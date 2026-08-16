// SendQueue debug observability — structured lifecycle logging for the SEND
// pipeline: BEFORE → JUDGE (decision) → EXECUTION → AFTER, plus schedule
// maintenance (compact/backfill) and automatic anomaly detection.
//
// This module is pure instrumentation. It does NOT change any scheduling,
// retry, rate-limit, compaction, dedup or business logic. Every emit is gated
// behind SEND_DEBUG=1 (or an explicit `force` flag used by tests), so with the
// flag off there is zero behaviour change and zero extra noise.
//
// Canonical helpers (getRateState, getPerDay, getScheduleWindow, buildQueueTimeline)
// are imported from sendRateLimit.js so the snapshot never re-derives a formula
// that could drift from the real scheduler.
import db from '../db.js';
import { createLogger } from './logger.js';
import {
  getRateState,
  getPerDay,
  getScheduleWindow,
  buildQueueTimeline,
  getActiveOrRecentSend,
} from './sendRateLimit.js';

// Must match STUCK_MS in sendRateLimit.js (reclaim threshold for a 'processing'
// row that is considered a lost send).
const STUCK_MS = 10 * 60 * 1000;

const sendLogger = createLogger('scheduler');

function isEnabled() {
  return process.env.SEND_DEBUG === '1' || process.env.SEND_DEBUG === 'true';
}

// One JSON object per line. Written to the scheduler log file (greppable) and,
// when debug is on, mirrored to stdout under the [SEND-JUDGE] namespace.
function emit(event, payload, { force = false } = {}) {
  if (!force && !isEnabled()) return null;
  const obj = { event, ts: new Date().toISOString(), ...payload };
  try { sendLogger.info(obj); } catch {}
  if (isEnabled() || force) {
    // eslint-disable-next-line no-console
    console.log('[SEND-JUDGE] ' + JSON.stringify(obj));
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────────────────
// Reusable, non-hardcoded snapshot of a single queue item plus its live rate
// state, schedule window and timestamps. Reads the actual DB — no duplicated
// formulas.
export function getSendDebugSnapshot(qid) {
  const row = db.prepare(
    `SELECT id, file_id, target, status, retry_count, attempt_log, scheduled_at,
            hold_until, processing_started_at, completed_at, error, pinned
     FROM send_queue WHERE id = ?`
  ).get(qid);
  if (!row) return { id: qid, exists: false };

  const now = Date.now();
  const rate = getRateState();
  const perDay = getPerDay();
  const schedTs = Number(row.scheduled_at) || 0;
  const autoFlow = schedTs <= 0;
  let window = 'AUTO';
  let eta = null;

  if (!autoFlow) {
    window = getScheduleWindow(schedTs, now);
    // Reuse the canonical timeline so ETA matches exactly what the scheduler
    // would assign (no second definition of slot math).
    const tl = buildQueueTimeline({
      now,
      pendingItems: [{
        id: row.id,
        file_id: row.file_id,
        target: row.target,
        caption: '',
        scheduled_at: row.scheduled_at,
        hold_until: row.hold_until,
        sort_order: row.id,
        pinned: row.pinned,
        status: row.status,
      }],
      perDay,
      rateState: rate,
    });
    if (tl[0]) eta = tl[0].eta;
  }

  let attemptLog = null;
  try { attemptLog = row.attempt_log ? JSON.parse(row.attempt_log) : null; } catch {}
  if (!Array.isArray(attemptLog)) attemptLog = null;

  return {
    id: row.id,
    exists: true,
    file_id: row.file_id,
    target: row.target,
    status: row.status,
    retry_count: row.retry_count,
    attempt_log: attemptLog,
    scheduled_at: row.scheduled_at,
    hold_until: row.hold_until,
    processing_started_at: row.processing_started_at,
    completed_at: row.completed_at,
    error: row.error,
    pinned: !!row.pinned,
    autoFlow,
    rate: {
      per_day: perDay,
      count: rate.count,
      last_send_at: rate.lastSendAt,
      bucket: rate.date,
    },
    schedule: {
      scheduled_at: row.scheduled_at,
      window,
      eta,
      pinned: !!row.pinned,
      autoFlow,
    },
    timestamps: {
      now,
      processing_started_at: row.processing_started_at,
      completed_at: row.completed_at,
    },
  };
}

// Diff the fields the user cares about. rate_count comes from the nested
// snapshot.rate.count, everything else from the top level.
export function diffSnapshots(before, after) {
  const fields = [
    'status', 'retry_count', 'rate_count', 'scheduled_at',
    'hold_until', 'processing_started_at', 'completed_at', 'error',
  ];
  const delta = {};
  for (const f of fields) {
    const b = f === 'rate_count' ? (before?.rate?.count ?? null) : (before?.[f] ?? null);
    const a = f === 'rate_count' ? (after?.rate?.count ?? null) : (after?.[f] ?? null);
    if (b !== a) delta[f] = [b, a];
  }
  return delta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event emitters
// ─────────────────────────────────────────────────────────────────────────────
export function logSendBefore(qid, snapshot) {
  return emit('send_before', { qid, state: snapshot });
}

export function logSendClaim(qid, claimed, { prevStatus, claimType, reason } = {}) {
  return emit('send_claim', { qid, claimed, prevStatus, claimType, reason });
}

export function logSendDecision(qid, action, { reason, detail } = {}) {
  return emit('send_decision', { qid, action, reason, detail });
}

export function logSendExecutionStart(qid, { target, file_id }) {
  // Never log raw secrets/tokens/sessions — only target + file id.
  return emit('send_execution_start', { qid, target, file_id });
}

export function logSendExecutionResult(qid, { delivered, result, error }) {
  const e = error ? String(error).slice(0, 300) : null;
  return emit('send_execution_result', { qid, delivered, result, error: e });
}

export function logSendAfter(qid, delta, after) {
  return emit('send_after', { qid, delta, state: after });
}

export function logScheduleMaintenance(ev) {
  // ev: { action:'COMPACT'|'BACKFILL', failedQid, failedSlotTs, window,
  //       candidateQid, oldScheduledAt, newScheduledAt, affected, count }
  return emit('schedule_maintenance', ev);
}

export function logSendAnomaly(qid, type, detail = {}) {
  return emit('send_anomaly', { qid, type, ...detail });
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly detection (rules 1-12)
// ─────────────────────────────────────────────────────────────────────────────
export function detectAnomalies(ctx) {
  const {
    qid, before, after, claimed, performed, delivered, result, claimType, now = Date.now(),
    detail = {},
  } = ctx;
  const anomalies = [];
  const rateBefore = before?.rate?.count ?? 0;
  const rateAfter = after?.rate?.count ?? 0;
  const rateDelta = rateAfter - rateBefore;

  // 1. delivered=false but rate_count rose
  if (!delivered && rateDelta > 0) {
    anomalies.push({ type: 'RATE_COUNT_ON_FAILURE', rateBefore, rateAfter, rateDelta });
  }
  // 2. delivered=true but rate_count did not rise
  if (delivered && rateDelta === 0) {
    anomalies.push({ type: 'RATE_COUNT_ON_SUCCESS_MISSING', rateBefore, rateAfter });
  }
  // 3. claim=false but performSend still called
  if (!claimed && performed) {
    anomalies.push({ type: 'CLAIM_BYPASS', claimType });
  }
  // 4. permanent media error routed into retry
  if (result === 'permanent_failure' && after?.status === 'pending') {
    anomalies.push({ type: 'PERMANENT_IN_RETRY' });
  }
  // 5. retry_count exceeded (> 3)
  if ((after?.retry_count ?? 0) > 3) {
    anomalies.push({ type: 'RETRY_OVER_LIMIT', retry_count: after?.retry_count });
  }
  // 6. failed item became done without a retry/manual action
  if (before?.status === 'failed' && after?.status === 'done' && before?.retry_count === after?.retry_count) {
    anomalies.push({ type: 'FAILED_TO_DONE_NO_RETRY' });
  }
  // 7. duplicate active row detected for the same file+target
  if (detail.duplicateActiveRow) {
    anomalies.push({ type: 'DUPLICATE_ACTIVE_ROW', otherQid: detail.duplicateActiveRow });
  }
  // 8. processing item reclaimed before STUCK_MS
  if (before?.status === 'processing' && claimType === 'fresh' &&
      (now - (before?.processing_started_at ?? now)) < STUCK_MS) {
    anomalies.push({ type: 'STUCK_RECLAIM_EARLY', ageMs: now - (before?.processing_started_at ?? now) });
  }
  // 10. transient retry produced no hold_until
  if (result === 'transient_failure' && after?.status === 'pending' && !after?.hold_until) {
    anomalies.push({ type: 'TRANSIENT_NO_HOLD' });
  }
  return anomalies;
}

// Convenience: run detection and emit an event per anomaly.
export function logAnomalies(ctx) {
  const anomalies = detectAnomalies(ctx);
  for (const a of anomalies) {
    logSendAnomaly(ctx.qid, a.type, a);
  }
  return anomalies;
}

// Detect duplicate active rows for a file+target (rule 7 support). Returns the
// other qid if found, else null.
export function findDuplicateActiveRow(fileId, target, excludeQid) {
  const row = getActiveOrRecentSend(fileId, target);
  if (row && row.id !== excludeQid) return row.id;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset-classification helper (for DECISION media preflight logging)
// ─────────────────────────────────────────────────────────────────────────────
export function classifyResult(delivered, errorMsg) {
  if (delivered) return 'success';
  const msg = errorMsg ? String(errorMsg) : '';
  if (/Media gagal diproses WA|codec .* tidak didukung|media type unsupported|media gagal diproses/i.test(msg)) {
    return 'permanent_failure';
  }
  return 'transient_failure';
}

export const _STUCK_MS = STUCK_MS;
