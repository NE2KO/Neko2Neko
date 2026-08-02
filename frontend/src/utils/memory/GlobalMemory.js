// GlobalMemory — session-wide memory (not per-engine).
// Stores metrics that span both MV and BG engines.

import { createMemorySnapshot } from './MemorySnapshot.js';

export class GlobalMemory {
  constructor() {
    this.cptSessionMs = 0;
    this.sessionQuality = 1;
    this.disturbanceSummary = { mv: 0, bg: 0 };
  }

  setCptSessionMs(cptMs) {
    this.cptSessionMs = Number(cptMs || 0);
  }

  recordDisturbance(engineId) {
    if (engineId === 'mv') this.disturbanceSummary.mv++;
    else if (engineId === 'bg') this.disturbanceSummary.bg++;
  }

  setSessionQuality(quality) {
    this.sessionQuality = Math.max(0, Math.min(1, Number(quality ?? 1)));
  }

  reset() {
    this.cptSessionMs = 0;
    this.sessionQuality = 1;
    this.disturbanceSummary = { mv: 0, bg: 0 };
  }

  createSnapshot(engineId = 'mv') {
    return createMemorySnapshot({
      engineId,
      driftEMA: null,
      biasMs: 0,
      cptMs: this.cptSessionMs,
      pipelineState: 'UNKNOWN',
      warmupPhase: true,
      disturbanceCount: this.disturbanceSummary.mv + this.disturbanceSummary.bg,
      recentTickDeltas: [],
      cpuOverloaded: false,
      decodeLatencyHistory: [],
      droppedFrames: 0,
      futileCount: 0,
      adaptiveThresholds: { softMs: 30, hardMs: 300 },
      confidenceHistory: [],
      sessionQuality: this.sessionQuality,
    });
  }
}
