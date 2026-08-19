export const DEFAULT_TRIANGLE_TOLERANCE_MS = 1;
export const POST_SEEK_TRANSITION_MS = 1500;
export const POST_SEEK_SPIKE_THRESHOLD_MS = 30;
export const GENUINE_SPIKE_SAMPLES = 3;
export const RECOVERY_STABLE_SAMPLES = 5;
export const WARNING_ENTER_MS = 10;
export const WARNING_EXIT_MS = 6;

export function computeTriangleDrifts(audioMs, mvMs, bgMs, videoOffset = 0) {
  const valid = Number.isFinite(audioMs) && Number.isFinite(mvMs) && Number.isFinite(bgMs);
  if (!valid) {
    return {
      audioMvMs: null,
      audioBgMs: null,
      mvBgMs: null,
      triangleValid: false,
      triangleConsistent: false,
      triangleErrorMs: null,
    };
  }

  // Input: seconds, Output: milliseconds
  const audioMvMs = (mvMs - (audioMs + videoOffset)) * 1000;
  const audioBgMs = (bgMs - (audioMs + videoOffset)) * 1000;
  const mvBgMs = (bgMs - mvMs) * 1000;

  const triangleErrorMs = Math.abs((audioMvMs + mvBgMs) - audioBgMs);
  const triangleConsistent = triangleErrorMs <= DEFAULT_TRIANGLE_TOLERANCE_MS;

  return {
    audioMvMs,
    audioBgMs,
    mvBgMs,
    triangleValid: true,
    triangleConsistent,
    triangleErrorMs,
  };
}

export function computeTriangleErrorMs(audioMvMs, audioBgMs, mvBgMs) {
  if (
    !Number.isFinite(audioMvMs) ||
    !Number.isFinite(audioBgMs) ||
    !Number.isFinite(mvBgMs)
  ) {
    return null;
  }
  return Math.abs((audioMvMs + mvBgMs) - audioBgMs);
}

export function judgeTriangleOutlier(audioMvMs, audioBgMs, mvBgMs, tolerance = DEFAULT_TRIANGLE_TOLERANCE_MS) {
  const errorMs = computeTriangleErrorMs(audioMvMs, audioBgMs, mvBgMs);
  if (errorMs === null || errorMs > tolerance) {
    return { outlierEngine: null, confidence: 0, triangleConsistent: false };
  }

  const absAudioMv = Math.abs(audioMvMs);
  const absAudioBg = Math.abs(audioBgMs);
  const absMvBg = Math.abs(mvBgMs);

  let outlierEngine = null;
  let maxDrift = 0;

  if (absAudioMv >= absAudioBg && absAudioMv >= absMvBg) {
    outlierEngine = 'audio';
    maxDrift = absAudioMv;
  } else if (absMvBg >= absAudioBg) {
    outlierEngine = 'mv';
    maxDrift = absMvBg;
  } else {
    outlierEngine = 'bg';
    maxDrift = absAudioBg;
  }

  const confidence = Math.max(0.5, 1 - errorMs / 50);

  return {
    outlierEngine,
    confidence,
    triangleConsistent: true,
    maxDriftMs: maxDrift,
  };
}