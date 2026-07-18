import db from '../db.js';

// Rate limit is expressed as "N sends per day" (UI: 1x/24h, 2x/12h, 3x/8h, 4x/6h,
// 5x/4.8h, 6x/4h). The interval between sends is 24h / perDay, and the schedule is
// anchored to 00:00 local time each day — slots fall on 00:00, (24/perDay)h, … so
// ticks are evenly spaced and reset at midnight. A perDay of 0 (or SEND_DAILY_CAP=0)
// means UNLIMITED (used while testing).
const MAX_PER_DAY = 6; // UI slider max: 1x..6x per day
const rawCap = process.env.SEND_DAILY_CAP;
const clampCap = (n) => Math.min(MAX_PER_DAY, Math.max(0, n));
const ENV_CAP = clampCap(rawCap === undefined || rawCap === '' ? 3 : parseInt(rawCap, 10));

// Default perDay when no UI setting exists yet (kept in sync with env cap).
function defaultPerDay() {
  return ENV_CAP; // env cap == perDay (1x..Nx). 0 = unlimited.
}

// Resolve the active per-day count from the persisted settings (UI wins), falling
// back to the env default. Returns 0 for unlimited.
export function getPerDay() {
  try {
    const row = db.prepare('SELECT per_day FROM send_settings WHERE id = 1').get();
    if (row && Number.isFinite(row.per_day)) return clampCap(row.per_day);
  } catch {}
  return defaultPerDay();
}

// Allow tests / env to override until settings table is ready.
let overridePerDay = null;
export function setPerDayForProcess(n) { overridePerDay = n; }

function activePerDay() {
  if (overridePerDay !== null) return overridePerDay;
  return getPerDay();
}

const DAILY_CAP = ENV_CAP;
const PER_DAY = activePerDay();
const MIN_INTERVAL_HOURS = PER_DAY > 0 ? (24 / PER_DAY) : 0;
const MIN_INTERVAL_MS = MIN_INTERVAL_HOURS * 60 * 60 * 1000;

// Anti-double-send window: the recent-send dedup. When interval > 0 we reuse that
// cooldown; when unlimited (0) we still guard against accidental rapid re-sends of
// the SAME file+target with a fixed window.
const DEDUP_WINDOW_MS = MIN_INTERVAL_MS > 0 ? MIN_INTERVAL_MS : 5 * 60 * 1000;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Local midnight (00:00) of a given timestamp — the anchor for the daily schedule.
function dayStart(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getRateState() {
  const row = db.prepare('SELECT date, count, last_send_at FROM send_rate_limit WHERE id = 1').get();
  return { date: row?.date || '', count: row?.count || 0, lastSendAt: row?.last_send_at || 0 };
}

function resetIfNewDay() {
  const state = getRateState();
  if (state.date !== todayStr()) {
    db.prepare("UPDATE send_rate_limit SET date = ?, count = 0, last_send_at = 0 WHERE id = 1").run(todayStr());
    return { date: todayStr(), count: 0, lastSendAt: 0 };
  }
  return state;
}

export function recordSend() {
  const state = resetIfNewDay();
  db.prepare('UPDATE send_rate_limit SET count = ?, last_send_at = ? WHERE id = 1').run(state.count + 1, Date.now());
}

export function canSendNow() {
  const state = resetIfNewDay();
  const now = Date.now();
  const perDay = getPerDay();
  const unlimited = perDay === 0;
  const slotsUsed = state.count;
  const intervalMs = (24 / perDay) * 60 * 60 * 1000;
  const start = dayStart(now);

  if (unlimited) {
    return {
      allowed: true,
      unlimited: true,
      nextAllowedAt: 0,
      nextSlotAt: 0,
      remainingToday: Infinity,
      dailyCap: 0,
      minIntervalHours: 0,
    };
  }

  const elapsedSlots = Math.floor((now - start) / intervalMs);

  let nextSlot;
  if (state.lastSendAt > start) {
    nextSlot = Math.floor((state.lastSendAt - start) / intervalMs) + 1;
  } else {
    nextSlot = Math.max(elapsedSlots, slotsUsed);
  }

  let nextAllowedAt;
  if (nextSlot >= perDay) {
    nextAllowedAt = start + 24 * 60 * 60 * 1000;
  } else {
    nextAllowedAt = start + nextSlot * intervalMs;
  }

  const allowed = now >= nextAllowedAt && slotsUsed < perDay;

  let nextSlotAt;
  if (nextSlot >= perDay) {
    nextSlotAt = start + 24 * 60 * 60 * 1000;
  } else {
    nextSlotAt = start + (nextSlot + 1) * intervalMs;
  }

  return {
    allowed,
    unlimited: false,
    nextAllowedAt,
    nextSlotAt,
    remainingToday: Math.max(0, perDay - slotsUsed),
    dailyCap: perDay,
    minIntervalHours: 24 / perDay,
  };
}

// Calculate slot timestamps for a given day based on perDay setting
// Returns array of timestamps: [00:00, 08:00, 16:00] for perDay=3
function calculateSlotsForDay(ts = Date.now(), perDay) {
  if (perDay === 0) return [];
  
  const start = dayStart(ts);
  const intervalMs = (24 / perDay) * 60 * 60 * 1000;
  const slots = [];
  
  for (let i = 0; i < perDay; i++) {
    slots.push(start + i * intervalMs);
  }
  
  return slots;
}

// Find the current slot index (slots that have passed or are current)
function findCurrentSlotIndex(now, slots) {
  return slots.findIndex(slot => slot > now);
}

// Build a timeline of pending items with their individual ETAs
// Each item gets its own ETA based on slot timeline, enabling cascading
export function buildQueueTimeline({ now, pendingItems, perDay, rateState }) {
  if (perDay === 0 || !pendingItems || pendingItems.length === 0) {
    return [];
  }
  
  const today = dayStart(now);
  const tomorrow = today + 24 * 60 * 60 * 1000;
  const intervalMs = (24 / perDay) * 60 * 60 * 1000;
  const slots = calculateSlotsForDay(now, perDay);
  
  if (slots.length === 0) return [];
  
  const slotsUsed = rateState?.count || 0;
  const lastSendAt = rateState?.last_send_at || 0;
  
  // Calculate elapsed slots from midnight
  const elapsedSlots = Math.floor((now - today) / intervalMs);
  
  // Determine next available slot index
  // Priority: 1) After last send, 2) Next unused slot, 3) First future slot
  let nextSlotIdx;
  if (lastSendAt > today) {
    // Items sent today: next slot is after the last send's slot
    nextSlotIdx = Math.floor((lastSendAt - today) / intervalMs) + 1;
  } else if (slotsUsed < perDay) {
    // No sends yet today: next slot is the first unused one
    nextSlotIdx = slotsUsed;
  } else {
    // All today's slots used: items wait for tomorrow
    nextSlotIdx = perDay;
  }
  
  // If all today's slots are used, items go to tomorrow
  if (nextSlotIdx >= perDay) {
    return pendingItems.map((item, position) => {
      const tomorrowSlotIdx = position;
      const eta = tomorrow + tomorrowSlotIdx * intervalMs;
      return {
        id: item.id,
        fileId: item.file_id,
        target: item.target,
        caption: item.caption || '',
        eta,
        ready: eta <= now,
      };
    });
  }
  
  return pendingItems.map((item, position) => {
    const slotIdx = nextSlotIdx + position;
    let eta;
    
    if (slotIdx < slots.length) {
      eta = slots[slotIdx];
    } else {
      // Item needs to wait for tomorrow's slots
      const tomorrowSlotIdx = slotIdx - slots.length;
      eta = tomorrow + tomorrowSlotIdx * intervalMs;
    }
    
    return {
      id: item.id,
      fileId: item.file_id,
      target: item.target,
      caption: item.caption || '',
      eta,
      ready: eta <= now,
    };
  });
}

export function enqueueSend(fileId, target, debug = 0, caption = '') {
  const info = db.prepare('INSERT INTO send_queue (file_id, target, created_at, status, debug, caption) VALUES (?, ?, ?, ?, ?, ?)')
    .run(fileId, target, Date.now(), 'pending', debug ? 1 : 0, caption);
  return info.lastInsertRowid;
}

export function setQueueCaption(qid, caption) {
  db.prepare('UPDATE send_queue SET caption = ? WHERE id = ?').run(caption || '', qid);
}

// Wipe every row created during debug mode (test traffic). Both pending and
// history rows are removed — the user said debug history should be cleared when
// debug is turned off, and they clean up the rest manually.
export function clearDebugHistory() {
  return db.prepare('DELETE FROM send_queue WHERE debug = 1').run().changes;
}

// Sub-targets each logical target covers, so dedup can detect overlap (e.g. an
// 'all' or 'whatsapp' row already covers 'status', so a later 'status'-only send
// must NOT be enqueued again → no duplicate WA Status post).
const SUB_TARGETS = {
  telegram: ['telegram'],
  channel: ['channel'],
  status: ['status'],
  whatsapp: ['channel', 'status'],
  all: ['telegram', 'channel', 'status'],
};
function targetsOverlap(a, b) {
  const sa = SUB_TARGETS[a] || [];
  const sb = SUB_TARGETS[b] || [];
  return sa.some((t) => sb.includes(t));
}

// Anti-double-send: returns an existing in-flight or recently completed item that
// overlaps the requested target for the same file, so the same file is never
// queued/re-sent twice. Overlap is by sub-target (see SUB_TARGETS), not exact
// target match — e.g. a prior 'all' (which hits status) blocks a later 'status'
// request, preventing a duplicate status post.
export function getActiveOrRecentSend(fileId, target, withinMs = DEDUP_WINDOW_MS) {
  const rows = db.prepare(`
    SELECT id, file_id, target, status, created_at, error
    FROM send_queue
    WHERE file_id = ? AND created_at >= ?
    ORDER BY id DESC
  `).all(fileId, Date.now() - withinMs);
  for (const row of rows) {
    if (targetsOverlap(target, row.target)) return row;
  }
  return null;
}

// Mark an item as in-flight so the scheduler (which only drains 'pending') won't
// pick it up while the direct-send path is still performing the send.
export function markProcessing(id) {
  db.prepare("UPDATE send_queue SET status = 'processing' WHERE id = ?").run(id);
}

// The scheduler only drains 'pending'. A 'processing' row is one the direct-send
// path is actively working on — it's excluded so it can't be double-sent. If a
// process dies mid-send, such a row would be stuck, so we also recover any
// 'processing' row older than STUCK_MS (treat it as a lost send to retry).
const STUCK_MS = 10 * 60 * 1000;
export function getPendingSends() {
  return db.prepare(`
    SELECT id, file_id, target, created_at, status, caption
    FROM send_queue
    WHERE (status = 'pending' AND (hold_until IS NULL OR hold_until <= ?) AND (scheduled_at IS NULL OR scheduled_at <= ?))
       OR (status = 'processing' AND created_at < ?)
    ORDER BY COALESCE(sort_order, id) ASC, id ASC LIMIT 100
  `).all(Date.now(), Date.now(), Date.now() - STUCK_MS);
}

export function getPendingDebugSends() {
  return db.prepare(`
    SELECT sq.id AS qid, sq.file_id, sq.target, sq.created_at, sq.status, sq.caption,
           f.name, f.type, f.ext, f.has_thumb
    FROM send_queue sq
    LEFT JOIN files f ON f.id = sq.file_id
    WHERE sq.status = 'pending' AND sq.debug = 1
    ORDER BY sq.id ASC LIMIT 100
  `).all();
}

export function markSendDone(id, ok, error) {
  db.prepare('UPDATE send_queue SET status = ?, error = ?, completed_at = ? WHERE id = ?').run(ok ? 'done' : 'failed', error || null, Date.now(), id);
}

export function cancelSend(id) {
  const info = db.prepare("UPDATE send_queue SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(id);
  return info.changes > 0;
}

export function retrySend(id) {
  const info = db.prepare("UPDATE send_queue SET status = 'pending', error = NULL WHERE id = ? AND status = 'failed'").run(id);
  return info.changes > 0;
}

export function removeSend(id) {
  const info = db.prepare("DELETE FROM send_queue WHERE id = ? AND status != 'pending'").run(id);
  return info.changes > 0;
}

export function clearHistory() {
  return db.prepare("DELETE FROM send_queue WHERE status != 'pending'").run().changes;
}

export function reorderQueueItem(id, direction) {
  const item = db.prepare('SELECT id, sort_order FROM send_queue WHERE id = ? AND status = ?').get(id, 'pending');
  if (!item) return false;
  const currentOrder = item.sort_order ?? item.id;
  let neighbor;
  if (direction === 'up') {
    neighbor = db.prepare("SELECT id, sort_order FROM send_queue WHERE status = 'pending' AND (sort_order < ? OR (sort_order = ? AND id < ?)) ORDER BY sort_order DESC, id DESC LIMIT 1").get(currentOrder, currentOrder, id);
  } else {
    neighbor = db.prepare("SELECT id, sort_order FROM send_queue WHERE status = 'pending' AND (sort_order > ? OR (sort_order = ? AND id > ?)) ORDER BY sort_order ASC, id ASC LIMIT 1").get(currentOrder, currentOrder, id);
  }
  if (!neighbor) return false;
  const neighborOrder = neighbor.sort_order ?? neighbor.id;
  db.prepare('UPDATE send_queue SET sort_order = ? WHERE id = ?').run(neighborOrder, id);
  db.prepare('UPDATE send_queue SET sort_order = ? WHERE id = ?').run(currentOrder, neighbor.id);
  return true;
}

export function rescheduleQueueItem(id, scheduledAt) {
  const info = db.prepare("UPDATE send_queue SET scheduled_at = ?, hold_until = 0 WHERE id = ? AND status = 'pending'").run(scheduledAt || null, id);
  return info.changes > 0;
}

// ── Queue behaviour settings (auto-send tick + debug hold mode) ──
export function getSendSettings() {
  const row = db.prepare('SELECT tick_enabled, debug_mode, per_day, share_only_target FROM send_settings WHERE id = 1').get();
  return {
    tickEnabled: !!(row && row.tick_enabled),
    debugMode: !!(row && row.debug_mode),
    perDay: row && Number.isFinite(row.per_day) ? clampCap(row.per_day) : defaultPerDay(),
  };
}

export function setSendSettings({ tickEnabled, debugMode, perDay } = {}) {
  const cur = getSendSettings();
  const nextTick = typeof tickEnabled === 'boolean' ? (tickEnabled ? 1 : 0) : (cur.tickEnabled ? 1 : 0);
  const nextDebug = typeof debugMode === 'boolean' ? (debugMode ? 1 : 0) : (cur.debugMode ? 1 : 0);
  let nextPerDay = cur.perDay;
  if (typeof perDay === 'number' && Number.isFinite(perDay) && perDay >= 0 && perDay <= MAX_PER_DAY) {
    nextPerDay = Math.round(perDay);
  }
  db.prepare('UPDATE send_settings SET tick_enabled = ?, debug_mode = ?, per_day = ? WHERE id = 1').run(nextTick, nextDebug, nextPerDay);
  return { tickEnabled: !!nextTick, debugMode: !!nextDebug, perDay: nextPerDay };
}

// Debug hold: when debug mode is turned ON while the next auto-send slot is still
// in the future, push every pending item 8h ahead so the tick won't sweep the queue
// while a human inspects the send pipeline. If the next slot has ALREADY passed
// (debug was enabled after the scheduled time), items are left untouched — their
// send time does NOT shift forward.
export function holdPendingForDebug(hours = 8) {
  const policy = canSendNow();
  // nextAllowedAt is in the future → debug is "above schedule" → reschedule.
  if (!policy.nextAllowedAt || policy.nextAllowedAt <= Date.now()) {
    return 0; // nothing to hold; schedule already passed, leave as-is.
  }
  const until = Date.now() + hours * 60 * 60 * 1000;
  return db.prepare(
    "UPDATE send_queue SET hold_until = ? WHERE status = 'pending' AND hold_until < ?"
  ).run(until, until).changes;
}

export function clearHolds() {
  return db.prepare("UPDATE send_queue SET hold_until = 0 WHERE status = 'pending'").run().changes;
}

export function getStatusCounts(target) {
  const base = 'SELECT status, COUNT(*) AS c FROM send_queue';
  const { condition, params } = targetFilter(target);
  const rows = db.prepare(`${base}${condition ? ' WHERE ' + condition : ''} GROUP BY status`).all(...params);
  const counts = { pending: 0, done: 0, failed: 0, canceled: 0 };
  for (const r of rows) {
    // 'processing' rows (in-flight direct send, or a send crashed <10min ago)
    // are still "not delivered" — fold them into pending so the queue count stays
    // exact for notifications/auto-send instead of vanishing from every bucket.
    if (r.status === 'processing') counts.pending += r.c;
    else if (r.status in counts) counts[r.status] = r.c;
  }
  return counts;
}

// Build a safe `target IN (...)` filter condition (WITHOUT a leading WHERE so it
// can be appended after an existing WHERE with AND). `target` may be a
// comma-separated list (e.g. 'whatsapp,all'). Only whitelisted values are allowed
// — anything else is dropped to prevent SQL injection via the query string.
const VALID_TARGETS = new Set(['whatsapp', 'all', 'telegram', 'channel', 'status']);
function targetFilter(target) {
  if (!target) return { condition: '', params: [] };
  const list = String(target).split(',').map(s => s.trim()).filter(Boolean)
    .filter(t => VALID_TARGETS.has(t));
  if (list.length === 0) return { condition: '', params: [] };
  const placeholders = list.map(() => '?').join(',');
  return { condition: `target IN (${placeholders})`, params: list };
}

export function getQueueByStatus(status, cursor = 0, limit = 100, target) {
  const { condition, params } = targetFilter(target);
  // 'processing' rows are in-flight direct sends (or a crashed send <10min ago)
  // and are still "not delivered" — getStatusCounts folds them into pending, so
  // the list must include them too. Otherwise the Antrian count shows N but the
  // list renders empty ("1 item, no items") whenever a send is mid-flight.
  const statusClause = status === 'pending' ? "sq.status IN ('pending','processing')" : 'sq.status = ?';
  // Only non-pending status uses a `?` placeholder for the status value; the
  // pending branch inlines the two literal statuses, so don't pass `status` as a
  // bound param there (otherwise sqlite throws "Too many parameter values").
  const statusParam = status === 'pending' ? [] : [status];
  const rows = db.prepare(`
    SELECT sq.id AS qid, sq.file_id, sq.target, sq.created_at, sq.status, sq.error,
           sq.hold_until, sq.completed_at, sq.caption, sq.debug, sq.sort_order, sq.scheduled_at,
           f.name, f.type, f.ext, f.has_thumb
    FROM send_queue sq
    LEFT JOIN files f ON f.id = sq.file_id
    WHERE ${statusClause} AND sq.id > ?${condition ? ' AND ' + condition : ''}
    ORDER BY COALESCE(sq.sort_order, sq.id) ASC, sq.id ASC
    LIMIT ?
  `).all(...statusParam, cursor, ...params, limit);
  const last = rows.length ? rows[rows.length - 1].qid : cursor;
  return { items: rows, nextCursor: rows.length < limit ? null : last };
}
