// DriftAnalyzer — per-engine analyzer for drift facts.
// Pure function: context -> evidence. No side effects. No action knowledge.

import { AnalyzerReasonCode } from '../validation/ReasonCodes.js';

export function evaluateDriftAnalyzer(ctx) {
  const { sensor, memorySnapshot } = ctx;
  const d = sensor?.data || {};
  const driftMs = Number(d.driftMs || 0);
  const absDrift = Math.abs(driftMs);
  const biasMs = Number(memorySnapshot?.biasMs || 0);
  const driftEMA = memorySnapshot?.driftEMA || { value: 0, sigma: 0, count: 0 };
  const sigmaMs = Math.sqrt(Number(driftEMA.sigma || 0));
  const adaptiveThresholds = memorySnapshot?.adaptiveThresholds || { softMs: 30, hardMs: 300 };
  const softThresholdMs = adaptiveThresholds.softMs;
  const hardThresholdMs = adaptiveThresholds.hardMs;

  const evidence = {
    driftMs,
    absDrift,
    biasMs,
    correctedDriftMs: driftMs - biasMs,
    sigmaMs,
    sampleCount: driftEMA.count,
  };

  let quality = 1;
  let confidence = 1;
  let reason = 'drift nominal';
  let reasonCode = null;

  if (absDrift > hardThresholdMs) {
    reasonCode = AnalyzerReasonCode.DRIFT_EXCEEDS_HARD_THRESHOLD;
    reason = `drift exceeds hard threshold (${absDrift.toFixed(1)}ms > ${hardThresholdMs}ms)`;
    confidence = Math.max(0.7, 1 - sigmaMs / (absDrift || 1));
    quality = sensor?.validationResult?.measurementConfidence ?? 1;
  } else if (absDrift > softThresholdMs) {
    reasonCode = AnalyzerReasonCode.DRIFT_EXCEEDS_SOFT_THRESHOLD;
    reason = `drift exceeds soft threshold (${absDrift.toFixed(1)}ms > ${softThresholdMs}ms)`;
    confidence = Math.max(0.5, 1 - sigmaMs / (absDrift || 1));
    quality = sensor?.validationResult?.measurementConfidence ?? 1;
  } else {
    reason = `drift within soft threshold (${absDrift.toFixed(1)}ms <= ${softThresholdMs}ms)`;
    confidence = Math.max(0.3, 1 - sigmaMs / (softThresholdMs || 1));
    quality = sensor?.validationResult?.measurementConfidence ?? 1;
  }

  if (sigmaMs > softThresholdMs) {
    reasonCode = AnalyzerReasonCode.SIGMA_TOO_HIGH;
    reason += `; sigma high (${sigmaMs.toFixed(1)}ms)`;
    confidence *= 0.7;
  }

  if (driftEMA.count < 20) {
    confidence *= 0.6;
    reason += `; insufficient samples (${driftEMA.count})`;
  }

  return {
    analyzerId: 'DriftAnalyzer',
    engineId: sensor?.data?.engineId || 'mv',
    timestamp: sensor?.ts || performance.now(),
    evidence,
    quality,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    reasonCode: reasonCode || undefined,
  };
}
