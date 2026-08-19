import { computeTriangleDrifts, computeTriangleErrorMs, judgeTriangleOutlier, DEFAULT_TRIANGLE_TOLERANCE_MS } from './TriangleCalculator.js';
import { createSpikeDetectors, analyzeDriftSpikes } from './transientDetector.js';

let verificationSequence = 0;

export function generateVerificationSnapshot(engineState, params = {}) {
  const {
    audioMs,
    mvMs,
    bgMs,
    videoOffset = 0,
    biasMs,
    timing,
    mode = 'LOCKED',
    seekPending = false,
    lastHardSeekTime = 0,
    timestamp = Date.now(),
  } = engineState;

  const triangle = computeTriangleDrifts(
    audioMs ?? 0,
    mvMs ?? 0,
    bgMs ?? 0,
    videoOffset
  );

  const judge = judgeTriangleOutlier(
    triangle.audioMvMs ?? 0,
    triangle.audioBgMs ?? 0,
    triangle.mvBgMs ?? 0
  );

  const rawDriftMs = triangle.audioMvMs ?? 0;
  const isPostSeek = lastHardSeekTime > 0 && (Date.now() - lastHardSeekTime) < 1500;

  const spikeAnalysis = analyzeDriftSpikes(rawDriftMs, engineState.spikeDetector, {
    timestamp,
    engineState: { mode, seekPending, lastHardSeekTime },
  });

  const syncTickTiming = timing || {
    sensor: 0,
    triangle: 0,
    validator: 0,
    analyzer: 0,
    judge: 0,
    constraint: 0,
    decision: 0,
    executor: 0,
    total: 0,
  };

  return {
    sequence: ++verificationSequence,
    timestamp,

    audioMs: audioMs ?? 0,
    mvMs: mvMs ?? 0,
    bgMs: bgMs ?? 0,
    videoOffset: videoOffset ?? 0,

    audioMvMs: triangle.audioMvMs,
    audioBgMs: triangle.audioBgMs,
    mvBgMs: triangle.mvBgMs,

    triangleValid: triangle.triangleValid,
    triangleConsistent: triangle.triangleConsistent,
    triangleErrorMs: triangle.triangleErrorMs,

    biasMs: biasMs ?? 0,
    frameAge: engineState.frameAge ?? null,

    judgeResult: judge.outlierEngine,
    confidence: judge.confidence,
    maxDriftMs: judge.maxDriftMs,

    allowedActions: engineState.allowedActions || ['HOLD', 'NOOP'],
    selectedAction: engineState.selectedAction || 'HOLD',
    decisionReason: engineState.decisionReason || 'default',

    mode,
    seekPending,
    timeSinceSeekMs: lastHardSeekTime ? Date.now() - lastHardSeekTime : 0,

    isPostSeek,
    classification: spikeAnalysis.classification,
    isSpike: spikeAnalysis.isSpike,
    spikeConfidence: spikeAnalysis.confidence,

    tickDelta: engineState.tickDelta ?? 30,
    schedulerLateness: engineState.schedulerLateness ?? 0,

    timing: syncTickTiming,

    spikeAnalysis: {
      spikeCount: spikeAnalysis.spikeCount,
      stableSamples: spikeAnalysis.stableSamples,
      reason: spikeAnalysis.reason,
    },
  };
}

export function computeReferenceFromSnapshot(snapshot, tolerance = DEFAULT_TRIANGLE_TOLERANCE_MS) {
  const { audioMs, mvMs, bgMs, videoOffset = 0 } = snapshot;

  if (
    typeof audioMs !== 'number' ||
    typeof mvMs !== 'number' ||
    typeof bgMs !== 'number'
  ) {
    return { error: 'invalid_input' };
  }

  const triangle = computeTriangleDrifts(audioMs, mvMs, bgMs, videoOffset);
  const judge = judgeTriangleOutlier(
    triangle.audioMvMs ?? 0,
    triangle.audioBgMs ?? 0,
    triangle.mvBgMs ?? 0,
    tolerance
  );

  return {
    audioMs,
    mvMs,
    bgMs,
    videoOffset,

    audioMvMs: triangle.audioMvMs,
    audioBgMs: triangle.audioBgMs,
    mvBgMs: triangle.mvBgMs,

    triangleValid: triangle.triangleValid,
    triangleConsistent: triangle.triangleConsistent,
    triangleErrorMs: triangle.triangleErrorMs,

    judge: {
      outlierEngine: judge.outlierEngine,
      confidence: judge.confidence,
      triangleConsistent: judge.triangleConsistent,
    },

    status: triangle.triangleConsistent ? 'MATCH' : 'INCONSISTENT',
  };
}

export function compareSnapshotToReference(snapshot, reference, tolerance = DEFAULT_TRIANGLE_TOLERANCE_MS) {
  const mismatch = [];

  if ((snapshot.triangleValid ?? false) !== (reference.triangleValid ?? false)) {
    mismatch.push('triangleValid');
  }
  if ((snapshot.triangleConsistent ?? true) !== (reference.triangleConsistent ?? true)) {
    mismatch.push('triangleConsistent');
  }

  const numericFields = ['audioMvMs', 'audioBgMs', 'mvBgMs', 'triangleErrorMs'];
  for (const f of numericFields) {
    const s = snapshot[f];
    const r = reference[f];
    if (s === null || r === null) {
      if (s !== r) mismatch.push(f);
    } else if (Math.abs(s - r) > tolerance) {
      mismatch.push(f);
    }
  }

  if (mismatch.length === 0) {
    return { status: 'MATCH', match: true };
  }

  if (mismatch.length < 3) {
    return { status: 'MINOR_DIVERGENCE', match: true, details: mismatch };
  }

  return { status: 'DIVERGENCE', match: false, details: mismatch };
}

export function resetSequence(counter = null) {
  if (counter !== undefined) {
    verificationSequence = counter;
  } else {
    verificationSequence = 0;
  }
  return verificationSequence;
}

export function getSequence() {
  return verificationSequence;
}