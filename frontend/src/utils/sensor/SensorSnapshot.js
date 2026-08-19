// SensorSnapshot — immutable snapshot of browser/media sensor data per tick per engine.

/**
 * @typedef {Object} SensorData
 * @property {string} engineId - 'mv' | 'bg'
 * @property {number} videoCurrentTime
 * @property {number} audioCurrentTime
 * @property {number} driftMs - signed drift (video - audio) in ms
 * @property {number} readyState
 * @property {number} networkState
 * @property {boolean} waiting
 * @property {boolean} stalled
 * @property {boolean} seeking
 * @property {string} rvfcStatus - 'ACTIVE' | 'DEGRADED' | 'UNSUPPORTED' | 'UNKNOWN'
 * @property {number} tickDelta - ms since last tick
 * @property {boolean} cpuOverloaded
 * @property {number} droppedFrames
 * @property {number} decodeLatencyMs
 * @property {string} pipelineState - 'READY' | 'WARMING' | 'DISTURBED' | 'UNKNOWN'
 * @property {number} cptMs - current presentation time from RVFC if available
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {number} measurementConfidence - 0..1
 * @property {string[]} reasonCodes
 * @property {string[]} reasons
 */

import { computeTriangleDrifts } from '../TriangleCalculator.js';

export function createSensorSnapshot(data) {
  const videoOffset = Number.isFinite(Number(data.videoOffset)) ? data.videoOffset : 0;
  const bgCurrentTime = Number.isFinite(Number(data.bgCurrentTime)) ? data.bgCurrentTime : null;

  const triangle = computeTriangleDrifts(
    data.audioCurrentTime,
    data.videoCurrentTime,
    bgCurrentTime,
    videoOffset
  );

  return Object.freeze({
    ts: typeof data.ts === 'number' ? data.ts : performance.now(),
    kind: 'sensor_snapshot',
    data: Object.freeze({
      engineId: String(data.engineId || 'mv'),
      videoCurrentTime: Number(data.videoCurrentTime || 0),
      audioCurrentTime: Number(data.audioCurrentTime || 0),
      bgCurrentTime: bgCurrentTime,
      driftMs: Number(data.driftMs || 0),
      readyState: Number(data.readyState || 0),
      networkState: Number(data.networkState || 0),
      waiting: Boolean(data.waiting),
      stalled: Boolean(data.stalled),
      seeking: Boolean(data.seeking),
      rvfcStatus: String(data.rvfcStatus || 'UNKNOWN'),
      tickDelta: Number(data.tickDelta || 0),
      cpuOverloaded: Boolean(data.cpuOverloaded),
      droppedFrames: Number(data.droppedFrames || 0),
      decodeLatencyMs: Number(data.decodeLatencyMs || 0),
      pipelineState: String(data.pipelineState || 'UNKNOWN'),
      cptMs: Number(data.cptMs || 0),
      videoOffset,
      audioMvMs: triangle.audioMvMs,
      audioBgMs: triangle.audioBgMs,
      mvBgMs: triangle.mvBgMs,
      triangleValid: triangle.triangleValid,
      triangleConsistent: triangle.triangleConsistent,
      triangleErrorMs: triangle.triangleErrorMs,
    }),
    validationResult: data.validationResult ? Object.freeze(data.validationResult) : null,
  });
}

export function isSensorSnapshotValid(snapshot) {
  if (!snapshot || !snapshot.data) return false;
  const d = snapshot.data;
  if (!Number.isFinite(d.driftMs)) return false;
  if (!Number.isFinite(d.tickDelta)) return false;
  return true;
}
