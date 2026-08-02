// DecisionEngine — applies constraint-based policy rules over DerivedMetrics + AnalyzerEvidence.
// Produces ActionRequest. Never calls media APIs directly.

import { createActionRequest, ActionType, ActionPriority } from './ActionRequest.js';
import { getConstraints } from './ConstraintProvider.js';
import { DecisionReasonCode } from '../validation/ReasonCodes.js';

export function decide({
  evidenceList = [],
  derivedMetrics,
  constraints,
  engineId,
  validatedSensor = null,
  driftHistory = [],
  mvFramePeriodMs = 33,
  bgFramePeriodMs = 33,
}) {
  if (!derivedMetrics) {
    return {
      actionRequest: createActionRequest({ type: ActionType.NOOP, priority: ActionPriority.NOOP }),
      reason: 'No derived metrics available',
      reasonCode: DecisionReasonCode.DRIFT_BELOW_THRESHOLD,
      decisionConfidence: 0,
      derivedMetrics,
      evidence: evidenceList,
      constraintsViolated: constraints?.constraintsViolated || [],
      memoryUsed: {},
    };
  }

  const { allowedActions, constraintsViolated, reasonCode, reason } = constraints || getConstraints(derivedMetrics);

  if (!allowedActions.includes(ActionType.SEEK) && !allowedActions.includes(ActionType.SET_RATE)) {
    return {
      actionRequest: createActionRequest({ type: ActionType.HOLD, priority: ActionPriority.HOLD, params: { holdMs: 0 } }),
      reason: reason || 'Constraints forbid correction',
      reasonCode: reasonCode || DecisionReasonCode.PIPELINE_NOT_READY,
      decisionConfidence: 0.95,
      derivedMetrics,
      evidence: evidenceList,
      constraintsViolated,
      memoryUsed: {},
    };
  }

  const driftMagnitude = derivedMetrics.driftMagnitude || 0;
  const driftConfidence = derivedMetrics.driftConfidence || 0;
  const sampleCount = derivedMetrics.sampleCount || 0;
  const softThresholdMs = derivedMetrics.adaptiveThresholds?.softMs ?? 30;
  const hardThresholdMs = derivedMetrics.adaptiveThresholds?.hardMs ?? 300;
  // Hard seek is a coarse, frame-jumping operation (snaps to the nearest
  // keyframe) and is destructive on sparse-keyframe videos — it causes frame
  // repetition / strobe loops when issued for sub-second drift. Gate it behind
  // a large floor so normal playback drift is corrected by SET_RATE (invisible
  // on muted video) and hard seeks only fire for genuine gross repositioning.
  const hardSeekFloorMs = 1500;
  const hardSeekTriggerMs = Math.max(hardThresholdMs, hardSeekFloorMs);
  const consistencyScore = derivedMetrics.consistencyScore ?? 1;
  const outlierNode = derivedMetrics.outlierNode || null;

  // ── Pairwise frame-period gate (Phase D) ──────────────────────────────
  // Tolerances are one frame period per engine (24/30/60fps → 41.7/33.3/16.7ms).
  // When |mvBgMs| exceeds the tightest frame period, MV and BG have drifted
  // apart from each other; only the engine farther from audio is corrected,
  // one engine per tick.
  const triangle = derivedMetrics.triangleDrifts || null;
  const mvTol = Number.isFinite(mvFramePeriodMs) && mvFramePeriodMs > 0 ? mvFramePeriodMs : 33;
  const bgTol = Number.isFinite(bgFramePeriodMs) && bgFramePeriodMs > 0 ? bgFramePeriodMs : 33;
  const pairTol = Math.min(mvTol, bgTol);
  let pairViolated = false;
  let fartherEngine = null;
  let pairDeltaMs = 0;
  if (triangle && triangle.hasTriangle) {
    pairDeltaMs = triangle.mvBgMs;
    pairViolated = Math.abs(pairDeltaMs) > pairTol;
    if (pairViolated) {
      fartherEngine = Math.abs(triangle.audioMvMs) >= Math.abs(triangle.audioBgMs) ? 'mv' : 'bg';
    }
  }

  // Triangle consistency gate: if triangle is inconsistent, only correct the outlier node.
  // Non-outlier engines should hold even if their local drift looks actionable.
  const isOutlier = outlierNode === engineId;
  const triangleInconsistent = consistencyScore < 0.5 && outlierNode != null;
  const effectiveDrift = triangleInconsistent && !isOutlier ? 0 : driftMagnitude;

  if (effectiveDrift > hardSeekTriggerMs && (driftConfidence > 0.7 || (triangleInconsistent && isOutlier)) && allowedActions.includes(ActionType.SEEK)) {
    const actualReason = triangleInconsistent
      ? `Hard seek justified by outlier drift (${driftMagnitude.toFixed(1)}ms) on ${engineId || 'unknown'}`
      : 'Drift exceeds hard threshold';
    const actualReasonCode = triangleInconsistent && isOutlier
      ? DecisionReasonCode.TRIANGLE_OUTLIER_CORRECTION
      : DecisionReasonCode.ALL_CONSTRAINTS_PASS_SEEK;
    return {
      actionRequest: createActionRequest({ type: ActionType.HARD_SEEK, priority: ActionPriority.HARD_SEEK, params: { magnitude: 'hard' } }),
      reason: actualReason,
      reasonCode: actualReasonCode,
      decisionConfidence: driftConfidence,
      derivedMetrics,
      evidence: evidenceList,
      constraintsViolated,
      memoryUsed: {},
    };
  }

  // Pairwise MV↔BG rule: correct the engine farther from audio (one per tick).
  if (pairViolated && engineId === fartherEngine) {
    const pairReason =
      `Pairwise MV↔BG off ${Math.abs(pairDeltaMs).toFixed(1)}ms (tol ${pairTol.toFixed(1)}ms); ${fartherEngine} farther from audio`;
    const pairConfidence = Math.max(driftConfidence, Math.min(1, Math.abs(pairDeltaMs) / (pairTol * 3)));
    const magnitude = Math.abs(pairDeltaMs);
    if (magnitude > Math.max(hardSeekTriggerMs, pairTol * 2.5) && allowedActions.includes(ActionType.SEEK)) {
      return {
        actionRequest: createActionRequest({ type: ActionType.HARD_SEEK, priority: ActionPriority.HARD_SEEK, params: { magnitude: 'hard' } }),
        reason: pairReason,
        reasonCode: DecisionReasonCode.TRIANGLE_OUTLIER_CORRECTION,
        decisionConfidence: pairConfidence,
        derivedMetrics,
        evidence: evidenceList,
        constraintsViolated,
        memoryUsed: {},
      };
    }
    // Sub-floor pairwise gaps are corrected by rate (invisible on muted video)
    // instead of soft seeks, which land on the same keyframe and repeat frames.
    if (allowedActions.includes(ActionType.SET_RATE)) {
      return {
        actionRequest: createActionRequest({ type: ActionType.SET_RATE, priority: ActionPriority.SET_RATE }),
        reason: pairReason,
        reasonCode: DecisionReasonCode.PAIRWISE_OFFSET,
        decisionConfidence: pairConfidence * 0.8,
        derivedMetrics,
        evidence: evidenceList,
        constraintsViolated,
        memoryUsed: {},
      };
    }
  }

  // Rate catch-up is preferred when drift exceeds the soft threshold. No soft
  // seek is ever issued from steady-state decisions: on sparse-keyframe videos a
  // sub-second seek lands on the same keyframe and visibly repeats frames. The
  // video keeps playing and ramps its playback rate to close the gap instead of
  // seeking (muted video → no audio side effects).
  if (effectiveDrift > softThresholdMs && driftConfidence > 0.5 && allowedActions.includes(ActionType.SET_RATE)) {
    const actualReason = triangleInconsistent
      ? `Rate adjustment on outlier ${engineId || 'unknown'} (${driftMagnitude.toFixed(1)}ms)`
      : 'Drift within soft threshold, rate adjustment preferred';
    return {
      actionRequest: createActionRequest({ type: ActionType.SET_RATE, priority: ActionPriority.SET_RATE }),
      reason: actualReason,
      reasonCode: DecisionReasonCode.ALL_CONSTRAINTS_PASS_HOLD,
      decisionConfidence: driftConfidence * 0.8,
      derivedMetrics,
      evidence: evidenceList,
      constraintsViolated,
      memoryUsed: {},
    };
  }

  // Adaptive hold (Phase C): when data quality is doubtful (few samples, low
  // confidence, invalid sensor, or thin drift history) extend the hold window
  // so the engine keeps observing instead of churning corrections. With solid
  // data the hold is instant (re-evaluate every tick).
  const sensorValid = !(validatedSensor?.validationResult && validatedSensor.validationResult.valid === false);
  const sensorConf = validatedSensor?.validationResult?.measurementConfidence ?? 1;
  const historyStable = Array.isArray(driftHistory) && driftHistory.length >= 5;
  const dataQuality = Math.min(1, sampleCount / 40) * Math.max(0.05, driftConfidence) * sensorConf;
  const doubtful = sampleCount < 20 || driftConfidence < 0.5 || !sensorValid || !historyStable;
  const holdMs = doubtful ? 250 : dataQuality < 0.6 ? 120 : 0;
  const holdReasonCode = doubtful
    ? DecisionReasonCode.HOLD_TO_OBSERVE
    : DecisionReasonCode.DRIFT_BELOW_THRESHOLD;

  const holdReason = triangleInconsistent
    ? `Triangle inconsistent; holding ${isOutlier ? 'outlier' : 'non-outlier'} ${engineId || 'unknown'} (outlier: ${outlierNode})`
    : doubtful
      ? `Holding to observe (low data quality: samples=${sampleCount}, conf=${(driftConfidence * 100).toFixed(0)}%, sensor=${sensorValid ? 'ok' : 'bad'})`
      : 'Drift below actionable threshold';

  return {
    actionRequest: createActionRequest({ type: ActionType.HOLD, priority: ActionPriority.HOLD, params: { holdMs } }),
    reason: holdReason,
    reasonCode: holdReasonCode,
    decisionConfidence: 1 - driftConfidence,
    derivedMetrics,
    evidence: evidenceList,
    constraintsViolated,
    memoryUsed: {},
  };
}
