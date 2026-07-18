import { useState, useRef, useCallback, useEffect } from 'react';
import { getSendProgress } from '../utils/api';

// Sub-targets each logical send target covers, mirrored from the backend. Used to
// seed only the pills that will actually be attempted (not all three).
const ATTEMPTED_BY_TARGET = {
  telegram: ['telegram'],
  channel: ['channel'],
  status: ['status'],
  whatsapp: ['channel', 'status'],
  all: ['telegram', 'channel', 'status'],
};

// Poll live per-target send progress (keyed by queueId) while a combined/WA
// send is in flight. Stops when the backend clears the entry (send done) or all
// attempted targets resolve to done/err.
export function useSendProgress() {
  const [progress, setProgress] = useState(null);
  const timerRef = useRef(null);
  const attemptedRef = useRef(['telegram', 'channel', 'status']);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(null);
  }, []);

  const start = useCallback((qid, target) => {
    if (!qid) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const attempted = ATTEMPTED_BY_TARGET[target] || ['telegram', 'channel', 'status'];
    attemptedRef.current = attempted;
    const seed = {};
    for (const t of attempted) seed[t] = 'pending';
    setProgress(seed);
    timerRef.current = setInterval(async () => {
      try {
        const p = await getSendProgress(qid);
        // Backend cleared the entry → send finished.
        if (!p) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setProgress(null);
          return;
        }
        setProgress(p);
        const allDone = attempted.every((k) => {
          const v = p[k];
          return v === 'done' || v === 'err';
        });
        if (allDone) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch {}
    }, 500);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return { progress, start, stop };
}
