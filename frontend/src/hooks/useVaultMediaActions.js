import { useCallback, useState, useEffect, useRef } from 'react';
import { useIsFavorite } from '../store/favoritesStore';
import { useIsLocked, default as lockedStore } from '../store/lockedStore';
import { useSendProgress } from './useSendProgress';
import { useWaUnsupported } from './useWaUnsupported';
import { sendToTelegram, sendToChannel, sendToStatus, sendToAll, getSendQueue, toggleLock, getLock } from '../utils/api';

function formatDate(ts) {
  if (!ts) return null;
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useVaultMediaActions(file, onToggleFavorite) {
  const isFav = useIsFavorite(file?.id, file?.is_favorite ? 1 : 0);
  const waUnsupported = useWaUnsupported(file);
  const isFileLocked = useIsLocked(file?.id, file?.is_locked ? 1 : 0);
  const { progress, start: startProgress } = useSendProgress();
  const [isFileQueued, setIsFileQueued] = useState(false);
  const [isFileSent, setIsFileSent] = useState(false);
  const [sendStatus, setSendStatus] = useState('idle');
  const [sendMessage, setSendMessage] = useState('');
  const [sendExtraInfo, setSendExtraInfo] = useState(null);
  const timerRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const sendStatusRef = useRef(sendStatus);
  const fileIdRef = useRef(file?.id);

  const clearSendTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (pollingTimerRef.current) { clearTimeout(pollingTimerRef.current); pollingTimerRef.current = null; }
  }, []);

  useEffect(() => { sendStatusRef.current = sendStatus; }, [sendStatus]);
  useEffect(() => { fileIdRef.current = file?.id; }, [file?.id]);

  // Clear any pending status-reset / retry timers when the viewed file changes
  // so a previous file's 4s idle timer can't wipe the new file's status.
  useEffect(() => {
    clearSendTimer();
  }, [file?.id, clearSendTimer]);

  const checkFileSendStatus = useCallback(async () => {
    const currentFileId = fileIdRef.current;
    if (!currentFileId) return;
    try {
      const [pendingData, doneData] = await Promise.all([
        getSendQueue('pending', 0, 100),
        getSendQueue('done', 0, 1),
      ]);
      // Stale guard: if the viewed file changed while this request was in
      // flight, abort before applying another file's status to the current file
      // (otherwise a slow previous check can wrongly disable the send button).
      if (fileIdRef.current !== currentFileId) return;
      const pendingItems = pendingData?.items || [];
      const doneItems = doneData?.items || [];
      const currentFileIdStr = String(currentFileId);
      const pendingItem = pendingItems.find(item => String(item.file_id) === currentFileIdStr || String(item.id) === currentFileIdStr);
      const lastSent = doneItems.find(item => String(item.file_id) === currentFileIdStr || String(item.id) === currentFileIdStr);

      if (pendingItem) {
        setIsFileQueued(true);
        setIsFileSent(false);
        const queuePosition = pendingItems.filter(item => item.status === 'pending').sort((a, b) => (Number(a.scheduled_at) || 0) - (Number(b.scheduled_at) || 0)).findIndex(item => String(item.file_id) === currentFileIdStr) + 1;
        const sched = Number(pendingItem.scheduled_at) || Number(pendingItem.hold_until) || 0;
        const extra = {
          queuePosition: `Urutan item: #${queuePosition}`,
          scheduledAt: sched ? `Jadwal kirim: ${formatDate(sched)}` : null,
          etaEndMs: pendingItem.eta ? Number(pendingItem.eta) : null,
        };
        console.log('[useVaultMediaActions] FOUND pendingItem id=', pendingItem.id, 'file_id=', pendingItem.file_id, 'extra=', extra);
        setSendExtraInfo(extra);
        setSendMessage('Sudah dalam antrian');
        setSendStatus('queued');
        clearSendTimer();
        timerRef.current = setTimeout(() => {
          setSendStatus('idle');
          setSendMessage('');
          setSendExtraInfo(null);
        }, 4000);
      } else if (lastSent) {
        setIsFileQueued(false);
        setIsFileSent(true);
        const extra = {
          lastSentAt: `Terkirim: ${formatDate(lastSent.completed_at || lastSent.created_at)}`,
        };
        setSendExtraInfo(extra);
        setSendMessage('Sudah dikirim sebelumnya');
        setSendStatus('success');
        clearSendTimer();
        timerRef.current = setTimeout(() => {
          setSendStatus('idle');
          setSendMessage('');
          setSendExtraInfo(null);
        }, 4000);
      } else if (sendStatusRef.current === 'queued') {
        console.log('[useVaultMediaActions] not found, retrying in 2s... currentFileIdStr=', currentFileIdStr, 'pendingItems count=', pendingItems.length);
        pollingTimerRef.current = setTimeout(() => {
          checkFileSendStatus();
        }, 2000);
      } else {
        console.log('[useVaultMediaActions] NOT FOUND, setting idle. currentFileIdStr=', currentFileIdStr, 'pendingItems count=', pendingItems.length, 'doneItems count=', doneItems.length);
        setIsFileQueued(false);
        setIsFileSent(false);
        setSendStatus('idle');
        setSendMessage('');
        setSendExtraInfo(null);
      }
    } catch {}
  }, [clearSendTimer]);

  // Re-validate send state on every file switch. The hook is mounted once in
  // MediaModal, so without this a previous file's "already sent" lock bleeds onto
  // the next file (only clearing on a full reload). Reset optimistic state first
  // so the new file never flashes the old lock while we refetch.
  useEffect(() => {
    setIsFileQueued(false);
    setIsFileSent(false);
    setSendStatus('idle');
    setSendMessage('');
    setSendExtraInfo(null);
    checkFileSendStatus();
  }, [file?.id, checkFileSendStatus]);

  // Sync authoritative lock state from the server when the file changes.
  useEffect(() => {
    const id = file?.id;
    if (!id) return;
    let cancelled = false;
    getLock(id)
      .then((data) => { if (!cancelled) lockedStore.getState().set(id, data.is_locked ? 1 : 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [file?.id]);

  const handleToggleFavorite = useCallback(async () => {
    if (!file?.id || !onToggleFavorite) return;
    try { await onToggleFavorite(file); } catch {}
  }, [file, onToggleFavorite]);

  const toggleItemLock = useCallback(async () => {
    const id = file?.id;
    if (!id) return;
    try {
      const res = await toggleLock(id);
      lockedStore.getState().set(id, res.is_locked ? 1 : 0);
    } catch {}
  }, [file?.id]);

  const handleSend = useCallback(async (target) => {
    const currentFileId = fileIdRef.current;
    if (!currentFileId) return;
    clearSendTimer();
    setSendStatus('loading');
    setSendMessage('Mengirim...');
    setSendExtraInfo(null);

    const startTime = Date.now();
    const MIN_LOADING_MS = 500;

    let res;
    try {
      if (target === 'telegram') res = await sendToTelegram(currentFileId);
      else if (target === 'channel') res = await sendToChannel(currentFileId);
      else if (target === 'status') res = await sendToStatus(currentFileId);
      else if (target === 'all') res = await sendToAll(currentFileId);

      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise(r => setTimeout(r, MIN_LOADING_MS - elapsed));
      }

      if (res) {
        if (res.qid) startProgress(res.qid, target);

        if (res.duplicate) {
          if (res.sent) {
            // Already delivered before — show a success (green/check) pill, not
            // a queued (amber/clock) one.
            setSendMessage(res.message || 'Sudah dikirim');
            setSendStatus('success');
            setIsFileSent(true);
            setIsFileQueued(false);
          } else {
            setSendMessage(res.message || 'Sudah dalam antrian');
            setSendStatus('queued');
            setIsFileQueued(true);
            setIsFileSent(false);
          }
        } else if (res.ok !== false) {
          const targetLabel = { telegram: 'Telegram', channel: 'Channel', status: 'Status', all: 'Semua' }[target] || target;
          setSendMessage(`Masuk antrian ${targetLabel}`);
          setSendStatus('queued');
          setIsFileQueued(true);
        } else {
          setSendMessage('Gagal mengirim');
          setSendStatus('error');
        }
      } else {
        setSendMessage('Gagal mengirim');
        setSendStatus('error');
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise(r => setTimeout(r, MIN_LOADING_MS - elapsed));
      }
      setSendMessage('Gagal: ' + (err?.message || 'Unknown error'));
      setSendStatus('error');
    }

    // Delay the queue-info poll so the result state is already visible;
    // if the backend hasn't registered the item yet, the poll retries once.
    pollingTimerRef.current = setTimeout(() => {
      checkFileSendStatus();
    }, 1500);
  }, [startProgress, clearSendTimer, checkFileSendStatus]);

  useEffect(() => {
    return clearSendTimer;
  }, [clearSendTimer]);

  return { isFav, waUnsupported, progress, startProgress, isFileQueued, isFileSent, sendStatus, sendMessage, sendExtraInfo, isFileLocked, toggleItemLock, handleToggleFavorite, handleSend, checkFileSendStatus };
}
