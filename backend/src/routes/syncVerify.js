import { Router } from 'express';
import { computeTriangleDrifts, computeTriangleErrorMs, judgeTriangleOutlier, DEFAULT_TRIANGLE_TOLERANCE_MS } from '../syncUtils.js';

const router = Router();

let telemetryBuffer = [];
const MAX_TELEMETRY_BUFFER = 1000;

function detectTransientSpike(history, currentDrift, spikeThresholdMs = 8) {
  if (history.length < 3) return { isSpike: false, reason: 'insufficient_history' };

  const recent = history.slice(-5);
  const avgRecent = recent.reduce((a, b) => a + b.drift, 0) / recent.length;
  const stdDev = Math.sqrt(recent.reduce((a, b) => a + (b.drift - avgRecent) ** 2, 0) / recent.length);

  const isOvershoot = Math.abs(currentDrift - avgRecent) > 3 * (stdDev + 1);
  const isSmallRegion = Math.abs(avgRecent) < 5;
  const isHighSpike = Math.abs(currentDrift) > spikeThresholdMs;
  const isLowStdDev = stdDev < 10;

  if (isOvershoot && isSmallRegion && isHighSpike && isLowStdDev) {
    return { isSpike: true, reason: 'transient_spike', spikePeak: currentDrift, baseline: avgRecent };
  }

  return { isSpike: false, reason: 'normal', baseline: avgRecent };
}

router.post('/snapshot', (req, res) => {
  const { snapshots } = req.body;
  if (!snapshots || !Array.isArray(snapshots)) {
    return res.status(400).json({ error: 'Missing snapshots array' });
  }

  const received = [];
  for (const snap of snapshots) {
    const { sequence, data } = snap;
    if (!sequence || !data) continue;

    const processed = processSnapshotData(data);
    const snapshot = {
      sequence,
      receivedAt: Date.now(),
      ...processed,
    };

    telemetryBuffer.push(snapshot);
    received.push(sequence);
  }

  if (telemetryBuffer.length > MAX_TELEMETRY_BUFFER) {
    telemetryBuffer = telemetryBuffer.slice(-MAX_TELEMETRY_BUFFER);
  }

  res.json({ status: 'received', received, count: received.length });
});

function processSnapshotData(data) {
  const result = { ...data };

  if (typeof data.audioMs === 'number' && typeof data.mvMs === 'number' && typeof data.bgMs === 'number') {
    const videoOffset = Number.isFinite(data.videoOffset) ? data.videoOffset : 0;
    const triangle = computeTriangleDrifts(data.audioMs, data.mvMs, data.bgMs, videoOffset);

    result.audioMvMs = triangle.audioMvMs;
    result.audioBgMs = triangle.audioBgMs;
    result.mvBgMs = triangle.mvBgMs;
    result.triangleValid = triangle.triangleValid;
    result.triangleConsistent = triangle.triangleConsistent;
    result.triangleErrorMs = triangle.triangleErrorMs;
  }

  return result;
}

router.get('/verify/:sequence', (req, res) => {
  const { tolerance = DEFAULT_TRIANGLE_TOLERANCE_MS } = req.query;
  const seqNum = parseInt(req.params.sequence, 10);
  const snap = telemetryBuffer.find(s => s.sequence === seqNum);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

  const comparison = compareSnapToReference(snap, Number(tolerance));
  res.json({ sequence: seqNum, ...comparison });
});

router.get('/replay/:sequence', (req, res) => {
  const { tolerance = DEFAULT_TRIANGLE_TOLERANCE_MS } = req.query;
  const seqNum = parseInt(req.params.sequence, 10);
  const snap = telemetryBuffer.find(s => s.sequence === seqNum);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

  try {
    const reference = computeReferenceState(snap);
    const comparison = compareStates(snap, reference, Number(tolerance));
    res.json({
      sequence: seqNum,
      status: comparison.status,
      match: comparison.status === 'MATCH',
      frontend: snap,
      reference,
      comparison,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function computeReferenceState(snap) {
  const audioMs = snap.audioMs ?? snap.data?.audioCurrentTime ?? 0;
  const mvMs = snap.mvMs ?? snap.data?.videoCurrentTime ?? 0;
  const bgMs = snap.bgMs ?? snap.data?.bgCurrentTime ?? 0;
  const videoOffset = Number.isFinite(snap.videoOffset) ? snap.videoOffset : 0;

  const triangle = computeTriangleDrifts(audioMs, mvMs, bgMs, videoOffset);

  const judge = judgeTriangleOutlier(
    triangle.audioMvMs ?? 0,
    triangle.audioBgMs ?? 0,
    triangle.mvBgMs ?? 0
  );

  return {
    audioMs,
    mvMs,
    bgMs,
    videoOffset,
    triangle,
    judge,
    constraints: ['HOLD', 'NOOP'],
    decision: { type: 'hold', reason: 'within_threshold' },
  };
}

function compareSnapToReference(snap, tolerance) {
  const reference = computeReferenceState(snap);
  return compareStates(snap, reference, tolerance);
}

function compareStates(frontend, reference, tolerance) {
  const status = [];

  const triCheck = compareTriangles(
    frontend,
    reference.triangle,
    tolerance
  );

  if (triCheck.status !== 'MATCH') {
    status.push({ field: 'triangle', status: triCheck.status, diffs: triCheck.diffs });
  }

  const judgeCheck = judgeByEnum(
    frontend.judgeResult,
    frontend.suspectedOutlier,
    frontend.confidence,
    reference.judge.outlierEngine,
    reference.judge.confidence
  );

  if (!judgeCheck.match) {
    status.push({ field: 'judge', expected: reference.judge.outlierEngine, actual: frontend.judgeResult });
  }

  const toleranceCheck = Math.abs((frontend.triangleErrorMs ?? 0) - (reference.triangle.triangleErrorMs ?? 0));
  if (toleranceCheck > tolerance) {
    status.push({ field: 'triangleErrorMs', diff: toleranceCheck });
  }

  if (status.length === 0) {
    return { status: 'MATCH', match: true, details: {} };
  }

  const hasMajorDivergence = status.some(s => s.status === 'DIVERGENCE');
  return {
    status: hasMajorDivergence ? 'DIVERGENCE' : 'MINOR_DIVERGENCE',
    match: !hasMajorDivergence,
    details: status,
  };
}

function judgeByEnum(frontendResult, frontendOutlier, frontendConfidence, backendOutlier, backendConfidence) {
  if (frontendResult === backendOutlier) return { match: true };

  const nullCheck = frontendResult === 'null' && backendOutlier === null;
  if (nullCheck) return { match: true };

  const tolerance = 30;
  if (Math.abs((frontendConfidence || 0) - (backendConfidence || 0)) <= tolerance) {
    return { match: true, note: 'confidence within tolerance' };
  }

  return { match: false };
}

function compareTriangles(frontend, backendTriangle, tolerance) {
  const diffs = [];
  if (frontend.triangleValid !== backendTriangle.triangleValid) diffs.push('triangleValid');
  if (frontend.triangleConsistent !== backendTriangle.triangleConsistent) diffs.push('triangleConsistent');

  const tol = tolerance || 1;
  const numFields = ['audioMvMs', 'audioBgMs', 'mvBgMs', 'triangleErrorMs'];

  for (const f of numFields) {
    const fv = frontend[f];
    const bv = backendTriangle[f];
    if (fv === null || bv === null) {
      if (fv !== bv) diffs.push(f);
    } else if (Math.abs(fv - bv) > tol) {
      diffs.push(f);
    }
  }

  if (diffs.length === 0) return { status: 'MATCH' };
  if (diffs.length < 3) return { status: 'MINOR_DIVERGENCE', diffs };
  return { status: 'DIVERGENCE', diffs };
}

router.get('/recent', (_req, res) => {
  const snapshots = telemetryBuffer.slice(-100).map(s => ({
    sequence: s.sequence,
    receivedAt: s.receivedAt,
    triangleValid: s.triangleValid,
    triangleConsistent: s.triangleConsistent,
    triangleErrorMs: s.triangleErrorMs,
    audioMvMs: s.audioMvMs,
    audioBgMs: s.audioBgMs,
    mvBgMs: s.mvBgMs,
  }));

  const drifts = snapshots.map(s => s.triangleErrorMs || 0);
  if (drifts.length >= 3) {
    const baseline = drifts.slice(0, -1).reduce((a, b) => a + b, 0) / (drifts.length - 1);
    const lastDrift = drifts[drifts.length - 1];
    const isSpike = Math.abs(lastDrift - baseline) > 3 * (baseline + 1) && Math.abs(lastDrift) > 8;
  }

  res.json({ snapshots });
});

router.get('/analyze', (req, res) => {
  const { window = 50 } = req.query;
  const windowSize = Math.min(telemetryBuffer.length, parseInt(window, 10) || 50);
  const recent = telemetryBuffer.slice(-windowSize);

  const drifts = recent.map(s => Math.abs(s.triangleErrorMs ?? 0));
  const avgDrift = drifts.reduce((a, b) => a + b, 0) / drifts.length;
  const consistencyRate = recent.filter(s => s.triangleConsistent).length / recent.length;

  const spikes = [];
  for (let i = 5; i < recent.length; i++) {
    const history = recent.slice(0, i - 1).map(s => s.triangleErrorMs || 0);
    const spikeInfo = detectTransientSpike(history, recent[i].triangleErrorMs || 0);
    if (spikeInfo.isSpike) {
      spikes.push({
        sequence: recent[i].sequence,
        ...spikeInfo,
      });
    }
  }

  res.json({
    window: windowSize,
    total: telemetryBuffer.length,
    consistencyRate,
    avgDriftMs: avgDrift,
    spikes,
    firstTimestamp: recent[0]?.receivedAt,
    lastTimestamp: recent[recent.length - 1]?.receivedAt,
  });
});

router.get('/stats', (_req, res) => {
  const statuses = telemetryBuffer.map(s => s.triangleConsistent).filter(Boolean).length;
  res.json({
    total: telemetryBuffer.length,
    consistent: statuses,
    inconsistent: telemetryBuffer.length - statuses,
    rate: telemetryBuffer.length > 0 ? (statuses / telemetryBuffer.length) : 1,
  });
});

router.delete('/clear', (_req, res) => {
  telemetryBuffer = [];
  res.json({ status: 'cleared' });
});

export default router;