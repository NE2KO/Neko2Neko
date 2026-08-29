export {
  computeTriangleDrifts,
  computeTriangleErrorMs,
  judgeTriangleOutlier,
  DEFAULT_TRIANGLE_TOLERANCE_MS,
  POST_SEEK_TRANSITION_MS,
  POST_SEEK_SPIKE_THRESHOLD_MS,
  GENUINE_SPIKE_SAMPLES,
  RECOVERY_STABLE_SAMPLES,
  WARNING_ENTER_MS,
  WARNING_EXIT_MS,
} from '../TriangleCalculator.js';

export {
  generateVerificationSnapshot,
  computeReferenceFromSnapshot,
  compareSnapshotToReference,
  resetSequence,
  getSequence,
} from '../syncVerification.js';

export {
  configureTelemetry,
  setTelemetryEnabled,
  enqueueSyncVerification,
  buildSyncSnapshot,
  sendTelemetryBatch,
  processPendingTelemetry,
  getTelemetryStats,
  clearTelemetryQueue,
  telemetryQueue,
} from '../syncTelemetry.js';

export {
  TransientSpikeDetector,
  createSpikeDetectors,
  analyzeDriftSpikes,
} from '../transientDetector.js';