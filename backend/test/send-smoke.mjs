// Live WA smoke test — run in the user's environment where the backend + WhatsApp
// Status client are actually connected. NOT executed in CI/sandbox (no WA client).
//
// Usage:
//   SEND_DEBUG=1 node test/send-smoke.mjs <h264_aac_fileId> [failing_fileId]
//
// Hard limits honoured: max 2 media, no queue sweep, no blast. The script uses the
// real HTTP API so it exercises the exact production send path (enqueueOrSend ->
// performAndRecord -> performSend -> WA Status). With SEND_DEBUG=1 the server prints
// [SEND-JUDGE] lifecycle lines; this script also reports the rate_count delta so you
// can confirm T1 (recordSend only on delivered) empirically.
import { performance } from 'node:perf_hooks';

const BASE = process.env.SEND_BASE || 'http://localhost:3000';
const fileId1 = process.argv[2]; // H.264 + AAC valid -> expected SUCCESS
const fileId2 = process.argv[3]; // safe failure/transient -> expected RETRY/FAILURE

if (!fileId1) {
  console.error('Usage: node test/send-smoke.mjs <h264_aac_fileId> [failing_fileId]');
  process.exit(2);
}

async function getJSON(path) {
  const r = await fetch(BASE + path);
  return r.json();
}
async function postJSON(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function rateSnapshot() {
  const s = await getJSON('/api/send/queue/statuses');
  return { count: s.policy?.dailyCap ? s.policy.dailyCap - s.policy.remainingToday : null, policy: s.policy };
}

async function runOne(label, fileId, expect) {
  console.log(`\n===== ${label}: fileId=${fileId} (expect ${expect}) =====`);
  const before = await rateSnapshot();
  const t0 = performance.now();
  const res = await postJSON('/api/send/status', { fileId });
  const dt = Math.round(performance.now() - t0);
  const after = await rateSnapshot();
  console.log('response:', JSON.stringify(res.json).slice(0, 300));
  console.log(`time=${dt}ms  rateBefore=${JSON.stringify(before.policy?.remainingToday)} rateAfter=${JSON.stringify(after.policy?.remainingToday)}`);

  const q = await getJSON('/api/send/queue?status=done');
  const f = await getJSON('/api/send/queue?status=failed');
  const recent = [...(q.items || []), ...(f.items || [])].filter((i) => i.file_id == fileId || i.id == res.json?.queueId).slice(-3);
  console.log('recent item(s):', JSON.stringify(recent.map((i) => ({ id: i.id, status: i.status, error: i.error, attempt_log: i.attempt_log })), null, 0));

  const delta = (before.policy?.remainingToday ?? null) - (after.policy?.remainingToday ?? null);
  console.log(`RATE delta (remainingToday): ${delta}  -> ${expect === 'SUCCESS' ? 'expect 0 (consumed 1 of N slots)' : 'expect 0 (failure must NOT consume a slot)'}`);
}

await runOne('TEST 1 (SUCCESS expected)', fileId1, 'SUCCESS');
if (fileId2) {
  await runOne('TEST 2 (FAILURE/RETRY expected)', fileId2, 'FAILURE');
  console.log('\nNOTE: confirm no duplicate send_history rows for the same file+target,');
  console.log('and grep server stdout for [SEND-JUDGE] to inspect BEFORE/DECISION/AFTER.');
}
console.log('\nSmoke test complete (2 media max).');
