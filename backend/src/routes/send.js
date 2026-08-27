import { Router } from 'express';
import db from '../db.js';
import { sendFileToTelegram, getBot } from '../utils/telegramBot.js';
import { getWaSendPath } from '../utils/waCompat.js';
import { incrementTelegramCount, incrementWhatsAppCount, isSeparatorNeeded } from '../utils/sendCounter.js';
import { canSendNow, recordSend, enqueueSend,   getActiveOrRecentSend, markSendDone, cancelSend, retrySend, removeSend, clearHistory, getStatusCounts, getQueueByStatus, getSendSettings, setSendSettings, clearHolds, clearDebugHistory, buildQueueTimeline, getPerDay, getPendingSends, getAllPendingSends, getRateState, setQueueCaption, reorderQueueItem, rescheduleQueueItem, initScheduleIntegrity, claimPending, requeueForRetry, waPermanentMediaError, backfillDailySlots, compactScheduleAfterFailure, findExistingSendRow } from '../utils/sendRateLimit.js';
import {
  getSendDebugSnapshot,
  diffSnapshots,
  logSendBefore,
  logSendClaim,
  logSendDecision,
  logSendExecutionStart,
  logSendExecutionResult,
  logSendAfter,
  logAnomalies,
  findDuplicateActiveRow,
  classifyResult,
} from '../utils/sendDebug.js';

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

  const engine = globalThis.mediaEngine;
  if (!engine) throw new Error('Media engine not ready');
  const file = await engine.resolve(fileId);
  if (!file || file.blocked) throw new Error('File not found');

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
    // Auto-fix incompatible codecs (H.264+Opus → re-encode audio to AAC;
    // non-H.264 video → iGPU/VAAPI transcode) before sending to WhatsApp so
    // deterministic media failures are remediated instead of dropped. Unfixable
    // media throws a permanent-style error (matched by isPermanentMediaError).
    let waPath = file.fullPath;
    try {
      const compat = await getWaSendPath(fileId);
      waPath = compat.path;
    } catch (err) {
      throw new Error('Media gagal diproses WA: ' + (err.message || err));
    }
    const wa = await sendMediaToTargets(waPath, { channel: wantChannel, status: wantStatus, caption });
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
  // Separator hanya untuk WA Channel, bukan Status
  if (wantChannel) {
    const waCount = await incrementWhatsAppCount();
    if (isSeparatorNeeded(waCount)) await sendDotWhatsApp();
  } else if (wantStatus) {
    // Status only - update counter tapi tanpa separator
    await incrementWhatsAppCount();
  }

  return { target, results };
}

// Result keys per logical target. The scheduler depends ONLY on these normalized
// tokens (never on raw client.sendMessage return values) — see the contract
// boundary in the plan. `sent` = delivered; anything else (including 'err: …') = failure.
const TARGET_RESULT_KEYS = {
  telegram: ['telegram'],
  channel: ['whatsapp_channel'],
  status: ['whatsapp_status'],
  whatsapp: ['whatsapp_channel', 'whatsapp_status'],
  all: ['telegram', 'whatsapp_channel', 'whatsapp_status'],
};

// Strict delivery: every requested target must be exactly 'sent'.
function isDelivered(results, target) {
  const keys = TARGET_RESULT_KEYS[target] || [];
  if (keys.length === 0) return false;
  return keys.every((k) => results[k] === 'sent');
}

// Rich, non-null root cause from the failed targets (they already carry the real
// message from normalizeWaError). Empty → caller coerces to a generic message so
// `error` is never NULL.
function buildError(results, target) {
  const keys = TARGET_RESULT_KEYS[target] || [];
  const failed = [];
  for (const k of keys) {
    const v = results[k];
    if (v && v.startsWith('err')) failed.push(v.slice(4));
  }
  return failed.length ? failed.join(' | ') : null;
}

// WA media-decode failures are deterministic: no amount of retrying fixes a codec
// WhatsApp can't stream. Detect them so they're marked 'failed' immediately
// (PERMANENT_MEDIA_ERROR) instead of burning the retry budget.
function isPermanentMediaError(msg) {
  return /Media gagal diproses WA|codec .* tidak didukung|media type unsupported|media gagal diproses/i.test(msg || '');
}

// Unified send-outcome handler used by BOTH the direct-send path and the
// scheduler tick. A failed attempt is retried (requeued with backoff) up to the
// retry budget instead of being marked 'failed' immediately. This keeps a
// transient failure (e.g. "File not found" when a file hasn't been scanned/
// indexed yet, or a momentary storage hiccup) from permanently dropping an item
// — previously only the scheduler retried, while the direct "send now" path
// marked such items 'failed' on the very first attempt (retry_count stayed 0).
// A permanent media error (see isPermanentMediaError) is failed immediately and
// never retried.
export function recordSendOutcome(id, delivered, msg, effectiveSlot, timeline) {
  if (delivered) {
    markSendDone(id, true, msg || null);
    return;
  }
  if (isPermanentMediaError(msg)) {
    markSendDone(id, false, msg || 'Permanent media error: media not supported by WhatsApp');
    compactScheduleAfterFailure(id, effectiveSlot, timeline); // slot within grace → compact; else backfill
    return;
  }
  const row = db.prepare('SELECT retry_count FROM send_queue WHERE id = ?').get(id);
  const rc = (row && Number.isFinite(row.retry_count)) ? row.retry_count : 0;
  if (rc < 2) {
    requeueForRetry(id, rc, msg || 'Send failed: unknown error'); // still pending → no compaction
  } else {
    markSendDone(id, false, msg || 'Send failed: unknown error');
    compactScheduleAfterFailure(id, effectiveSlot, timeline); // retries exhausted → slot within grace → compact; else backfill
  }
}

// Display-only media preflight for the DECISION log (no transcode is triggered
// here — this just reports what we know about the file's WhatsApp compatibility).
async function mediaPreflight(fileId, target) {
  if (!['whatsapp', 'all', 'channel', 'status'].includes(target)) {
    return { target, waRelevant: false };
  }
  const row = db.prepare('SELECT codec_info FROM files WHERE id = ?').get(fileId);
  if (!row || row.codec_info == null) return { target, waRelevant: true, probed: false };
  let ci;
  try { ci = JSON.parse(row.codec_info); } catch { return { target, waRelevant: true, probed: false }; }
  const videoCodec = (ci.videoCodec || '').toLowerCase();
  const audioCodec = (ci.audioCodec || '').toLowerCase();
  const WA_VIDEO_OK = new Set(['h264', 'avc1', 'avc3']);
  const videoOk = !videoCodec || WA_VIDEO_OK.has(videoCodec);
  const audioOk = !audioCodec || audioCodec === 'aac' || audioCodec === 'mp4a';
  return {
    target, waRelevant: true, probed: true,
    videoCodec, audioCodec,
    waVideoCompatible: videoOk,
    waAudioCompatible: audioOk,
    waCompatible: !videoCodec ? true : (videoOk && audioOk),
    fixable: (!videoOk) || (!audioOk),
  };
}

// Instrumented wrapper around the actual send + outcome recording. Preserves the
// exact existing behaviour (performSend → isDelivered → recordSend ONLY when
// delivered → recordSendOutcome) while emitting the full lifecycle log:
// send_before → send_claim → send_decision → send_execution_start →
// send_execution_result → send_after (+ anomalies). Pure observability — no
// control-flow change.
async function performAndRecord({ id, fileId, target, caption, recordRate, claimType, prevStatus, effectiveSlot, timeline }) {
  const before = getSendDebugSnapshot(id);
  logSendBefore(id, before);
  logSendClaim(id, true, { prevStatus, claimType });

  const dup = findDuplicateActiveRow(fileId, target, id);
  logSendDecision(id, 'SEND', {
    reason: 'attempt_send',
    mediaPreflight: await mediaPreflight(fileId, target),
    schedule: before.schedule,
    rate: {
      per_day: before.rate.per_day,
      count: before.rate.count,
      remaining: Math.max(0, before.rate.per_day - before.rate.count),
    },
    duplicateActiveRow: dup || null,
  });

  logSendExecutionStart(id, { target, file_id: fileId });

  let out = null, delivered = false, msg = null, errorMsg = null;
  try {
    out = await performSend(fileId, target, id, caption);
    delivered = isDelivered(out.results, target);
    msg = buildError(out.results, target);
  } catch (err) {
    errorMsg = err?.message || String(err);
  }
  const result = classifyResult(delivered, errorMsg || msg);

  if (recordRate && delivered) recordSend();
  recordSendOutcome(id, delivered, errorMsg || msg, effectiveSlot, timeline);

  const after = getSendDebugSnapshot(id);
  const delta = diffSnapshots(before, after);
  logSendAfter(id, delta, after);
  logAnomalies({
    qid: id, before, after, claimed: true, performed: true, delivered, result, claimType,
    now: Date.now(), detail: { duplicateActiveRow: dup },
  });
  return { out, delivered, msg: errorMsg || msg, result };
}

// ── Enqueue or send directly ──
export async function enqueueOrSend(fileId, target, force = false) {
  // Preflight: a known-incompatible (e.g. AV1) video can never stream to WhatsApp.
  // Reject up front (defense-in-depth alongside the scheduler preflight) so we
  // don't enqueue/attempt a deterministically-impossible send.
  const permErr = waPermanentMediaError(fileId, target);
  if (permErr) {
    return { sent: false, queued: false, permanent: true, error: permErr };
  }

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
    const dbgBefore = getSendDebugSnapshot(id);
    logSendBefore(id, dbgBefore);
    logSendClaim(id, true, { prevStatus: 'pending', claimType: 'direct' });
    logSendDecision(id, 'SEND', { reason: 'debug_direct', rate: dbgBefore.rate, schedule: dbgBefore.schedule });
    logSendExecutionStart(id, { target, file_id: fileId });
    const result = classifyResult(ok, errMsg);
    logSendExecutionResult(id, { delivered: ok, result, error: errMsg });
    markSendDone(id, ok, errMsg || null);
    const dbgAfter = getSendDebugSnapshot(id);
    logSendAfter(id, diffSnapshots(dbgBefore, dbgAfter), dbgAfter);
    logAnomalies({ qid: id, before: dbgBefore, after: dbgAfter, claimed: true, performed: true, delivered: ok, result, claimType: 'direct', now: Date.now() });
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
    const tgBefore = getSendDebugSnapshot(id);
    logSendBefore(id, tgBefore);
    logSendClaim(id, true, { prevStatus: 'pending', claimType: 'direct' });
    logSendDecision(id, 'SEND', { reason: 'telegram_direct', rate: tgBefore.rate });
    logSendExecutionStart(id, { target: 'telegram', file_id: fileId });
    const result = classifyResult(ok, errMsg);
    logSendExecutionResult(id, { delivered: ok, result, error: errMsg });
    markSendDone(id, ok, errMsg || null);
    const tgAfter = getSendDebugSnapshot(id);
    logSendAfter(id, diffSnapshots(tgBefore, tgAfter), tgAfter);
    logAnomalies({ qid: id, before: tgBefore, after: tgAfter, claimed: true, performed: true, delivered: ok, result, claimType: 'direct', now: Date.now() });
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
    logSendDecision(id, 'SEND', { reason: 'rate_slot_available', remainingToday: policy.remainingToday, nextAllowedAt: policy.nextAllowedAt });
    const claimed = claimPending(id);
    if (!claimed) {
      return { sent: false, queued: false, duplicate: true, message: 'Sudah dalam proses' };
    }
    const r = await performAndRecord({ id, fileId, target, caption: null, recordRate: true, claimType: 'direct', prevStatus: 'pending' });
    scheduleClearProgress(id);
    return { sent: r.delivered, queued: false, queueId: id, results: r.out?.results, error: r.msg };
  }
  return { sent: false, queued: true, queueId: id, nextAllowedAt: policy.nextAllowedAt, remainingToday: policy.remainingToday };
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
    const pending = getAllPendingSends();
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
    const { items, nextCursor } = getQueueByStatus(status, cursor, limit, req.query.target, {
      sortBy: req.query.sortBy || null,
      sortOrder: req.query.sortOrder || 'desc',
      typeFilter: req.query.typeFilter || null,
    });
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
    res.status(400).json({ ok: false, error: err.message });
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

// Enqueue a file into the send queue as PENDING without sending it immediately,
// so the caller can then pin it to a specific date via /queue/:id/schedule.
// Reuses the same dedup as enqueueOrSend: if an in-flight/recent item already
// exists for that file+target we return it instead of creating a duplicate.
router.post('/queue/enqueue', (req, res) => {
  try {
    const { fileId, target = 'status' } = req.body || {};
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    // Dedup: prefer a recent in-flight/recent row, but ALSO reuse any existing
    // pending/processing/done row for this file+overlapping target regardless of
    // age (plan T4) — so an already-sent file is never re-enqueued as a duplicate
    // just because the 8h window lapsed.
    const existing = getActiveOrRecentSend(fileId, target) || findExistingSendRow(fileId, target);
    let id;
    if (existing) {
      id = existing.id;
    } else {
      id = enqueueSend(fileId, target, false);
    }
    res.json({ ok: true, qid: id });
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

// TEMP: direct-send a specific queue item by id (bypasses the scheduler + the
// enqueueOrSend dedup guard) so we can test COPIES of the queue without the
// still-pending originals blocking them via getActiveOrRecentSend. Used by the
// full-queue video test; remove after the test.
router.post('/_testsend/:id', async (req, res) => {
  let id;
  try {
    id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT id, file_id, target, caption FROM send_queue WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Item not found' });
    const out = await performSend(row.file_id, row.target, id, row.caption || '');
    const delivered = isDelivered(out.results, row.target);
    const msg = buildError(out.results, row.target);
    recordSendOutcome(id, delivered, msg);
    res.json({ ok: true, delivered, msg, results: out.results });
  } catch (err) {
    try { recordSendOutcome(id, false, err && err.message); } catch {}
    res.status(500).json({ error: err && err.message });
  }
});

let schedulerStarted = false;
export function startSendScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // Enforce the "one item per slot" invariant on boot (dedupe collisions + create
  // the partial UNIQUE index). Idempotent.
  try { initScheduleIntegrity(); } catch (e) { console.error('[send] initScheduleIntegrity failed:', e?.message || e); }
  // Secondary guard: never let two intervals overlap within one process (the
  // primary guard is the atomic DB claim in claimPending).
  let tickInFlight = false;
  let forceStopTick = false;
  setInterval(async () => {
    if (tickInFlight) return;
    tickInFlight = true;
    if (forceStopTick) { tickInFlight = false; return; }
    try {
      const settings = getSendSettings();
      // Skip tick only when debug mode is ON without share-only target.
      // Share-only mode sends directly, so tick should still run for queued items.
      if (!settings.tickEnabled || settings.debugMode) return;

      // Pause queue when internet is down — items resume automatically when
      // connectivity is restored (next tick that passes the check).
      const inetOk = await checkInternet();
      if (!inetOk) return;

      const now = Date.now();
      const rateState = getRateState();
      const perDay = settings.perDay;

      // Build the timeline over the FULL pending set so slot allocation matches
      // the UI's merged calendar timeline (scheduled/held items occupy their
      // absolute slots). Send order then follows display order follows ETA.
      const fullPending = getAllPendingSends();
      const timeline = buildQueueTimeline({ now, pendingItems: fullPending, perDay, rateState });
      const etaById = new Map(timeline.map(t => [t.id, t.eta]));
      const readyById = new Map(timeline.map(t => [t.id, t.ready]));

      // Only due items are candidates to send this tick (mirrors getPendingSends:
      // excludes held, future-scheduled, and fresh in-flight 'processing' rows so
      // a direct send in progress is never double-sent).
      const due = getPendingSends();
      if (due.length === 0) return;

      // Order candidates by their timeline eta so the scheduler sends in the
      // same order the queue is displayed.
      due.sort((a, b) => {
        const ea = etaById.get(a.id) ?? Infinity;
        const eb = etaById.get(b.id) ?? Infinity;
        if (ea !== eb) return ea - eb;
        const sa = a.sort_order ?? a.id;
        const sb = b.sort_order ?? b.id;
        if (sa !== sb) return sa - sb;
        return a.id - b.id;
      });

      for (const item of due) {
        if (!readyById.get(item.id)) continue; // not yet due on the merged timeline
        // Codec preflight: a known-incompatible (e.g. AV1) video can NEVER stream
        // to WhatsApp, so fail it once as PERMANENT_MEDIA_ERROR — never claim it
        // into 'processing', never retry. This keeps deterministic media failures
        // off the retry budget entirely.
        const permErr = waPermanentMediaError(item.file_id, item.target);
        if (permErr) {
          const before = getSendDebugSnapshot(item.id);
          logSendBefore(item.id, before);
          logSendDecision(item.id, 'PERMANENT_FAIL', { reason: 'permanent_media_error', detail: permErr });
          markSendDone(item.id, false, permErr);
          scheduleClearProgress(item.id);
          compactScheduleAfterFailure(item.id, etaById.get(item.id), timeline); // permanent preflight fail → compact if within grace, else backfill
          const after = getSendDebugSnapshot(item.id);
          logSendAfter(item.id, diffSnapshots(before, after), after);
          logAnomalies({ qid: item.id, before, after, claimed: false, performed: false, delivered: false, result: 'permanent_failure', claimType: 'scheduler', now: Date.now() });
          continue;
        }
        // Atomic claim is the PRIMARY dedup: only the worker that flips this row
        // to 'processing' may send it. Overlapping ticks (or a restart) that find
        // it already 'processing' are skipped — this is what stops duplicate/triple
        // sends. retry_count is the count of completed attempts; we allow at most
        // 3 total, so we only requeue while fewer than 2 attempts are done.
        if (!claimPending(item.id, now)) {
          logSendClaim(item.id, false, { prevStatus: item.status, reason: 'already_processing_or_claimed' });
          continue;
        }
        const claimType = item.status === 'processing' ? 'reclaim' : 'fresh';
        const r = await performAndRecord({ id: item.id, fileId: item.file_id, target: item.target, caption: item.caption, recordRate: true, claimType, prevStatus: item.status, effectiveSlot: etaById.get(item.id), timeline });
        scheduleClearProgress(item.id);
      }
    } catch {}
    finally { tickInFlight = false; }
  }, 30 * 1000);
}

export default router;
