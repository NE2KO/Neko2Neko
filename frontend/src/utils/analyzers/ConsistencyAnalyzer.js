// ConsistencyAnalyzer — cross-engine analyzer for triangle relationship health.
// Pure function: context -> evidence. No side effects. No action knowledge.

import { AnalyzerReasonCode } from '../validation/ReasonCodes.js';

export function evaluateConsistencyAnalyzer(ctx) {
  const { sensor, memorySnapshot } = ctx;
  const d = sensor?.data || {};

  const audioMvMs = Number(d.audioMvMs || 0);
  const audioBgMs = Number(d.audioBgMs ?? d.audioBgMs);
  const mvBgMs = Number(d.mvBgMs ?? d.mvBgMs);

  const hasTriangle = Number.isFinite(audioMvMs) && Number.isFinite(audioBgMs) && Number.isFinite(mvBgMs);

  const evidence = {
    audioMvMs,
    audioBgMs,
    mvBgMs,
    hasTriangle,
  };

  let quality = 1;
  let confidence = 1;
  let reason = 'triangle nominal';
  let reasonCode = null;

  if (!hasTriangle) {
    reason = 'incomplete triangle (missing BG or MV time)';
    confidence = 0.3;
    quality = 0.5;
    reasonCode = AnalyzerReasonCode.INCOMPLETE_TRIANGLE;
    return {
      analyzerId: 'ConsistencyAnalyzer',
      engineId: sensor?.data?.engineId || 'system',
      timestamp: sensor?.ts || performance.now(),
      evidence,
      quality,
      confidence: Math.max(0, Math.min(1, confidence)),
      reason,
      reasonCode: reasonCode || undefined,
    };
  }

  const absAudioMv = Math.abs(audioMvMs);
  const absAudioBg = Math.abs(audioBgMs);
  const absMvBg = Math.abs(mvBgMs);

  // Consistency: three relationships should be mutually consistent.
  // Audio↔MV + Audio↔BG ≈ MV↔BG (within tolerance).
  const expectedMvBg = audioBgMs - audioMvMs;
  const consistencyError = Math.abs(mvBgMs - expectedMvBg);
  const consistencyTolerance = 40; // ms

  if (consistencyError > consistencyTolerance) {
    reasonCode = AnalyzerReasonCode.TRIANGLE_INCONSISTENT;
    reason = `triangle inconsistent (expected MV↔BG ${expectedMvBg.toFixed(1)}ms, got ${mvBgMs.toFixed(1)}ms, error ${consistencyError.toFixed(1)}ms)`;
    confidence = Math.max(0.2, 1 - consistencyError / 200);
    quality = 0.3;
  } else if (absAudioMv > 100 || absAudioBg > 100 || absMvBg > 100) {
    reasonCode = AnalyzerReasonCode.TRIANGLE_HIGH_DRIFT;
    reason = `triangle high drift (Audio↔MV ${absAudioMv}ms, Audio↔BG ${absAudioBg}ms, MV↔BG ${absMvBg}ms)`;
    confidence = Math.max(0.4, 1 - Math.max(absAudioMv, absAudioBg, absMvBg) / 500);
    quality = 0.6;
  } else {
    reason = `triangle consistent (Audio↔MV ${audioMvMs}ms, Audio↔BG ${audioBgMs}ms, MV↔BG ${mvBgMs}ms)`;
    confidence = Math.max(0.7, 1 - Math.max(absAudioMv, absAudioBg, absMvBg) / 200);
    quality = 0.9;
  }

  // Identify outlier node
  const absDrifts = [
    { node: 'mv', drift: absAudioMv, raw: audioMvMs },
    { node: 'bg', drift: absAudioBg, raw: audioBgMs },
  ];
  absDrifts.sort((a, b) => b.drift - a.drift);
  const outlier = absDrifts[0].drift > consistencyTolerance ? absDrifts[0].node : null;

  return {
    analyzerId: 'ConsistencyAnalyzer',
    engineId: sensor?.data?.engineId || 'system',
    timestamp: sensor?.ts || performance.now(),
    evidence: {
      ...evidence,
      consistencyError,
      consistencyTolerance,
      outlier,
      maxDrift: absDrifts[0].drift,
      maxDriftNode: absDrifts[0].node,
      sortedDrifts: absDrifts,
    },
    quality,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    reasonCode: reasonCode || undefined,
  };
}
