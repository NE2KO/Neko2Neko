import {
  POST_SEEK_TRANSITION_MS,
  POST_SEEK_SPIKE_THRESHOLD_MS,
  GENUINE_SPIKE_SAMPLES,
} from './TriangleCalculator.js';

export class TransientSpikeDetector {
  constructor(engineName = 'mv') {
    this.engineName = engineName;
    this.windowSize = 10;
    this.history = [];
    this.spikeCount = 0;
    this.consecutiveNormalCount = 0;
    this.lastSeekTime = 0;
    this.stableSampleCount = 0;
    this.postSeekThreshold = POST_SEEK_SPIKE_THRESHOLD_MS;
    this.spikeSamplesRequired = GENUINE_SPIKE_SAMPLES;
  }

  setSeekTime(timestamp = Date.now()) {
    this.lastSeekTime = timestamp;
    this.history = [];
    this.spikeCount = 0;
    this.consecutiveNormalCount = 0;
    this.stableSampleCount = 0;
  }

  isPostSeekTransition(now = Date.now()) {
    const elapsed = now - this.lastSeekTime;
    return elapsed < POST_SEEK_TRANSITION_MS;
  }

  push(driftMs, time = Date.now()) {
    this.history.push({ t: time, drift: driftMs });
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }
    this.consecutiveNormalCount = 0;
  }

  analyze(driftMs, timestamp, engineState = {}) {
    const now = timestamp || Date.now();
    const isPostSeek = this.isPostSeekTransition(now);

    const absDrift = Math.abs(driftMs);
    let classification = 'NORMAL';
    let confidence = 1.0;
    let reason = 'within_threshold';

    if (isPostSeek) {
      if (absDrift <= this.postSeekThreshold) {
        classification = 'TRANSITIONAL';
        confidence = 0.3;
        reason = 'post_seek_transitional';
      } else {
        classification = 'TRANSITIONAL_SPIKE';
        confidence = 0.6;
        reason = 'potential_transitional_spike';
      }
      return {
        isSpike: false,
        classification,
        confidence,
        reason,
        isPostSeek: true,
        elapsedSinceSeek: now - this.lastSeekTime,
        estimatedDrift: 0,
      };
    }

    const recent = this.history.slice(-5);
    if (recent.length < 3) {
      return {
        isSpike: false,
        classification,
        confidence: 0.5,
        reason: 'insufficient_history',
        isPostSeek: false,
      };
    }

    const avgRecent = recent.reduce((a, b) => a + b.drift, 0) / recent.length;
    const stdDev = Math.sqrt(recent.reduce((a, b) => a + (b.drift - avgRecent) ** 2, 0) / recent.length);

    const isOvershoot = Math.abs(driftMs - avgRecent) > 3 * (stdDev + 1);
    const isHighSpike = absDrift > 10;
    const isSparseRegion = Math.abs(avgRecent) < 6;

    if (isOvershoot && isSparseRegion && isHighSpike && stdDev < 10) {
      this.spikeCount++;
      this.stableSampleCount = 0;
      classification = 'SPIKE';
      confidence = Math.min(1, this.spikeCount / this.spikeSamplesRequired);
      reason = 'transient_spike_detected';
    } else if (absDrift <= 6) {
      this.consecutiveNormalCount++;
      this.stableSampleCount++;
      if (this.spikeCount > 0) this.spikeCount = Math.max(0, this.spikeCount - 0.1);
      classification = 'NORMAL';
      confidence = 1 - (this.spikeCount * 0.1);
      reason = 'stable';
    } else {
      classification = 'SUSPECT';
      confidence = 0.5;
      reason = 'out_of_normal_range';
    }

    const isGenuineSpike = this.spikeCount >= this.spikeSamplesRequired;

    return {
      isSpike: isGenuineSpike,
      classification,
      confidence: Math.max(0.1, confidence),
      reason,
      isPostSeek: false,
      elapsedSinceSeek: 0,
      spikeCount: this.spikeCount,
      stableSamples: this.stableSampleCount,
    };
  }

  reset() {
    this.history = [];
    this.spikeCount = 0;
    this.consecutiveNormalCount = 0;
    this.stableSampleCount = 0;
    this.lastSeekTime = 0;
  }

  getStats() {
    if (this.history.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };
    const drifts = this.history.map(h => Math.abs(h.drift));
    return {
      avg: drifts.reduce((a, b) => a + b, 0) / drifts.length,
      min: Math.min(...drifts),
      max: Math.max(...drifts),
      count: drifts.length,
      spikeCount: this.spikeCount,
    };
  }
}

export function createSpikeDetectors() {
  return {
    mv: new TransientSpikeDetector('mv'),
    bg: new TransientSpikeDetector('bg'),
  };
}

export function analyzeDriftSpikes(currentDrift, spikeDetector, options = {}) {
  const result = spikeDetector.analyze(currentDrift, options.timestamp, options.engineState);

  return {
    isSpike: result.isSpike && !result.isPostSeek,
    isTransitional: result.classification === 'TRANSITIONAL' || result.classification === 'TRANSITIONAL_SPIKE',
    classification: result.classification,
    confidence: result.confidence,
    reason: result.reason,
    estimatedDrift: result.classification === 'TRANSITIONAL' ? 0 : currentDrift,
    elapsedSinceSeek: result.elapsedSinceSeek,
    spikeCount: result.spikeCount,
    stableSamples: result.stableSamples,
  };
}