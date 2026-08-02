// LearningMemory — per-engine memory for adaptive learning state.

import { createMemorySnapshot } from './MemorySnapshot.js';

export class LearningMemory {
  constructor(engineId) {
    this.engineId = engineId;
    this.futileCount = 0;
    this.adaptiveThresholds = { softMs: 30, hardMs: 300 };
    this.confidenceHistory = [];
    this.maxConfidenceHistory = 100;
  }

  recordFutile() {
    this.futileCount++;
  }

  resetFutile() {
    this.futileCount = 0;
  }

  setAdaptiveThresholds(thresholds) {
    this.adaptiveThresholds = {
      softMs: Number(thresholds.softMs || 30),
      hardMs: Number(thresholds.hardMs || 300),
    };
  }

  pushConfidence(confidence) {
    if (!Number.isFinite(confidence)) return;
    this.confidenceHistory.push(confidence);
    if (this.confidenceHistory.length > this.maxConfidenceHistory) this.confidenceHistory.shift();
  }

  reset() {
    this.futileCount = 0;
    this.confidenceHistory = [];
  }

  createSnapshot() {
    return createMemorySnapshot({
      engineId: this.engineId,
      driftEMA: null,
      biasMs: 0,
      cptMs: 0,
      pipelineState: 'UNKNOWN',
      warmupPhase: true,
      disturbanceCount: 0,
      recentTickDeltas: [],
      cpuOverloaded: false,
      decodeLatencyHistory: [],
      droppedFrames: 0,
      futileCount: this.futileCount,
      adaptiveThresholds: this.adaptiveThresholds,
      confidenceHistory: this.confidenceHistory.slice(),
      sessionQuality: 1,
    });
  }
}
