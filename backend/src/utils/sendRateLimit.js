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
const TICK_GRACE_MS = 5 * 60 * 1000; // Grace period for delayed tick

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
  const date = row?.date || '';
  const today = todayStr();
  if (date !== today) {
    db.prepare("UPDATE send_rate_limit SET date = ?, count = 0, last_send_at = 0 WHERE id = 1").run(today);
    return { date: today, count: 0, lastSendAt: 0 };
  }
  return { date, count: row?.count || 0, lastSendAt: row?.last_send_at || 0 };
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

// Reset the daily rate counter so the scheduler recalculates slots from scratch.
// Called when auto-send is re-enabled or debug mode is turned off.
export function resetRateState() {
  db.prepare("UPDATE send_rate_limit SET date = ?, count = 0, last_send_at = 0 WHERE id = 1").run(todayStr());
}

// Clear stale scheduled_at timestamps so pending items get fresh ETAs on the
// next tick.  Without this, items scheduled for a slot that passed while
// auto-send was off would either fire immediately or stay stuck.
export function clearScheduledAt() {
  return db.prepare("UPDATE send_queue SET scheduled_at = NULL WHERE status = 'pending'").run().changes;
}

// Remove duplicate / misaligned `scheduled_at` values so the UNIQUE partial index
// can be created and the invariant "one item per slot" holds. Only touches rows
// that already have a scheduled_at — NULL (flowing) items are left untouched,
// preserving the pending-queue semantics. Returns the number of rows changed.
export function dedupeScheduledAt() {
  const perDay = getPerDay();
  if (perDay <= 0) return 0;
  const intervalMs = (24 / perDay) * 60 * 60 * 1000;
  if (intervalMs <= 0) return 0;
  const today = dayStart(Date.now());
  const rows = db.prepare(
    "SELECT id, scheduled_at FROM send_queue WHERE status = 'pending' AND scheduled_at IS NOT NULL ORDER BY scheduled_at ASC, id ASC"
  ).all();
  if (rows.length === 0) return 0;
  const seen = new Set();
  const upd = db.prepare('UPDATE send_queue SET scheduled_at = ? WHERE id = ?');
  let changes = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      let k = Math.round((Number(r.scheduled_at) - today) / intervalMs);
      if (k < 0) k = 0;
      while (seen.has(k)) k++;
      seen.add(k);
      const newTs = today + k * intervalMs;
      if (newTs !== Number(r.scheduled_at)) {
        upd.run(newTs, r.id);
        changes++;
      }
    }
  });
  tx();
  return changes;
}

// One-time integrity: dedupe overlapping scheduled_at and create a partial UNIQUE
// index (per-day schedule, only pending rows with a slot). Idempotent; safe to
// call on every boot.
export function initScheduleIntegrity() {
  dedupeScheduledAt();
  const ddl =
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_send_queue_sched ON send_queue(scheduled_at) WHERE status = 'pending' AND scheduled_at IS NOT NULL";
  try {
    db.exec(ddl);
  } catch (e) {
    // A duplicate slipped through (e.g. concurrent writer) — dedupe again and retry.
    try {
      dedupeScheduledAt();
      db.exec(ddl);
    } catch (e2) {
      console.error('[send] failed to enforce unique scheduled_at:', (e2 && e2.message) || e2);
    }
  }
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
  const slotAfterLastSend = state.lastSendAt > start
    ? Math.floor((state.lastSendAt - start) / intervalMs) + 1
    : 0;
  let nextSlot = Math.max(elapsedSlots, slotsUsed, slotAfterLastSend);

  // Grace period: skip ALL missed slots so items never get assigned to a
  // slot that already expired. Without this, a delayed tick could place
  // items into a slot that started >5 min ago.
  while (nextSlot < perDay) {
    const slotStart = start + nextSlot * intervalMs;
    if (now >= slotStart + TICK_GRACE_MS) {
      nextSlot += 1;
    } else {
      break;
    }
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

// Build a timeline of pending items with their individual ETAs
// Each item gets its own ETA based on slot timeline, enabling cascading
export function buildQueueTimeline({ now, pendingItems, perDay, rateState }) {
  if (!pendingItems || pendingItems.length === 0) {
    return [];
  }

  const sendable = [];
  const held = [];
  const scheduled = [];

  for (const item of pendingItems) {
    const hold = Number(item.hold_until) || 0;
    const sched = Number(item.scheduled_at) || 0;
    if (hold > now) {
      held.push({ ...item, _eta: hold });
    } else if (sched > now) {
      scheduled.push({ ...item, _eta: sched });
    } else {
      sendable.push(item);
    }
  }

  // Sendable items get slot-based ETAs assigned in THIS deterministic order,
  // independent of how `pendingItems` was pre-sorted by the caller. `scheduled_at`
  // is an ABSOLUTE epoch (not an offset), so we can't sort by its raw value
  // (NULL=0 would sort before a just-lapsed past timestamp). Instead:
  //   group 0 = lapsed scheduled_at (past, but >0): send ASAP, earliest-lapsed first
  //   group 1 = NULL/auto-flow: keep manual queue order (sort_order, then id)
  // This guarantees an item whose scheduled slot just lapsed is placed on the
  // next free slot rather than being pushed to the far end of the queue, and the
  // same ordering is produced regardless of caller input order.
  sendable.sort((a, b) => {
    const sa = Number(a.scheduled_at) || 0;
    const sb = Number(b.scheduled_at) || 0;
    const ga = sa > 0 && sa <= now ? 0 : 1;
    const gb = sb > 0 && sb <= now ? 0 : 1;
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      if (sa !== sb) return sa - sb;
    } else {
      const soa = a.sort_order ?? a.id;
      const sob = b.sort_order ?? b.id;
      if (soa !== sob) return soa - sob;
    }
    return a.id - b.id;
  });

  const result = [];

  // Held items: ETA = hold_until, not ready
  for (const item of held) {
    result.push({
      id: item.id,
      fileId: item.file_id,
      target: item.target,
      caption: item.caption || '',
      eta: item._eta,
      ready: false,
    });
  }

  // Scheduled items: ETA = scheduled_at, not ready
  for (const item of scheduled) {
    result.push({
      id: item.id,
      fileId: item.file_id,
      target: item.target,
      caption: item.caption || '',
      eta: item._eta,
      ready: false,
    });
  }

  // Sendable items: slot-based ETA, collision-free.
  if (sendable.length > 0) {
    const today = dayStart(now);
    const intervalMs = perDay > 0 ? (24 / perDay) * 60 * 60 * 1000 : 0;
    const slots = perDay > 0 ? calculateSlotsForDay(now, perDay) : [];

    if (perDay > 0 && slots.length > 0) {
      const slotsUsed = rateState?.count || 0;
      const lastSendAt = rateState?.lastSendAt || 0;
      const elapsedSlots = Math.floor((now - today) / intervalMs);
      const slotAfterLastSend = lastSendAt > today
        ? Math.floor((lastSendAt - today) / intervalMs) + 1
        : 0;
      let nextSlotIdx = Math.max(elapsedSlots, slotsUsed, slotAfterLastSend);

      while (nextSlotIdx < perDay) {
        const slotStart = slots[nextSlotIdx];
        if (now >= slotStart + TICK_GRACE_MS) {
          nextSlotIdx += 1;
        } else {
          break;
        }
      }

      // Slots already owned by scheduled / held items must not be reused by the
      // computed (NULL) ETAs — otherwise two pending items would share a time
      // ("numpuk jadwal"). Only slot-aligned timestamps count as occupied.
      const occupied = new Set();
      const alignTol = Math.min(1000, Math.floor(intervalMs / 2));
      const markOccupied = (ts) => {
        const offset = ts - today;
        if (offset < 0) return;
        const frac = offset % intervalMs;
        const dist = Math.min(frac, intervalMs - frac);
        if (dist <= alignTol) {
          const k = Math.round(offset / intervalMs);
          if (k >= 0) occupied.add(k);
        }
      };
      for (const it of scheduled) markOccupied(it._eta);
      for (const it of held) markOccupied(it._eta);

      // Walk global slot indices (today = 0..perDay-1, tomorrow = perDay..) and
      // place each sendable item on the first free slot, skipping occupied ones.
      let cursorIdx = nextSlotIdx;
      let placed = 0;
      while (placed < sendable.length) {
        while (occupied.has(cursorIdx)) cursorIdx++;
        const eta = today + cursorIdx * intervalMs;
        const item = sendable[placed];
        result.push({
          id: item.id,
          fileId: item.file_id,
          target: item.target,
          caption: item.caption || '',
          eta,
          ready: eta <= now,
        });
        placed++;
        cursorIdx++;
      }
    } else if (perDay === 0) {
      // Unlimited mode: all sendable items are ready now
      for (const item of sendable) {
        result.push({
          id: item.id,
          fileId: item.file_id,
          target: item.target,
          caption: item.caption || '',
          eta: now,
          ready: true,
        });
      }
    }
  }

  return result;
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
// must NOT be enqueued again → no duplicate WA Status post.
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
// pick it up while the direct-send path is still performing the send. Records
// processing_started_at so a crash can be detected/reclaimed after STUCK_MS.
export function markProcessing(id) {
  db.prepare("UPDATE send_queue SET status = 'processing', processing_started_at = ? WHERE id = ?").run(Date.now(), id);
}

// ── Permanent-media-error preflight ──
// WhatsApp (Status / Channel — and therefore 'whatsapp' / 'all') requires whole-
// media compatibility, not just a streamable video: the VIDEO must be H.264
// (avc1/avc3/h264) AND, when an AUDIO stream is present, it must be AAC. A video
// that fails either check can NEVER succeed on WhatsApp, so it is failed
// immediately as a PERMANENT_MEDIA_ERROR — never claimed into 'processing', never
// retried, and a manual retry/reschedule is rejected (changing the time doesn't
// fix the media). This closes the same gap as the earlier AV1 fix: the previous
// check only looked at video compatibility (is_stream_compatible), so an H.264
// video with an incompatible audio codec (e.g. Opus) slipped through to the send
// and failed at WhatsApp. The check now reads the normalized videoCodec /
// audioCodec fields instead of the browser-only is_stream_compatible flag.
// Items not yet probed (codec_info NULL) fall through to the normal send path so
// a future scan can still classify them; Telegram-only targets are exempt
// (Telegram handles far more codecs than WhatsApp).
const WA_TARGETS = new Set(['whatsapp', 'all', 'channel', 'status']);
// WhatsApp accepts H.264 (avc1/avc3 are H.264 tags) for video.
const WA_VIDEO_OK = new Set(['h264', 'avc1', 'avc3']);
// WhatsApp accepts AAC audio. mp4a is the AAC codec tag and is normalized to
// 'aac' by the scanner; an empty audioCodec means no audio stream (silent video,
// which is fine).
function isWaAudioOk(audioCodec) {
  return !audioCodec || audioCodec === 'aac' || audioCodec === 'mp4a';
}
export function waPermanentMediaError(fileId, target) {
  if (!WA_TARGETS.has(target)) return null; // Telegram-only: codec-agnostic
  const row = db.prepare('SELECT codec_info FROM files WHERE id = ?').get(fileId);
  if (!row || row.codec_info == null) return null; // not probed yet → let send path decide
  let ci;
  try { ci = JSON.parse(row.codec_info); } catch { return null; }
  const videoCodec = (ci.videoCodec || ci.video_codec || '').toString().toLowerCase();
  const audioCodec = (ci.audioCodec || ci.audio_codec || '').toString().toLowerCase();
  if (!videoCodec) return null; // no video stream → not our media; let send path decide
  if (!WA_VIDEO_OK.has(videoCodec)) {
    return `Permanent media error: WhatsApp requires H.264 video (detected video: ${videoCodec || 'unknown'})`;
  }
  if (!isWaAudioOk(audioCodec)) {
    return `Permanent media error: WhatsApp requires H.264 video + AAC audio (detected audio: ${audioCodec || 'unknown'})`;
  }
  return null;
}

// Atomic claim: the PRIMARY dedup mechanism. A worker claims a 'pending' row (or
// reclaims a 'processing' row that has been stuck longer than STUCK_MS) by
// flipping it to 'processing' in a single conditional UPDATE. Returns true only if
// exactly one row was changed — so two overlapping scheduler ticks (or a restart)
// can never both send the same item. This is what actually fixes duplicate/triple
// auto-sends; tickInFlight is only a secondary local guard.
export function claimPending(id, now = Date.now()) {
  const info = db.prepare(`
    UPDATE send_queue
    SET status = 'processing', processing_started_at = ?
    WHERE id = ?
      AND (status = 'pending'
           OR (status = 'processing' AND COALESCE(processing_started_at, created_at) < ?))
  `).run(Date.now(), id, now - STUCK_MS);
  return info.changes === 1;
}

// The scheduler only drains 'pending'. A 'processing' row is one the direct-send
// path is actively working on — it's excluded so it can't be double-sent. A
// 'processing' row older than STUCK_MS is treated as a lost send (process died
// mid-send) and reclaimed for retry. Returns retry_count + processing_started_at
// so the scheduler can decide retry vs permanent-failure and detect stuck rows.
const STUCK_MS = 10 * 60 * 1000;
export function getPendingSends() {
  const now = Date.now();
  return db.prepare(`
    SELECT id, file_id, target, created_at, status, caption, retry_count, processing_started_at
    FROM send_queue
    WHERE (status = 'pending' AND (hold_until IS NULL OR hold_until <= ?) AND (scheduled_at IS NULL OR scheduled_at <= ?))
       OR (status = 'processing' AND COALESCE(processing_started_at, created_at) < ?)
    ORDER BY COALESCE(scheduled_at, 0) ASC, COALESCE(sort_order, id) ASC, id ASC
  `).all(now, now, now - STUCK_MS);
}

// All pending/processing items regardless of hold/schedule status.
// Used for the UI timeline so held/scheduled items still show an ETA.
export function getAllPendingSends() {
  return db.prepare(`
    SELECT id, file_id, target, created_at, status, caption, hold_until, scheduled_at, sort_order
    FROM send_queue
    WHERE status IN ('pending', 'processing')
    ORDER BY COALESCE(scheduled_at, 0) ASC, COALESCE(sort_order, id) ASC, id ASC
  `).all();
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

// Append a structured attempt record to attempt_log (JSON, capped ~5). Shape:
// { attempt, started_at, result: 'success'|'failed', error }. Lets us diagnose
// "item X selalu gagal" at a glance instead of guessing.
export function recordAttempt(id, attemptNo, ok, msg) {
  const errMsg = ok ? null : (msg || 'Send failed: unknown error');
  const row = db.prepare('SELECT attempt_log FROM send_queue WHERE id = ?').get(id);
  let log = [];
  try { if (row && row.attempt_log) log = JSON.parse(row.attempt_log); } catch {}
  if (!Array.isArray(log)) log = [];
  log.push({
    attempt: attemptNo,
    started_at: new Date().toISOString(),
    result: ok ? 'success' : 'failed',
    error: errMsg,
  });
  if (log.length > 5) log = log.slice(-5);
  db.prepare('UPDATE send_queue SET attempt_log = ? WHERE id = ?').run(JSON.stringify(log), id);
}

export function markSendDone(id, ok, error) {
  // `error` is NEVER stored as NULL on failure: the caller passes the real reason
  // (or we coerce to a generic message) so a "failed" row always carries a cause.
  const err = error || (ok ? null : 'Send failed: unknown error');
  const row = db.prepare('SELECT retry_count FROM send_queue WHERE id = ?').get(id);
  const attemptNo = (row && Number.isFinite(row.retry_count) ? row.retry_count : 0) + 1;
  recordAttempt(id, attemptNo, ok, err);
  db.prepare('UPDATE send_queue SET status = ?, error = ?, completed_at = ? WHERE id = ?').run(ok ? 'done' : 'failed', err, Date.now(), id);
}

// Requeue a failed attempt for another try. `retryCount` is the item's current
// completed-attempt count (so the attempt number logged is retryCount+1). Applies
// a backoff hold so retries don't hammer immediately. Increments retry_count.
export function requeueForRetry(id, retryCount, msg) {
  const errMsg = msg || 'Send failed: unknown error';
  recordAttempt(id, retryCount + 1, false, errMsg);
  const now = Date.now();
  const hold = now + 60_000 * (retryCount + 1);
  db.prepare("UPDATE send_queue SET status = 'pending', scheduled_at = NULL, hold_until = ?, retry_count = retry_count + 1 WHERE id = ?")
    .run(hold, id);
}

export function cancelSend(id) {
  const info = db.prepare("UPDATE send_queue SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(id);
  if (info.changes > 0) {
    db.prepare("UPDATE send_queue SET scheduled_at = NULL, hold_until = 0 WHERE status = 'pending'").run();
  }
  return info.changes > 0;
}

export function retrySend(id) {
  // MANUAL retry: reset the attempt budget to a fresh 3 attempts. Distinct from
  // rescheduleQueueItem (which only moves scheduled_at and keeps retry_count).
  const row = db.prepare('SELECT id, file_id, target, status FROM send_queue WHERE id = ?').get(id);
  if (!row || row.status !== 'failed') return false;
  // A known-incompatible (e.g. AV1) video can NEVER succeed — reject the manual
  // retry so we don't re-queue a deterministically-impossible send. The user must
  // first transcode to H.264 and refresh the DB metadata before retrying.
  const permErr = waPermanentMediaError(row.file_id, row.target);
  if (permErr) throw new Error(permErr);
  const info = db.prepare("UPDATE send_queue SET status = 'pending', error = NULL, scheduled_at = NULL, hold_until = 0, retry_count = 0, attempt_log = NULL WHERE id = ? AND status = 'failed'").run(id);
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

// Reschedule inserts an item at a chosen ABSOLUTE calendar slot and cascade-
// shifts everything at/after that slot down by one interval — like
// `array.splice(index, 0, X)`. The relative order of the existing items is
// always preserved (a uniform shift can never collide). This ONLY writes
// `scheduled_at`; it must NOT touch `sort_order`. The two are independent axes:
//   sort_order    = manual queue order (reorderQueueItem up/down + main queue list)
//   scheduled_at  = absolute calendar slot (NULL = auto-flow)
// Old behaviour only bumped the first colliding item, which leapfrogged the
// next one (e.g. inserting 8 at slot 2 of 1..8 gave 1 8 3 2 …). The cascade
// gives the correct 1 8 2 3 4 5 6 7 deterministically.
export function rescheduleQueueItem(id, scheduledAt) {
  if (!scheduledAt) {
    const info = db.prepare("UPDATE send_queue SET scheduled_at = NULL, hold_until = 0 WHERE id = ? AND status = 'pending'").run(id);
    return info.changes > 0;
  }
  const ts = Number(scheduledAt);
  const perDay = getPerDay();
  // Nudge step: real per-day interval when rate-limited, else a fixed 1-min
  // guard so a shift still progresses (perDay=0 = unlimited).
  const intervalMs = perDay > 0 ? (24 / perDay) * 60 * 60 * 1000 : 60 * 1000;

  const updSched = db.prepare('UPDATE send_queue SET scheduled_at = ?, hold_until = 0 WHERE id = ?');
  const tx = db.transaction(() => {
    // Push every OTHER pending item currently at or after the target slot down
    // by one interval, preserving their relative order (uniform shift = no
    // collisions). NULL scheduled_at (auto-flow) is excluded (scheduled_at >= ts
    // is false for NULL).
    db.prepare(
      "UPDATE send_queue SET scheduled_at = scheduled_at + ? " +
      "WHERE status = 'pending' AND id <> ? AND scheduled_at >= ?"
    ).run(intervalMs, id, ts);
    // Pin the moved item exactly on the chosen slot.
    updSched.run(ts, id);
  });
  tx();
  return true;
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

  // When auto-send is re-enabled (OFF→ON) or debug mode is turned OFF,
  // reset the rate state and tidy overlapping scheduled_at. We deliberately do
  // NOT clear scheduled_at for the whole pending set — that would destroy the
  // user-chosen calendar slots (the explicit-slot feature). Pinned items keep
  // their slot; only collisions are re-spaced.
  const turnedOn = !cur.tickEnabled && nextTick;
  const debugOff = cur.debugMode && !nextDebug;
  if (turnedOn || debugOff) {
    resetRateState();
    dedupeScheduledAt();
  }

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
    else if (r.status in counts) counts[r.status] += r.c;
  }
  return counts;
}

// Build a safe `target IN (...)` filter condition (WITHOUT a leading Where so it
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

const VALID_SORT_BY = new Set([null, 'name', 'size', 'created_at', 'completed_at']);
const VALID_SORT_ORDER = new Set(['asc', 'desc']);
const VALID_TYPE_FILTER = new Set([null, 'video', 'image']);

export function getQueueByStatus(status, cursor = 0, limit = 100, target, opts = {}) {
  const sortBy = VALID_SORT_BY.has(opts.sortBy) ? opts.sortBy : null;
  const sortOrder = VALID_SORT_ORDER.has(opts.sortOrder) ? opts.sortOrder : 'desc';
  const typeFilter = VALID_TYPE_FILTER.has(opts.typeFilter) ? opts.typeFilter : null;

  const isPending = status === 'pending';

  // Pending with the default (queue) order follows the merged calendar timeline
  // built by buildQueueTimeline: scheduled_at is an ABSOLUTE slot on a shared
  // timeline, not a sort bucket that pushes items to the top/bottom. Slots are
  // allocated globally (send_rate_limit is shared), so target/type filters are
  // applied AFTER ordering and must not affect slot allocation.
  if (isPending && !sortBy) {
    const allRows = db.prepare(`
      SELECT sq.id AS qid, sq.id AS id, sq.file_id, sq.target, sq.created_at, sq.status, sq.error,
             sq.hold_until, sq.completed_at, sq.caption, sq.debug, sq.sort_order, sq.scheduled_at,
             f.name, f.type, f.ext, f.has_thumb, f.size, f.duration
      FROM send_queue sq
      LEFT JOIN files f ON f.id = sq.file_id
      WHERE sq.status IN ('pending','processing')
      ORDER BY COALESCE(sq.sort_order, sq.id) ASC, sq.id ASC
    `).all();

    const now = Date.now();
    const timeline = buildQueueTimeline({ now, pendingItems: allRows, perDay: getPerDay(), rateState: getRateState() });
    const etaById = new Map(timeline.map(t => [t.id, t.eta]));

    // Sort by merged-timeline eta (scheduled/held/auto-flow all share one axis),
    // tie-break by manual queue order, then id. This is the single source of
    // truth for the grid `#` position.
    allRows.sort((a, b) => {
      const ea = etaById.get(a.qid) ?? Infinity;
      const eb = etaById.get(b.qid) ?? Infinity;
      if (ea !== eb) return ea - eb;
      const sa = a.sort_order ?? a.qid;
      const sb = b.sort_order ?? b.qid;
      if (sa !== sb) return sa - sb;
      return a.qid - b.qid;
    });

    // Filter target/type in JS so global slot allocation is preserved.
    const { condition, params } = targetFilter(target);
    let filtered = allRows;
    if (condition) {
      const allowed = new Set(params);
      filtered = filtered.filter(r => allowed.has(r.target));
    }
    if (typeFilter) {
      filtered = filtered.filter(r => r.type === typeFilter);
    }

    // Offset-based pagination: the list is sorted in JS, so an id-based cursor
    // no longer works. The frontend round-trips nextCursor and dedupes appends.
    const offset = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
    const page = filtered.slice(offset, offset + limit);
    const nextCursor = offset + limit < filtered.length ? offset + limit : null;
    return { items: page, nextCursor };
  }

  const { condition, params } = targetFilter(target);
  const statusClause = isPending ? "sq.status IN ('pending','processing')" : 'sq.status = ?';
  const statusParam = isPending ? [] : [status];

  const extraWhere = [];
  const extraParams = [];
  if (typeFilter) {
    extraWhere.push('f.type = ?');
    extraParams.push(typeFilter);
  }

  const isDesc = !isPending && sortOrder === 'desc';
  const whereParts = [statusClause];
  const queryParams = [...statusParam];

  if (!(isDesc && cursor === 0)) {
    const op = isDesc ? '<' : '>';
    whereParts.push(`sq.id ${op} ?`);
    queryParams.push(cursor);
  }

  whereParts.push(condition, ...extraWhere);
  const where = whereParts.filter(Boolean).join(' AND ');
  const allParams = [...queryParams, ...extraParams, ...params];
  let orderBy = isPending
    ? 'COALESCE(sq.scheduled_at, 0) ASC, COALESCE(sq.sort_order, sq.id) ASC, sq.id ASC'
    : 'COALESCE(sq.completed_at, sq.created_at) DESC, sq.id DESC';
  if (sortBy === 'name') orderBy = 'f.name COLLATE NOCASE ASC, sq.id ASC';
  else if (sortBy === 'size') orderBy = 'COALESCE(f.size, 0) DESC, sq.id ASC';
  else if (sortBy === 'created_at') orderBy = 'sq.created_at DESC, sq.id DESC';
  else if (sortBy === 'completed_at') orderBy = 'sq.completed_at DESC, sq.id DESC';
  if (sortBy && sortOrder === 'asc') {
    orderBy = orderBy.replace(/ DESC/g, ' ASC').replace(/ ASC/g, ' DESC');
  }

  const rows = db.prepare(`
    SELECT sq.id AS qid, sq.file_id, sq.target, sq.created_at, sq.status, sq.error,
           sq.hold_until, sq.completed_at, sq.caption, sq.debug, sq.sort_order, sq.scheduled_at,
           f.name, f.type, f.ext, f.has_thumb, f.size, f.duration
    FROM send_queue sq
    LEFT JOIN files f ON f.id = sq.file_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ?
  `).all(...allParams, limit);
  const last = rows.length ? rows[rows.length - 1].qid : cursor;
  return { items: rows, nextCursor: rows.length < limit ? null : last };
}
