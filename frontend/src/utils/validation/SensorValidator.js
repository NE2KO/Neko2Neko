// SensorValidator — validates raw sensor data before analyzers process it.
// Stateless. Never mutates Memory. Produces measurementConfidence + reason codes.

import { ValidationReasonCode } from '../validation/ReasonCodes.js';

const RVFC_UNSUPPORTED_THRESHOLD_MS = 30000;
const PERFORMANCE_EMPTY_THRESHOLD_MS = 10000;
const TICK_DELTA_MAX_MS = 5000;
const DRIFT_MAX_MS = 5000;

export function validateSensorSnapshot(snapshot) {
  if (!snapshot || !snapshot.data) {
    return {
      valid: false,
      measurementConfidence: 0,
      reasonCodes: [ValidationReasonCode.TIMESTAMP_MISSING_OR_NAN],
      reasons: ['Snapshot missing'],
    };
  }

  const d = snapshot.data;
  const result = {
    valid: true,
    measurementConfidence: 1,
    reasonCodes: [],
    reasons: [],
  };

  // Timestamp sanity
  if (!Number.isFinite(snapshot.ts) || snapshot.ts <= 0) {
    result.valid = false;
    result.measurementConfidence = 0;
    result.reasonCodes.push(ValidationReasonCode.TIMESTAMP_MISSING_OR_NAN);
    result.reasons.push('Timestamp missing/NaN');
  }

  // RVFC status
  if (d.rvfcStatus === 'UNKNOWN' || d.rvfcStatus === 'UNSUPPORTED') {
    result.measurementConfidence = Math.min(result.measurementConfidence, 0.5);
    result.reasonCodes.push(ValidationReasonCode.RVFC_MISSING_OR_UNSUPPORTED);
    result.reasons.push(`RVFC ${d.rvfcStatus}`);
  }

  // readyState
  if (d.readyState < 3 && !d.seeking) {
    result.measurementConfidence = Math.min(result.measurementConfidence, 0.4);
    result.reasonCodes.push(ValidationReasonCode.READY_STATE_INVALID);
    result.reasons.push(`readyState=${d.readyState} without seeking`);
  }

  // tickDelta
  if (!Number.isFinite(d.tickDelta) || d.tickDelta <= 0 || d.tickDelta > TICK_DELTA_MAX_MS) {
    result.measurementConfidence = Math.min(result.measurementConfidence, 0.6);
    result.reasonCodes.push(ValidationReasonCode.TICK_DELTA_INVALID);
    result.reasons.push(`tickDelta=${d.tickDelta}ms`);
  }

  // driftMs
  if (!Number.isFinite(d.driftMs) || Math.abs(d.driftMs) > DRIFT_MAX_MS) {
    result.valid = false;
    result.measurementConfidence = 0;
    result.reasonCodes.push(ValidationReasonCode.DRIFT_INVALID);
    result.reasons.push(`driftMs=${d.driftMs}`);
  }

  // Performance API — optional, only warn
  if (typeof performance !== 'undefined' && typeof performance.now !== 'function') {
    result.measurementConfidence = Math.min(result.measurementConfidence, 0.7);
    result.reasonCodes.push(ValidationReasonCode.PERFORMANCE_API_EMPTY);
    result.reasons.push('Performance API unavailable');
  }

  return result;
}
