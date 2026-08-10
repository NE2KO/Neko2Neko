import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';

const STATUS_CONFIG = {
  loading: { bg: '#262626', border: '#404040', text: '#e5e5e5', icon: 'spinner' },
  queued:  { bg: 'rgba(245,158,11,0.9)', border: '#fbbf24', text: '#ffffff', icon: 'clock' },
  success: { bg: 'rgba(16,185,129,0.9)', border: '#34d399', text: '#ffffff', icon: 'check' },
  error:   { bg: 'rgba(239,68,68,0.9)',   border: '#f87171', text: '#ffffff', icon: 'x' },
};

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="32" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>;
}

function ClockIcon() {
  return <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
}

function XIcon() {
  return <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>;
}

function Icon({ name }) {
  if (name === 'spinner') return <Spinner />;
  if (name === 'check') return <CheckIcon />;
  if (name === 'clock') return <ClockIcon />;
  if (name === 'x') return <XIcon />;
  return null;
}

function useEtaTick(etaEndMs, enabled) {
  const [display, setDisplay] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled || !etaEndMs) { setDisplay(''); return; }
    const tick = () => {
      const mins = Math.max(0, Math.round((Number(etaEndMs) - Date.now()) / 60000));
      setDisplay(mins === 0 ? 'Segera' : `${mins} menit`);
    };
    tick();
    timerRef.current = setInterval(tick, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [etaEndMs, enabled]);

  return display;
}

export default function SendStatusPill({ visible, status, message, extraInfo, anchorRef }) {
  const [phase, setPhase] = useState('idle');
  const timerRef = useRef(null);
  const pillRef = useRef(null);
  const spinnerRef = useRef(null);
  const contentRef = useRef(null);
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.loading;

  const clearTimers = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const startHide = (delay = 4000) => {
    clearTimers();
    if (status === 'loading') return;
    timerRef.current = setTimeout(() => setPhase('exiting'), delay);
  };

  useEffect(() => {
    if (!visible || status === 'idle') {
      if (phase !== 'idle') { clearTimers(); setPhase('exiting'); }
      return;
    }
    if (phase === 'idle') {
      setPhase('entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPhase('open'));
      });
      startHide(status === 'loading' ? Infinity : 4000);
    } else if (phase === 'open') {
      startHide(status === 'loading' ? Infinity : 4000);
    }
    return clearTimers;
  }, [visible, status]);

  useEffect(() => () => clearTimers(), []);

  useLayoutEffect(() => {
    if (!pillRef.current || !anchorRef?.current) return;
    const pill = pillRef.current;
    const anchor = anchorRef.current;

    const anchorRect = anchor.getBoundingClientRect();
    const anchorCenterX = anchorRect.left + anchorRect.width / 2;
    const top = anchorRect.bottom + 12;

    Object.assign(pill.style, {
      position: 'fixed',
      left: `${anchorCenterX}px`,
      top: `${top}px`,
    });
  }, [phase]);

  useEffect(() => {
    if (phase === 'exiting') {
      const t = setTimeout(() => setPhase('idle'), 200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const etaDisplay = useEtaTick(extraInfo?.etaEndMs, phase === 'open' && status === 'queued');
  const extraLines = extraInfo
    ? [extraInfo.queuePosition, etaDisplay ? `ETA: ${etaDisplay}` : null, extraInfo.scheduledAt, extraInfo.lastSentAt]
        .filter(Boolean)
    : [];
  const isEntering = phase === 'entering';
  const isExiting = phase === 'exiting';

  if (phase === 'idle') return null;

  return (
    <div
      ref={pillRef}
      className="z-50"
      style={{
        position: 'fixed',
        transform: `translateX(-50%) ${isExiting ? 'translateY(-8px)' : isEntering ? 'translateY(-20px)' : 'translateY(0)'}`,
        maxWidth: isEntering || isExiting ? '120px' : '600px',
        opacity: isEntering || isExiting ? 0 : 1,
        transition: 'max-width 200ms ease-out, transform 200ms ease-out, opacity 150ms ease-out',
        pointerEvents: 'none',
      }}
    >
      <div
        className="relative rounded-xl border shadow-2xl backdrop-blur-md overflow-hidden"
        style={{
          width: '100%',
          background: config.bg,
          borderColor: config.border,
          transform: isExiting ? 'scaleX(0.9)' : 'scaleX(1)',
          opacity: isExiting ? 0 : 1,
          transition: isExiting
            ? 'transform 200ms ease-in, opacity 200ms ease-in'
            : 'none',
          transformOrigin: 'top center',
        }}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          <span className="flex-shrink-0" style={{ visibility: isEntering ? 'hidden' : 'visible' }}>
            <Icon name={config.icon} />
          </span>
          <div ref={contentRef} className="flex flex-col gap-0.5 min-w-0">
            <span className={`text-xs font-semibold whitespace-nowrap ${config.text}`}>{message}</span>
            {extraLines.map((line, i) => (
              <span key={i} className={`text-[11px] opacity-80 whitespace-nowrap ${config.text}`}>{line}</span>
            ))}
          </div>
          <span ref={spinnerRef} className="flex-shrink-0" style={{ visibility: isEntering ? 'visible' : 'hidden' }}>
            <Icon name="spinner" />
          </span>
        </div>
      </div>
    </div>
  );
}
