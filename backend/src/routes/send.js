import { Router } from 'express';
import db from '../db.js';
import { sendFileToTelegram, getBot } from '../utils/telegramBot.js';
import { getFileWithRelPath } from '../utils/fileResolver.js';
import { incrementTelegramCount, incrementWhatsAppCount, isSeparatorNeeded } from '../utils/sendCounter.js';
import { canSendNow, recordSend, enqueueSend, getActiveOrRecentSend, markProcessing, markSendDone, cancelSend, retrySend, removeSend, clearHistory, getStatusCounts, getQueueByStatus, getSendSettings, setSendSettings, clearHolds, clearDebugHistory, buildQueueTimeline, getPerDay, getPendingSends, getRateState, setQueueCaption, reorderQueueItem, rescheduleQueueItem } from '../utils/sendRateLimit.js';

const router = Router();
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1002821903652';
const WA_CHANNEL_JID = '120363428745244070@newsletter';

// ── Internet connectivity check ──
let internetOk = true;
let lastCheckAt = 0;
const CHECK_INTERVAL_MS = 30_000; // check every 30s
const CHECK_TIMEOUT_MS = 5_000;

async function checkInternet() {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) return internetOk;
  lastCheckAt = now;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    // Use Google's generate_204 as a lightweight connectivity probe
    const res = await fetch('https://clients3.google.com/generate_204', {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    internetOk = res.ok || res.status === 204;
  } catch {
    internetOk = false;
  }
  return internetOk;
}

router.get('/health/internet', async (_req, res) => {
  const ok = await checkInternet();
  res.json({ ok, checkedAt: lastCheckAt });
});

// In-memory per-target send progress, keyed by queueId. Lets the frontend show
// live "Tele / WA Ch / WA St" pills while a combined send is in flight. Lost on
// backend restart (acceptable — UI falls back to a plain "Sending…" state).
const sendProgress = new Map();

function setProgress(qid, patch) {
  // Only the targets actually being attempted are written; un-attempted targets
  // are never seeded as 'pending' (so the UI doesn't show a misleading "pending"
  // for, e.g., Tele/WA Ch during a 'status'-only send).
  const prev = sendProgress.get(qid) || {};
  sendProgress.set(qid, { ...prev, ...patch });
}
function clearProgress(qid) {
  sendProgress.delete(qid);
}

// Delay clearing so the frontend poller (every ~500ms) gets at least one chance
// to observe the final 'done'/'err' state and show the checkmark / error before
// the entry vanishes (which would otherwise make the pills disappear without
// ever showing the result).
function scheduleClearProgress(qid, ms = 2500) {
  setTimeout(() => clearProgress(qid), ms);
}

async function sendDotTelegram() {
  const bot = getBot();
  if (bot) {
    try { await bot.sendMessage(TELEGRAM_CHAT_ID, '.'); } catch {}
  }
}

async function sendDotWhatsApp() {
  try {
    const { getClient } = await import('../../../whatsapp-bot/src/connection.js');
    const client = getClient();
    if (client) {
      try { await client.sendMessage(WA_CHANNEL_JID, '.'); } catch {}
    }
  } catch {}
}

// Retry a single send on transient network / 5xx errors. Deterministic failures
// (e.g. Telegram 413 "file too large") are NOT retried. Without this, a single
// flaky "EFATAL: fetch failed" from the Telegram bot would permanently drop the
// send while the other targets (WA channel/status) still succeed.
async function sendWithRetry(fn, { retries = 3, baseDelay = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err && err.message) || String(err);
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ESOCKETTIMEDOUT|5\d\d|ETELEGRAM: 5/i.test(msg);
      if (!transient || attempt === retries) throw err;
      await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function performSend(fileId, target, qid, caption = '') {
  if (target === 'telegram') {
    if (qid) setProgress(qid, { telegram: 'sending' });
    await sendWithRetry(() => sendFileToTelegram(fileId, caption));
    const count = await incrementTelegramCount();
    if (isSeparatorNeeded(count)) await sendDotTelegram();
    if (qid) setProgress(qid, { telegram: 'done' });
    return { target: 'telegram', results: { telegram: 'sent' } };
  }

  const file = getFileWithRelPath(fileId);
  if (!file) throw new Error('File not found');

  const results = { telegram: null, whatsapp_channel: null, whatsapp_status: null };

  // 'all'      → Telegram + WA channel + WA status
  // 'whatsapp' → WA channel + WA status (no Telegram)
  // 'channel'  → WA channel only
  // 'status'   → WA status only
  const wantTelegram = target === 'all';
  const wantChannel = target === 'channel' || target === 'whatsapp' || target === 'all';
  const wantStatus = target === 'status' || target === 'whatsapp' || target === 'all';

  if (wantTelegram) {
    if (qid) setProgress(qid, { telegram: 'sending' });
    try {
      await sendWithRetry(() => sendFileToTelegram(fileId, caption));
      results.telegram = 'sent';
      if (qid) setProgress(qid, { telegram: 'done' });
    } catch (err) {
      results.telegram = 'err: ' + err.message;
      if (qid) setProgress(qid, { telegram: 'err' });
    }
  }

  // Channel and status share the same encoded media and are sent sequentially
  // (never in parallel — both go through the shared WA Web client, parallel
  // risks a double send / client clash). Per-target outcome is recorded so a
  // failure in one does not swallow the other.
  if (wantChannel || wantStatus) {
    const { sendMediaToTargets } = await import('../../../whatsapp-bot/src/sender.js');
    if (qid) {
      const patch = {};
      if (wantChannel) patch.channel = 'sending';
      if (wantStatus) patch.status = 'sending';
      setProgress(qid, patch);
    }
    const wa = await sendMediaToTargets(file.fullPath, { channel: wantChannel, status: wantStatus, caption });
    if (wantChannel) results.whatsapp_channel = wa.channel === 'sent' ? 'sent' : wa.channel;
    if (wantStatus) results.whatsapp_status = wa.status === 'sent' ? 'sent' : wa.status;

    if (qid) {
      const patch = {};
      if (wantChannel) patch.channel = wa.channel === 'sent' ? 'done' : 'err';
      if (wantStatus) patch.status = wa.status === 'sent' ? 'done' : 'err';
      setProgress(qid, patch);
    }
    if (results.whatsapp_channel && results.whatsapp_channel.startsWith('err')) console.error('[send] WA channel error:', results.whatsapp_channel);
    if (results.whatsapp_status && results.whatsapp_status.startsWith('err')) console.error('[send] WA status error:', results.whatsapp_status);
  }

  if (wantTelegram) {
    const tgCount = await incrementTelegramCount();
    if (isSeparatorNeeded(tgCount)) await sendDotTelegram();
  }
  if (wantChannel || wantStatus) {
    const waCount = await incrementWhatsAppCount();
    if (isSeparatorNeeded(waCount)) await sendDotWhatsApp();
  }

  return { target, results };
}

// Build a short human-readable summary of any failed targets.
function summarizeFailures(results) {
  const failed = [];
  if (results.telegram && results.telegram.startsWith('err')) failed.push('Telegram: ' + results.telegram.slice(4));
  if (results.whatsapp_channel && results.whatsapp_channel.startsWith('err')) failed.push('WA Channel: ' + results.whatsapp_channel.slice(4));
  if (results.whatsapp_status && results.whatsapp_status.startsWith('err')) failed.push('WA Status: ' + results.whatsapp_status.slice(4));
  return failed.length ? failed.join(' | ') : null;
}

// ── Enqueue or send directly ──
async function enqueueOrSend(fileId, target, force = false) {
  const settings = getSendSettings();
  const debugMode = settings.debugMode;
  const debugCaption = debugMode ? '[DEBUG]' : null;

  // Debug mode: bypass queue, send directly (no rate-limit, no pending).
  if (debugMode) {
    let ok = true, errMsg = null, out;
    try {
      out = await performSend(fileId, target, null, null);
    } catch (err) {
      ok = false;
      errMsg = err.message;
    }
    const id = enqueueSend(fileId, target, false, debugCaption);
    markSendDone(id, ok, errMsg || null);
    return { sent: ok, queued: false, queueId: id, results: out?.results, error: errMsg };
  }

  // Telegram-only sends are instant (no rate-limit, no queue/pending). But we
  // still record them as a done/failed history row so they appear under the
  // Telegram group in the queue UI (which has no "Antrian" card).
  if (target === 'telegram') {
    let ok = true, errMsg = null, out;
    try {
      out = await performSend(fileId, 'telegram', null, null);
    } catch (err) {
      ok = false;
      errMsg = err.message;
    }
    const id = enqueueSend(fileId, 'telegram', false);
    markSendDone(id, ok, errMsg || null);
    return { sent: ok, queued: false, queueId: id, results: out?.results, error: errMsg };
  }
  // Whatever WA target ('whatsapp' | 'channel' | 'status' | 'all') is
  // rate-limited by the shared daily cap. Always track it in the queue so we can
  // dedup and show history/errors.
  const existing = getActiveOrRecentSend(fileId, target);
  if (existing) {
    return {
      sent: existing.status === 'done',
      queued: existing.status === 'pending',
      queueId: existing.id,
      duplicate: true,
      message: existing.status === 'pending' ? 'Sudah dalam antrian' : 'Sudah dikirim',
    };
  }
  const id = enqueueSend(fileId, target, false);
  const policy = canSendNow();
  const inetOk = await checkInternet();
  if (policy.allowed && inetOk) {
    markProcessing(id);
    try {
      const out = await performSend(fileId, target, id);
      recordSend();
      const errSummary = summarizeFailures(out.results);
      const waFailed = isWaFailed(out.results, target);
      markSendDone(id, !waFailed, errSummary || null);
      scheduleClearProgress(id);
      return { sent: true, queued: false, queueId: id, results: out.results, error: errSummary };
    } catch (err) {
      markSendDone(id, false, err.message);
      scheduleClearProgress(id);
      return { sent: false, queued: false, queueId: id, error: err.message };
    }
  }
  return { sent: false, queued: true, queueId: id, nextAllowedAt: policy.nextAllowedAt, remainingToday: policy.remainingToday };
}

// Did every WhatsApp target the user actually asked for fail? Used to decide
// whether the queue row is 'done' or 'failed'. Targets not requested are ignored
// (e.g. a 'channel'-only send isn't failed just because status wasn't attempted).
function isWaFailed(results, target) {
  const keys = [];
  if (target === 'channel' || target === 'whatsapp' || target === 'all') keys.push('whatsapp_channel');
  if (target === 'status' || target === 'whatsapp' || target === 'all') keys.push('whatsapp_status');
  if (keys.length === 0) return false;
  return keys.every(k => results[k] && results[k].startsWith('err'));
}

router.post('/telegram', async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const out = await enqueueOrSend(fileId, 'telegram');
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[send/telegram] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/all', async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const out = await enqueueOrSend(fileId, 'all');
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[send/all] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/whatsapp', async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const out = await enqueueOrSend(fileId, 'whatsapp');
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[send/whatsapp] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channel', async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const out = await enqueueOrSend(fileId, 'channel');
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[send/channel] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/status', async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const out = await enqueueOrSend(fileId, 'status');
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[send/status] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/status', (req, res) => {
  const bot = getBot();
  res.json({
    configured: !!process.env.TELEGRAM_BOT_TOKEN,
    botReady: !!bot,
    chatId: process.env.TELEGRAM_CHAT_ID || '-1002821903652',
    ...canSendNow(),
  });
});

// Queue behaviour settings: auto-send tick + debug hold mode.
router.get('/settings', (req, res) => {
  try {
    res.json({ ok: true, settings: getSendSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    const body = req.body || {};
    const prev = getSendSettings();
    const next = setSendSettings({
      tickEnabled: body.tickEnabled,
      debugMode: body.debugMode,
      perDay: body.perDay,
    });
    // Debug mode = send immediately (bypass rate limit). No 8h hold needed.
    // Leaving debug: clear any leftover holds so pending items wait on their
    // normal scheduled tick again.
    if (next.debugMode && !prev.debugMode) {
      res.json({ ok: true, settings: next });
    } else if (!next.debugMode && prev.debugMode) {
      const released = clearHolds();
      const wiped = clearDebugHistory();
      res.json({ ok: true, settings: next, released, wiped });
    } else {
      res.json({ ok: true, settings: next });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/queue/statuses', async (req, res) => {
  try {
    const policy = canSendNow();
    const pending = getPendingSends();
    const rateState = getRateState();
    const timeline = buildQueueTimeline({
      now: Date.now(),
      pendingItems: pending,
      perDay: policy.dailyCap,
      rateState,
    });
    const inetOk = await checkInternet();
    res.json({ 
      counts: getStatusCounts(req.query.target), 
      policy,
      timeline,
      internet: inetOk,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const VALID_STATUS = new Set(['pending', 'done', 'failed', 'canceled']);
router.get('/queue', (req, res) => {
  try {
    const status = req.query.status || 'pending';
    if (!VALID_STATUS.has(status)) return res.status(400).json({ error: 'invalid status' });
    const cursor = parseInt(req.query.cursor || '0', 10) || 0;
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const { items, nextCursor } = getQueueByStatus(status, cursor, limit, req.query.target);
    res.json({ items, nextCursor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-target live progress for a combined send (keyed by queueId).
router.get('/progress', (req, res) => {
  try {
    const qid = parseInt(req.query.qid || '0', 10) || 0;
    res.json(sendProgress.get(qid) || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:id/cancel', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = cancelSend(id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:id/retry', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = retrySend(id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/queue/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = removeSend(id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/clear-history', (req, res) => {
  try {
    const removed = clearHistory();
    res.json({ ok: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/queue/:id/caption', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { caption } = req.body || {};
    if (typeof caption !== 'string') return res.status(400).json({ error: 'caption must be a string' });
    setQueueCaption(id, caption);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/queue/:id/reorder', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { direction } = req.body || {};
    if (direction !== 'up' && direction !== 'down') return res.status(400).json({ error: 'direction must be up or down' });
    const ok = reorderQueueItem(id, direction);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/queue/:id/schedule', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { scheduledAt } = req.body || {};
    const ts = scheduledAt ? new Date(scheduledAt).getTime() : null;
    if (scheduledAt && (!ts || isNaN(ts))) return res.status(400).json({ error: 'invalid scheduledAt' });
    const ok = rescheduleQueueItem(id, ts);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:id/resend', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('SELECT file_id, target FROM send_queue WHERE id = ?').get(id);
    const row = db.prepare('SELECT file_id, target FROM send_queue WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Item not found' });
    const out = await enqueueOrSend(row.file_id, row.target);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let schedulerStarted = false;
export function startSendScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(async () => {
    try {
      const purgeBefore = Date.now() - 7 * 24 * 3600 * 1000;
      db.prepare("DELETE FROM send_queue WHERE status != 'pending' AND created_at < ?").run(purgeBefore);

      const settings = getSendSettings();
      // Skip tick only when debug mode is ON without share-only target.
      // Share-only mode sends directly, so tick should still run for queued items.
      if (!settings.tickEnabled || settings.debugMode) return;

      // Pause queue when internet is down — items resume automatically when
      // connectivity is restored (next tick that passes the check).
      const inetOk = await checkInternet();
      if (!inetOk) return;

      const pending = getPendingSends();
      if (pending.length === 0) return;

      const now = Date.now();
      const rateState = getRateState();
      const timeline = buildQueueTimeline({
        now,
        pendingItems: pending,
        perDay: settings.perDay,
        rateState,
      });

      if (timeline.length === 0 || !timeline[0].ready) return;

      for (const item of timeline) {
        if (!item.ready) break;
        if (item.target === 'telegram') {
          markSendDone(item.id, true);
          continue;
        }
        try {
          const out = await performSend(item.fileId, item.target, item.id, item.caption);
          recordSend();
          const errSummary = summarizeFailures(out.results);
          const waFailed = isWaFailed(out.results, item.target);
          markSendDone(item.id, !waFailed, errSummary || null);
          scheduleClearProgress(item.id);
        } catch (err) {
          markSendDone(item.id, false, err.message);
          scheduleClearProgress(item.id);
        }
      }
    } catch {}
  }, 30 * 1000);
}

export default router;
