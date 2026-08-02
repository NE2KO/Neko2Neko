import { performance } from 'perf_hooks';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 1. MOCK performance.now() — deterministic clock for the harness
// ─────────────────────────────────────────────────────────────────────────────

let mockTime = 0;
const originalNow = performance.now.bind(performance);
performance.now = () => mockTime++;

// ─────────────────────────────────────────────────────────────────────────────
// 2. IMPORT ENGINE — after mock is in place so all methods see it
// ─────────────────────────────────────────────────────────────────────────────

import { SharedSyncCore, EMATracker, RollingStats, Histogram, DecisionCounter, SeekTelemetry } from '../frontend/src/utils/syncCore.js';

// ─────────────────────────────────────────────────────────────────────────────
// 3. DETERMINISTIC SCENARIO GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateDriftSequence(length, seed = 0) {
  const seq = [];
  for (let i = 0; i < length; i++) {
    const t = i / length;
    // Mostly stable with occasional small fluctuations
    const base = Math.sin(seed + i * 0.05) * 2;
    // Periodic spikes to exercise seek logic
    const spike = (i % 300 === 0) ? 120 : (i % 300 === 150 ? -80 : 0);
    // Random-ish but deterministic walk
    const walk = Math.sin(seed + i * 0.13) * 3 + Math.cos(seed + i * 0.07) * 2;
    seq.push(base + spike + walk);
  }
  return seq;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. STATE CAPTURE — must capture every mutable field for Level B hashing
// ─────────────────────────────────────────────────────────────────────────────

function captureRolling(stat) {
  if (!stat) return null;
  return {
    current: stat.current,
    sum: stat.sum,
    min: stat.min === Infinity ? null : stat.min,
    max: stat.max,
    count: stat.count,
  };
}

function captureEngineState(stats) {
  return {
    rawDriftEMA: { mean: stats.rawDriftEMA.mean, variance: stats.rawDriftEMA.variance, samples: stats.rawDriftEMA.samples },
    correctedDriftEMA: { mean: stats.correctedDriftEMA.mean, variance: stats.correctedDriftEMA.variance, samples: stats.correctedDriftEMA.samples },
    biasEMA: { mean: stats.biasEMA.mean, variance: stats.biasEMA.variance, samples: stats.biasEMA.samples },
    presLatEMA: { mean: stats.presLatEMA.mean, variance: stats.presLatEMA.variance, samples: stats.presLatEMA.samples },
    seekLatEMA: { mean: stats.seekLatEMA.mean, variance: stats.seekLatEMA.variance, samples: stats.seekLatEMA.samples },
    decodeLatEMA: { mean: stats.decodeLatEMA.mean, variance: stats.decodeLatEMA.variance, samples: stats.decodeLatEMA.samples },
    rawDrift: captureRolling(stats.rawDrift),
    correctedDrift: captureRolling(stats.correctedDrift),
    presLat: captureRolling(stats.presLat),
    seekLat: captureRolling(stats.seekLat),
    decodeLat: captureRolling(stats.decodeLat),
    frameAge: captureRolling(stats.frameAge),
    fps: captureRolling(stats.fps),
    tickDelta: captureRolling(stats.tickDelta),
    schedulerLateness: captureRolling(stats.schedulerLateness),
    tickCount: stats.tickCount,
    schedulerStallCount: stats.schedulerStallCount,
    cpuOverloadCount: stats.cpuOverloadCount,
    tickMissCount: stats.tickMissCount,
    histogram: captureHistogram(stats.histogram),
    lastRawDrift: stats.lastRawDrift,
    lastCorrectedDrift: stats.lastCorrectedDrift,
    lastBias: stats.lastBias,
    lastPresLat: stats.lastPresLat,
    lastSeekLat: stats.lastSeekLat,
    lastDecodeLat: stats.lastDecodeLat,
    lastFrameAge: stats.lastFrameAge,
    pendingSeek: stats._pendingSeek ? { type: stats._pendingSeek.type, timestamp: stats._pendingSeek.timestamp } : null,
    seekPipelineLatenciesCount: stats.seekPipelineLatencies.length,
    clockProvenanceRingLength: stats.clockProvenanceRing.length,
    spikeRecorderLength: stats.spikeRecorder.length,
    reStabilityEventsCount: stats.reStabilityEvents.length,
    currentReStabilityEvent: stats.currentReStabilityEvent ? { trigger: stats.currentReStabilityEvent.trigger } : null,
  };
}

function captureHistogram(hist) {
  if (!hist || !hist.bins) return null;
  return {
    bins: hist.bins.map(b => ({ label: b.label, count: b.count })),
    total: hist.total,
  };
}

function captureCoreState(core) {
  return {
    isStable: core._isStable,
    mv: captureEngineState(core.mv),
    bg: captureEngineState(core.bg),
    mvDecisions: core.mvDecisions.getSummary(),
    bgDecisions: core.bgDecisions.getSummary(),
    mvConfidence: core.mv.confidence,
    bgConfidence: core.bg.confidence,
    replayLogLength: core.replayLog.length,
    // Capture replay sample to ensure deterministic timestamps
    replaySample: core.replayLog.slice(0, 3).map(e => ({ t: e.t, engine: e.engine, kind: e.kind })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TEST RUNNERS
// ─────────────────────────────────────────────────────────────────────────────

async function runLevelA_FunctionalDeterminism() {
  console.log('\n=== Level A: Functional Determinism ===');
  console.log('Testing: identical inputs → identical decision log output across 100 runs\n');

  const RUNS = 100;
  const TICKS = 1000;
  const driftSequence = generateDriftSequence(TICKS, 42);
  const runSummaries = [];

  for (let run = 0; run < RUNS; run++) {
    mockTime = 0;
    const core = new SharedSyncCore(() => mockTime++);

    for (let i = 0; i < TICKS; i++) {
      const driftMs = driftSequence[i];
      const state = { mode: 'LOCKED', stable: true };

      // Systematic observation calls (mirrors what Music.jsx tick does)
      core.observeTickDelta('mv', 30);
      core.observeSchedulerLateness('mv', 0);
      core.incTickCount('mv');

      if (Math.abs(driftMs) < 5000) {
        core.observeDrift('mv', driftMs, state);
      }

      // Decision logic (mirrors Music.jsx threshold decisions)
      const stats = core.getStats('mv');
      const softTh = stats.thresholds.soft * 1000;
      const hardTh = stats.thresholds.hard * 1000;
      const correctedDrift = driftMs - (stats.biasReady ? stats.bias : 0);
      const absDrift = Math.abs(correctedDrift);

      if (absDrift > hardTh) {
        core.recordDecision('mv', 'HARD');
        core.recordSeek('mv', 'HARD', driftMs, null);
      } else if (absDrift > softTh) {
        core.recordDecision('mv', 'SOFT');
        core.recordSeek('mv', 'SOFT', driftMs, null);
      } else {
        core.recordDecision('mv', 'LOCK');
      }

      // Stabilization lifecycle at deterministic points
      if (i === 200) {
        core.setStable(false);
        core.startReStabilization('mv', 'audio_event');
      }
      if (i === 350) {
        core.completeReStabilization('mv', true, false);
      }

      // Spike capture at deterministic points
      if (Math.abs(driftMs) > 50) {
        core.captureSpike('mv', driftMs, { ...state, seekJustCompleted: false, schedulerLateness: 0 });
      }
    }

    const summary = core.mvDecisions.getSummary();
    runSummaries.push(JSON.stringify(summary));
  }

  const firstSummary = runSummaries[0];
  const allMatch = runSummaries.every(s => s === firstSummary);

  if (allMatch) {
    console.log(`  ✅ PASS: ${RUNS} runs produced identical decision summaries`);
    console.log(`  Summary: ${firstSummary}`);
    return true;
  } else {
    console.error('  ❌ FAIL: Decision summaries differ across runs');
    for (let i = 0; i < Math.min(RUNS, 5); i++) {
      if (runSummaries[i] !== firstSummary) {
        console.error(`    Run ${i}: ${runSummaries[i]}`);
        break;
      }
    }
    return false;
  }
}

async function runLevelB_StateTransitionDeterminism() {
  console.log('\n=== Level B: State Transition Determinism ===');
  console.log('Testing: SHA256 state hash per tick identical across 100 runs\n');

  const RUNS = 100;
  const TICKS = 1000;
  const driftSequence = generateDriftSequence(TICKS, 42);

  const tickHashes = {}; // tickIndex -> expectedHash

  for (let run = 0; run < RUNS; run++) {
    mockTime = 0;
    const core = new SharedSyncCore(() => mockTime++);

    for (let i = 0; i < TICKS; i++) {
      const driftMs = driftSequence[i];
      const state = { mode: 'LOCKED', stable: true };

      core.observeTickDelta('mv', 30);
      core.observeSchedulerLateness('mv', 0);
      core.incTickCount('mv');

      if (Math.abs(driftMs) < 5000) {
        core.observeDrift('mv', driftMs, state);
      }

      const stats = core.getStats('mv');
      const softTh = stats.thresholds.soft * 1000;
      const hardTh = stats.thresholds.hard * 1000;
      const correctedDrift = driftMs - (stats.biasReady ? stats.bias : 0);
      const absDrift = Math.abs(correctedDrift);

      if (absDrift > hardTh) {
        core.recordDecision('mv', 'HARD');
        core.recordSeek('mv', 'HARD', driftMs, null);
      } else if (absDrift > softTh) {
        core.recordDecision('mv', 'SOFT');
        core.recordSeek('mv', 'SOFT', driftMs, null);
      } else {
        core.recordDecision('mv', 'LOCK');
      }

      if (i === 200) {
        core.setStable(false);
        core.startReStabilization('mv', 'audio_event');
      }
      if (i === 350) {
        core.completeReStabilization('mv', true, false);
      }

      if (Math.abs(driftMs) > 50) {
        core.captureSpike('mv', driftMs, { ...state, seekJustCompleted: false, schedulerLateness: 0 });
      }

      // Hash state at every 100th tick + final tick
      if (i % 100 === 0 || i === TICKS - 1) {
        const hash = createHash('sha256').update(JSON.stringify(captureCoreState(core))).digest('hex');
        if (!tickHashes[i]) tickHashes[i] = hash;
        if (tickHashes[i] !== hash) {
          console.error(`  ❌ FAIL: tick=${i} run=${run} hash mismatch`);
          console.error(`    expected: ${tickHashes[i]}`);
          console.error(`    actual:   ${hash}`);
          return false;
        }
      }
    }
  }

  console.log(`  ✅ PASS: ${RUNS} runs × ${TICKS} ticks — all ${Object.keys(tickHashes).length} state hashes identical`);
  const sampleTick = Math.floor(TICKS / 2);
  console.log(`  Sample hash at tick ${sampleTick}: ${tickHashes[sampleTick]}`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. GOLDEN REPLAY GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function generateGoldenPerfect() {
  console.log('\n=== Generating Golden Replay: perfect.json ===');

  const ticks = [];
  const duration = 30; // seconds
  const tickInterval = 0.030; // 30ms
  const numTicks = Math.floor(duration / tickInterval);

  for (let i = 0; i < numTicks; i++) {
    const t = i * tickInterval;
    // Perfect clock: audio and video advance identically, zero drift
    ticks.push({
      t: Math.round(t * 1000),
      audio: parseFloat((10.0 + t).toFixed(3)),
      video: parseFloat((10.0 + t).toFixed(3)),
      drift: 0,
    });
  }

  const golden = {
    name: 'perfect',
    description: 'Steady-state 30s playback, no disruptions, zero drift',
    tickIntervalMs: 30,
    ticks,
  };

  const goldenDir = join(__dirname, 'golden');
  mkdirSync(goldenDir, { recursive: true });
  writeFileSync(join(goldenDir, 'perfect.json'), JSON.stringify(golden, null, 2));
  console.log(`  ✅ Written: ${join(goldenDir, 'perfect.json')} (${ticks.length} ticks)`);
}

function generateGoldenNoisy() {
  console.log('\n=== Generating Golden Replay: noisy.json ===');

  const ticks = [];
  const duration = 30;
  const tickInterval = 0.030;
  const numTicks = Math.floor(duration / tickInterval);

  for (let i = 0; i < numTicks; i++) {
    const t = i * tickInterval;
    // 1ms Gaussian-ish noise (deterministic via sin)
    const noise = Math.sin(i * 0.1) * 0.5 + Math.cos(i * 0.23) * 0.5;
    const audio = 10.0 + t;
    const video = 10.0 + t + noise * 0.001;
    const drift = video - audio;
    ticks.push({
      t: Math.round(t * 1000),
      audio: parseFloat(audio.toFixed(3)),
      video: parseFloat(video.toFixed(3)),
      drift: parseFloat(drift.toFixed(6)),
    });
  }

  const golden = {
    name: 'noisy',
    description: 'Steady-state 30s playback with ~1ms deterministic noise floor',
    tickIntervalMs: 30,
    ticks,
  };

  const goldenDir = join(__dirname, 'golden');
  mkdirSync(goldenDir, { recursive: true });
  writeFileSync(join(goldenDir, 'noisy.json'), JSON.stringify(golden, null, 2));
  console.log(`  ✅ Written: ${join(goldenDir, 'noisy.json')} (${ticks.length} ticks)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Algorithm Determinism Test — Level A + Level B     ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const levelA = await runLevelA_FunctionalDeterminism();
  const levelB = await runLevelB_StateTransitionDeterminism();

  generateGoldenPerfect();
  generateGoldenNoisy();

  console.log('\n══════════════════════════════════════════════════════');
  if (levelA && levelB) {
    console.log('RESULT: ✅ ENGINE DETERMINISTIC — proceed to Reference Baseline Matrix');
    process.exit(0);
  } else {
    console.log('RESULT: ❌ ENGINE NON-DETERMINISTIC — fix before proceeding');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Harness error:', err);
  process.exit(1);
});
