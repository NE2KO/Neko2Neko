import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid } from 'react-window';

import { Inbox, CheckCircle2, XCircle, Ban, Trash2, Clock, ArrowLeft, X, Settings, Bug, Power, Square, Play, AlertTriangle, Pencil, ChevronUp, ChevronDown, Calendar, RotateCw } from 'lucide-react';
import { getSendQueueStatuses, getSendQueue, clearSendQueueHistory, getThumbnailUrl, cancelSendQueueItem, retrySendQueueItem, removeSendQueueItem, getSendSettings, setSendSettings, getWhatsAppSendStatus, setQueueCaption, reorderQueueItem, resendQueueItem, rescheduleQueueItem } from '../utils/api';

import SendQueuePlayer from './SendQueuePlayer';
import CaptionEditorModal from './CaptionEditorModal';
import RescheduleModal from './RescheduleModal';
import { useToast } from './Toast';

const STATUS_META = {
  pending: { key: 'pending', label: 'Antrian', icon: Inbox, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  done: { key: 'done', label: 'Terkirim', icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  failed: { key: 'failed', label: 'Gagal', icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  canceled: { key: 'canceled', label: 'Dibatalkan', icon: Ban, color: 'text-neutral-400', bg: 'bg-neutral-500/10', border: 'border-neutral-500/30' },
};

// Two logical groups. WA holds rate-limited sends (channel / status / whatsapp
// / all) and therefore has an "Antrian" card. Telegram holds instant sends
// plus "all" (which also hits Telegram), so its target filter includes 'all'.
const GROUPS = {
  wa: { key: 'wa', label: 'WhatsApp', target: 'whatsapp,channel,status,all', statuses: ['pending', 'done', 'failed', 'canceled'] },
  telegram: { key: 'telegram', label: 'Telegram', target: 'telegram,all', statuses: ['done', 'failed', 'canceled'] },
};
const GROUP_ORDER = [GROUPS.wa, GROUPS.telegram];

// Returns the countdown as a readable HH:MM:SS string.
function remainingDigits(ms) {
  if (!ms || ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

// Shared clock: one interval drives all consumers. Components subscribe via
// useClock() and only re-render when the second actually ticks.
let _clockNow = Date.now();
const _clockListeners = new Set();
let _clockStarted = false;
let _clockPaused = false;
function startClockIfNeeded() {
  if (_clockStarted) return;
  _clockStarted = true;
  setInterval(() => {
    _clockNow = Date.now();
    if (!_clockPaused) _clockListeners.forEach((fn) => fn());
  }, 1000);
}
// Pause the whole clock while the user is actively scrolling the grid. Without
// this, every mounted ItemCard re-renders + runs an Odometer rAF animation once
// per second, which makes scrolling the (virtualized) grid feel janky. On resume
// we notify listeners immediately so countdowns refresh without waiting a tick.
function setClockPaused(paused) {
  if (_clockPaused === paused) return;
  _clockPaused = paused;
  if (!paused) {
    _clockNow = Date.now();
    _clockListeners.forEach((fn) => fn());
  }
}
function useClock() {
  startClockIfNeeded();
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const tick = () => forceUpdate((c) => c + 1);
    _clockListeners.add(tick);
    return () => _clockListeners.delete(tick);
  }, []);
  return _clockNow;
}

const StatusFolderCard = memo(function StatusFolderCard({ meta, count, coverId, policy, timeline, onClick, scheduleActive }) {
  const now = useClock();
  const Icon = meta.icon;
  const isPending = meta.key === 'pending';
  const unlimited = policy?.unlimited ?? false;
  
  const firstItemEta = isPending && timeline && timeline.length > 0 ? timeline[0].eta : 0;
  const nextAllowed = policy?.nextAllowedAt || 0;
  const rawEta = isPending ? Math.max(firstItemEta, nextAllowed) : nextAllowed;

  // Freeze ETA: capture on transition from active→inactive
  const frozenEtaRef = useRef(rawEta || 0);
  const prevActiveRef = useRef(scheduleActive);
  useEffect(() => {
    if (prevActiveRef.current && !scheduleActive && rawEta > 0) {
      frozenEtaRef.current = rawEta;
    }
    if (scheduleActive && rawEta > 0) {
      frozenEtaRef.current = rawEta;
    }
    prevActiveRef.current = scheduleActive;
  }, [scheduleActive, rawEta]);

  const displayEta = scheduleActive ? (rawEta || frozenEtaRef.current) : frozenEtaRef.current;

  const remainingDigitsStr = isPending && !unlimited ? remainingDigits(displayEta - now) : null;
  
  // Calculate hours until next slot
  const nextSlotHours = Math.floor((displayEta - now) / 3600000);
  const nextSlotMins = Math.floor(((displayEta - now) % 3600000) / 60000);
  const nextSlotLabel = displayEta > now ? `${nextSlotHours}h ${nextSlotMins}m` : 'Siap';

return (
      <button
        onClick={onClick}
        className={`relative flex flex-col items-start gap-2 p-5 rounded-2xl border ${meta.border} ${meta.bg} hover:brightness-125 transition-all text-left overflow-hidden focus:outline-none focus:ring-0`}
        style={{ minHeight: '180px' }}
     >
      <div className={`flex items-center gap-2 ${meta.color}`}>
        <Icon size={24} />
        <span className="text-lg font-semibold">{meta.label}</span>
      </div>
      <CounterOdometer value={count} />
{isPending && (
       <div className="mt-auto w-full">
              <div className="flex items-center gap-1.5 text-sm text-amber-300/90">
            <Clock size={15} className="flex-shrink-0" />
            {unlimited ? (
              <span>Tanpa batas</span>
            ) : (
              <Odometer countdown={remainingDigitsStr || '00:00:00'} placeholder={!scheduleActive} format="00:00:00" size="sm" color="amber" />
            )}
          </div>
<div className="text-[13px] text-neutral-400 mt-0.5">
            {unlimited
              ? 'Tanpa batas'
              : `Slot berikutnya: ${nextSlotLabel}`}
          </div>
       </div>
     )}
     {!isPending && coverId && (
       <img
         src={getThumbnailUrl({ id: coverId })}
         alt=""
         className="absolute right-3 bottom-3 w-14 h-14 rounded-lg object-cover opacity-40 pointer-events-none"
         onError={(e) => { e.currentTarget.style.display = 'none'; }}
       />
     )}
   </button>
 );
});

export const ItemCard = memo(function ItemCard({ item, onOpen, onAction, onCaptionChange, sendEta, ready, index, scheduleActive, interactive = true, isScrolling = false }) {
  const now = useClock();
  const meta = STATUS_META[item.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const [showCaptionModal, setShowCaptionModal] = useState(false);

  const displayName = item.name || '(file dihapus)';
  const captionText = item.caption || null;

  let eta = null;
  let etaLabel = null;
  
  if (item.status === 'pending' || item.status === 'processing') {
    const hold = item.hold_until ? Number(item.hold_until) : 0;
    const tick = sendEta ? Number(sendEta) : 0;
    const target = Math.max(hold, tick);
    const isReady = ready !== undefined ? ready : (target > 0 ? target <= now : true);
    if (hold > tick && hold > now) {
      etaLabel = 'Ditahan';
      eta = hold - now;
    } else if (!isReady && target > now) {
      etaLabel = 'Antri';
      eta = target - now;
    } else {
      etaLabel = 'Siap';
      eta = Math.max(0, target - now);
    }
  }

  const quick = (e, fn) => { e.stopPropagation(); fn(); };

  return (
    <div
      onClick={() => onOpen(item)}
      className="group relative flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden hover:border-neutral-600 transition-colors cursor-pointer"
    >
      {/* Thumbnail area — centered vertically in available space */}
      <div className="flex-1 flex items-center justify-center min-h-0 bg-neutral-950 relative">
        <div className="w-full relative" style={{ aspectRatio: '1/1' }}>
        {item.file_id ? (
          <img src={getThumbnailUrl({ id: item.file_id })} alt={item.name || ''} decoding="async" className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-700">
            <Icon size={28} />
          </div>
        )}
        {item.debug ? (
          <span className="absolute top-1.5 left-1.5 text-[8px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold uppercase tracking-wider">
            Debug
          </span>
        ) : null}
        {/* Index badge - top left */}
        {index !== undefined && (
          <span className="absolute top-1.5 left-1.5 text-[11px] px-1.5 py-0.5 rounded bg-neutral-900/90 text-neutral-200 font-mono font-medium border border-neutral-700">
            #{index + 1}
          </span>
        )}
        <span className={`absolute top-1.5 right-1.5 text-[9px] px-1 py-0.5 rounded ${meta.bg} ${meta.color} border ${meta.border} flex items-center gap-0.5 font-semibold`}>
           <Icon size={9} />
           <span>{etaLabel || meta.label}</span>
        </span>
        {/* Gradient overlay to keep badge readable over any image */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
        <SendTimeBadge
          sendEta={sendEta}
          ready={ready}
          item={item}
          scheduleActive={scheduleActive}
        />
        </div>
      </div>
      {/* Metadata area — sits at bottom of card */}
      <div className="p-2 bg-neutral-900 border-t border-neutral-800/60 flex flex-col justify-end mt-auto w-full overflow-hidden">
        <p className="text-[11px] font-medium truncate text-neutral-200 w-full leading-tight">
          {displayName}
        </p>
        {/* ETA row — always rendered for consistent card height */}
        <div className="flex items-center gap-0.5 mt-0.5 min-h-[18px]">
            {eta != null && eta > 0 ? (
              <>
                <Clock size={10} className="text-amber-400/70 flex-shrink-0" />
                <Odometer countdown={remainingDigits(eta)} placeholder={!scheduleActive} format="00:00:00" size="sm" color="amber" />
              </>
            ) : <span />}
          </div>
        {/* Caption */}
        <div className="flex items-center gap-1 mt-0.5 group/cap">
          <p
            className={`text-[13px] truncate flex-1 min-w-0 ${captionText ? 'text-neutral-400' : 'text-neutral-600 italic'}`}
          >
            {captionText ? `Caption: ${captionText}` : 'Tanpa caption'}
          </p>
          {interactive && item.status === 'pending' && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowCaptionModal(true); }}
              className="p-0.5 rounded opacity-0 group-hover/cap:opacity-100 text-neutral-600 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all flex-shrink-0 focus:outline-none focus:ring-0"
              title="Edit caption"
            >
              <Pencil size={10} />
            </button>
          )}
        </div>
      </div>
      {/* Hover quick actions */}
      {interactive && (
      <div className="absolute bottom-[80px] right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {item.status === 'pending' && (
          <>
            <button title="Geser ke atas" onClick={(e) => quick(e, () => onAction('moveUp', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
              <ChevronUp size={12} />
            </button>
            <button title="Geser ke bawah" onClick={(e) => quick(e, () => onAction('moveDown', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
              <ChevronDown size={12} />
            </button>
            <button title="Batalkan" onClick={(e) => quick(e, () => onAction('cancel', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
              <Ban size={12} />
            </button>
            <button title="Jadwalkan ulang" onClick={(e) => quick(e, () => onAction('reschedule', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-cyan-400 focus:outline-none focus:ring-0">
              <Calendar size={12} />
            </button>
          </>
        )}
        {item.status === 'failed' && (
          <>
            <button title="Ulangi" onClick={(e) => quick(e, () => onAction('retry', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
              <XCircle size={12} />
            </button>
            <button title="Hapus" onClick={(e) => quick(e, () => onAction('remove', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
              <Trash2 size={12} />
            </button>
          </>
        )}
        {item.status === 'done' && (
          <>
            <button title="Kirim lagi" onClick={(e) => quick(e, () => onAction('resend', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-emerald-400 focus:outline-none focus:ring-0">
              <RotateCw size={12} />
            </button>
            <button title="Hapus dari riwayat" onClick={(e) => quick(e, () => onAction('remove', item))}
              className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
              <Trash2 size={12} />
            </button>
          </>
        )}
        {item.status === 'canceled' && (
          <button title="Hapus dari riwayat" onClick={(e) => quick(e, () => onAction('remove', item))}
            className="p-1 rounded-full bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:text-white focus:outline-none focus:ring-0">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      )}
      {showCaptionModal && (
        <CaptionEditorModal
          open={showCaptionModal}
          caption={item.caption || ''}
          onSave={(c) => onCaptionChange(item, c)}
          onClose={() => setShowCaptionModal(false)}
        />
      )}
    </div>
  );
});

function Toggle({ on, onClick, disabled, color = 'emerald' }) {
  const onCls = color === 'amber' ? 'bg-amber-500' : color === 'red' ? 'bg-red-500' : 'bg-emerald-600';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${on ? onCls : 'bg-neutral-700'}`}
      role="switch"
      aria-checked={on}
    >
      <span className={`absolute top-0.5 ${on ? 'left-[22px]' : 'left-0.5'} w-5 h-5 rounded-full bg-white transition-all`} />
    </button>
  );
}


function CounterOdometer({ value, className = '' }) {
  const DIGIT_H = 40;
  const str = String(Math.max(0, Math.round(value))).padStart(1, '0');

  return (
    <div className={`inline-flex ${className}`} style={{ height: DIGIT_H }}>
      {[...str].map((ch, i) => (
        <div
          key={`digit-${i}`}
          className="relative overflow-hidden"
          style={{ width: '22px', height: DIGIT_H }}
        >
          <div
            className="absolute left-0 top-0 flex flex-col will-change-transform"
            style={{
              transform: `translateY(-${Number(ch) * DIGIT_H}px)`,
              transition: 'transform 500ms cubic-bezier(.12,.8,.22,1)',
            }}
          >
            {Array.from({ length: 10 }, (_, n) => (
              <span
                key={n}
                style={{ height: DIGIT_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                className="text-4xl font-bold text-neutral-100 tabular-nums"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
const SendTimeBadge = memo(function SendTimeBadge({ sendEta, ready, item, scheduleActive }) {
  const now = useClock();
  const fmt = (ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const bestEta = useMemo(() => {
    if (!sendEta && item.status === 'pending') {
      const hold = Number(item.hold_until) || 0;
      const sched = Number(item.scheduled_at) || 0;
      const candidates = [hold, sched].filter(v => v > now);
      return candidates.length ? Math.min(...candidates) : null;
    }
    if (!sendEta) return null;
    const timelineEta = Number(sendEta);
    if (item.status !== 'pending') return timelineEta > now ? timelineEta : null;
    const hold = Number(item.hold_until) || 0;
    const sched = Number(item.scheduled_at) || 0;
    const candidates = [hold, sched, timelineEta].filter(v => v > now);
    return candidates.length ? Math.min(...candidates) : null;
  }, [sendEta, item, now]);

  const label = useMemo(() => {
    if (item.status === 'done' && item.completed_at) return fmt(item.completed_at);
    if (item.status === 'failed' && item.completed_at) return fmt(item.completed_at);
    if (item.status === 'canceled') return null;
    if (bestEta) return fmt(bestEta);
    return 'Siap';
  }, [item, bestEta]);

  if (!label) return null;

  const color = item.status === 'pending' ? 'cyan'
    : item.status === 'done' ? 'emerald'
    : item.status === 'failed' ? 'red' : 'neutral';

  const bgCls = color === 'cyan' ? 'bg-black/60 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(34,211,238,0.3)]'
    : color === 'emerald' ? 'bg-black/60 text-emerald-300 border-emerald-500/40'
    : color === 'red' ? 'bg-black/60 text-red-300 border-red-500/40'
    : 'bg-black/60 text-neutral-300 border-neutral-600/40';

  return (
    <div className="absolute bottom-2 left-2 flex flex-col items-start gap-0.5 z-20">
      <div className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold tracking-wide border backdrop-blur-md ${bgCls}`}>
        {label}
      </div>
    </div>
  );
});

function Odometer({ value, digits = 2, className = '', placeholder = false, format = null, size = 'md', countdown = null, color = 'neutral' }) {
  const isXs = size === 'xs';
  const isSmall = size === 'sm';
  const DIGIT_H = isXs ? 12 : isSmall ? 16 : 40;
  const DIGIT_W = isXs ? 8 : isSmall ? 10 : 22;
  const FONT_CLASS = isXs ? 'text-[10px]' : isSmall ? 'text-[12px]' : 'text-2xl';
  const COLON_W = isXs ? 4 : isSmall ? 6 : 12;
  const CASCADE_DELAY = 80;
  const COLOR_CLASS = color === 'amber' ? 'text-amber-300' : 'text-neutral-100';
  const COLON_COLOR = color === 'amber' ? 'text-amber-300/70' : 'text-neutral-100';

  const stripRefs = useRef([]);
  const rafRef = useRef(null);
  const settleTimerRef = useRef(null);
  const prevPlaceholderRef = useRef(placeholder);
  const stateRef = useRef({
    mode: 'settled',
    currentCountdown: countdown,
    lastPositions: (() => {
      const p = {};
      if (countdown) { let di = 0; [...countdown].forEach((ch) => { if (ch !== ':') { p[di] = placeholder ? 10 * DIGIT_H : Number(ch) * DIGIT_H; di++; } }); }
      return p;
    })(),
  });

  const chars = useMemo(() => {
    if (countdown) {
      return [...countdown].map((ch, i) => ch === ':' ? { type: 'colon', key: `c${i}` } : { type: 'digit', key: `d${i}`, ch, digitIdx: [...countdown].slice(0, i + 1).filter(c => c !== ':').length - 1 });
    }
    if (format) {
      return [...format].map((ch, i) => ch === ':' ? { type: 'colon', key: `c${i}` } : { type: 'digit', key: `d${i}`, digitIdx: format.slice(0, i + 1).replace(/:/g, '').length - 1 });
    }
    return String(Math.max(0, Math.round(value))).padStart(digits, '0').slice(-digits).split('').map((ch, i) => ({ type: 'digit', key: `d${i}`, ch, digitIdx: i }));
  }, [countdown, format, value, digits]);

  const stripDigitMap = useMemo(() => chars.map(c => c.type === 'digit' ? Number(c.ch || '0') : null), [chars]);
  const numDigits = useMemo(() => stripDigitMap.filter(d => d !== null).length, [stripDigitMap]);
  const charsToDigit = useMemo(() => {
    const m = {}; let di = 0;
    stripDigitMap.forEach((d, idx) => { if (d !== null) { m[idx] = di; di++; } });
    return m;
  }, [stripDigitMap]);

  // Mount: set initial positions. When placeholder is true on mount, force all
  // strips to the dash position (index 10) instead of the countdown digits —
  // otherwise the flip-in animation never triggers and the display shows frozen
  // numbers instead of --:--:--.
  useLayoutEffect(() => {
    const st = stateRef.current;
    stripRefs.current.forEach((strip, idx) => {
      if (!strip || stripDigitMap[idx] === null) return;
      if (placeholder) {
        const dashPos = 10 * DIGIT_H;
        strip.style.transform = `translateY(-${dashPos}px)`;
        st.lastPositions[charsToDigit[idx]] = dashPos;
      } else {
        const pos = st.lastPositions[charsToDigit[idx]];
        if (pos !== undefined) strip.style.transform = `translateY(-${pos}px)`;
      }
    });
  }, []);

  // EFFECT 1: Placeholder transitions — flip in cascade / settle out
  useEffect(() => {
    const st = stateRef.current;
    const prev = prevPlaceholderRef.current;

    // === FLIP IN: false→true → cascade digits → --:--:-- ===
    if (placeholder && !prev) {
      st.mode = 'spinning';
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }

      const FLIP_COUNT = 3;
      const flipStates = stripRefs.current.map(() => ({ flips: 0, done: false }));
      const startTime = performance.now();

      const flipTick = (now) => {
        const elapsed = now - startTime;
        let allDone = true;

        stripRefs.current.forEach((strip, idx) => {
          if (!strip || stripDigitMap[idx] === null || flipStates[idx].done) return;
          const delay = idx * CASCADE_DELAY;
          if (elapsed < delay) { allDone = false; return; }
          const localElapsed = elapsed - delay;
          const interval = 60 + idx * 5;
          const expectedFlips = Math.min(FLIP_COUNT, Math.floor(localElapsed / interval));

          if (expectedFlips > flipStates[idx].flips) {
            flipStates[idx].flips = expectedFlips;
            strip.style.transform = `translateY(-${Math.floor(Math.random() * 10) * DIGIT_H}px)`;
          }

          if (flipStates[idx].flips >= FLIP_COUNT) {
            strip.style.transition = 'transform 120ms ease-out';
            strip.style.transform = `translateY(-${10 * DIGIT_H}px)`;
            flipStates[idx].done = true;
          } else {
            allDone = false;
          }
        });

        if (!allDone) {
          rafRef.current = requestAnimationFrame(flipTick);
        } else {
          rafRef.current = null;
          st.mode = 'placeholder';
          setTimeout(() => {
            stripRefs.current.forEach((s) => { if (s) s.style.transition = ''; });
          }, 150);
        }
      };
      rafRef.current = requestAnimationFrame(flipTick);
    }

    // === SETTLE OUT: true→false → CSS transition to countdown ===
    if (!placeholder && prev) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); }
      st.mode = 'settling';

      stripRefs.current.forEach((strip, idx) => {
        if (!strip || stripDigitMap[idx] === null) return;
        const target = stripDigitMap[idx] * DIGIT_H;
        strip.style.transition = `transform 350ms cubic-bezier(.12,.8,.22,1) ${idx * CASCADE_DELAY}ms`;
        strip.style.transform = `translateY(-${target}px)`;
        st.lastPositions[charsToDigit[idx]] = target;
      });

      const totalMs = CASCADE_DELAY * numDigits + 400;
      settleTimerRef.current = setTimeout(() => {
        st.mode = 'settled';
        stripRefs.current.forEach((s) => { if (s) s.style.transition = ''; });
      }, totalMs);
    }

    prevPlaceholderRef.current = placeholder;
  }, [placeholder, stripDigitMap, numDigits, charsToDigit]);

  // EFFECT 2: Countdown tick — smooth digit roll on every change.
  useEffect(() => {
    const st = stateRef.current;
    if (placeholder) {
      if (countdown) st.currentCountdown = countdown;
      return;
    }
    if (!countdown || countdown === st.currentCountdown) return;

    // Force a clean 'settled' state before rolling so the update never snaps:
    // cancel a pending settle-out timer / any rAF, drop leftover CSS transitions,
    // and reset a mode stuck at 'spinning'/'settling' (e.g. a flip-in that got
    // interrupted by a re-render). Without this the digits occasionally jump to
    // the new value instead of rolling.
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    st.mode = 'settled';
    stripRefs.current.forEach((s) => { if (s) s.style.transition = ''; });

    st.currentCountdown = countdown;
    const starts = { ...st.lastPositions };
    const targets = {};
    stripDigitMap.forEach((d, idx) => { if (d !== null) targets[idx] = d * DIGIT_H; });

    const dur = 250;
    const t0 = Date.now();
    const anim = () => {
      const p = Math.min((Date.now() - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      stripRefs.current.forEach((strip, idx) => {
        if (!strip || targets[idx] === undefined) return;
        const from = starts[charsToDigit[idx]] ?? 0;
        const to = targets[idx];
        strip.style.transform = `translateY(-${Math.round(from + (to - from) * e)}px)`;
        st.lastPositions[charsToDigit[idx]] = Math.round(from + (to - from) * e);
      });
      if (p < 1) { rafRef.current = requestAnimationFrame(anim); }
      else { rafRef.current = null; }
    };
    rafRef.current = requestAnimationFrame(anim);
  }, [countdown, placeholder, stripDigitMap, charsToDigit]);

  // Cleanup timers only on unmount — never on dependency changes, so the
  // settle-out timer and flip-in rAF always run to completion even when
  // stripDigitMap changes mid-animation (which previously killed the settle
  // timer and froze the countdown at 'settling' mode forever).
  useEffect(() => {
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    };
  }, []);

  return (
    <div className={`inline-flex items-center ${className}`} style={{ height: DIGIT_H }}>
      {chars.map((item, idx) => {
        if (item.type === 'colon') {
          return (
            <div
              key={item.key}
              className={`flex items-center justify-center font-bold ${COLON_COLOR} ${FONT_CLASS}`}
              style={{ width: COLON_W, height: DIGIT_H }}
            >
              :
            </div>
          );
        }
        return (
          <div
            key={`d${item.digitIdx}`}
            className="relative overflow-hidden"
            style={{ width: DIGIT_W, height: DIGIT_H }}
          >
            <div
              ref={el => { stripRefs.current[idx] = el; }}
              className="absolute left-0 top-0 will-change-transform"
            >
              {Array.from({ length: 11 }, (_, n) => (
                <div
                  key={n}
                  className={`${COLOR_CLASS} tabular-nums ${FONT_CLASS} font-bold flex items-center justify-center`}
                  style={{ width: DIGIT_W, height: DIGIT_H }}
                >
                  {n < 10 ? n : '\u2013'}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stepper({ value, min, max, step = 1, onChange, onCommit, disabled, suffix, render }) {
  const pct = ((value - min) / (max - min)) * 100;
  const commit = () => onCommit && onCommit(value);

  return (
    <div className={`flex items-center gap-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="relative flex-1 h-6 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-neutral-700/70" />
        <div
          className="absolute left-0 h-1.5 rounded-full bg-sky-500"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={commit}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="absolute left-0 right-0 w-full appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-sky-500
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-sky-500"
        />
      </div>
      <div className="flex items-baseline gap-0.5 min-w-[42px] justify-end">
        <span className="text-lg font-bold text-neutral-100 tabular-nums">{value}</span>
        {suffix && <span className="text-[11px] font-medium text-neutral-400">{suffix}</span>}
      </div>
    </div>
  );
}

function Row({ icon: Icon, iconColor, title, desc, children }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0 pr-2">
        <div className="text-sm font-medium text-neutral-100">{title}</div>
        {desc && <div className="text-[11px] text-neutral-500 mt-0.5 leading-snug">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function SettingsModal({ settings, onClose, onApply }) {
  const [tick, setTick] = useState(settings?.tickEnabled ?? true);
  const [debug, setDebug] = useState(settings?.debugMode ?? false);
  const [perDay, setPerDay] = useState(Math.min(5, Math.max(1, settings?.perDay ?? 3)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const intervalSummary = perDay <= 0 ? 'Tanpa batas' : `${perDay}x sehari · tiap ${Math.round(24 / perDay)} jam`;

  const apply = async (patch) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = {
        tickEnabled: patch.tick ?? tick,
        debugMode: patch.debug ?? debug,
        perDay: patch.perDay ?? perDay,
      };
      const res = await setSendSettings(next);
      if (res && res.settings) {
        setTick(res.settings.tickEnabled);
        setDebug(res.settings.debugMode);
        setPerDay(res.settings.perDay);
        onApply && onApply(res.settings);
        const bits = [];
        if (res.held) bits.push(`${res.held} di-hold 8j`);
        if (res.released) bits.push(`${res.released} hold dilepas`);
        // Build the summary from the SAVED value, not the stale closure copy of
        // `perDay` (the +/- buttons pass a different value than the local state).
        const savedPerDay = res.settings.perDay;
        const savedSummary = savedPerDay <= 0 ? 'Tanpa batas' : `${savedPerDay}x sehari · tiap ${Math.round(24 / savedPerDay)} jam`;
        setMsg('Tersimpan' + (bits.length ? ' · ' + bits.join(' · ') : '') + ` · ${savedSummary}`);
      } else {
        setMsg('Gagal menyimpan');
      }
    } catch (e) {
      setMsg('Error: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const stopNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await setSendSettings({ tickEnabled: false, debugMode: false, perDay });
      if (res && res.settings) { setTick(false); setDebug(false); setMsg('Auto-send dihentikan (Stop)'); onApply && onApply(res.settings); }
    } catch (e) {
      setMsg('Error: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md h-[560px] flex flex-col bg-[#0e0e10] border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
            <Settings size={16} className="text-neutral-400" /> Pengaturan Antrian
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-2 divide-y divide-neutral-800/70 flex-1 overflow-y-auto">
          {/* Frekuensi */}
          <div className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={15} className="text-sky-400" />
              <span className="text-sm font-medium text-neutral-100">Frekuensi kirim otomatis</span>
            </div>
            {/* Odometer display + stepper buttons */}
            <div className="flex items-center justify-center gap-3 mb-4">
              <button
                type="button"
                aria-label="Kurangi"
                disabled={busy || perDay <= 1}
                onClick={() => apply({ perDay: Math.max(1, perDay - 1) })}
                className="w-9 h-9 shrink-0 rounded-xl bg-neutral-800/60 border border-neutral-700 text-neutral-200 text-lg leading-none
                  hover:text-white hover:bg-neutral-700/60 active:scale-95 active:bg-neutral-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                −
              </button>
              <div className="flex items-baseline justify-center min-w-[40px]">
                <Odometer value={perDay} digits={1} />
              </div>
              <button
                type="button"
                aria-label="Tambah"
                disabled={busy || perDay >= 6}
                onClick={() => apply({ perDay: Math.min(6, perDay + 1) })}
                className="w-9 h-9 shrink-0 rounded-xl bg-neutral-800/60 border border-neutral-700 text-neutral-200 text-lg leading-none
                  hover:text-white hover:bg-neutral-700/60 active:scale-95 active:bg-neutral-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
            {/* Slider — track fill follows the real thumb center (compensates 16px thumb) */}
            <div className="relative h-5 flex items-center">
              <div className="absolute left-2 right-2 h-1.5 rounded-full bg-neutral-700/70" />
              <div
                className="absolute left-2 h-1.5 rounded-full bg-sky-500"
                style={{ width: `calc(8px + ${((perDay - 1) / 5) * 100}% * (100% - 32px) / 100%)` }}
              />
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={perDay}
                disabled={busy}
                onChange={(e) => { setPerDay(Number(e.target.value)); setMsg(null); }}
                onPointerUp={() => apply({ perDay })}
                onMouseUp={() => apply({ perDay })}
                onTouchEnd={() => apply({ perDay })}
                className="absolute inset-0 w-full appearance-none bg-transparent cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-sky-500 [&::-webkit-slider-thumb]:shadow
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-sky-500"
              />
            </div>
            <div className="mt-3 text-[11px] text-neutral-500 leading-snug text-center">
              {`Setiap ${(24 / perDay).toFixed(1).replace(/\.0$/, '')} jam · maks ${perDay} kirim/hari · jadwal dari 00:00.`}
            </div>
          </div>

          {/* Auto-send */}
          <Row
            icon={tick ? Play : Power}
            iconColor={tick ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-700/40 text-neutral-500'}
            title="Auto-send (Tick)"
            desc="Jadwal otomatis mengirim antrian. Mati = tidak kirim otomatis."
          >
            <Toggle on={tick} color="emerald" disabled={busy} onClick={() => apply({ tick: !tick })} />
          </Row>

          {/* Bagikan hanya ke */}
          <Row
            icon={Bug}
            iconColor={debug ? 'bg-amber-500/15 text-amber-400' : 'bg-neutral-700/40 text-neutral-500'}
            title="Bagikan hanya ke"
            desc="Semua kiriman langsung dikirim tanpa antri. Berguna untuk kirim cepat tanpa batas rate."
          >
            <Toggle on={debug} color="amber" disabled={busy} onClick={() => apply({ debug: !debug })} />
          </Row>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-800 space-y-3 flex-shrink-0">
          <button
            onClick={stopNow}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600/90 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <Square size={14} /> Stop sekarang
          </button>
          <div className="text-center text-xs text-emerald-400 h-4">{msg}</div>
          <div className="text-[10px] text-neutral-600 text-center">
            {debug ? 'Mode share-only: Status WA di-override, langsung dikirim (tanpa antri).' : 'Kirim manual tetap jalan.'}
          </div>
        </div>
      </div>
    </div>
  );
}

// Parse the current queue URL: #/sendqueue[/<group>/<status>[/<qid>]]
function parseQueueHash() {
  const parts = (window.location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'sendqueue') return { group: null, status: null, qid: null };
  return { group: parts[1] || null, status: parts[2] || null, qid: parts[3] || null };
}

// Merge a freshly-fetched first page into the currently-loaded list WITHOUT
// dropping the deeper pages the user already scrolled to and WITHOUT producing
// duplicates. The server page arrives in current sort order, so any item that is
// present both in the fresh page and in the existing list keeps the FRESH
// (updated) instance and takes its position from the fresh page (this is what
// makes newly-arrived / status-changed items surface at the top live). Items
// that only exist in the previously-loaded deeper pages are kept at the tail.
function mergeRefresh(prev, fresh) {
  const seen = new Set();
  const out = [];
  const freshById = new Map();
  for (const it of fresh) freshById.set(it.qid, it);
  for (const it of fresh) {
    if (seen.has(it.qid)) continue;
    seen.add(it.qid);
    out.push(it);
  }
  for (const p of prev) {
    if (seen.has(p.qid)) continue;
    seen.add(p.qid);
    out.push(freshById.has(p.qid) ? freshById.get(p.qid) : p);
  }
  return out;
}
// Write a queue URL. replace=true swaps history (e.g. when opening an item
// without adding a new back entry we still want reload to land on the item).
function writeQueueUrl(group, status, qid = null, replace = false) {
  let hash = '/sendqueue';
  if (group && status) {
    hash += `/${group}/${status}`;
    if (qid) hash += `/${qid}`;
  }
  const url = '#' + hash;
  if (window.location.hash === url) return;
  const data = { view: 'sendqueue', group, status, qid };
  if (replace) history.replaceState(data, '', url);
  else history.pushState(data, '', url);
}

export default function SendQueueView({ onMenuOpen, onToggleFavorite }) {
  const { showToast } = useToast();
  const initHash = parseQueueHash();
  const initSelected = (initHash.group && initHash.status)
    ? { groupKey: initHash.group, status: initHash.status }
    : null;
  const [selected, setSelected] = useState(initSelected); // { groupKey, status }
  const [counts, setCounts] = useState({ wa: null, telegram: null });
const [items, setItems] = useState([]);
   const [cursor, setCursor] = useState(0);
   const [hasMore, setHasMore] = useState(false);
   const [loading, setLoading] = useState(false);
   const [everLoaded, setEverLoaded] = useState(false);
  const [covers, setCovers] = useState({ wa: {}, telegram: {} });
  const [selectedItem, setSelectedItem] = useState(null);
   const [policy, setPolicy] = useState(null);
   const [timeline, setTimeline] = useState([]);
   const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
   const [waStatus, setWaStatus] = useState(null); // { connected, reconnecting, ... }
   const [internet, setInternet] = useState(true);
   const [sortBy, setSortBy] = useState(null);
   const [sortOrder, setSortOrder] = useState("desc");
   const [typeFilter, setTypeFilter] = useState(null);
   const [rescheduleItem, setRescheduleItem] = useState(null);
   const [showRescheduleModal, setShowRescheduleModal] = useState(false);
    // const scrollRef = useRef(null); // removed – scroll handled by react-window

  // Surface WA connection state in the queue UI: if WhatsApp drops while debug
  // mode is on, sends fail silently-ish — the user needs to know immediately
  // (and that they should re-scan the QR in the Bot menu), instead of a queue
  // full of failed test sends.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await getWhatsAppSendStatus();
        if (alive) setWaStatus(d);
      } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Keep the rate-limit policy (nextAllowedAt) fresh every second so the Antrian
  // countdown ticks smoothly without re-fetching covers/items.
  useEffect(() => {
    let alive = true;
    const tickPolicy = async () => {
      try {
        const d = await getSendQueueStatuses('whatsapp,channel,status,all');
        if (alive && d) {
          if (d.policy) setPolicy(d.policy);
          if (d.timeline) setTimeline(d.timeline);
        }
      } catch {}
    };
    tickPolicy();
    const t = setInterval(tickPolicy, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Refresh immediately whenever a send happens anywhere in the app (player,
  // image viewer, music, queue actions) — without needing a tab reload.
  const refreshRef = useRef(() => {});
  const flipAndRefreshRef = useRef(null);
  useEffect(() => {
    const onChanged = () => {
      if (flipAndRefreshRef.current) flipAndRefreshRef.current();
      else refreshRef.current();
    };
    window.addEventListener('media-vault:send-changed', onChanged);
    return () => window.removeEventListener('media-vault:send-changed', onChanged);
  }, []);

  // Counts + policy only (cheap, no item fetch). Runs on a stable interval so the
  // Antrian/Terkirim badges always reflect reality — decoupled from `cursor` so it
  // never gets reset mid-scroll and goes stale.
  const prevCountsRef = useRef(null);
  const prevPolicyRef = useRef(null);
  const prevTimelineRef = useRef(null);
  const loadCounts = useCallback(async () => {
    try {
      const out = {};
      let pol = null;
      let tline = [];
      for (const g of GROUP_ORDER) {
        const d = await getSendQueueStatuses(g.target);
        out[g.key] = d.counts;
        if (g.key === 'wa') {
          pol = d.policy;
          tline = d.timeline || [];
        }
      }
      const newCounts = { wa: out.wa, telegram: out.telegram };
      const newCountsJson = JSON.stringify(newCounts);
      if (newCountsJson !== prevCountsRef.current) {
        prevCountsRef.current = newCountsJson;
        setCounts(newCounts);
      }
      const newPolicyJson = JSON.stringify(pol);
      if (newPolicyJson !== prevPolicyRef.current) {
        prevPolicyRef.current = newPolicyJson;
        setPolicy(pol);
      }
      const newTimelineJson = JSON.stringify(tline);
      if (newTimelineJson !== prevTimelineRef.current) {
        prevTimelineRef.current = newTimelineJson;
        setTimeline(tline);
      }
      if (d.internet !== undefined) setInternet(d.internet);
    } catch {}
  }, []);

  // Cover thumbnails per non-pending status (best-effort, separate from counts).
  const prevCoversRef = useRef(null);
  const loadCovers = useCallback(async () => {
    try {
      const c = {};
      for (const g of GROUP_ORDER) {
        const cov = {};
        for (const s of g.statuses) {
          if (s === 'pending') continue;
          try {
            const r = await getSendQueue(s, 0, 1, g.target);
            if (r.items && r.items[0]) cov[s] = r.items[0].file_id;
          } catch {}
        }
        c[g.key] = cov;
      }
      const cJson = JSON.stringify(c);
      if (cJson !== prevCoversRef.current) {
        prevCoversRef.current = cJson;
        setCovers(c);
      }
    } catch {}
  }, []);

  const prevItemsJsonRef = useRef(null);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  // Track the last loaded sentinel ID to avoid duplicate loads
  const lastLoadedRef = useRef(null);
  // True once the user has scrolled and appended pages beyond the first page.
  // While set, the 2s poll must NOT reset-replace the list (that would wipe the
  // appended pages and make the strip repeat the first batch forever).
  const loadedMoreRef = useRef(false);
  // Mutable ref mirroring the items state for stable scroll callbacks
  const itemsRef = useRef([]);
  const loadItems = useCallback(async (groupKey, status, reset) => {
    const g = GROUPS[groupKey];
    if (!g) return;
    // Only show loading spinner on initial/fresh loads, not on2s refreshes.
    // Without this, every 2s tick briefly flashes "Memuat…" over the grid.
    if (reset && !prevItemsJsonRef.current) setLoading(true);
    const myId = ++requestIdRef.current;
    try {
      loadingMoreRef.current = true;
      const currentCursor = reset ? 0 : cursorRef.current;
      const r = await getSendQueue(status, currentCursor, 5000, g.target, { sortBy, sortOrder, typeFilter });
      if (myId !== requestIdRef.current) return;
      const list = (r && Array.isArray(r.items)) ? r.items : [];
      const listJson = JSON.stringify(list);
      if (listJson !== prevItemsJsonRef.current) {
        prevItemsJsonRef.current = listJson;
        if (reset) {
          // Reset = fetch the CURRENT first page. If the user has scrolled and
          // appended deeper pages, MERGE the fresh page into the front (live
          // status updates + newly-arrived items at top) WITHOUT dropping the
          // deeper pages and WITHOUT producing duplicates. If we're on a fresh
          // selection with nothing appended, just replace.
          setItems(loadedMoreRef.current
            ? (cur) => mergeRefresh(cur, list)
            : list);
          setEverLoaded(true);
        } else {
          // Append (defensive): never add an id we already hold, so a backend
          // that ever returns an overlapping/identical page can't double the list.
          setItems((prev) => {
            if (list.length > 0) loadedMoreRef.current = true;
            const seen = new Set(prev.map((p) => p.qid));
            const fresh = list.filter((it) => !seen.has(it.qid));
            if (fresh.length === 0) return prev;
            return [...prev, ...fresh];
          });
          setEverLoaded(true);
        }
      }
      // Keep the cursor pointing past the deepest appended page after a live
      // merge, so "load more" continues from the end instead of re-requesting.
      // A plain first-page reset (or a first-load replace) updates the cursor
      // normally.
      if (!(reset && loadedMoreRef.current)) {
        setCursor(r && r.nextCursor ? r.nextCursor : 0);
        setHasMore(!!(r && r.nextCursor));
      }
    } catch {
      // On error, keep existing items instead of clearing - prevents flicker on temp network issue
    } finally {
      loadingMoreRef.current = false;
      setLoading(false);
    }
  }, [sortBy, sortOrder, typeFilter]);

  // Keep a mutable ref of the current items array for the scroll handler
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const loadStatuses = useCallback(async () => {
    await loadCounts();
    await loadCovers();
  }, [loadCounts, loadCovers]);

  // Keep latest callbacks/selection in refs so the polling interval can use a
  // STABLE (empty) dependency list and run uninterrupted for the component's
  // whole lifetime. Previously the interval was torn down/re-created whenever
  // `cursor`/`selected` changed (loadItems is recreated on every cursor update),
  // which could leave no active interval — causing badges + lists to go stale
  // until a full page reload.
  const loadCountsRef = useRef(loadCounts);
  const loadCoversRef = useRef(loadCovers);
  const loadItemsRef = useRef(loadItems);
  const selectedRef = useRef(selected);
  const selectedItemRef = useRef(selectedItem);
  loadCountsRef.current = loadCounts;
  loadCoversRef.current = loadCovers;
  loadItemsRef.current = loadItems;
  selectedRef.current = selected;
  selectedItemRef.current = selectedItem;

  const refresh = useCallback(() => {
    loadStatuses();
    // Return the loadItems promise so callers (e.g. flipAndRefresh) can await
    // the data commit before measuring layout for the FLIP animation.
    if (selected) return loadItems(selected.groupKey, selected.status, true);
  }, [loadStatuses, loadItems, selected]);
  refreshRef.current = refresh;

// Live-refresh: counts + covers every 2s, and the open folder's items too, so
// a send made elsewhere shows up without a manual reload.
// Skip item refresh while the grid is being scrolled to avoid jank.
useEffect(() => {
  const tick = () => {
    loadCountsRef.current();
    loadCoversRef.current();
    // Drive the open folder's items through FLIP so background reorders
    // (e.g. auto-send pushing a freshly-sent item to the top of its status
    // folder) slide smoothly instead of hard-cutting the grid down.
    liveRefreshRef.current();
  };
  tick();
  const t = setInterval(tick, 2000);
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && selectedRef.current && !scrollingRef.current && !selectedItemRef.current) {
      loadItemsRef.current(selectedRef.current.groupKey, selectedRef.current.status, true);
    }
  };
  const onFocus = () => {
    if (selectedRef.current && !scrollingRef.current && !selectedItemRef.current) {
      loadItemsRef.current(selectedRef.current.groupKey, selectedRef.current.status, true);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onFocus); };
}, []);

  // Load queue behaviour settings (tick / debug) on mount + when modal opens.
  useEffect(() => {
    (async () => {
      try {
        const d = await getSendSettings();
        if (d && d.settings) setSettings(d.settings);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (showSettings) {
      (async () => {
        try {
          const d = await getSendSettings();
          if (d && d.settings) setSettings(d.settings);
        } catch {}
      })();
    }
  }, [showSettings]);

useEffect(() => {
  loadedMoreRef.current = false;
  if (selected) loadItems(selected.groupKey, selected.status, true);
}, [selected]);

  // On reload landing directly on an item URL (#/sendqueue/<g>/<s>/<qid>),
  // re-open the player once the folder's items have loaded.
  const initQidRef = useRef(parseQueueHash().qid);
  useEffect(() => {
    const qid = initQidRef.current;
    if (qid && !selectedItem && items.length) {
      const found = items.find((it) => it.qid === qid);
      if (found) { setSelectedItem(found); initQidRef.current = null; }
    }
  }, [items, selectedItem]);

const openStatus = (groupKey, status) => {
  lastLoadedRef.current = null;
  setSelected({ groupKey, status });
  setSortBy(null);
  setSortOrder('desc');
  setTypeFilter(null);
  writeQueueUrl(groupKey, status);
};
  const back = () => {
    setSelected(null);
    setSortBy(null);
    setSortOrder('desc');
    setTypeFilter(null);
    writeQueueUrl(null, null);
  };

  const onAction = async (action, item) => {
    const id = item.qid;
    // Optimistic UI updates for reorder (visual move before the backend commit).
    let optimisticPatch = null;
    if (action === 'moveUp' || action === 'moveDown') {
      const idx = items.findIndex((it) => it.qid === id);
      if (idx > 0 && action === 'moveUp') {
        optimisticPatch = { fromIdx: idx, toIdx: idx - 1 };
      } else if (idx >= 0 && idx < items.length - 1 && action === 'moveDown') {
        optimisticPatch = { fromIdx: idx, toIdx: idx + 1 };
      }
    }
    const applyLocal = () => {
      // Apply the optimistic reorder before refresh. Status flips for
      // retry/resend are NOT applied here — they only happen after a
      // successful backend call (see below) so a failed retry never shows
      // a fake "Siap".
      if (optimisticPatch) {
        setItems((prev) => {
          const next = [...prev];
          const [moved] = next.splice(optimisticPatch.fromIdx, 1);
          next.splice(optimisticPatch.toIdx, 0, moved);
          return next;
        });
      }
    };
    const flipToPending = () => {
      setItems((prev) => prev.map((it) => it.qid === id ? { ...it, status: 'pending' } : it));
    };
    try {
      if (action === 'moveUp' || action === 'moveDown') {
        // Slide the moved card(s) to their new grid position via FLIP.
        await flipAndRefresh(async () => {
          if (action === 'moveUp') await reorderQueueItem(id, 'up');
          if (action === 'moveDown') await reorderQueueItem(id, 'down');
          applyLocal();
        });
        return;
      }
      if (action === 'cancel') await cancelSendQueueItem(id);
      if (action === 'retry') await retrySendQueueItem(id);
      if (action === 'remove') await removeSendQueueItem(id);
      if (action === 'resend') await resendQueueItem(id);
      if (action === 'reschedule') {
        if (item && item.status === 'pending') {
          setRescheduleItem(item);
          setShowRescheduleModal(true);
        }
      }
      // Only now (success) flip a failed item to "pending" for retry/resend.
      if (action === 'retry' || action === 'resend') flipToPending();
      refresh();
    } catch (err) {
      // Surface the real backend error instead of lying with "Siap".
      if (action === 'retry' || action === 'resend' || action === 'cancel' || action === 'remove') {
        const msg = err?.message || 'Tindakan gagal';
        showToast({ message: msg, type: 'error', duration: 6000 });
      }
      // Reconcile to the true server state.
      refresh();
    }
  };

  const handleCaptionChange = async (item, caption) => {
    if (caption === (item.caption || '')) return;
    try {
      await setQueueCaption(item.qid, caption);
      setItems((prev) => prev.map((it) => it.qid === item.qid ? { ...it, caption } : it));
      if (selectedItem?.qid === item.qid) setSelectedItem((cur) => cur ? { ...cur, caption } : cur);
    } catch {}
  };

  // Refresh the list when a queue action happens inside the player, and reflect
  // the item's possibly-changed status back onto the open player. If the current
  // item was removed, advance to the next item in the list instead of keeping
  // a stale selection.
  const onDetailChanged = () => {
    refresh();
    setSelectedItem((cur) => {
      if (!cur) return cur;
      const currentItems = itemsRef.current;
      const updated = currentItems.find((it) => it.qid === cur.qid);
      if (updated) return updated;
      return cur;
    });
  };

  // Auto-advance selection when the current item is no longer in the refreshed
  // list (e.g. after a remove action from the grid or the player).
  useEffect(() => {
    if (!selectedItem) return;
    const stillInList = items.some((it) => it.qid === selectedItem.qid);
    if (!stillInList && items.length > 0) {
      const next = items[0];
      if (next) openItemRef.current(next);
    }
  }, [items, selectedItem]);

  const openItem = (item) => {
    setSelectedItem(item);
    if (item?.qid) writeQueueUrl(selected?.groupKey, selected?.status, item.qid);
  };
  const closeItem = () => {
    setSelectedItem(null);
    writeQueueUrl(selected?.groupKey, selected?.status);
  };

  // O(1) timeline lookup instead of timeline.find() per item
  const timelineMap = useMemo(() => {
    const m = {};
    for (const t of timeline) m[t.id] = t;
    return m;
  }, [timeline]);

  // Map queue item id -> its real send ETA (from backend timeline). Most pending
  // items have scheduled_at = NULL, so their true slot comes from the timeline.
  const etaMap = useMemo(() => {
    const m = {};
    for (const t of timeline) m[t.id] = t.eta;
    return m;
  }, [timeline]);

  // Stable callback refs so memoized ItemCards don't re-render on every parent tick
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const handleCaptionChangeRef = useRef(handleCaptionChange);
  handleCaptionChangeRef.current = handleCaptionChange;
  const openItemRef = useRef(openItem);
  openItemRef.current = openItem;

  const stableOnAction = useCallback((action, item) => onActionRef.current(action, item), []);
  const stableOnCaptionChange = useCallback((item, c) => handleCaptionChangeRef.current(item, c), []);
  const stableOnOpen = useCallback((item) => openItemRef.current(item), []);

  // Removed scroll handler – infinite loading now handled via react-window onItemsRendered

  // Tracks react-window's isScrolling so the shared countdown clock can be
  // paused while the user scrolls (keeps the grid light during fast scrolling).
  const scrollingRef = useRef(false);

  // Maps each mounted card's qid -> its react-window wrapper element so we can
  // run a FLIP animation (capture positions, then slide to the new ones) when
  // items are reordered / rescheduled. Off-screen cards aren't mounted, so
  // they simply snap into place instead of sliding.
  const cardElsRef = useRef(new Map());

  // Resume the clock when leaving the folder grid back to the folder cards.
  useEffect(() => {
    if (!selected) {
      scrollingRef.current = false;
      setClockPaused(false);
    }
  }, [selected]);

  // Never leak a paused clock into other views on unmount.
  useEffect(() => {
    return () => {
      scrollingRef.current = false;
      setClockPaused(false);
    };
  }, []);

  // FLIP helpers: capture the current on-screen rect of every mounted card,
  // then after a layout change animate each card from its old position to the
  // new one. Only mounted (visible) cards can animate.
  const captureRects = useCallback(() => {
    const snap = new Map();
    cardElsRef.current.forEach((el, qid) => {
      snap.set(qid, el.getBoundingClientRect());
    });
    return snap;
  }, []);

  const flipTo = useCallback((snap) => {
    snap.forEach((prev, qid) => {
      const el = cardElsRef.current.get(qid);
      if (!el) return; // off-screen (not mounted) -> snap instead of slide
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Force reflow so the starting transform is committed before animating.
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 320ms ease';
        el.style.transform = '';
      });
      const cleanup = () => {
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', cleanup);
      };
      el.addEventListener('transitionend', cleanup);
      setTimeout(cleanup, 400); // fallback if transitionend doesn't fire
    });
  }, []);

  const flipAndRefresh = useCallback(async (fn) => {
    const snap = captureRects();
    await fn();
    // Two frames so the post-refresh layout is committed before measuring.
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    flipTo(snap);
  }, [captureRects, flipTo]);

  // Send-made-elsewhere refresh (media-vault:send-changed): FLIP so the newly
  // inserted card doesn't hard-cut in and shove the others down abruptly. The
  // 2s tick handles background reorders; this handles the immediate send event.
  flipAndRefreshRef.current = () => {
    if (selectedItemRef.current) { refresh(); return; } // don't churn the open player
    if (scrollingRef.current) { refresh(); return; }    // keep fast scrolling light
    flipAndRefresh(() => refresh());
  };

  // Background live-refresh (the 2s tick) wrapped in FLIP so reorders caused by
  // auto-send / other live sends animate smoothly. Without this, react-window
  // hard-cuts cards to their new index positions — the grid appears to "jump
  // down" abruptly with a clipped/cut animation and feels janky. Cards that
  // didn't move are skipped by flipTo, and we bail out of concurrent FLIPs so
  // two ticks can't fight each other mid-animation.
  const flippingRef = useRef(false);
  const liveRefreshRef = useRef(async () => {});
  liveRefreshRef.current = async () => {
    const sel = selectedRef.current;
    if (!sel) return;
    if (selectedItemRef.current) return; // don't churn the open player
    if (scrollingRef.current) return;   // keep fast scrolling light
    if (flippingRef.current) return;
    flippingRef.current = true;
    try {
      const snap = captureRects();
      await loadItemsRef.current(sel.groupKey, sel.status, true);
      // Two frames so the post-refresh layout is committed before measuring.
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      // Only freeze the per-second ETA clock + run the heavy FLIP slide when a
      // card actually moved. Most 2s refreshes change nothing, so leave them
      // invisible: the countdown keeps ticking every second (light, no stutter).
      let moved = false;
      snap.forEach((prev, qid) => {
        const el = cardElsRef.current.get(qid);
        if (!el) return;
        const now = el.getBoundingClientRect();
        if (Math.abs(prev.left - now.left) >= 1 || Math.abs(prev.top - now.top) >= 1) moved = true;
      });
      if (!moved) {
        flippingRef.current = false;
        return;
      }
      setClockPaused(true);
      flipTo(snap);
      // Release after the 320ms slide finishes so the next tick can FLIP again.
      setTimeout(() => { flippingRef.current = false; setClockPaused(false); }, 360);
    } catch {
      flippingRef.current = false;
    }
  };

  const selectedGroup = selected ? GROUPS[selected.groupKey] : null;
  const selectedMeta = selected ? STATUS_META[selected.status] : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" style={{ background: '#0a0a0a' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 flex-shrink-0">
        {/* Hamburger menu - only visible at root level (not inside a folder) */}
        {!selected && (
          <button onClick={onMenuOpen} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors flex-shrink-0 focus:outline-none focus:ring-0" title="Menu">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        {selected && (
          <button onClick={back} className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 focus:outline-none focus:ring-0" title="Kembali">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-neutral-100">
            {selected ? `${selectedGroup.label} · ${selectedMeta.label}` : 'Antrian Kirim'}
          </h1>
{selected && (
              <span className="px-2.5 py-1 text-[12px] font-mono text-neutral-300 bg-neutral-800/60 rounded border border-neutral-700">
                { (counts[selected?.groupKey] && counts[selected?.groupKey][selected?.status]) || 0 } item
              </span>
            )}
        </div>

        <div className="flex-1" />
        {!selected && (
          <>
            <button
              onClick={() => setShowSettings(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border focus:outline-none focus:ring-0 ${
                settings?.debugMode
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : settings && !settings.tickEnabled
                  ? 'bg-red-500/15 border-red-500/40 text-red-300'
                  : 'bg-neutral-800/70 border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-700/70'
              }`}
              title="Pengaturan antrian (tick / stop / debug)"
            >
              <Settings size={14} />
              {settings?.debugMode ? 'Share' : settings && !settings.tickEnabled ? 'Stop' : 'Setelan'}
            </button>
            <button
              onClick={async () => { await clearSendQueueHistory(); refresh(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-neutral-800/70 border border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-700/70 focus:outline-none focus:ring-0"
              title="Hapus semua riwayat (selain antrian)"
            >
              <Trash2 size={14} /> Bersihkan riwayat
            </button>
          </>
        )}
      </div>

      {/* Internet connection warning */}
      {!internet && (
        <div className="px-4 pt-3">
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs bg-red-500/10 border-red-500/30 text-red-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Tidak ada koneksi internet</div>
              <div className="opacity-80 mt-0.5">
                Semua pengiriman dijeda. Antrian akan otomatis dilanjutkan saat internet tersedia.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WA connection warning — critical in debug mode since sends fail
          silently-ish when WhatsApp is disconnected. */}
      {waStatus && !waStatus.connected && (
        <div className="px-4 pt-3">
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            settings?.debugMode
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">
                WhatsApp {waStatus.reconnecting ? 'terputus — mencoba hubungkan ulang…' : 'tidak terhubung'}
              </div>
              <div className="opacity-80 mt-0.5">
                {settings?.debugMode
                  ? 'Debug mode aktif: kirim WA akan gagal sampai terhubung. Scan ulang QR di menu Bot.'
                  : 'Kirim otomatis WA tidak akan jalan sampai terhubung. Scan ulang QR di menu Bot.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4" style={{ minHeight: 0 }}>
        {!selected ? (
          <div className="space-y-8 max-w-4xl">
            {GROUP_ORDER.map((g) => (
              <div key={g.key}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-neutral-300">{g.label}</h2>
                  <div className="flex-1 h-px bg-neutral-800" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {g.statuses.map((s) => (
                    <StatusFolderCard
                      key={s}
                      meta={STATUS_META[s]}
                      count={(counts[g.key] && counts[g.key][s]) || 0}
                      coverId={covers[g.key] ? covers[g.key][s] : null}
                      policy={g.key === 'wa' ? policy : null}
                      timeline={g.key === 'wa' ? timeline : []}
                      scheduleActive={settings?.tickEnabled && !settings?.debugMode}
                      onClick={() => openStatus(g.key, s)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
) : (
           <div className="h-full max-w-[1100px] mx-auto">
              {items.length === 0 && !loading && !everLoaded ? (
               <div className="text-center text-neutral-500 py-20">Tidak ada item di status ini.</div>
             ) : (
               <AutoSizer>
                  {({ height, width }) => {
                    const GUTTER = 16; // gap between cards (matches the old gap-4 grid)
                    const SCROLLBAR = 20; // reserve room for react-window's vertical
                                          // scrollbar so the grid content never overflows
                                          // horizontally (which drew a horizontal slider +
                                          // a white corner box where both sliders met).
                    const META_HEIGHT = 88; // fixed metadata block (name / date / ETA / caption)
                    const columnCount = width >= 768 ? 4 : width >= 640 ? 3 : 2;
                    // Card width = available width minus reserved scrollbar minus the gutters
                    // between columns. Total content width stays <= width so no horizontal scroll.
                    const cardW = Math.max(1, Math.floor((width - SCROLLBAR - (columnCount - 1) * GUTTER) / columnCount));
                    const cardH = cardW + META_HEIGHT; // square thumbnail (1:1, = cardW) + metadata
                    const columnWidth = cardW + GUTTER;
                    const rowHeight = cardH + GUTTER;
                    // Real rows of actual items, plus a reserved scroll zone at the
                    // bottom (2 empty rows). When the user reaches the end they see
                    // safe blank space, and appended items render into that zone
                    // seamlessly instead of pushing/jumping up against the page edge.
                    const REAL_ROWS = Math.max(1, Math.ceil(items.length / columnCount));
                    const RESERVE_ROWS = 2;
                    const rowCount = REAL_ROWS + RESERVE_ROWS;
                    // How many rows before the real end we start fetching the next
                    // page. Because row height = card height (~180-400px), a small
                    // prefetch here hides the network latency / big-append recompute,
                    // so the user never scrolls into an empty gap or a slow stall.
                    const PREFETCH_ROWS = 3;
                    const handleItemsRendered = ({ visibleRowStopIndex }) => {
                      // Start loading as soon as we get near the last real item
                      // (the reserved rows are only scroll-cushion, not content).
                      if (visibleRowStopIndex >= REAL_ROWS - PREFETCH_ROWS && !loadingMoreRef.current) {
                        const sel = selectedRef.current;
                        if (sel) {
                          const last = itemsRef.current[itemsRef.current.length - 1];
                          const sentinel = last ? last.qid : null;
                          if (!sentinel || sentinel !== lastLoadedRef.current) {
                            lastLoadedRef.current = sentinel;
                            loadItemsRef.current(sel.groupKey, sel.status, false);
                          }
                        }
                      }
                    };
                    return (
                      <Grid
                        height={height}
                        width={width}
                        columnCount={columnCount}
                        rowCount={rowCount}
                        columnWidth={columnWidth}
                        rowHeight={rowHeight}
                        onItemsRendered={handleItemsRendered}
                        overscanRowCount={1}
                        useIsScrolling
                        style={{ overflowX: 'hidden' }}
                      >
                        {({ columnIndex, rowIndex, style, isScrolling }) => {
                          // Pause the shared countdown clock while scrolling so the
                          // ~20 mounted cards don't re-render + run flip animations
                          // every second (the main cause of scroll jank).
                          if (isScrolling !== scrollingRef.current) {
                            scrollingRef.current = isScrolling;
                            setClockPaused(isScrolling);
                          }
                          const idx = rowIndex * columnCount + columnIndex;
                          const it = items[idx];
                          if (!it) return null;
                          const timelineItem = timelineMap[it.qid];
                          const isLastCol = columnIndex === columnCount - 1;
                          const isLastRow = rowIndex === rowCount - 1;
                          return (
                            <div
                              ref={(el) => { if (el) cardElsRef.current.set(it.qid, el); else cardElsRef.current.delete(it.qid); }}
                              style={{ ...style, paddingRight: isLastCol ? 0 : GUTTER, paddingBottom: isLastRow ? 0 : GUTTER }}
                            >
                              <ItemCard
                               key={it.qid}
                               item={it}
                               index={idx}
                               isScrolling={isScrolling}
                               onOpen={stableOnOpen}
                               onAction={stableOnAction}
                               onCaptionChange={stableOnCaptionChange}
                               sendEta={timelineItem?.eta}
                               ready={timelineItem?.ready}
                               scheduleActive={settings?.tickEnabled && !settings?.debugMode}
                             />
                           </div>
                         );
                       }}
                     </Grid>
                   );
                 }}
               </AutoSizer>
            )}
            {loading && <div className="text-center text-neutral-500 py-6">Memuat…</div>}
          </div>
        )}
      </div>

      {selectedItem && (
        <SendQueuePlayer
          item={selectedItem}
          folderFiles={items}
          onNavigate={openItem}
          onClose={closeItem}
          onChanged={onDetailChanged}
          onCaptionChange={handleCaptionChange}
          onToggleFavorite={onToggleFavorite}
          onReschedule={(it) => { if (it && it.status === 'pending') { setRescheduleItem(it); setShowRescheduleModal(true); } }}
        />
      )}

      {showRescheduleModal && (
        <RescheduleModal
          open={showRescheduleModal}
          item={rescheduleItem}
          allItems={items}
          etaMap={etaMap}
          onClose={() => { setShowRescheduleModal(false); setRescheduleItem(null); }}
          onConfirm={async (qid, timestamp) => {
            await flipAndRefresh(async () => {
              await rescheduleQueueItem(qid, timestamp);
              setShowRescheduleModal(false);
              setRescheduleItem(null);
              await refresh();
            });
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onApply={(s) => setSettings(s)}
        />
      )}
    </div>
  );
}
