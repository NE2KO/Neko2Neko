// DriftMemory — per-engine memory for drift-related state.
// Owns driftEMA, bias, sigma, drift history.

import { createMemorySnapshot } from './MemorySnapshot.js';

export class DriftMemory {
  constructor(engineId) {
    this.engineId = engineId;
    this.driftEMA = { value: 0, sigma: 0, count: 0 };
    this.biasMs = 0;
    this.sigmaMs = 0;
    this.driftHistory = [];
    this.maxHistory = 100;
  }

  pushDrift(driftMs) {
    if (!Number.isFinite(driftMs)) return;
    // EMA feeding the decision engine's driftMagnitude. alpha=0.02 took ~50
    // samples (~1.5s at 33Hz) to converge, so the judge reacted late to drift
    // growth — rate corrections lagged several ms behind the actual drift.
    // alpha=0.15 tracks in ~7 samples (~200ms) so the judge sees drift sooner.
    const alpha = 0.15;
    if (this.driftEMA.count === 0) {
      this.driftEMA.value = driftMs;
      this.driftEMA.sigma = 0;
    } else {
      const delta = driftMs - this.driftEMA.value;
      this.driftEMA.value += alpha * delta;
      this.driftEMA.sigma = (1 - alpha) * (this.driftEMA.sigma + alpha * delta * delta);
    }
    this.driftEMA.count++;
    this.sigmaMs = Math.sqrt(this.driftEMA.sigma);
    this.driftHistory.push(driftMs);
    if (this.driftHistory.length > this.maxHistory) this.driftHistory.shift();
  }

  setBiasMs(biasMs) {
    this.biasMs = Number(biasMs || 0);
  }

  reset() {
    this.driftEMA = { value: 0, sigma: 0, count: 0 };
    this.biasMs = 0;
    this.sigmaMs = 0;
    this.driftHistory = [];
  }

  createSnapshot() {
    return createMemorySnapshot({
      engineId: this.engineId,
      driftEMA: this.driftEMA,
      biasMs: this.biasMs,
      cptMs: 0,
      pipelineState: 'UNKNOWN',
      warmupPhase: true,
      disturbanceCount: 0,
      recentTickDeltas: [],
      cpuOverloaded: false,
      decodeLatencyHistory: [],
      droppedFrames: 0,
      futileCount: 0,
      adaptiveThresholds: { softMs: 30, hardMs: 300 },
      confidenceHistory: [],
      sessionQuality: 1,
    });
  }
}
