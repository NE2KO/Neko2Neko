export const DEFAULT_TRIANGLE_TOLERANCE_MS = 1;

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