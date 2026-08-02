// SchedulerAnalyzer — per-engine analyzer for scheduler/timing facts.
// Pure function: context -> evidence. No side effects. No action knowledge.

import { AnalyzerReasonCode } from '../validation/ReasonCodes.js';

export function evaluateSchedulerAnalyzer(ctx) {
  const { sensor, memorySnapshot } = ctx;
  const d = sensor?.data || {};
  const tickDelta = Number(d.tickDelta || 0);
  const cpuOverloaded = Boolean(d.cpuOverloaded);
  const recentTickDeltas = Array.isArray(memorySnapshot?.recentTickDeltas) ? memorySnapshot.recentTickDeltas : [];
  const lateTickCount = Number(memorySnapshot?.lateTickCount || 0);

  const evidence = {
    tickDelta,
    cpuOverloaded,
    recentTickDeltasCount: recentTickDeltas.length,
    lateTickCount,
  };

  let quality = 1;
  let confidence = 1;
  let reason = 'scheduler nominal';
  let reasonCode = null;

  if (cpuOverloaded) {
    reasonCode = AnalyzerReasonCode.SCHEDULER_OVERLOADED;
    reason = `scheduler overloaded (tickDelta=${tickDelta.toFixed(0)}ms, lateTicks=${lateTickCount})`;
    confidence = 0.3;
    quality = 0.6;
  } else if (tickDelta > 80) {
    reasonCode = AnalyzerReasonCode.SCHEDULER_UNSTABLE;
    reason = `scheduler unstable (tickDelta=${tickDelta.toFixed(0)}ms)`;
    confidence = 0.5;
    quality = 0.7;
  } else if (recentTickDeltas.length >= 3) {
    const sorted = [...recentTickDeltas].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const variance = recentTickDeltas.reduce((sum, val) => sum + Math.abs(val - median), 0) / recentTickDeltas.length;
    if (variance > 20) {
      reasonCode = AnalyzerReasonCode.SCHEDULER_UNSTABLE;
      reason = `scheduler unstable (variance=${variance.toFixed(1)}ms, median=${median.toFixed(0)}ms)`;
      confidence = 0.5;
      quality = 0.7;
    } else {
      reason = `scheduler stable (tickDelta=${tickDelta.toFixed(0)}ms, variance=${variance.toFixed(1)}ms)`;
      confidence = 0.8;
      quality = 0.9;
    }
  } else {
    reason = `scheduler nominal (tickDelta=${tickDelta.toFixed(0)}ms)`;
    confidence = 0.7;
    quality = 0.85;
  }

  if (tickDelta <= 0 || tickDelta > 5000) {
    quality = 0.2;
    reason += `; invalid tickDelta`;
  }

  return {
    analyzerId: 'SchedulerAnalyzer',
    engineId: sensor?.data?.engineId || 'mv',
    timestamp: sensor?.ts || performance.now(),
    evidence,
    quality,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    reasonCode: reasonCode || undefined,
  };
}
