import React, { useState, useEffect, useRef } from 'react';

export default function SyncVerifyOverlay({ sessionStats }) {
  const [verified, setVerified] = useState({
    totalTicks: 0,
    matchRate: 100,
    recentMatches: [],
    lastStatus: 'CONNECTING',
    roundTripMs: null,
  });
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let interval = null;

    const fetchStatus = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch('/api/sync-verify/recent', {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const stats = data.snapshots || [];

        const matches = stats.filter(s => s.triangleConsistent).length;
        const rate = stats.length > 0 ? (matches / stats.length) * 100 : 100;

        setVerified({
          totalTicks: stats.length,
          matchRate: rate,
          recentMatches: stats.slice(-5).map(s => ({
            sequence: s.sequence,
            status: s.triangleConsistent ? 'MATCH' : 'INCONSISTENT',
          })),
          lastStatus: 'CONNECTED',
          roundTripMs: null,
        });
        setError(null);
      } catch (e) {
        if (e.name !== 'AbortError') {
          setError(e.message);
        }
      }
    };

    if (isVisible) {
      interval = setInterval(fetchStatus, 2000);
      fetchStatus();
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const statusColor = verified.lastStatus === 'CONNECTED'
    ? (verified.matchRate > 99 ? '#10b981' : verified.matchRate > 95 ? '#f59e0b' : '#ef4444')
    : '#6b7280';

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-black/90 border border-white/10 rounded-lg p-3 text-xs text-white font-mono max-w-[280px]">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-purple-400">SYNC VERIFY</span>
        <button
          onClick={() => setIsVisible(false)}
          className="text-white/50 hover:text-white text-lg"
          title="Close"
        >
          x
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Status:</span>
          <span style={{ color: statusColor }}>{verified.lastStatus}</span>
        </div>

        <div className="flex justify-between">
          <span>Match:</span>
          <span style={{ color: verified.matchRate > 99 ? '#10b981' : verified.matchRate > 95 ? '#f59e0b' : '#ef4444' }}>
            {verified.matchRate.toFixed(1)}%
          </span>
        </div>

        <div className="flex justify-between">
          <span>Ticks:</span>
          <span>{verified.totalTicks}</span>
        </div>

        {verified.roundTripMs !== null && (
          <div className="flex justify-between">
            <span>Round-trip:</span>
            <span>{verified.roundTripMs}ms</span>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-[10px]">
            Error: {error}
          </div>
        )}
      </div>

      {verified.recentMatches.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[10px]">
          <div className="text-white/50 mb-1">Recent:</div>
          {verified.recentMatches.slice(-3).map((m) => (
            <div key={m.sequence} className="flex justify-between">
              <span>#{m.sequence}</span>
              <span style={{ color: m.status === 'MATCH' ? '#10b981' : '#ef4444' }}>
                {m.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setIsVisible(false)}
        className="mt-2 w-full text-[10px] text-white/50 hover:text-white underline"
      >
        Hide
      </button>
    </div>
  );
}</div>

export function ToggleSyncVerify({ initial = false }) {
  const [visible, setVisible] = useState(initial);

  useEffect(() => {
    window.__SYNC_VERIFY_VISIBLE__ = visible;
  }, [visible]);

  return (
    <button
      onClick={() => setVisible(v => {
        setVisible(!v);
        return !v;
      })}
      className="fixed bottom-4 left-4 z-50 bg-black/90 border border-white/10 rounded-full w-10 h-10 text-white hover:bg-white/10 flex items-center justify-center text-2xl"
      title="Toggle Sync Verify"
    >
      {visible ? '×' : '👁️'}
    </button>
  );
}