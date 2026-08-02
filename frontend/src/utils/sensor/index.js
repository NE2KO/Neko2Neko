// Sensor Layer helpers for Phase 0.
// Extracts browser/media data into SensorSnapshot per tick per engine.
// No behavior change: only adds optional logging.

import { createSensorSnapshot, isSensorSnapshotValid } from './SensorSnapshot.js';
import { validateSensorSnapshot } from '../validation/SensorValidator.js';

/**
 * Build a SensorSnapshot from current engine tick data.
 * This is a pure function; it does not mutate any state.
 */
export function buildSensorSnapshot({
  engineId,
  videoCurrentTime,
  audioCurrentTime,
  driftMs,
  readyState,
  networkState,
  waiting,
  stalled,
  seeking,
  rvfcStatus,
  tickDelta,
  cpuOverloaded,
  droppedFrames,
  decodeLatencyMs,
  pipelineState,
  cptMs,
}) {
  return createSensorSnapshot({
    engineId,
    videoCurrentTime,
    audioCurrentTime,
    driftMs,
    readyState,
    networkState,
    waiting,
    stalled,
    seeking,
    rvfcStatus,
    tickDelta,
    cpuOverloaded,
    droppedFrames,
    decodeLatencyMs,
    pipelineState,
    cptMs,
  });
}

/**
 * Validate a SensorSnapshot and attach validationResult if missing.
 * Returns the snapshot with validationResult attached (immutable).
 */
export function validateAndAttach(snapshot) {
  if (!snapshot) return null;
  if (snapshot.validationResult) return snapshot;
  const validationResult = validateSensorSnapshot(snapshot);
  return createSensorSnapshot({
    ...snapshot.data,
    ts: snapshot.ts,
    validationResult,
  });
}

/**
 * Log sensor snapshot to syncLog if enabled.
 * Does not throw.
 */
export function logSensorSnapshot(syncLogFn, snapshot) {
  try {
    if (typeof syncLogFn !== 'function') return;
    if (!snapshot || !isSensorSnapshotValid(snapshot)) return;
    syncLogFn('sensor_snapshot', snapshot.data.engineId, {
      ts: snapshot.ts,
      data: snapshot.data,
      validationResult: snapshot.validationResult,
    });
  } catch {
    // Never let telemetry logging break playback
  }
}
