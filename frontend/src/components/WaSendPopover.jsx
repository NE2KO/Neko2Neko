import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendToStatus, sendToChannel, sendToWhatsApp, sendToAll, getSendQueueStatuses, getSendQueue } from '../utils/api';
import './WaSendPopover.css';

const TARGET_LABEL = {
  status: 'Status',
  channel: 'Channel',
  whatsapp: 'WhatsApp',
  all: 'Semua',
};

function fmtClock(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDatetime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return `${date}, ${fmtClock(ms)}`;
}

function etaCountdown(ms) {
  if (!ms) return 'segera';
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s <= 0) return 'segera';
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam ${m % 60} mnt`;
  return `${Math.floor(h / 24)} hari`;
}

export default function WaSendPopover({
  fileId,
  target = 'status',
  disabled = false,
  className = '',
  children,
  align = 'right',
  onResult = null,
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | loading | result | error
  const [kind, setKind] = useState(null);
  // null = not blocked, 'queued' = already in queue, 'sent' = already sent once.
  const [blocked, setBlocked] = useState(null);
  const autoCloseTimer = useRef(null);
  const containerRef = useRef(null);
  const seq = useRef(0);

  const clearAutoClose = useCallback(() => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    autoCloseTimer.current = null;
  }, []);

  const close = useCallback(() => {
    seq.current++;
    clearAutoClose();
    setOpen(false);
    setPhase('idle');
    setKind(null);
  }, [clearAutoClose]);

  // Keep the disable-state fresh: if this file is already pending in the queue
  // or was already sent to this target, the button is disabled so the user can't
  // double-send.
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    (async () => {
      const [st, done] = await Promise.all([
        getSendQueueStatuses('whatsapp,channel,status,all').catch(() => ({})),
        getSendQueue('done', 0, 100, target).catch(() => ({ items: [] })),
      ]);
      if (!alive) return;
      const tl = Array.isArray(st.timeline) ? st.timeline : [];
      const inQueue = tl.some((t) => t && t.target === target && t.fileId === fileId);
      const wasSent = (done.items || []).some((r) => r && r.file_id === fileId);
      setBlocked(inQueue ? 'queued' : wasSent ? 'sent' : null);
    })();
    return () => { alive = false; };
  }, [fileId, target]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      clearAutoClose();
    };
  }, [open, close, clearAutoClose]);

  const apiFor = useCallback((t) => {
    if (t === 'channel') return sendToChannel;
    if (t === 'whatsapp') return sendToWhatsApp;
    if (t === 'all') return sendToAll;
    return sendToStatus;
  }, []);

  const handleClick = useCallback(async () => {
    if (disabled) return;
    if (open && phase !== 'loading') { close(); return; }
    clearAutoClose();
    setOpen(true);
    setPhase('loading');
    setKind(null);
    const my = ++seq.current;

    const sendPromise = blocked
      ? Promise.resolve(null)
      : apiFor(target)(fileId).catch((e) => ({ error: (e && e.message) || 'Gagal kirim' }));

    const [res, statuses, doneRows] = await Promise.all([
      sendPromise,
      getSendQueueStatuses('whatsapp,channel,status,all').catch(() => ({})),
      getSendQueue('done', 0, 100, target).catch(() => ({ items: [] })),
    ]);

    if (my !== seq.current) return; // closed / re-clicked meanwhile

    const timeline = Array.isArray(statuses.timeline) ? statuses.timeline : [];
    const targetList = timeline.filter((t) => t && t.target === target);
    const myIdx = targetList.findIndex((t) => t && t.fileId === fileId);
    const mine = myIdx >= 0 ? targetList[myIdx] : null;
    const count = targetList.length;
    const nextAllowedAt = (statuses.policy && statuses.policy.nextAllowedAt) || (res && res.nextAllowedAt);

    const buildQueued = () => ({
      type: 'queued',
      position: myIdx >= 0 ? myIdx + 1 : count + 1,
      eta: (mine && mine.eta) || (res && res.nextAllowedAt) || null,
      count,
      nextAllowedAt,
    });

    let nextPhase = 'result';
    let nextKind;
    if (blocked) {
      if (blocked === 'queued') {
        nextKind = buildQueued();
      } else {
        const doneRow = Array.isArray(doneRows.items)
          ? doneRows.items.find((r) => r && r.file_id === fileId)
          : null;
        nextKind = { type: 'sent', sentAt: (doneRow && doneRow.completed_at) || Date.now(), nextAllowedAt };
      }
    } else if (res && res.error && !res.queued && !res.duplicate && !res.sent) {
      nextPhase = 'error';
      nextKind = { type: 'error', message: res.error };
    } else if (res && res.sent) {
      nextKind = { type: 'sent', sentAt: Date.now(), nextAllowedAt };
    } else if (res && res.queued) {
      nextKind = buildQueued();
    } else if (res && res.duplicate) {
      if (mine) {
        nextKind = buildQueued();
      } else {
        const doneRow = Array.isArray(doneRows.items)
          ? doneRows.items.find((r) => r && r.file_id === fileId)
          : null;
        nextKind = { type: 'sent', sentAt: (doneRow && doneRow.completed_at) || Date.now(), nextAllowedAt };
      }
    } else {
      nextKind = buildQueued();
    }

    // After our own send the item is queued/sent, so disable the button too.
    if (!blocked && res && !res.error) setBlocked(res.queued || res.sent || res.duplicate ? (res.sent ? 'sent' : 'queued') : 'queued');
    if (!blocked && res && res.error) setBlocked(null);

    setPhase(nextPhase);
    setKind(nextKind);
    if (onResult) { try { onResult(res); } catch {} }
    autoCloseTimer.current = setTimeout(() => setOpen(false), 8000);
  }, [fileId, target, disabled, open, phase, close, clearAutoClose, apiFor, onResult, blocked]);

  if (!fileId) return null;

  const dimmed = disabled || blocked != null;

  return (
    <div className="relative" ref={containerRef}>
      <div
        role="button"
        tabIndex={dimmed ? -1 : 0}
        aria-disabled={dimmed}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
        className={`${className} ${dimmed ? 'opacity-40 cursor-not-allowed' : ''}`}
        title={blocked === 'queued'
          ? 'Item sudah ada di antrian WhatsApp'
          : blocked === 'sent'
            ? 'Item sudah pernah dikirim ke WhatsApp'
            : 'Kirim ke WhatsApp Status'}
        style={{ cursor: dimmed ? 'not-allowed' : 'pointer' }}
      >
        {children}
      </div>

      {open && (
        <div
          className={`wa-pop z-50 mt-2 ${align === 'right' ? 'right-0' : 'left-0'} max-w-xs rounded-full border border-neutral-700/70 bg-neutral-900/95 text-white shadow-2xl backdrop-blur-sm`}
          style={{ position: 'absolute' }}
        >
          <div className="px-4 py-2.5 text-center text-xs">
            {phase === 'loading' && (
              <span className="inline-flex items-center gap-2 whitespace-nowrap text-neutral-300">
                <span className="w-3.5 h-3.5 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
                Antri ke WhatsApp {TARGET_LABEL[target]}…
              </span>
            )}
            {phase === 'error' && (
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <span className="h-4 w-4 shrink-0 rounded-full bg-red-500/20 text-red-400 text-center leading-4 font-bold">!</span>
                <span>
                  <span className="text-red-300 font-semibold">Gagal mengirim</span>
                  <span className="text-neutral-400 ml-1.5">{(kind && kind.message) || 'Coba lagi.'}</span>
                </span>
              </span>
            )}
            {phase === 'result' && kind && kind.type === 'queued' && (
              <div className="whitespace-nowrap">
                <p className="text-emerald-300 font-semibold">✓ Masuk antrian</p>
                <p className="text-neutral-300 mt-0.5">
                  Urutan <span className="text-white font-bold">#{kind.position}</span> dari {kind.count}
                  <span className="text-neutral-500"> · ETA {fmtClock(kind.eta)}</span>
                  {kind.eta && kind.eta > Date.now() ? <span className="text-neutral-500"> ({etaCountdown(kind.eta)})</span> : null}
                </p>
              </div>
            )}
            {phase === 'result' && kind && kind.type === 'sent' && (
              <div className="whitespace-nowrap">
                <p className="text-amber-300 font-semibold">Sudah dikirim ke {TARGET_LABEL[target]}</p>
                <p className="text-neutral-300 mt-0.5">
                  <span className="text-neutral-400">Dikirim</span> <span className="text-neutral-200">{fmtDatetime(kind.sentAt)}</span>
                  {kind.nextAllowedAt ? <span className="text-neutral-500"> · berikutnya {fmtDatetime(kind.nextAllowedAt)}</span> : null}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}