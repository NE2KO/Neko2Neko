import { performance } from 'perf_hooks';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SharedSyncCore } from '../frontend/src/utils/syncCore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 1. MOCK performance.now() — deterministic clock for the harness
// ─────────────────────────────────────────────────────────────────────────────

let mockTime = 0;
const originalNow = performance.now.bind(performance);
performance.now = () => mockTime++;

// ─────────────────────────────────────────────────────────────────────────────
// 2. HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function loadGolden(name) {
  const path = join(__dirname, 'golden', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runReplay(golden, config = {}) {
  mockTime = 0;
  const core = new SharedSyncCore(() => mockTime++);

  const ticks = golden.ticks || [];
  const tickIntervalMs = golden.tickIntervalMs || 30;
  const samples = {
    mv: [],
    bg: [],
    all: [],
  };

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    const driftSec = tick.drift != null ? tick.drift : (tick.audio != null && tick.video != null ? tick.video - tick.audio : 0);
    const driftMs = driftSec * 1000;
    const state = { mode: 'LOCKED', stable: true };

    // Simulate tick delta + scheduler latch untuk kedua engine
    core.observeTickDelta('mv', tickIntervalMs);
    core.observeSchedulerLateness('mv', 0);
    core.incTickCount('mv');

    core.observeTickDelta('bg', tickIntervalMs);
    core.observeSchedulerLateness('bg', 0);
    core.incTickCount('bg');

    // Amati drift jika dalam batas wajar
    if (Math.abs(driftMs) < 5000) {
      core.observeDrift('mv', driftMs, state);
      core.observeDrift('bg', driftMs, state);
    }

    // Keputusan seek — sama dengan Music.jsx tick logic
    for (const engine of ['mv', 'bg']) {
      const stats = core.getStats(engine);
      const softTh = stats.thresholds.soft * 1000;
      const hardTh = stats.thresholds.hard * 1000;
      const correctedDrift = driftMs - (stats.biasReady ? stats.bias : 0);
      const absDrift = Math.abs(correctedDrift);

      if (absDrift > hardTh) {
        core.recordDecision(engine, 'HARD');
        core.recordSeek(engine, 'HARD', driftMs, null);
      } else if (absDrift > softTh) {
        core.recordDecision(engine, 'SOFT');
        core.recordSeek(engine, 'SOFT', driftMs, null);
      } else {
        core.recordDecision(engine, 'LOCK');
      }

      samples[engine].push({
        t: tick.t,
        raw: driftMs,
        corrected: correctedDrift,
        sigma: stats.driftStdDev,
        biasReady: stats.biasReady,
        bias: stats.bias,
        softTh,
        hardTh,
        decision: absDrift > hardTh ? 'HARD' : absDrift > softTh ? 'SOFT' : 'LOCK',
      });
    }

    samples.all.push({
      t: tick.t,
      mv: samples.mv[samples.mv.length - 1],
      bg: samples.bg[samples.bg.length - 1],
    });
  }

  const mvStats = core.getStats('mv');
  const bgStats = core.getStats('bg');
  const mvDecisions = core.mvDecisions.getSummary();
  const bgDecisions = core.bgDecisions.getSummary();
  const durationSec = ticks.length * (tickIntervalMs / 1000);

  return {
    name: golden.name,
    description: golden.description,
    tickIntervalMs,
    ticksCount: ticks.length,
    durationSec,
    mv: {
      stats: mvStats,
      decisions: mvDecisions,
      seekTelemetry: core.mvSeekTelemetry.getSummary(),
      softSeekPerMin: durationSec > 0 ? (mvDecisions.soft / durationSec * 60) : 0,
      hardSeekPerMin: durationSec > 0 ? (mvDecisions.hard / durationSec * 60) : 0,
      sigma: mvStats.driftStdDev,
      lockPct: mvDecisions.lockPct,
      biasReady: mvStats.biasReady,
      biasSamples: mvStats.biasSamples,
      samples: samples.mv,
    },
    bg: {
      stats: bgStats,
      decisions: bgDecisions,
      seekTelemetry: core.bgSeekTelemetry.getSummary(),
      softSeekPerMin: durationSec > 0 ? (bgDecisions.soft / durationSec * 60) : 0,
      hardSeekPerMin: durationSec > 0 ? (bgDecisions.hard / durationSec * 60) : 0,
      sigma: bgStats.driftStdDev,
      lockPct: bgDecisions.lockPct,
      biasReady: bgStats.biasReady,
      biasSamples: bgStats.biasSamples,
      samples: samples.bg,
    },
  };
}

function fmt(v, decimals = 2) {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(decimals);
}

function formatTable(rows) {
  const headers = ['Environment', 'Sigma', 'Lock%', 'Soft/min', 'Hard/min', 'Bias ready', 'Duration'];
  const lines = ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |'];
  for (const r of rows) {
    lines.push(`| ${r.env} | ${fmt(r.sigma)} | ${fmt(r.lockPct, 0)}% | ${fmt(r.softPerMin, 1)} | ${fmt(r.hardPerMin, 1)} | ${r.biasReady ? '✅' : '❌'} | ${fmt(r.durationSec, 1)}s |`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RUN BASELINE
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║               Reference Baseline Matrix                ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const goldenNames = ['perfect', 'noisy'];
  const rows = [];

  for (const name of goldenNames) {
    console.log(`\n▶ Replaying ${name}.json ...`);
    const golden = loadGolden(name);
    const result = runReplay(golden);

    console.log(`  Ticks:        ${result.ticksCount}`);
    console.log(`  Duration:     ${fmt(result.durationSec, 1)}s`);
    console.log(`  MV   sigma:   ${fmt(result.mv.sigma)}  Lock%: ${fmt(result.mv.lockPct, 0)}%  Soft/min: ${fmt(result.mv.softSeekPerMin, 1)}  Hard/min: ${fmt(result.mv.hardSeekPerMin, 1)}  Bias ready: ${result.mv.biasReady ? 'YES' : 'NO'}`);
    console.log(`  BG   sigma:   ${fmt(result.bg.sigma)}  Lock%: ${fmt(result.bg.lockPct, 0)}%  Soft/min: ${fmt(result.bg.softSeekPerMin, 1)}  Hard/min: ${fmt(result.bg.hardSeekPerMin, 1)}  Bias ready: ${result.bg.biasReady ? 'YES' : 'NO'}`);

    rows.push({
      env: name,
      sigma: result.mv.sigma,
      lockPct: result.mv.lockPct,
      softPerMin: result.mv.softSeekPerMin,
      hardPerMin: result.mv.hardSeekPerMin,
      biasReady: result.mv.biasReady,
      durationSec: result.durationSec,
    });

    const outPath = join(__dirname, 'golden', `${name}-baseline.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  ✅ Baseline written: ${outPath}`);
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log(formatTable(rows));

  // Simple PASS/FAIL assessment against Acceptance Baseline
  console.log('\n────────────────────────────────────────────────────────');
  console.log('Assessment against Acceptance Baseline:');
  for (const r of rows) {
    const passSigma = r.sigma !== null && (r.env === 'perfect' ? r.sigma <= 0.5 : r.sigma <= 3);
    const passLock = r.lockPct >= 95;
    const status = passSigma && passLock ? '✅ PASS' : '🔲 REVIEW';
    console.log(`  ${r.env}: sigma=${fmt(r.sigma)} lock%=${fmt(r.lockPct, 0)}% → ${status}`);
  }
}

main().catch(err => {
  console.error('Baseline error:', err);
  process.exit(1);
});
