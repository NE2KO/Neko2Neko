import { useEffect, useMemo, useRef, useState, memo } from 'react';

const MiniGauge = memo(function MiniGauge({ value, size = 48, strokeWidth: sw, smoothEnabled = true, smoothMs, label }) {

  const prefersReducedMotion = useMemo(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }, []);

  const effectiveSmooth = smoothEnabled && !prefersReducedMotion && smoothMs > 0;
  const pathRef = useRef(null);

  const strokeW = sw ?? size * 0.1;
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;
  const r = (size - strokeW * 2) / 2 - size * 0.04;
  const pathLen = Math.PI * r;

  const next = Number(value ?? 0);
  const targetOffset = pathLen * (1 - Math.min(Math.max(next, 0), 100) / 100);
  const color = next > 85 ? '#ef4444' : next > 65 ? '#f59e0b' : '#22c55e';

  useEffect(() => {
    if (!pathRef.current) return;
    if (!effectiveSmooth) {
      pathRef.current.setAttribute('stroke-dashoffset', targetOffset);
      return;
    }
    const from = parseFloat(pathRef.current.getAttribute('stroke-dashoffset') || targetOffset);
    const to = targetOffset;
    if (Math.abs(to - from) < 0.5) {
      pathRef.current.setAttribute('stroke-dashoffset', to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / smoothMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (to - from) * eased;
      pathRef.current.setAttribute('stroke-dashoffset', val);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [targetOffset, effectiveSmooth, smoothMs, pathLen]);

  const labelExtra = label ? size * 0.22 : 0;
  const svgHeight = Math.ceil(size * 0.6 + labelExtra);

  return (
    <svg data-debug-id="2.2.12" data-debug-name="MiniGauge" data-debug-type="chart" width={size} height={svgHeight} viewBox={`0 0 ${size} ${svgHeight}`} overflow="visible">
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      <path
        ref={pathRef}
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeDasharray={pathLen}
        strokeDashoffset={targetOffset}
        style={{ transition: 'none' }}
      />

      {label && (
        <text
          x={cx}
          y={cy + size * 0.04}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#a3a3a3"
          fontSize={size * 0.22}
          fontWeight="700"
          fontFamily="ui-monospace,monospace"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {label}
        </text>
      )}
    </svg>
  );
});

export default MiniGauge;