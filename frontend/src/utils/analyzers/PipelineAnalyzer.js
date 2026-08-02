// PipelineAnalyzer — per-engine analyzer for pipeline/CPT/disturbance facts.
// Pure function: context -> evidence. No side effects. No action knowledge.

import { AnalyzerReasonCode } from '../validation/ReasonCodes.js';

export function evaluatePipelineAnalyzer(ctx) {
  const { sensor, memorySnapshot } = ctx;
  const d = sensor?.data || {};
  const readyState = Number(d.readyState || 0);
  const networkState = Number(d.networkState || 0);
  const waiting = Boolean(d.waiting);
  const stalled = Boolean(d.stalled);
  const seeking = Boolean(d.seeking);
  const warmupPhase = Boolean(memorySnapshot?.warmupPhase);
  const pipelineState = String(memorySnapshot?.pipelineState || 'UNKNOWN');
  const disturbanceCount = Number(memorySnapshot?.disturbanceCount || 0);
  const cptMs = Number(memorySnapshot?.cptMs || 0);

  const evidence = {
    readyState,
    networkState,
    waiting,
    stalled,
    seeking,
    warmupPhase,
    pipelineState,
    disturbanceCount,
    cptMs,
  };

  let quality = 1;
  let confidence = 1;
  let reason = 'pipeline nominal';
  let reasonCode = null;

  if (pipelineState === 'WARMING' || warmupPhase) {
    reasonCode = AnalyzerReasonCode.PIPELINE_WARMING;
    reason = `pipeline warming (disturbances=${disturbanceCount}, cptMs=${cptMs.toFixed(0)})`;
    confidence = 0.4;
    quality = 0.7;
  } else if (waiting || stalled) {
    reasonCode = AnalyzerReasonCode.WAITING_EVENT_ACTIVE;
    reason = `waiting/stalled active (readyState=${readyState}, networkState=${networkState})`;
    confidence = 0.3;
    quality = 0.5;
  } else if (pipelineState === 'DISTURBED') {
    reasonCode = AnalyzerReasonCode.WAITING_EVENT_ACTIVE;
    reason = `pipeline disturbed (disturbances=${disturbanceCount})`;
    confidence = 0.5;
    quality = 0.6;
  } else if (pipelineState === 'READY' && readyState >= 3) {
    reason = `pipeline ready (readyState=${readyState}, networkState=${networkState})`;
    confidence = 0.9;
    quality = 0.95;
  } else {
    reason = `pipeline state unclear (readyState=${readyState}, state=${pipelineState})`;
    confidence = 0.4;
    quality = 0.5;
  }

  if (disturbanceCount > 5) {
    confidence *= 0.7;
    reason += `; high disturbance count (${disturbanceCount})`;
  }

  return {
    analyzerId: 'PipelineAnalyzer',
    engineId: sensor?.data?.engineId || 'mv',
    timestamp: sensor?.ts || performance.now(),
    evidence,
    quality,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    reasonCode: reasonCode || undefined,
  };
}
