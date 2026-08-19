// ConsistencyAnalyzer — cross-engine analyzer for triangle relationship health.
// Pure function: context -> evidence. No side effects. No action knowledge.

import { AnalyzerReasonCode } from '../validation/ReasonCodes.js';
import { DEFAULT_TRIANGLE_TOLERANCE_MS, computeTriangleErrorMs } from '../TriangleCalculator.js';

const TRIANGLE_TOLERANCE_MS = DEFAULT_TRIANGLE_TOLERANCE_MS;

export function evaluateConsistencyAnalyzer(ctx) {
  const { sensor, memorySnapshot } = ctx;
  const d = sensor?.data || {};

  const audioMvMs = d.audioMvMs !== null && Number.isFinite(Number(d.audioMvMs)) ? Number(d.audioMvMs) : null;
  const audioBgMs = d.audioBgMs !== null && Number.isFinite(Number(d.audioBgMs)) ? Number(d.audioBgMs) : null;
  const mvBgMs = d.mvBgMs !== null && Number.isFinite(Number(d.mvBgMs)) ? Number(d.mvBgMs) : null;

  const hasTriangle = audioMvMs !== null && audioBgMs !== null && mvBgMs !== null;

  const evidence = {
    audioMvMs,
    audioBgMs,
    mvBgMs,
    hasTriangle,
    triangleValid: hasTriangle,
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

  const triangleErrorMs = computeTriangleErrorMs(audioMvMs, audioBgMs, mvBgMs);
  const triangleConsistent = triangleErrorMs !== null && triangleErrorMs <= TRIANGLE_TOLERANCE_MS;

  const absAudioMv = Math.abs(audioMvMs);
  const absAudioBg = Math.abs(audioBgMs);
  const absMvBg = Math.abs(mvBgMs);

  if (!triangleConsistent) {
    reasonCode = AnalyzerReasonCode.TRIANGLE_INCONSISTENT;
    reason = `triangle inconsistent (error ${triangleErrorMs?.toFixed(1)}ms > tolerance ${TRIANGLE_TOLERANCE_MS}ms)`;
    confidence = Math.max(0.2, 1 - triangleErrorMs / 200);
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

  const absDrifts = [
    { node: 'mv', drift: absAudioMv, raw: audioMvMs },
    { node: 'bg', drift: absAudioBg, raw: audioBgMs },
  ];
  absDrifts.sort((a, b) => b.drift - a.drift);
  const outlier = absDrifts[0].drift > 50 ? absDrifts[0].node : null;

  return {
    analyzerId: 'ConsistencyAnalyzer',
    engineId: sensor?.data?.engineId || 'system',
    timestamp: sensor?.ts || performance.now(),
    evidence: {
      ...evidence,
      triangleErrorMs,
      triangleConsistent,
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
