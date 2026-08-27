// ConstraintProvider — hard gates for Decision Engine.
// Constraints are not weights. They are boolean checks that restrict allowed actions.

import { DecisionReasonCode } from '../validation/ReasonCodes.js';
import { ActionType } from './ActionRequest.js';

export function getConstraints(derivedMetrics) {
  if (!derivedMetrics) {
    return {
      constraintsViolated: [],
      allowedActions: [ActionType.NOOP, ActionType.HOLD],
      reasonCode: DecisionReasonCode.PIPELINE_NOT_READY,
      reason: 'No derived metrics available',
    };
  }

  const violated = [];
  if (!derivedMetrics.pipelineReady) {
    violated.push({ code: DecisionReasonCode.PIPELINE_NOT_READY, reason: 'Pipeline NOT READY', forbidden: [ActionType.SEEK, ActionType.SET_RATE, ActionType.HOLD] });
  }
  if (!derivedMetrics.schedulerStable && derivedMetrics.schedulerQuality < 0.5) {
    violated.push({ code: DecisionReasonCode.SCHEDULER_OVERLOADED, reason: 'Scheduler overloaded', forbidden: [ActionType.SEEK] });
  }
  if (!derivedMetrics.decoderHealthy && derivedMetrics.decoderQuality < 0.3) {
    violated.push({ code: DecisionReasonCode.DECODER_UNHEALTHY, reason: 'Decoder unhealthy', forbidden: [ActionType.SEEK, ActionType.SET_RATE] });
  }
  if (derivedMetrics.futileCount >= 3) {
    violated.push({ code: DecisionReasonCode.FUTILE_SEEK_PATTERN, reason: 'Futile seek pattern', forbidden: [ActionType.SEEK] });
  }
  if (!derivedMetrics.playbackActive) {
    violated.push({ code: DecisionReasonCode.PLAYBACK_INACTIVE, reason: 'Video not in controllable state', forbidden: [ActionType.HARD_SEEK] });
  }
  if (derivedMetrics.executionBusy) {
    violated.push({ code: DecisionReasonCode.EXECUTION_IN_FLIGHT, reason: 'Action in flight', forbidden: [ActionType.HARD_SEEK] });
  }
  if (derivedMetrics.isRecovering) {
    violated.push({ code: DecisionReasonCode.RECOVERY_GRACE, reason: 'Recovering from seek', forbidden: [ActionType.HARD_SEEK] });
  }

  let allowedActions = [ActionType.NOOP, ActionType.HOLD, ActionType.SEEK, ActionType.SET_RATE, ActionType.PLAY];
  let reasonCode = null;
  let reason = 'All constraints pass';

  for (const v of violated) {
    allowedActions = allowedActions.filter(action => !v.forbidden.includes(action));
    if (!reasonCode) {
      reasonCode = v.code;
      reason = v.reason;
    }
  }

  // NOOP must always be available as a safe fallback
  if (!allowedActions.includes(ActionType.NOOP)) {
    allowedActions = [ActionType.NOOP, ActionType.HOLD];
    if (!reasonCode) {
      reasonCode = DecisionReasonCode.NOOP_SAFETY;
      reason = 'System blocked - safe state: NOOP';
    }
  }

  return {
    constraintsViolated: violated.map(v => v.code),
    allowedActions,
    reasonCode,
    reason,
  };
}
