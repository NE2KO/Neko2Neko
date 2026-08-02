// DecoderMemory — per-engine memory for decoder/presentation state.

import { createMemorySnapshot } from './MemorySnapshot.js';

export class DecoderMemory {
  constructor(engineId) {
    this.engineId = engineId;
    this.decodeLatencyHistory = [];
    this.droppedFrames = 0;
    this.rvfcStatusHistory = [];
    this.maxHistory = 100;
  }

  pushDecodeLatency(latencyMs) {
    if (!Number.isFinite(latencyMs)) return;
    this.decodeLatencyHistory.push(latencyMs);
    if (this.decodeLatencyHistory.length > this.maxHistory) this.decodeLatencyHistory.shift();
  }

  recordDroppedFrames(count) {
    this.droppedFrames += Number(count || 0);
  }

  setRvfcStatus(status) {
    this.rvfcStatusHistory.push({ status: String(status), t: performance.now() });
    if (this.rvfcStatusHistory.length > this.maxHistory) this.rvfcStatusHistory.shift();
  }

  reset() {
    this.decodeLatencyHistory = [];
    this.droppedFrames = 0;
    this.rvfcStatusHistory = [];
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
      decodeLatencyHistory: this.decodeLatencyHistory.slice(),
      droppedFrames: this.droppedFrames,
      futileCount: 0,
      adaptiveThresholds: { softMs: 30, hardMs: 300 },
      confidenceHistory: [],
      sessionQuality: 1,
    });
  }
}
