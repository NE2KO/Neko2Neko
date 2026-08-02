// DecoderAnalyzer — per-engine analyzer for decoder/presentation facts.
// Pure function: context -> evidence. No side effects. No action knowledge.

import { AnalyzerReasonCode } from '../validation/ReasonCodes.js';

export function evaluateDecoderAnalyzer(ctx) {
  const { sensor, memorySnapshot } = ctx;
  const d = sensor?.data || {};
  const decodeLatencyMs = Number(d.decodeLatencyMs || 0);
  const droppedFrames = Number(d.droppedFrames || 0);
  const rvfcStatus = String(d.rvfcStatus || 'UNKNOWN');
  const decodeLatencyHistory = Array.isArray(memorySnapshot?.decodeLatencyHistory) ? memorySnapshot.decodeLatencyHistory : [];
  const droppedFramesMemory = Number(memorySnapshot?.droppedFrames || 0);

  const evidence = {
    decodeLatencyMs,
    droppedFrames,
    rvfcStatus,
    decodeLatencyHistoryCount: decodeLatencyHistory.length,
    totalDroppedFrames: droppedFramesMemory,
  };

  let quality = 1;
  let confidence = 1;
  let reason = 'decoder nominal';
  let reasonCode = null;

  if (rvfcStatus === 'UNSUPPORTED' || rvfcStatus === 'UNKNOWN') {
    reasonCode = AnalyzerReasonCode.RVFC_STATUS_DEGRADED;
    reason = `RVFC ${rvfcStatus.toLowerCase()}`;
    confidence = 0.3;
    quality = 0.4;
  } else if (decodeLatencyMs > 50) {
    reasonCode = AnalyzerReasonCode.DECODE_LATENCY_HIGH;
    reason = `decode latency high (${decodeLatencyMs.toFixed(1)}ms)`;
    confidence = 0.5;
    quality = 0.6;
  } else if (droppedFrames > 0 || droppedFramesMemory > 0) {
    reasonCode = AnalyzerReasonCode.DROPPED_FRAMES;
    reason = `dropped frames detected (tick=${droppedFrames}, total=${droppedFramesMemory})`;
    confidence = 0.5;
    quality = 0.5;
  } else if (rvfcStatus === 'ACTIVE') {
    reason = `decoder healthy (latency=${decodeLatencyMs.toFixed(1)}ms, rvfc=${rvfcStatus})`;
    confidence = 0.9;
    quality = 0.95;
  } else if (rvfcStatus === 'DEGRADED' || rvfcStatus === 'TIMEOUT') {
    reasonCode = AnalyzerReasonCode.RVFC_STATUS_DEGRADED;
    reason = `RVFC ${rvfcStatus.toLowerCase()}`;
    confidence = 0.4;
    quality = 0.5;
  } else {
    reason = `decoder state unclear (rvfc=${rvfcStatus})`;
    confidence = 0.4;
    quality = 0.5;
  }

  if (decodeLatencyHistory.length > 0) {
    const avgLatency = decodeLatencyHistory.reduce((a, b) => a + b, 0) / decodeLatencyHistory.length;
    if (avgLatency > 30) {
      confidence *= 0.8;
      reason += `; avg latency ${avgLatency.toFixed(1)}ms`;
    }
  }

  return {
    analyzerId: 'DecoderAnalyzer',
    engineId: sensor?.data?.engineId || 'mv',
    timestamp: sensor?.ts || performance.now(),
    evidence,
    quality,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    reasonCode: reasonCode || undefined,
  };
}
