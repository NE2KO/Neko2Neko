function circularDiff(a, b, duration) {
    if (!duration || !isFinite(duration) || duration <= 0) return a - b;
    let diff = a - b;
    diff = diff % duration;
    if (diff > duration / 2) diff -= duration;
    if (diff < -duration / 2) diff += duration;
    return diff;
}

function isValidTelemetrySample(value, context = {}) {
  if (!Number.isFinite(value)) return false;
  if (context.maxAbs && Math.abs(value) > context.maxAbs) return false;
  if (context.minAgeMs && performance.now() - (context.trackChangeTime || 0) < context.minAgeMs) return false;
  return true;
}

export { circularDiff, isValidTelemetrySample };
