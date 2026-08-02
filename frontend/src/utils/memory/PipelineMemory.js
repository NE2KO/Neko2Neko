// PipelineMemory — per-engine memory for pipeline/CPT/disturbance state.

import { createMemorySnapshot } from './MemorySnapshot.js';

export class PipelineMemory {
  constructor(engineId) {
    this.engineId = engineId;
    this.cptMs = 0;
    this.disturbanceCount = 0;
    this.warmupPhase = true;
    this.pipelineState = 'UNKNOWN';
    this.stateTransitions = [];
    this.maxTransitions = 50;
  }

  setCptMs(cptMs) {
    this.cptMs = Number(cptMs || 0);
  }

  recordDisturbance() {
    this.disturbanceCount++;
    this.pipelineState = 'DISTURBED';
    this.stateTransitions.push({ state: 'DISTURBED', t: performance.now() });
    if (this.stateTransitions.length > this.maxTransitions) this.stateTransitions.shift();
  }

  setReady() {
    this.pipelineState = 'READY';
    this.stateTransitions.push({ state: 'READY', t: performance.now() });
    if (this.stateTransitions.length > this.maxTransitions) this.stateTransitions.shift();
  }

  setWarming() {
    this.pipelineState = 'WARMING';
    this.warmupPhase = true;
    this.stateTransitions.push({ state: 'WARMING', t: performance.now() });
    if (this.stateTransitions.length > this.maxTransitions) this.stateTransitions.shift();
  }

  setStable() {
    this.warmupPhase = false;
    if (this.pipelineState === 'UNKNOWN' || this.pipelineState === 'WARMING' || this.pipelineState === 'DISTURBED') {
      this.pipelineState = 'READY';
    }
  }

  reset() {
    this.cptMs = 0;
    this.disturbanceCount = 0;
    this.warmupPhase = true;
    this.pipelineState = 'UNKNOWN';
    this.stateTransitions = [];
  }

  createSnapshot() {
    return createMemorySnapshot({
      engineId: this.engineId,
      driftEMA: null,
      biasMs: 0,
      cptMs: this.cptMs,
      pipelineState: this.pipelineState,
      warmupPhase: this.warmupPhase,
      disturbanceCount: this.disturbanceCount,
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
