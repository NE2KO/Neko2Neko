import { useState, useEffect, useRef, useMemo, memo } from 'react';

function useSmoothValue(target, { enabled = true, factor = 0.12 } = {}) {
  const [value, setValue] = useState(target);
  const currentRef = useRef(target);
  const rafRef = useRef(null);
  const targetRef = useRef(target);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      currentRef.current = target;
      targetRef.current = target;
      return;
    }
    targetRef.current = target;

    const step = () => {
      const current = currentRef.current;
      const t = targetRef.current;
      const diff = t - current;

      if (Math.abs(diff) < 0.3) {
        currentRef.current = t;
        setValue(t);
        rafRef.current = null;
        return;
      }

      const next = current + diff * factor;
      currentRef.current = next;
      setValue(next);
      rafRef.current = requestAnimationFrame(step);
    };

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(step);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, enabled, factor]);

  return value;
}

function useSmoothDisplayText(displayText, { enabled = true, factor = 0.15 } = {}) {
  const numVal = typeof displayText === 'object' && displayText?.value
    ? parseFloat(displayText.value)
    : typeof displayText === 'string' && !isNaN(parseFloat(displayText))
      ? parseFloat(displayText)
      : null;

  const animating = enabled && numVal !== null && !isNaN(numVal);
  const animatedNum = useSmoothValue(numVal ?? 0, { enabled: animating, factor });
  const displayed = animating ? animatedNum : (numVal ?? 0);

  if (typeof displayText === 'object' && displayText?.value) {
    const absVal = Math.abs(displayed);
    const decimals = absVal < 10 ? 1 : 0;
    const formatted = absVal < 10 ? displayed.toFixed(1) : Math.round(displayed).toString();
    return { value: formatted, unit: displayText.unit || '' };
  }
  if (typeof displayText === 'string' && numVal !== null) {
    const absVal = Math.abs(displayed);
    return absVal < 10 ? displayed.toFixed(1) : Math.round(displayed).toString();
  }
  return displayText;
}

const GaugeMeter = memo(function GaugeMeter({
  value = 0,
  label,
  unit = '%',
  displayText,
  size = 180,
  strokeWidth: sw,
  gradient = true,
  showNeedle = false,
  smoothEnabled = true,
  smoothMs,
}) {
  const prefersReducedMotion = useMemo(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }, []);

  const effectiveSmooth = smoothEnabled && !prefersReducedMotion;
  const factor = smoothEnabled ? 0.12 : 1;

  const strokeW = sw ?? size * 0.07;
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;
  const r = (size - strokeW * 2) / 2 - size * 0.04;
  const pathLen = Math.PI * r;

  const pct = Math.min(Math.max(value, 0), 100);
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e';
  const finalDashOffset = pathLen * (1 - Math.min(pct, 100) / 100);

  const animatedOffset = useSmoothValue(finalDashOffset, {
    enabled: effectiveSmooth,
    factor,
  });

  const animText = useSmoothDisplayText(displayText, {
    enabled: effectiveSmooth,
    factor: 0.15,
  });

  const gradientId = useMemo(() => `gg-${Math.random().toString(36).slice(2, 8)}`, []);

  const displayNum = animText?.value || animText;
  const numLen = displayNum ? String(displayNum).length : 2;
  const valueFontSize = Math.min(size * 0.16, size * 0.45 / Math.max(numLen, 1));
  const unitFontSize = size * 0.09;

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.62}`} className="overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>

        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeW}
          strokeLinecap="round"
        />

        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={gradient ? `url(#${gradientId})` : color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={pathLen}
          strokeDashoffset={animatedOffset}
          style={{ transition: 'none' }}
        />

        {showNeedle && (
          <circle cx={cx} cy={cy} r={3.5} fill={color} />
        )}

        <text
          x={cx}
          y={cy - r * 0.28 - (animText?.unit ? size * 0.04 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#e4e4e7"
          fontSize={valueFontSize}
          fontWeight="800"
          fontFamily="ui-monospace,monospace"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {animText?.value || animText || <>{Math.round(pct)}{unit}</>}
        </text>
        {animText?.unit && (
          <text
            x={cx}
            y={cy - r * 0.28 + size * 0.08}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#71717a"
            fontSize={unitFontSize}
            fontWeight="600"
            fontFamily="ui-monospace,monospace"
          >
            {animText.unit}
          </text>
        )}
      </svg>
      {label && <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">{label}</span>}
    </div>
  );
});

export default GaugeMeter;
