// Temp SQLite test for SendQueue debug observability (T1-T4 proof + logging).
// Uses an ISOLATED temp DB via MEDIA_DB_PATH so the production media.db is never
// touched. Runs the REAL scheduler/rate/retry/compaction logic from sendRateLimit
// and asserts the BEFORE/DECISION/AFTER deltas and anomaly rules.
//
// Run:  node test/send-debug.test.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'send-debug-'));
const DB_FILE = join(tmp, 'media.db');

process.env.MEDIA_DB_PATH = DB_FILE;
process.env.SEND_DEBUG = '1';

// Capture [SEND-JUDGE] structured log lines.
const captured = [];
const origLog = console.log;
console.log = (...args) => {
  const line = args.map(String).join(' ');
  if (line.startsWith('[SEND-JUDGE]')) captured.push(line.slice('[SEND-JUDGE] '.length));
  origLog(...args);
};

// Bootstrap the temp DB schema. db.js prepares statements that reference columns
// only added inside deferredDbInit() (after server.listen), so a fresh DB would
// crash on import. We extract and apply ALL of db.js's own CREATE TABLE / ALTER
// TABLE DDL against the temp file, so db.js's re-runs of the same DDL become
// no-ops and module-load prepares succeed. Production DBs are unaffected — this
// only runs against the isolated MEDIA_DB_PATH temp file.
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
{
  const src = readFileSync(new URL('../src/db.js', import.meta.url), 'utf-8');
  const boot = new Database(DB_FILE);
  boot.pragma('journal_mode = WAL');

  // All CREATE TABLE (IF NOT EXISTS) definitions — balanced-paren extraction.
  const creates = [];
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    creates.push(src.slice(m.index, i + 1));
  }
  // All ALTER TABLE ADD COLUMN statements (stop at the SQL boundary, before any
  // trailing `').run()` in the source).
  const alters = [...src.matchAll(/ALTER TABLE [a-z_]+ ADD COLUMN [a-z_]+ [A-Za-z0-9() ,]*/g)].map((x) => x[0].trim());

  // FTS virtual table (normally created in deferredDbInit) — referenced by
  // module-load prepared statements, so build it up front.
  const vts = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1')",
  ];
  for (const ddl of [...creates, ...alters, ...vts]) {
    try { boot.exec(ddl); } catch (e) { /* idempotent: ignore already-exists */ }
  }
  boot.close();
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  origLog(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}

let srl, sd, db, send;
try {
  db = (await import('../src/db.js')).default;
  srl = await import('../src/utils/sendRateLimit.js');
  sd = await import('../src/utils/sendDebug.js');
  send = await import('../src/routes/send.js');
} catch (e) {
  origLog('IMPORT FAILED:', e);
  process.exit(1);
}

// Seed helpers ---------------------------------------------------------------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function reset({ perDay = 3, rateCount = 0 } = {}) {
  db.prepare('UPDATE send_rate_limit SET date = ?, count = ?, last_send_at = 0 WHERE id = 1').run(todayStr(), rateCount);
  db.prepare('UPDATE send_settings SET per_day = ? WHERE id = 1').run(perDay);
  db.prepare("DELETE FROM send_queue").run();
}
function enq(fileId = 'f1', target = 'status') {
  return db.prepare(
    "INSERT INTO send_queue (file_id, target, created_at, status, retry_count) VALUES (?, ?, ?, 'pending', 0)"
  ).run(fileId, target, Date.now()).lastInsertRowid;
}
function qrow(id) {
  return db.prepare('SELECT * FROM send_queue WHERE id = ?').get(id);
}
function rateCount() {
  return db.prepare('SELECT count FROM send_rate_limit WHERE id = 1').get().count;
}

// A. SUCCESS: rate 2 -> 3 ------------------------------------------------
{
  reset({ perDay: 3, rateCount: 2 });
  const id = enq();
  const before = sd.getSendDebugSnapshot(id);
  check('A.before.rate_count=2', before.rate.count === 2, `got ${before.rate.count}`);
  srl.recordSend();                       // delivered -> recordSend()
  send.recordSendOutcome(id, true);        // mark done
  const after = sd.getSendDebugSnapshot(id);
  const delta = sd.diffSnapshots(before, after);
  check('A.after.status=done', after.status === 'done', after.status);
  check('A.rate delta +1', rateCount() === 3, `rate=${rateCount()}`);
  check('A.delta.rate_count=[2,3]', JSON.stringify(delta.rate_count) === '[2,3]', JSON.stringify(delta.rate_count));
  const anomalies = sd.detectAnomalies({ qid: id, before, after, claimed: true, performed: true, delivered: true, result: 'success', now: Date.now() });
  check('A.no anomalies', anomalies.length === 0, JSON.stringify(anomalies));
}

// B. TRANSIENT FAILURE: rate unchanged, retry+1, pending, hold set --------
{
  reset({ perDay: 3, rateCount: 2 });
  const id = enq();
  const before = sd.getSendDebugSnapshot(id);
  send.recordSendOutcome(id, false, 'EFATAL: fetch failed'); // transient
  const after = sd.getSendDebugSnapshot(id);
  const delta = sd.diffSnapshots(before, after);
  check('B.rate unchanged=2', rateCount() === 2, `rate=${rateCount()}`);
  check('B.status=pending', after.status === 'pending', after.status);
  check('B.retry_count +1', after.retry_count === 1, `rc=${after.retry_count}`);
  check('B.hold_until set', !!after.hold_until, String(after.hold_until));
  check('B.delta.rate_count none', delta.rate_count === undefined, JSON.stringify(delta.rate_count));
  const anomalies = sd.detectAnomalies({ qid: id, before, after, claimed: true, performed: true, delivered: false, result: 'transient_failure', now: Date.now() });
  check('B.no anomalies', anomalies.length === 0, JSON.stringify(anomalies));
}

// C. PERMANENT FAILURE: rate unchanged, status failed ----------------------
{
  reset({ perDay: 3, rateCount: 2 });
  const id = enq();
  const before = sd.getSendDebugSnapshot(id);
  send.recordSendOutcome(id, false, 'Media gagal diproses WA: codec xyz tidak didukung');
  const after = sd.getSendDebugSnapshot(id);
  check('C.rate unchanged=2', rateCount() === 2, `rate=${rateCount()}`);
  check('C.status=failed', after.status === 'failed', after.status);
  const anomalies = sd.detectAnomalies({ qid: id, before, after, claimed: false, performed: false, delivered: false, result: 'permanent_failure', now: Date.now() });
  // rule 4 only fires if a permanent error goes to RETRY, here it is FAILED -> ok
  check('C.no anomalies', anomalies.length === 0, JSON.stringify(anomalies));
}

// D. COMPACT OPEN: next item pulled into failed slot ----------------------
{
  captured.length = 0; // isolate maintenance events for this scenario
  reset({ perDay: 6, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000;        // failed slot, still OPEN
  const item2Ts = T0 + 60 * 1000;    // next item, same day
  const id1 = enq();
  const id2 = enq();
  db.prepare('UPDATE send_queue SET status=\'failed\', scheduled_at=? WHERE id=?').run(T0, id1);
  db.prepare('UPDATE send_queue SET scheduled_at=? WHERE id=?').run(item2Ts, id2);
  const before2 = sd.getSendDebugSnapshot(id2);
  srl.compactScheduleAfterFailure(id1);  // OPEN window -> COMPACT
  const after2 = sd.getSendDebugSnapshot(id2);
  check('D.item2 moved into failed slot', after2.scheduled_at === T0, `got ${after2.scheduled_at} want ${T0}`);
  check('D.rate unchanged', rateCount() === 0, `rate=${rateCount()}`);
  check('D.retry unchanged', after2.retry_count === before2.retry_count, `${before2.retry_count}->${after2.retry_count}`);
  const maint = captured.filter(l => { try { return JSON.parse(l).event === 'schedule_maintenance'; } catch { return false; } });
  check('D.schedule_maintenance COMPACT emitted', maint.some(l => JSON.parse(l).action === 'COMPACT'), JSON.stringify(maint));
}

// E. CLOSED: no yank, backfill only ---------------------------------------
{
  captured.length = 0; // isolate maintenance events for this scenario
  reset({ perDay: 6, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 10 * 60 * 1000;  // failed slot, CLOSED
  const item2Ts = now + 30 * 60 * 1000;
  const id1 = enq();
  const id2 = enq();
  db.prepare('UPDATE send_queue SET status=\'failed\', scheduled_at=? WHERE id=?').run(T0, id1);
  db.prepare('UPDATE send_queue SET scheduled_at=? WHERE id=?').run(item2Ts, id2);
  const before2 = sd.getSendDebugSnapshot(id2);
  srl.compactScheduleAfterFailure(id1);  // CLOSED -> BACKFILL (no yank)
  const after2 = sd.getSendDebugSnapshot(id2);
  check('E.item2 NOT yanked', after2.scheduled_at === item2Ts, `got ${after2.scheduled_at} want ${item2Ts}`);
  const maint = captured.filter(l => { try { return JSON.parse(l).event === 'schedule_maintenance'; } catch { return false; } });
  check('E.schedule_maintenance BACKFILL emitted', maint.some(l => JSON.parse(l).action === 'BACKFILL'), JSON.stringify(maint));
  check('E.no COMPACT on closed window', !maint.some(l => JSON.parse(l).action === 'COMPACT'));
}

// F. CLAIM OVERLAP: only one claim ----------------------------------------
{
  reset({ perDay: 3, rateCount: 0 });
  const id = enq();
  const c1 = srl.claimPending(id);
  const c2 = srl.claimPending(id); // already processing -> false
  check('F.first claim true', c1 === true);
  check('F.second claim false', c2 === false);
  db.prepare("UPDATE send_queue SET status='pending' WHERE id=?").run(id); // cleanup
}

// G. RESCHEDULE: retry_count unchanged -----------------------------------
{
  reset({ perDay: 3, rateCount: 0 });
  const id = enq();
  db.prepare('UPDATE send_queue SET retry_count=1 WHERE id=?').run(id);
  const ts = Date.now() + 3600 * 1000;
  srl.rescheduleQueueItem(id, ts); // numeric ts, same as the HTTP route does
  const after = sd.getSendDebugSnapshot(id);
  check('G.retry_count unchanged=1', after.retry_count === 1, `rc=${after.retry_count}`);
  check('G.scheduled_at set', after.scheduled_at === ts, `${after.scheduled_at} vs ${ts}`);
  check('G.pinned=1', after.pinned === true);
}

// H. MANUAL RETRY: retry_count reset --------------------------------------
{
  reset({ perDay: 3, rateCount: 0 });
  const id = enq();
  db.prepare('UPDATE send_queue SET status=\'failed\', retry_count=2 WHERE id=?').run(id);
  const ok = srl.retrySend(id);
  const after = sd.getSendDebugSnapshot(id);
  check('H.retrySend ok', ok === true);
  check('H.status=pending', after.status === 'pending', after.status);
  check('H.retry_count reset=0', after.retry_count === 0, `rc=${after.retry_count}`);
}

// I. FULL LIFECYCLE via real enqueueOrSend -> performSend (send.js path).
// Uses debug mode so the direct-send path actually runs (it would otherwise be
// queued because all daily slots have passed at this hour). A non-existent file
// makes performSend throw "File not found" BEFORE any network/WA call — safe,
// no real send — exercising the real claim/decision/execution/after wiring +
// anomaly checks on a transient failure.
{
  captured.length = 0;
  reset({ perDay: 3, rateCount: 2 });
  db.prepare('UPDATE send_settings SET debug_mode = 1 WHERE id = 1').run();
  let out;
  try {
    out = await send.enqueueOrSend('nonexistent-file-id', 'status');
  } finally {
    db.prepare('UPDATE send_settings SET debug_mode = 0 WHERE id = 1').run();
  }
  check('I.send returned', !!out, JSON.stringify(out));
  const events = captured.filter((l) => { try { return JSON.parse(l).event; } catch { return false; } }).map((l) => JSON.parse(l));
  check('I.has send_before', events.some((e) => e.event === 'send_before'));
  check('I.has send_claim', events.some((e) => e.event === 'send_claim'));
  check('I.has send_decision SEND', events.some((e) => e.event === 'send_decision' && e.action === 'SEND'));
  check('I.has send_execution_start', events.some((e) => e.event === 'send_execution_start'));
  check('I.has send_execution_result', events.some((e) => e.event === 'send_execution_result'));
  check('I.has send_after', events.some((e) => e.event === 'send_after'));
  check('I.rate unchanged on failure (=2)', rateCount() === 2, `rate=${rateCount()}`);
  check('I.no anomaly on valid transient', !events.some((e) => e.event === 'send_anomaly'));
}

// OBSERVABILITY OUTPUT VALIDATION -----------------------------------------
{
  reset({ perDay: 3, rateCount: 2 });
  const id = enq();
  const before = sd.getSendDebugSnapshot(id);
  sd.logSendBefore(id, before);
  sd.logSendDecision(id, 'SEND', { reason: 'attempt_send', rate: before.rate });
  sd.logSendExecutionStart(id, { target: 'status', file_id: 'f1' });
  sd.logSendExecutionResult(id, { delivered: true, result: 'success', error: null });
  srl.recordSend();
  send.recordSendOutcome(id, true);
  const after = sd.getSendDebugSnapshot(id);
  const delta = sd.diffSnapshots(before, after);
  sd.logSendAfter(id, delta, after);

  const events = captured.filter(l => { try { return JSON.parse(l).event; } catch { return false; } }).map(l => JSON.parse(l));
  check('O.has send_before', events.some(e => e.event === 'send_before'));
  check('O.has send_decision', events.some(e => e.event === 'send_decision' && e.action === 'SEND'));
  check('O.has send_execution_start', events.some(e => e.event === 'send_execution_start'));
  check('O.has send_execution_result', events.some(e => e.event === 'send_execution_result' && e.delivered === true));
  check('O.has send_after with delta', events.some(e => e.event === 'send_after' && e.delta && e.delta.rate_count && e.delta.rate_count[1] === 3));

  // Anomaly rule 1: delivered=false but rate rose -> anomaly
  const a1 = sd.detectAnomalies({ qid: 99, before: { rate: { count: 2 } }, after: { rate: { count: 3 } }, claimed: true, performed: true, delivered: false, result: 'transient_failure', now: Date.now() });
  check('O.rule1 RATE_COUNT_ON_FAILURE detected', a1.some(x => x.type === 'RATE_COUNT_ON_FAILURE'), JSON.stringify(a1));
  // Anomaly rule 2: delivered=true but rate did not rise -> anomaly
  const a2 = sd.detectAnomalies({ qid: 99, before: { rate: { count: 2 } }, after: { rate: { count: 2 } }, claimed: true, performed: true, delivered: true, result: 'success', now: Date.now() });
  check('O.rule2 RATE_COUNT_ON_SUCCESS_MISSING detected', a2.some(x => x.type === 'RATE_COUNT_ON_SUCCESS_MISSING'), JSON.stringify(a2));
}

// SUBST-1. AUTO OPEN: next AUTO item SUBSTITUTES via sort_order (no scheduled_at write)
{
  reset({ perDay: 3, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000; // failed slot, still OPEN
  const id1 = enq(); const id2 = enq(); const id3 = enq();
  db.prepare("UPDATE send_queue SET status='done', sort_order=10 WHERE id=?").run(id1);
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);
  db.prepare("UPDATE send_queue SET sort_order=30 WHERE id=?").run(id3);
  const timeline = [
    { id: id1, eta: T0, ready: true, window: 'AUTO' },
    { id: id2, eta: T0 + 1, ready: true, window: 'AUTO' },
    { id: id3, eta: T0 + 2, ready: true, window: 'AUTO' },
  ];
  const before2 = qrow(id2);
  srl.compactScheduleAfterFailure(id1, T0, timeline); // OPEN -> AUTO substitution
  const after2 = qrow(id2);
  const after3 = qrow(id3);
  check('SUBST-1 id2 promoted to failed slot sort_order', after2.sort_order === 10, `got ${after2.sort_order}`);
  check('SUBST-1 id2 scheduled_at STILL NULL (no auto->pinned)', after2.scheduled_at == null, String(after2.scheduled_at));
  check('SUBST-1 id2 NOT sent (still pending)', after2.status === 'pending', after2.status);
  check('SUBST-1 id2 retry_count unchanged', after2.retry_count === before2.retry_count, `${before2.retry_count}->${after2.retry_count}`);
  check('SUBST-1 rate unchanged', rateCount() === 0, `rate=${rateCount()}`);
  check('SUBST-1 id3 untouched', after3.sort_order === 30 && after3.scheduled_at == null, JSON.stringify(after3));
}

// SUBST-2. AUTO CLOSED: no substitution, backfill only (no premature yank)
{
  reset({ perDay: 3, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 10 * 60 * 1000; // failed slot, CLOSED
  const id1 = enq(); const id2 = enq();
  db.prepare("UPDATE send_queue SET status='done', sort_order=10 WHERE id=?").run(id1);
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);
  const timeline = [
    { id: id1, eta: T0, ready: false, window: 'AUTO' },
    { id: id2, eta: T0 + 1, ready: false, window: 'AUTO' },
  ];
  srl.compactScheduleAfterFailure(id1, T0, timeline); // CLOSED -> BACKFILL
  const after2 = qrow(id2);
  check('SUBST-2 id2 sort_order unchanged (no sub)', after2.sort_order === 20, `got ${after2.sort_order}`);
  check('SUBST-2 id2 scheduled_at NULL', after2.scheduled_at == null, String(after2.scheduled_at));
  check('SUBST-2 no premature send', after2.status === 'pending', after2.status);
}

// SUBST-3. AUTO CASCADE: fail id1 then id2 -> id3 takes id2's promoted slot
{
  reset({ perDay: 3, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000; // OPEN
  const id1 = enq(); const id2 = enq(); const id3 = enq(); const id4 = enq();
  db.prepare("UPDATE send_queue SET status='done', sort_order=10 WHERE id=?").run(id1);
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);
  db.prepare("UPDATE send_queue SET sort_order=30 WHERE id=?").run(id3);
  db.prepare("UPDATE send_queue SET sort_order=40 WHERE id=?").run(id4);
  const tl1 = [
    { id: id1, eta: T0, ready: true, window: 'AUTO' },
    { id: id2, eta: T0 + 1, ready: true, window: 'AUTO' },
    { id: id3, eta: T0 + 2, ready: true, window: 'AUTO' },
    { id: id4, eta: T0 + 3, ready: true, window: 'AUTO' },
  ];
  srl.compactScheduleAfterFailure(id1, T0, tl1);
  check('SUBST-3a id2 promoted', qrow(id2).sort_order === 10, `got ${qrow(id2).sort_order}`);
  // Now id2 fails (OPEN) -> next pending AUTO (id3) promoted onto id2's slot (10)
  db.prepare("UPDATE send_queue SET status='done' WHERE id=?").run(id2);
  const tl2 = [
    { id: id2, eta: T0, ready: false, window: 'AUTO' },
    { id: id3, eta: T0 + 1, ready: true, window: 'AUTO' },
    { id: id4, eta: T0 + 2, ready: true, window: 'AUTO' },
  ];
  srl.compactScheduleAfterFailure(id2, T0, tl2);
  const a3 = qrow(id3);
  const a4 = qrow(id4);
  check('SUBST-3b id3 promoted to id2 slot', a3.sort_order === 10, `got ${a3.sort_order}`);
  check('SUBST-3c id4 untouched', a4.sort_order === 40, `got ${a4.sort_order}`);
  check('SUBST-3d rate unchanged', rateCount() === 0, `rate=${rateCount()}`);
}

// SUBST-4. MIXED AUTO + EXPLICIT: AUTO substitution only relocates AUTO items,
// explicit items keep their absolute scheduled_at.
{
  reset({ perDay: 6, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000; // OPEN
  const id1 = enq(); const id2 = enq(); const id3 = enq();
  db.prepare("UPDATE send_queue SET status='done', sort_order=10 WHERE id=?").run(id1); // AUTO failed
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);                 // AUTO pending
  const expTs = now + 120 * 60 * 1000;
  db.prepare("UPDATE send_queue SET sort_order=99, scheduled_at=? WHERE id=?").run(expTs, id3); // explicit
  const timeline = [
    { id: id1, eta: T0, ready: true, window: 'AUTO' },
    { id: id2, eta: T0 + 1, ready: true, window: 'AUTO' },
    { id: id3, eta: expTs, ready: false, window: 'EXPLICIT' },
  ];
  srl.compactScheduleAfterFailure(id1, T0, timeline);
  const a2 = qrow(id2);
  const a3 = qrow(id3);
  check('SUBST-4 id2 promoted (AUTO sub)', a2.sort_order === 10, `got ${a2.sort_order}`);
  check('SUBST-4 id3 explicit scheduled_at untouched', a3.scheduled_at === expTs, `got ${a3.scheduled_at}`);
  check('SUBST-4 id3 sort_order untouched', a3.sort_order === 99, `got ${a3.sort_order}`);
}

// SUBST-5. EXPLICIT failure: AUTO items are NOT pulled into the vacated absolute
// slot (no scheduled_at write). Substitution for AUTO items is via sort_order
// only, handled in the autoFail branch of compactScheduleAfterFailure.
{
  reset({ perDay: 6, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000; // OPEN explicit failed slot
  const id1 = enq(); const id2 = enq();
  db.prepare("UPDATE send_queue SET status='done', scheduled_at=?, sort_order=10 WHERE id=?").run(T0, id1);
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);
  const timeline = [
    { id: id1, eta: T0, ready: true, window: 'EXPLICIT' },
    { id: id2, eta: T0 + 1, ready: true, window: 'AUTO' },
  ];
  srl.compactScheduleAfterFailure(id1, T0, timeline);
  const a2 = qrow(id2);
  check('SUBST-5 AUTO not pulled into explicit slot (scheduled_at stays null)', a2.scheduled_at == null, `got ${a2.scheduled_at}`);
  check('SUBST-5 AUTO sort_order unchanged', a2.sort_order === 20, `got ${a2.sort_order}`);
  check('SUBST-5 rate unchanged', rateCount() === 0, `rate=${rateCount()}`);
}

// NEW TESTS FOR SLOT-SWAP PLAN FIXES

// TEST 1. G1: cancelSend only clears the canceled row
{
  reset({ perDay: 3, rateCount: 0 });
  const id1 = enq(); const id2 = enq(); const id3 = enq();
  db.prepare("UPDATE send_queue SET scheduled_at = ?, hold_until = ? WHERE id = ?").run(Date.now() + 3600000, 0, id1);
  db.prepare("UPDATE send_queue SET scheduled_at = ?, hold_until = ? WHERE id = ?").run(Date.now() + 7200000, 0, id2);
  db.prepare("UPDATE send_queue SET scheduled_at = ?, hold_until = ? WHERE id = ?").run(Date.now() + 10800000, 0, id3);
  srl.cancelSend(id2);
  const r1 = qrow(id1);
  const r3 = qrow(id3);
  check('G1 id1 scheduled_at preserved', r1.scheduled_at != null, `got ${r1.scheduled_at}`);
  check('G1 id3 scheduled_at preserved', r3.scheduled_at != null, `got ${r3.scheduled_at}`);
  check('G1 id2 canceled', qrow(id2).status === 'canceled', `got ${qrow(id2).status}`);
}

// TEST 2. G2: direct-send uses claimPending (already covered by existing F test)
// Additional: claimPending returns false for already-processing row
{
  reset({ perDay: 3, rateCount: 0 });
  const id = enq();
  db.prepare("UPDATE send_queue SET status='processing', processing_started_at=? WHERE id=?").run(Date.now(), id);
  const claimed = srl.claimPending(id);
  check('G2 claimPending on processing row returns false', claimed === false, `got ${claimed}`);
  db.prepare("UPDATE send_queue SET status='pending' WHERE id=?").run(id);
}

// TEST 3. G2: claimPending reclaims stuck processing row
{
  reset({ perDay: 3, rateCount: 0 });
  const id = enq();
  const stuckTs = Date.now() - 11 * 60 * 1000; // >10 min ago
  db.prepare("UPDATE send_queue SET status='processing', processing_started_at=? WHERE id=?").run(stuckTs, id);
  const claimed = srl.claimPending(id);
  check('G2 claimPending reclaims stuck row', claimed === true, `got ${claimed}`);
  db.prepare("UPDATE send_queue SET status='pending' WHERE id=?").run(id);
}

// TEST 4. G3: backfillDailySlots does not write scheduled_at to AUTO items
{
  reset({ perDay: 3, rateCount: 0 });
  const id1 = enq(); const id2 = enq();
  db.prepare("UPDATE send_queue SET scheduled_at = ? WHERE id = ?").run(Date.now() + 3600000, id1);
  // id2 is AUTO (scheduled_at IS NULL)
  const filled = srl.backfillDailySlots();
  check('G3 backfill returned 0 (no AUTO pull)', filled === 0, `got ${filled}`);
  check('G3 id2 scheduled_at still null', qrow(id2).scheduled_at == null, `got ${qrow(id2).scheduled_at}`);
}

// TEST 5. G4: compactScheduleAfterFailure does not write scheduled_at to AUTO items
{
  reset({ perDay: 6, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000;
  const id1 = enq(); const id2 = enq();
  db.prepare("UPDATE send_queue SET status='done', scheduled_at=?, sort_order=10 WHERE id=?").run(T0, id1);
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);
  const timeline = [
    { id: id1, eta: T0, ready: true, window: 'EXPLICIT' },
    { id: id2, eta: T0 + 1, ready: true, window: 'AUTO' },
  ];
  srl.compactScheduleAfterFailure(id1, T0, timeline);
  const a2 = qrow(id2);
  check('G4 explicit fail does not pull AUTO (scheduled_at null)', a2.scheduled_at == null, `got ${a2.scheduled_at}`);
  check('G4 explicit fail does not pull AUTO (sort_order unchanged)', a2.sort_order === 20, `got ${a2.sort_order}`);
}

// TEST 6. G4: AUTO substitution via sort_order on next tick
{
  reset({ perDay: 3, rateCount: 0 });
  const now = Date.now();
  const T0 = now - 60 * 1000;
  const id1 = enq(); const id2 = enq();
  db.prepare("UPDATE send_queue SET status='done', sort_order=10 WHERE id=?").run(id1);
  db.prepare("UPDATE send_queue SET sort_order=20 WHERE id=?").run(id2);
  const timeline = [
    { id: id1, eta: T0, ready: true, window: 'AUTO' },
    { id: id2, eta: T0 + 1, ready: true, window: 'AUTO' },
  ];
  srl.compactScheduleAfterFailure(id1, T0, timeline);
  check('G4 AUTO sub sort_order promoted', qrow(id2).sort_order === 10, `got ${qrow(id2).sort_order}`);
}

// TEST 7. G6: dynamic dedup window
{
  reset({ perDay: 3, rateCount: 0 });
  const id = enq();
  // With perDay=3, interval = 8h = 28800000ms
  const row = srl.getActiveOrRecentSend('f1', 'status');
  check('G6 getActiveOrRecentSend returns recent item', row != null && row.id === id, `got ${row?.id}`);
  // Change perDay and verify the window changes
  srl.setPerDayForProcess(6);
  const row2 = srl.getActiveOrRecentSend('f1', 'status');
  check('G6 dynamic window still returns item', row2 != null && row2.id === id, `got ${row2?.id}`);
  srl.setPerDayForProcess(null);
}

// TEST 8. G8: lapsed explicit item becomes ready=true with original ETA
{
  reset({ perDay: 3, rateCount: 0 });
  const now = Date.now();
  const pastTs = now - 10 * 60 * 1000; // lapsed explicit, well past grace window
  const id1 = enq();
  db.prepare("UPDATE send_queue SET scheduled_at = ?, pinned = 1 WHERE id = ?").run(pastTs, id1);
  const items = [
    { id: id1, file_id: 'f1', target: 'status', hold_until: 0, scheduled_at: pastTs, sort_order: null },
  ];
  const timeline = srl.buildQueueTimeline({ now, pendingItems: items, perDay: 3, rateState: { count: 0, lastSendAt: 0 } });
  check('G8 lapsed explicit in timeline', timeline.length === 1, `got length ${timeline.length}`);
  check('G8 lapsed explicit ready=true', timeline[0].ready === true, `got ${timeline[0].ready}`);
  check('G8 lapsed explicit eta = original scheduled_at', timeline[0].eta === pastTs, `got ${timeline[0].eta} vs ${pastTs}`);
  check('G8 lapsed explicit window=CLOSED', timeline[0].window === 'CLOSED', `got ${timeline[0].window}`);
}

// TEST 9. G8: lapsed explicit + auto items mixed
{
  reset({ perDay: 3, rateCount: 0 });
  const now = Date.now();
  const pastTs = now - 10 * 60 * 1000;
  const id1 = enq(); const id2 = enq();
  db.prepare("UPDATE send_queue SET scheduled_at = ?, pinned = 1 WHERE id = ?").run(pastTs, id1);
  db.prepare("UPDATE send_queue SET sort_order = 20 WHERE id = ?").run(id2);
  const items = [
    { id: id1, file_id: 'f1', target: 'status', hold_until: 0, scheduled_at: pastTs, sort_order: null },
    { id: id2, file_id: 'f1', target: 'status', hold_until: 0, scheduled_at: null, sort_order: 20 },
  ];
  const timeline = srl.buildQueueTimeline({ now, pendingItems: items, perDay: 3, rateState: { count: 0, lastSendAt: 0 } });
  check('G8 mixed: lapsed explicit first', timeline[0].id === id1 && timeline[0].ready === true, `got id=${timeline[0].id} ready=${timeline[0].ready}`);
  check('G8 mixed: auto item gets slot', timeline[1].id === id2 && timeline[1].window === 'AUTO', `got id=${timeline[1].id} window=${timeline[1].window}`);
}

// TEST 10. G7: clearScheduledAt removed (function no longer exported)
{
  check('G7 clearScheduledAt not exported', typeof srl.clearScheduledAt === 'undefined', `got ${typeof srl.clearScheduledAt}`);
}

// TEST 11. G1 + G2 regression: cancel does not affect other items' scheduled_at
{
  reset({ perDay: 3, rateCount: 0 });
  const id1 = enq(); const id2 = enq(); const id3 = enq();
  const ts1 = Date.now() + 3600000;
  const ts2 = Date.now() + 7200000;
  const ts3 = Date.now() + 10800000;
  db.prepare("UPDATE send_queue SET scheduled_at = ? WHERE id = ?").run(ts1, id1);
  db.prepare("UPDATE send_queue SET scheduled_at = ? WHERE id = ?").run(ts2, id2);
  db.prepare("UPDATE send_queue SET scheduled_at = ? WHERE id = ?").run(ts3, id3);
  srl.cancelSend(id2);
  check('G1+G2 id1 scheduled_at intact', qrow(id1).scheduled_at === ts1, `got ${qrow(id1).scheduled_at}`);
  check('G1+G2 id3 scheduled_at intact', qrow(id3).scheduled_at === ts3, `got ${qrow(id3).scheduled_at}`);
  check('G1+G2 id2 canceled', qrow(id2).status === 'canceled', `got ${qrow(id2).status}`);
}

// Summary ------------------------------------------------------------------
const failed = results.filter(r => !r.pass);
origLog(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
