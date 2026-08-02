// MemorySnapshot — immutable projection of Memory Layer state for one tick.
// Used by Analyzers and Decision Engine. Never exposes writable Memory references.

export function createMemorySnapshot({
  engineId,
  driftEMA = null,
  biasMs = 0,
  cptMs = 0,
  pipelineState = 'UNKNOWN',
  warmupPhase = true,
  disturbanceCount = 0,
  recentTickDeltas = [],
  cpuOverloaded = false,
  decodeLatencyHistory = [],
  droppedFrames = 0,
  futileCount = 0,
  adaptiveThresholds = { softMs: 30, hardMs: 300 },
  confidenceHistory = [],
  sessionQuality = 1,
  triangleDrifts = null,
  isPaused = false,
  isWaiting = false,
  isSeeking = false,
  isRecovering = false,
  recentlyHardSeeked = false,
  executionBusy = false,
}) {
  return Object.freeze({
    engineId: String(engineId || 'mv'),
    driftEMA: Object.freeze({
      value: Number(driftEMA?.value || 0),
      sigma: Number(driftEMA?.sigma || 0),
      count: Number(driftEMA?.count || 0),
    }),
    biasMs: Number(biasMs || 0),
    cptMs: Number(cptMs || 0),
    pipelineState: String(pipelineState || 'UNKNOWN'),
    warmupPhase: Boolean(warmupPhase),
    disturbanceCount: Number(disturbanceCount || 0),
    recentTickDeltas: Object.freeze(recentTickDeltas.map(Number)),
    cpuOverloaded: Boolean(cpuOverloaded),
    decodeLatencyHistory: Object.freeze(decodeLatencyHistory.map(Number)),
    droppedFrames: Number(droppedFrames || 0),
    futileCount: Number(futileCount || 0),
    adaptiveThresholds: Object.freeze({
      softMs: Number(adaptiveThresholds.softMs || 30),
      hardMs: Number(adaptiveThresholds.hardMs || 300),
    }),
    confidenceHistory: Object.freeze(confidenceHistory.map(Number)),
    sessionQuality: Number(sessionQuality ?? 1),
    triangleDrifts: triangleDrifts
      ? Object.freeze({
          hasTriangle: Boolean(triangleDrifts.hasTriangle),
          audioMvMs: Number(triangleDrifts.audioMvMs || 0),
          audioBgMs: Number(triangleDrifts.audioBgMs || 0),
          mvBgMs: Number(triangleDrifts.mvBgMs || 0),
        })
      : null,
    isPaused: Boolean(isPaused),
    isWaiting: Boolean(isWaiting),
    isSeeking: Boolean(isSeeking),
    isRecovering: Boolean(isRecovering),
    recentlyHardSeeked: Boolean(recentlyHardSeeked),
    executionBusy: Boolean(executionBusy),
  });
}
