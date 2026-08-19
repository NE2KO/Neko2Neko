import { computeTriangleDrifts, DEFAULT_TRIANGLE_TOLERANCE_MS } from './TriangleCalculator.js';
import { createSpikeDetectors, analyzeDriftSpikes } from './transientDetector.js';

let telemetryQueue = [];
let samplingRate = 0.01;
let backendEndpoint = '/api/sync-verify/snapshot';
let lastSendTime = 0;
const MIN_SEND_INTERVAL_MS = 100;
const MAX_QUEUE_SIZE = 50;

let sequenceCounter = 0;

export function configureTelemetry({ samplingRate: rate = 0.01, endpoint = null } = {}) {
  samplingRate = Math.max(0, Math.min(1, rate));
  if (endpoint) backendEndpoint = endpoint;
}

export function setTelemetryEnabled(enabled) {
  if (!enabled) {
    telemetryQueue = [];
  }
}

export function enqueueSyncVerification(sequence, data) {
  if (Math.random() > samplingRate) return null;

  const enqueueTime = performance.now();
  const snapshot = {
    sequence: sequence || ++sequenceCounter,
    enqueueTime,
    data,
  };

  telemetryQueue.push(snapshot);
  if (telemetryQueue.length > MAX_QUEUE_SIZE) {
    telemetryQueue.shift();
  }

  return snapshot;
}

export function buildSyncSnapshot(params) {
  const {
    sequence,
    audioMs,
    mvMs,
    bgMs,
    videoOffset = 0,
    triangleValid,
    triangleConsistent,
    triangleErrorMs,
    audioMvMs,
    audioBgMs,
    mvBgMs,
    analyzerResult,
    judgeResult,
    confidence,
    allowedActions,
    selectedAction,
    decisionReason,
    frameAge,
    tickDelta,
    schedulerLateness,
    totalTiming,
    mode = 'LOCKED',
    seekPending = false,
    lastHardSeekTime = 0,
    spikeDetector,
  } = params;

  const timestamp = Date.now();
  let processedTriangle = null;

  if (typeof audioMvMs !== 'number' && (typeof audioMs === 'number' && typeof mvMs === 'number' && typeof bgMs === 'number')) {
    processedTriangle = computeTriangleDrifts(audioMs, mvMs, bgMs, videoOffset);
  } else {
    processedTriangle = {
      audioMvMs,
      audioBgMs,
      mvBgMs,
      triangleValid: triangleValid ?? true,
      triangleConsistent: triangleConsistent ?? true,
      triangleErrorMs: triangleErrorMs ?? 0,
    };
  }

  const isPostSeek = lastHardSeekTime > 0 && (Date.now() - lastHardSeekTime) < 1500;

  let spikeAnalysis = {
    classification: isPostSeek ? 'TRANSITIONAL' : 'NORMAL',
    isSpike: false,
    confidence: 1.0,
    reason: isPostSeek ? 'post_seek_transitional' : 'normal_operation',
  };

  if (spikeDetector) {
    const spikeResult = spikeDetector.analyze(processedTriangle.audioMvMs || 0, timestamp, {
      mode,
      seekPending,
      lastHardSeekTime,
    });
    spikeAnalysis = {
      classification: spikeResult.classification,
      isSpike: spikeResult.isSpike,
      confidence: spikeResult.confidence,
      reason: spikeResult.reason,
      spikeCount: spikeResult.spikeCount,
      stableSamples: spikeResult.stableSamples,
    };
  }

  return {
    sequence: sequence || ++sequenceCounter,
    timestamp,

    audioMs: audioMs ?? 0,
    mvMs: mvMs ?? 0,
    bgMs: bgMs ?? 0,
    videoOffset: videoOffset ?? 0,

    audioMvMs: processedTriangle.audioMvMs,
    audioBgMs: processedTriangle.audioBgMs,
    mvBgMs: processedTriangle.mvBgMs,

    triangleValid: processedTriangle.triangleValid,
    triangleConsistent: processedTriangle.triangleConsistent,
    triangleErrorMs: processedTriangle.triangleErrorMs,

    biasMs: params.biasMs ?? 0,
    frameAge: frameAge ?? null,

    judgeResult: judgeResult || null,
    confidence: confidence ?? spikeAnalysis.confidence,
    maxDriftMs: spikeAnalysis.spikeCount > 0 ? Math.abs(processedTriangle.audioMvMs || 0) : 0,

    allowedActions: allowedActions || ['HOLD', 'NOOP'],
    selectedAction: selectedAction || 'HOLD',
    decisionReason: decisionReason || 'default',

    mode,
    seekPending,
    timeSinceSeekMs: lastHardSeekTime ? Date.now() - lastHardSeekTime : 0,

    isPostSeek,
    classification: spikeAnalysis.classification,
    isSpike: spikeAnalysis.isSpike,
    spikeConfidence: spikeAnalysis.confidence,

    tickDelta: tickDelta ?? 30,
    schedulerLateness: schedulerLateness ?? 0,

    timing: totalTiming || { sensor: 0, triangle: 0, validator: 0, analyzer: 0, judge: 0, constraint: 0, decision: 0, executor: 0, total: 0 },

    spikeAnalysis: {
      spikeCount: spikeAnalysis.spikeCount,
      stableSamples: spikeAnalysis.stableSamples,
      reason: spikeAnalysis.reason,
    },
  };
}

export async function sendTelemetryBatch(batch = null) {
  const sendQueue = batch ?? telemetryQueue;
  if (!sendQueue.length) return { sent: 0, pending: telemetryQueue.length };

  const now = Date.now();
  if (now - lastSendTime < MIN_SEND_INTERVAL_MS) {
    return { sent: 0, pending: telemetryQueue.length };
  }

  const batchToSend = sendQueue.slice(0, 10);

  try {
    const response = await fetch(backendEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshots: batchToSend.map(s => ({
          sequence: s.sequence,
          data: s.data,
        })),
      }),
      keepalive: true,
    });

    if (response.ok) {
      const result = await response.json();
      telemetryQueue = telemetryQueue.slice(batchToSend.length);
      lastSendTime = now;
      return { sent: batchToSend.length, pending: telemetryQueue.length, result };
    }
  } catch (e) {
    // Silent fail - telemetry is optional
  }

  return { sent: 0, pending: sendQueue.length };
}

export function processPendingTelemetry() {
  if (telemetryQueue.length === 0) return;

  const now = performance.now();
  if (now - lastSendTime < MIN_SEND_INTERVAL_MS) return;

  sendTelemetryBatch().catch(() => {});
}

export function getTelemetryStats() {
  return {
    queueLength: telemetryQueue.length,
    samplingRate,
    backendEndpoint,
    lastSendTime,
    sequenceCounter,
  };
}

export function clearTelemetryQueue() {
  const len = telemetryQueue.length;
  telemetryQueue = [];
  return len;
}

export { telemetryQueue };