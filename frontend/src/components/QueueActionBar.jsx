import React from 'react';
import { Ban, RotateCw } from 'lucide-react';
import { cancelSendQueueItem, retrySendQueueItem } from '../utils/api';

const btnCls = "flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-800/60 border border-neutral-700/40 text-neutral-300 hover:bg-neutral-700/60 hover:text-white transition-all active:scale-95";

export default function QueueActionBar({ queueItem, onChanged }) {
  if (!queueItem) return null;
  const status = queueItem.status;
  const run = async (fn) => {
    try { await fn(queueItem.qid); } finally { onChanged && onChanged(); }
  };

  // No action for done/canceled (delete moved to the header) — render nothing
  // so the empty bar doesn't leave a thin black strip above the controls.
  if (status !== 'pending' && status !== 'failed') return null;

  return (
    <div className="flex items-center justify-center gap-3 py-3 border-t border-white/5 bg-neutral-950/80">
      {status === 'pending' && (
        <button className={btnCls} onClick={() => run(cancelSendQueueItem)} title="Batalkan pengiriman">
          <Ban size={16} />
          <span className="text-xs font-medium">Batalkan</span>
        </button>
      )}
      {status === 'failed' && (
        <button className={btnCls} onClick={() => run(retrySendQueueItem)} title="Ulangi pengiriman">
          <RotateCw size={16} />
          <span className="text-xs font-medium">Ulangi</span>
        </button>
      )}
    </div>
  );
}
