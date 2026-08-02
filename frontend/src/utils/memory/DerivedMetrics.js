// DerivedMetrics — computed facts from Memory Layer.
// Decision Engine reads only these, never raw Memory internals.

export function computeDerivedMetrics(memorySnapshot) {
  if (!memorySnapshot) {
    return createDerivedMetrics();
  }

  const driftEMA = memorySnapshot.driftEMA || { value: 0, sigma: 0, count: 0 };
  const sampleCount = Number(driftEMA.count || 0);
  const biasMs = memorySnapshot.biasMs || 0;
  const recentTickDeltas = Array.isArray(memorySnapshot.recentTickDeltas) ? memorySnapshot.recentTickDeltas : [];
  const decodeLatencyHistory = Array.isArray(memorySnapshot.decodeLatencyHistory) ? memorySnapshot.decodeLatencyHistory : [];
  const droppedFrames = memorySnapshot.droppedFrames || 0;
  const futileCount = memorySnapshot.futileCount || 0;
  const pipelineState = memorySnapshot.pipelineState || 'UNKNOWN';
  const warmupPhase = memorySnapshot.warmupPhase !== false;
  const cpuOverloaded = memorySnapshot.cpuOverloaded || false;
  const isPaused = memorySnapshot.isPaused || false;
  const isWaiting = memorySnapshot.isWaiting || false;
  const isSeeking = memorySnapshot.isSeeking || false;
  const isRecovering = memorySnapshot.isRecovering || false;
  const recentlyHardSeeked = memorySnapshot.recentlyHardSeeked || false;
  const executionBusy = memorySnapshot.executionBusy || false;
  const playbackActive = !isPaused && !isWaiting && !isSeeking;

  const pipelineReady = pipelineState === 'READY' && !warmupPhase;
  const schedulerStable = !cpuOverloaded && recentTickDeltas.length > 0 && getTickVariance(recentTickDeltas) < 20;
  const decoderHealthy = decodeLatencyHistory.length === 0 || getAvgDecodeLatency(decodeLatencyHistory) < 50;
  const biasStable = Math.abs(biasMs) < 50 && Math.sqrt(driftEMA.sigma || 0) < 50;
  const driftMagnitude = Math.abs(memorySnapshot.driftEMA?.value || 0);
  const driftConfidence = driftMagnitude > 0 ? Math.max(0, Math.min(1, 1 - (Math.sqrt(driftEMA.sigma || 0) / driftMagnitude))) : 0;
  const sessionQuality = memorySnapshot.sessionQuality ?? 1;
  const adaptiveThresholds = memorySnapshot.adaptiveThresholds || { softMs: 30, hardMs: 300 };

  // Triangle consistency
  const triangleDrifts = memorySnapshot.triangleDrifts || null;
  let consistencyScore = 1;
  let outlierNode = null;
  if (triangleDrifts && triangleDrifts.hasTriangle) {
    const { audioMvMs, audioBgMs, mvBgMs } = triangleDrifts;
    const expectedMvBg = audioBgMs - audioMvMs;
    const consistencyError = Math.abs(mvBgMs - expectedMvBg);
    const maxDrift = Math.max(Math.abs(audioMvMs), Math.abs(audioBgMs), Math.abs(mvBgMs));
    consistencyScore = Math.max(0, Math.min(1, 1 - consistencyError / 200)) * Math.max(0.3, 1 - maxDrift / 500);
    const absDrifts = [
      { node: 'mv', drift: Math.abs(audioMvMs), raw: audioMvMs },
      { node: 'bg', drift: Math.abs(audioBgMs), raw: audioBgMs },
    ];
    absDrifts.sort((a, b) => b.drift - a.drift);
    if (absDrifts[0].drift > 40) outlierNode = absDrifts[0].node;
  }

  return createDerivedMetrics({
    pipelineReady,
    pipelineHealth: pipelineReady ? 1 : 0.3,
    biasStable,
    biasQuality: biasStable ? 0.9 : 0.3,
    schedulerStable,
    schedulerQuality: schedulerStable ? 0.9 : 0.3,
    decoderHealthy,
    decoderQuality: decoderHealthy ? 0.9 : 0.3,
    driftMagnitude,
    driftConfidence,
    sampleCount,
    futileCount,
    sessionQuality,
    consistencyScore,
    outlierNode,
    triangleDrifts,
    adaptiveThresholds,
    playbackActive,
    isPaused,
    isWaiting,
    isSeeking,
    isRecovering,
    recentlyHardSeeked,
    executionBusy,
  });
}

export function createDerivedMetrics({
  pipelineReady = false,
  pipelineHealth = 0,
  biasStable = false,
  biasQuality = 0,
  schedulerStable = false,
  schedulerQuality = 0,
  decoderHealthy = false,
  decoderQuality = 0,
  driftMagnitude = 0,
  driftConfidence = 0,
  sampleCount = 0,
  futileCount = 0,
  sessionQuality = 1,
  consistencyScore = 1,
  outlierNode = null,
  triangleDrifts = null,
  adaptiveThresholds = { softMs: 30, hardMs: 300 },
  playbackActive = true,
  isPaused = false,
  isWaiting = false,
  isSeeking = false,
  isRecovering = false,
  recentlyHardSeeked = false,
  executionBusy = false,
} = {}) {
  return Object.freeze({
    pipelineReady: Boolean(pipelineReady),
    pipelineHealth: Number(pipelineHealth),
    biasStable: Boolean(biasStable),
    biasQuality: Number(biasQuality),
    schedulerStable: Boolean(schedulerStable),
    schedulerQuality: Number(schedulerQuality),
    decoderHealthy: Boolean(decoderHealthy),
    decoderQuality: Number(decoderQuality),
    driftMagnitude: Number(driftMagnitude),
    driftConfidence: Number(driftConfidence),
    sampleCount: Number(sampleCount),
    futileCount: Number(futileCount),
    sessionQuality: Number(sessionQuality),
    consistencyScore: Number(consistencyScore),
    outlierNode: outlierNode,
    triangleDrifts: triangleDrifts,
    adaptiveThresholds: Object.freeze({
      softMs: Number(adaptiveThresholds.softMs || 30),
      hardMs: Number(adaptiveThresholds.hardMs || 300),
    }),
    playbackActive: Boolean(playbackActive),
    isPaused: Boolean(isPaused),
    isWaiting: Boolean(isWaiting),
    isSeeking: Boolean(isSeeking),
    isRecovering: Boolean(isRecovering),
    recentlyHardSeeked: Boolean(recentlyHardSeeked),
    executionBusy: Boolean(executionBusy),
  });
}

function getTickVariance(deltas) {
  if (!deltas.length) return 0;
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.sqrt(deltas.reduce((sum, val) => sum + (val - mean) ** 2, 0) / deltas.length);
}

function getAvgDecodeLatency(history) {
  if (!history.length) return 0;
  return history.reduce((a, b) => a + b, 0) / history.length;
}
