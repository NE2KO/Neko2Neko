import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, X, Check, AlertCircle, Clock } from 'lucide-react';
import { formatBytes as formatSize } from '../utils/format.js';

// Module-level shared state so all hook instances stay in sync
const _sharedRemovedIds = new Set();
const _sharedDismissTimers = {};

// Cross-instance sync: when one instance dismisses/removes an item,
// broadcast to all other hook instances via CustomEvent
const UPLOAD_SYNC_EVENT = 'upload-queue-sync';

function broadcastSync(action, id) {
  window.dispatchEvent(new CustomEvent(UPLOAD_SYNC_EVENT, { detail: { action, id } }));
}

// === HELPER FORMATTERS (moved from UploadQueue) ===
const formatSpeed = (bps) => {
  if (!bps) return '';
  return `${formatSize(bps)}/s`;
};

const formatEta = (s) => {
  if (!s || s <= 0) return '';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const statusColors = {
  pending: 'text-neutral-500',
  uploading: 'text-cyan-400',
  processing: 'text-yellow-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-neutral-600',
};

const statusIcons = {
  pending: <Clock size={12} />,
  uploading: <Upload size={12} className="animate-pulse" />,
  completed: <Check size={12} />,
  failed: <AlertCircle size={12} />,
  cancelled: <X size={12} />,
};

export function useUploadQueueLogic(onClosePanel) {
  const [uploads, setUploads] = useState([]);
  const pollRef = useRef(null);

  const removeUpload = useCallback((id) => {
    clearTimeout(_sharedDismissTimers[id]);
    delete _sharedDismissTimers[id];
    _sharedRemovedIds.add(id);
    setUploads(prev => prev.filter(u => u.id !== id));
    broadcastSync('remove', id);
  }, []);

  const deleteUploadFile = useCallback(async (id) => {
    try {
      await fetch(`/api/upload/${id}`, { method: 'DELETE' });
      // Also remove the file from disk + DB
      await fetch(`/api/upload/${id}/file`, { method: 'DELETE' });
      setUploads(prev => prev.filter(u => u.id !== id));
      broadcastSync('remove', id);
    } catch {}
  }, []);

  const startDismiss = useCallback((id, delay) => {
    if (_sharedDismissTimers[id]) return;
    _sharedDismissTimers[id] = setTimeout(() => {
      _sharedDismissTimers[id] = setTimeout(() => removeUpload(id), 200);
    }, delay);
  }, [removeUpload]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/upload/status');
      if (res.ok) {
        const data = await res.json();
        const active = data.active || [];
        setUploads(prev => {
          const merged = new Map(prev.map(u => [u.id, u]));
          for (const u of active) {
            if (_sharedRemovedIds.has(u.id)) continue;
            merged.set(u.id, u);
          }
          // Remove items user requested to dismiss
          for (const id of _sharedRemovedIds) merged.delete(id);
          return Array.from(merged.values()).sort((a, b) => (b.startedAt || b.created_at || 0) - (a.startedAt || a.created_at || 0));
        });

        for (const u of active) {
          if (_sharedDismissTimers[u.id]) continue;
          if (u.status === 'completed') {
            startDismiss(u.id, 5000);
          } else if (u.status === 'failed') {
            startDismiss(u.id, 10000);
          }
        }
      }
    } catch {}
  }, [startDismiss]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/upload/history?limit=20');
      if (res.ok) {
        const data = await res.json();
        const history = data.entries || [];
        setUploads(prev => {
          const merged = new Map(prev.map(u => [u.id, u]));
          for (const h of history) {
            if (_sharedRemovedIds.has(h.id)) continue;
            if (!merged.has(h.id)) {
              merged.set(h.id, h);
            }
          }
          // Remove items user requested to dismiss
          for (const id of _sharedRemovedIds) merged.delete(id);
          return Array.from(merged.values()).sort((a, b) => (b.startedAt || b.created_at || 0) - (a.startedAt || a.created_at || 0));
        });
      }
    } catch {}
  }, []);

  const cancelUpload = useCallback(async (id) => {
    try {
      await fetch(`/api/upload/${id}`, { method: 'DELETE' });
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'cancelled' } : u));
      startDismiss(id, 2000);
    } catch {}
  }, [startDismiss]);

  // Listen for cross-instance sync events
  useEffect(() => {
    const handler = (e) => {
      const { action, id } = e.detail || {};
      if (action === 'remove' && id) {
        clearTimeout(_sharedDismissTimers[id]);
        delete _sharedDismissTimers[id];
        _sharedRemovedIds.add(id);
        setUploads(prev => prev.filter(u => u.id !== id));
      }
    };
    window.addEventListener(UPLOAD_SYNC_EVENT, handler);
    return () => window.removeEventListener(UPLOAD_SYNC_EVENT, handler);
  }, []);

  useEffect(() => {
    fetchHistory();
    fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, fetchHistory]);

  // Only poll when there are active uploads
  useEffect(() => {
    const hasActive = uploads.some(u => u.status === 'uploading' || u.status === 'processing' || u.status === 'pending');
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (hasActive) {
      pollRef.current = setInterval(fetchStatus, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [uploads, fetchStatus]);

  return {
    uploads,
    removeUpload,
    deleteUploadFile,
    cancelUpload,
    formatSize,
    formatSpeed,
    formatEta,
    statusColors,
    statusIcons,
    activeUploadCount: uploads.filter(u => u.status === 'uploading' || u.status === 'processing' || u.status === 'pending').length,
  };
}
