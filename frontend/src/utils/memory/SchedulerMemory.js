// SchedulerMemory — per-engine memory for scheduler/timing state.

import { createMemorySnapshot } from './MemorySnapshot.js';

export class SchedulerMemory {
  constructor(engineId) {
    this.engineId = engineId;
    this.recentTickDeltas = [];
    this.lateTickCount = 0;
    this.cpuOverloaded = false;
    this.maxTickDeltas = 30;
  }

  pushTickDelta(tickDelta) {
    if (!Number.isFinite(tickDelta)) return;
    this.recentTickDeltas.push(tickDelta);
    if (this.recentTickDeltas.length > this.maxTickDeltas) this.recentTickDeltas.shift();
  }

  recordLateTick() {
    this.lateTickCount++;
  }

  setCpuOverloaded(overloaded) {
    this.cpuOverloaded = Boolean(overloaded);
  }

  reset() {
    this.recentTickDeltas = [];
    this.lateTickCount = 0;
    this.cpuOverloaded = false;
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
      recentTickDeltas: this.recentTickDeltas.slice(),
      cpuOverloaded: this.cpuOverloaded,
      decodeLatencyHistory: [],
      droppedFrames: 0,
      futileCount: 0,
      adaptiveThresholds: { softMs: 30, hardMs: 300 },
      confidenceHistory: [],
      sessionQuality: 1,
    });
  }
}
