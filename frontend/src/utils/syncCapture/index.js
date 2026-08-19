const isBrowser = typeof window !== 'undefined' && typeof performance !== 'undefined';

export function startCapture(options = {}) {
  if (!isBrowser) return { status: 'no_browser' };
  if (captureSession) return { status: 'already_capturing' };

  const { maxBuffer = MAX_BUFFER, pollIntervalMs = POLL_INTERVAL_MS } = options;

  captureSession = {
    sessionId: `capture_${Date.now()}`,
    startTime: performance.now(),
    maxBuffer,
    pollIntervalMs,
    rawBuffer: [],
    processedBuffer: [],
    tickCount: 0,
  };

  rawBuffer = [];
  processedBuffer = [];

  captureInterval = setInterval(() => {
    if (!captureSession || !window.__SYNC_ENGINE__) return;

    const engine = window.__SYNC_ENGINE__;
    const tickTime = performance.now();
    const t = tickTime - captureSession.startTime;

    const raw = captureRawState(engine, t);
    const processed = captureProcessedState(engine, t);

    captureSession.tickCount++;

    if (raw) rawBuffer.push(raw);
    if (processed) processedBuffer.push(processed);

    if (rawBuffer.length > maxBuffer) rawBuffer.shift();
    if (processedBuffer.length > maxBuffer) processedBuffer.shift();
  }, pollIntervalMs);

  return { status: 'capturing', sessionId: captureSession.sessionId };
}

export function stopCapture() {
  if (!isBrowser) return { status: 'no_browser' };
  if (!captureSession) return { status: 'not_capturing' };

  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  const rawLength = rawBuffer.length;
  const processedLength = processedBuffer.length;

  const result = {
    status: 'stopped',
    sessionId: captureSession.sessionId,
    startTime: captureSession.startTime,
    endTime: performance.now(),
    tickCount: captureSession.tickCount,
    raw: rawLength,
    processed: processedLength,
    rawData: [...rawBuffer],
    processedData: [...processedBuffer],
  };

  captureSession = null;
  rawBuffer = [];
  processedBuffer = [];

  return result;
}

export function captureRawState(engine, t) {
  if (!isBrowser || !engine || !engine.state) return null;

  return {
    sequence: captureSession?.tickCount || 0,
    timestamp: Date.now(),
    ts: t,
    audioMvMs: engine.audioMvMs || 0,
    audioBgMs: engine.audioBgMs || 0,
    mvBgMs: engine.mvBgMs || 0,
    triangleValid: engine.triangleValid !== false,
    triangleConsistent: engine.triangleConsistent !== false,
    triangleErrorMs: engine.triangleErrorMs || 0,
    biasMs: engine.biasMs || 0,
    frameAge: engine.frameAge || null,
    tickDelta: engine.tickDelta || 16.67,
    schedulerLateness: engine.schedulerLateness || 0,
    isPostSeek: engine.isPostSeek || false,
    timeSinceSeekMs: engine.timeSinceSeekMs || 0,
    seekPending: engine.seekPending || false,
    mode: engine.mode || 'LOCKED',
    seekingMV: engine.seekingMV || false,
    seekingBG: false,
    decision: engine.decision || 'HOLD',
    decisionReason: engine.decisionReason,
    audioMs: engine.audioMs || 0,
    mvMs: engine.mvMs || 0,
    bgMs: engine.bgMs || 0,
    videoOffset: engine.videoOffset || 0,
  };
}

export function captureProcessedState(engine, t) {
  if (!isBrowser || !engine || !engine.state) return null;

  return {
    sequence: captureSession?.tickCount || 0,
    timestamp: Date.now(),
    ts: t,
    rawDriftMs: engine.rawDrift || 0,
    drift: Math.abs(engine.rawDrift || 0),
    correctedDriftMs: engine.correctedDrift || 0,
    biasMs: engine.biasMs || 0,
    emaDriftMs: engine.emaDrift || 0,
    sigmaMs: engine.sigmaMs || 0,
    confidence: engine.confidence || 1,
    classification: engine.classification || 'NORMAL',
    isSpike: engine.isSpike || false,
    decision: engine.decision || 'HOLD',
    mode: engine.mode || 'LOCKED',
  };
}

export function exportCapture(format = 'jsonl') {
  if (!isBrowser) return { status: 'no_browser' };
  if (rawBuffer.length === 0) {
    return { status: 'no_data' };
  }

  const sessionId = captureSession?.sessionId || `manual_${Date.now()}`;
  const header = `# SYNC CAPTURE SESSION: ${sessionId}\n`;
  const generatedAt = `generatedAt: ${new Date().toISOString()}\n`;
  const tickCount = `tickCount: ${rawBuffer.length}\n`;

  let content = '';

  if (format === 'jsonl') {
    content = rawBuffer.map((r) => JSON.stringify(r)).join('\n');
  } else {
    content = rawBuffer;
  }

  return {
    status: 'exported',
    session: sessionId,
    format,
    size: content.length,
    content: header + generatedAt + tickCount + `\n${content}`,
    raw: rawBuffer,
    processed: processedBuffer,
  };
}

export function clearCapture() {
  if (!isBrowser) return { status: 'no_browser' };
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  captureSession = null;
  rawBuffer = [];
  processedBuffer = [];
  return { status: 'cleared' };
}

export function getCaptureStatus() {
  if (!isBrowser) return { isCapturing: false, rawBufferLength: 0, processedBufferLength: 0 };
  return {
    session: captureSession,
    rawBufferLength: rawBuffer.length,
    processedBufferLength: processedBuffer.length,
    isCapturing: captureSession !== null,
  };
}

const MAX_BUFFER = 10000;
const POLL_INTERVAL_MS = 100;
let captureSession = null;
let captureInterval = null;
let rawBuffer = [];
let processedBuffer = [];

export const syncCapture = {
  startCapture,
  stopCapture,
  exportCapture,
  clearCapture,
  getCaptureStatus,
};