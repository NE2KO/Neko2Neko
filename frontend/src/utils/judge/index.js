import { DEFAULT_TRIANGLE_TOLERANCE_MS } from '../TriangleCalculator.js';

const TRIANGLE_TOLERANCE_MS = DEFAULT_TRIANGLE_TOLERANCE_MS;

export function judgeTriangleOutlier(audioMvMs, audioBgMs, mvBgMs, tolerance = TRIANGLE_TOLERANCE_MS, options = {}) {
  const { persistenceCount = 0, maxPersistence = 3 } = options;

  if (
    !Number.isFinite(audioMvMs) ||
    !Number.isFinite(audioBgMs) ||
    !Number.isFinite(mvBgMs)
  ) {
    return {
      outlierEngine: null,
      confidence: 0,
      triangleConsistent: false,
      maxDriftMs: null,
      needsObservation: persistenceCount < maxPersistence,
    };
  }

  const triangleErrorMs = Math.abs((audioMvMs + mvBgMs) - audioBgMs);
  const triangleConsistent = triangleErrorMs <= tolerance;

  if (!triangleConsistent) {
    return {
      outlierEngine: null,
      confidence: 0,
      triangleConsistent: false,
      maxDriftMs: Math.max(Math.abs(audioMvMs), Math.abs(audioBgMs), Math.abs(mvBgMs)),
      needsObservation: persistenceCount < maxPersistence,
    };
  }

  const absAudioMv = Math.abs(audioMvMs);
  const absAudioBg = Math.abs(audioBgMs);
  const absMvBg = Math.abs(mvBgMs);

  let outlierEngine = null;
  let maxDrift = 0;

  if (absAudioMv >= absAudioBg && absAudioMv >= absMvBg) {
    outlierEngine = audioMvMs > 0 ? 'mv' : 'audio';
    maxDrift = absAudioMv;
  } else if (absMvBg >= absAudioBg) {
    outlierEngine = 'bg';
    maxDrift = absMvBg;
  } else {
    outlierEngine = 'bg';
    maxDrift = absAudioBg;
  }

  const confidence = Math.max(0.5, 1 - triangleErrorMs / 50);
  const persistenceConfidence = options.persistenceCount > 0 
    ? Math.min(1, options.persistenceCount / options.maxPersistence) 
    : 1;

  return {
    outlierEngine,
    confidence: confidence * (0.5 + 0.5 * persistenceConfidence),
    triangleConsistent: true,
    maxDriftMs: maxDrift,
    persistenceCount: options.persistenceCount,
    needsObservation: options.persistenceCount < options.maxPersistence,
  };
}

const SPARSE_THRESHOLD_MS = 3;
const SPARSE_PERSISTENCE = 2;

export function detectTransientSpike(prevDrifts, currentDrift, maxDriftMs, confidence) {
  if (!prevDrifts || prevDrifts.length < 2) {
    return { isSpike: false, reason: 'insufficient_history' };
  }

  const recent = prevDrifts.slice(-5);
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const stdDev = Math.sqrt(recent.reduce((a, b) => a + (b - avgRecent) ** 2, 0) / recent.length);

  const isOutlier = Math.abs(currentDrift - avgRecent) > 3 * stdDev && stdDev < 10;
  const isHighConfidence = confidence > 0.7;
  const isSparseRegion = avgRecent < SPARSE_THRESHOLD_MS;

  if (isOutlier && !isHighConfidence && isSparseRegion) {
    return { isSpike: true, reason: 'transient_spike', confidence: 'low' };
  }

  if (isOutlier && isHighConfidence) {
    return { isSpike: false, reason: 'sustained_desync', confidence: 'high' };
  }

  return { isSpike: false, reason: 'normal' };
}

export function computeDriftTrend(drifts) {
  if (!drifts || drifts.length < 3) return { trend: 0, direction: 'neutral' };

  const recent = drifts.slice(-3);
  const deltas = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push(recent[i] - recent[i - 1]);
  }

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  if (avgDelta > 0.1) return { trend: avgDelta, direction: 'increasing' };
  if (avgDelta < -0.1) return { trend: Math.abs(avgDelta), direction: 'decreasing' };
  return { trend: 0, direction: 'stable' };
}