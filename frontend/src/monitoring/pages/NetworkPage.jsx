import { useEffect, useMemo, useRef, useState } from 'react';
import useMonitoringStore from '../stores/monitoringStore';
import GlassCard from '../shared/GlassCard';
import GaugeMeter from '../../components/GaugeMeter';
import { formatBytes, formatSpeed } from '../../utils/format.js';

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}


export default function NetworkPage() {
  const stats = useMonitoringStore(s => s.stats);
  const smoothEnabled = useMonitoringStore(s => s.smoothEnabled);
  const smoothMs = useMonitoringStore(s => s.smoothMs);

  const network = stats?.network || null;
  const interfaces = network?.interfaces || [];

  const PEAK_RESET_MINUTES = 5;
  const peakResetMs = PEAK_RESET_MINUTES * 60 * 1000;
  const [summaryTick, setSummaryTick] = useState(0);
  const summaryRef = useRef({
    startedAt: Date.now(),
    peakStartedAt: Date.now(),
    perIface: new Map(),
  });

  const upIfaces = useMemo(() => interfaces.filter(i => (i?.operstate === 'up' || i?.up === true)), [interfaces]);
  const upNameSet = useMemo(() => new Set(upIfaces.map(i => i?.name).filter(Boolean)), [upIfaces]);

  useEffect(() => {
    if (!network) return;
    const s = summaryRef.current;

    for (const name of Array.from(s.perIface.keys())) {
      if (!upNameSet.has(name)) s.perIface.delete(name);
    }

    for (const iface of upIfaces) {
      const name = iface?.name;
      if (!name) continue;
      const sp = iface?.speed || {};
      if (!s.perIface.has(name)) {
        s.perIface.set(name, {
          baseRxBytes: Number(sp.rxBytes || 0),
          baseTxBytes: Number(sp.txBytes || 0),
          sumRxSpeed: 0, sumTxSpeed: 0, samples: 0, peakRxSpeed: 0, peakTxSpeed: 0,
        });
        s.startedAt = Date.now();
      }
    }
    setSummaryTick(t => t + 1);
  }, [network, upIfaces, upNameSet]);

  useEffect(() => {
    if (!network) return;
    const s = summaryRef.current;
    for (const iface of upIfaces) {
      const name = iface?.name;
      if (!name) continue;
      const sp = iface?.speed || {};
      const st = s.perIface.get(name);
      if (!st) continue;
      const rxBytesNow = Number(sp.rxBytes || 0);
      const txBytesNow = Number(sp.txBytes || 0);
      if (rxBytesNow < st.baseRxBytes || txBytesNow < st.baseTxBytes) {
        st.baseRxBytes = rxBytesNow; st.baseTxBytes = txBytesNow;
        st.sumRxSpeed = 0; st.sumTxSpeed = 0; st.samples = 0;
      }
      const rx = Number(sp.rxSpeed || 0);
      const tx = Number(sp.txSpeed || 0);
      st.sumRxSpeed += rx; st.sumTxSpeed += tx; st.samples += 1;
      if (rx > st.peakRxSpeed) st.peakRxSpeed = rx;
      if (tx > st.peakTxSpeed) st.peakTxSpeed = tx;
    }
    setSummaryTick(t => t + 1);
  }, [network?.primary, upIfaces]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const s = summaryRef.current;
      if (now - s.peakStartedAt >= peakResetMs) {
        s.peakStartedAt = now;
        for (const st of s.perIface.values()) { st.peakRxSpeed = 0; st.peakTxSpeed = 0; }
      }
      setSummaryTick(t => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [peakResetMs]);

  const summary = summaryRef.current;
  const peakElapsed = Date.now() - summary.peakStartedAt;
  const peakRemaining = Math.max(peakResetMs - peakElapsed, 0);

  function formatCountdown(ms) {
    const sec = Math.ceil(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div className="p-3 md:p-6" data-debug-id="2.5" data-debug-name="NetworkPage" data-debug-type="container">
      <div className="mx-auto space-y-4" style={{ maxWidth: '1280px' }}>
        <GlassCard data-debug-id="2.5.4" data-debug-name="NetworkSummaryCard" data-debug-type="card" title="Network" subtitle={`${interfaces.length} interface(s)`}>
          <div data-debug-id="2.5.1" data-debug-name="InterfaceSummaryCard" data-debug-type="card" className="px-4 pb-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-[10px] text-neutral-600">
                Peak resets in <span className="font-mono tabular-nums text-neutral-400">{formatCountdown(peakRemaining)}</span> ({PEAK_RESET_MINUTES} min)
              </div>
            </div>

            <div className="space-y-3">
              {interfaces.map((iface) => {
                const st = summary.perIface.get(iface.name);
                const dl = Number(iface.speed?.rxSpeed || 0);
                const ul = Number(iface.speed?.txSpeed || 0);
                const avgDl = st?.samples ? st.sumRxSpeed / st.samples : 0;
                const avgUl = st?.samples ? st.sumTxSpeed / st.samples : 0;
                const totalDl = Math.max(Number(iface.speed?.rxBytes || 0) - Number(st?.baseRxBytes || 0), 0);
                const totalUl = Math.max(Number(iface.speed?.txBytes || 0) - Number(st?.baseTxBytes || 0), 0);
                const maxBytesPerSec = 12.5 * 1024 * 1024;
                const dlPct = clamp((dl / maxBytesPerSec) * 100, 0, 100);
                const ulPct = clamp((ul / maxBytesPerSec) * 100, 0, 100);

                return (
                  <div key={iface.name} data-debug-id="2.5.2" data-debug-name="InterfaceCard" data-debug-type="card" className="bg-neutral-900/50 rounded-lg p-3 border border-[#1e2530] min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-[11px] text-neutral-300 font-medium font-mono tabular-nums truncate">{iface.name}</div>
                      <div className="text-[10px] text-neutral-600 truncate">{iface.operstate || 'unknown'}</div>
                    </div>

                    {/* Mobile: compact text layout */}
                    <div className="sm:hidden">
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <div className="text-[9px] text-emerald-400/60 mb-0.5">Download</div>
                          <div className="text-sm font-bold text-emerald-400 font-mono tabular-nums">{formatSpeed(dl)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-blue-400/60 mb-0.5">Upload</div>
                          <div className="text-sm font-bold text-blue-400 font-mono tabular-nums">{formatSpeed(ul)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div className="text-neutral-600">↓Total</div>
                        <div className="text-neutral-400 font-mono tabular-nums text-right">{formatBytes(totalDl)}</div>
                        <div className="text-neutral-600">↑Total</div>
                        <div className="text-neutral-400 font-mono tabular-nums text-right">{formatBytes(totalUl)}</div>
                        <div className="text-neutral-600">↓Avg</div>
                        <div className="text-neutral-400 font-mono tabular-nums text-right">{formatSpeed(avgDl)}</div>
                        <div className="text-neutral-600">↑Avg</div>
                        <div className="text-neutral-400 font-mono tabular-nums text-right">{formatSpeed(avgUl)}</div>
                      </div>
                    </div>

                    {/* Desktop: full layout with gauges */}
                    <div className="hidden sm:flex items-center gap-3">
                      <GaugeMeter value={dlPct} unit="" size={100} strokeWidth={6} label="Download" smoothEnabled={smoothEnabled} smoothMs={smoothMs} />
                      <GaugeMeter value={ulPct} unit="" size={100} strokeWidth={6} label="Upload" smoothEnabled={smoothEnabled} smoothMs={smoothMs} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-neutral-600">Download</div>
                        <div className="text-[11px] text-neutral-300 font-mono tabular-nums truncate">{formatSpeed(dl)}</div>
                        <div className="text-[10px] text-neutral-600 mt-1">Upload</div>
                        <div className="text-[11px] text-neutral-300 font-mono tabular-nums truncate">{formatSpeed(ul)}</div>
                        <div data-debug-id="2.5.2.1" data-debug-name="IfaceDetail" data-debug-type="other" className="mt-2 pt-2 border-t border-neutral-800/60 grid grid-cols-2 gap-x-3 gap-y-1">
                          <div className="text-[10px] text-neutral-600">Total Down</div>
                          <div className="text-[10px] text-neutral-300 font-mono tabular-nums text-right">{formatBytes(totalDl)}</div>
                          <div className="text-[10px] text-neutral-600">Total Up</div>
                          <div className="text-[10px] text-neutral-300 font-mono tabular-nums text-right">{formatBytes(totalUl)}</div>
                          <div className="text-[10px] text-neutral-600">Avg Down</div>
                          <div className="text-[10px] text-neutral-300 font-mono tabular-nums text-right">{formatSpeed(avgDl)}</div>
                          <div className="text-[10px] text-neutral-600">Avg Up</div>
                          <div className="text-[10px] text-neutral-300 font-mono tabular-nums text-right">{formatSpeed(avgUl)}</div>
                          <div className="text-[10px] text-neutral-600">Peak Down</div>
                          <div className="text-[10px] text-neutral-300 font-mono tabular-nums text-right">{formatSpeed(st?.peakRxSpeed || 0)}</div>
                          <div className="text-[10px] text-neutral-600">Peak Up</div>
                          <div className="text-[10px] text-neutral-300 font-mono tabular-nums text-right">{formatSpeed(st?.peakTxSpeed || 0)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {interfaces.length === 0 && (
                <div className="text-[11px] text-neutral-600 italic">Waiting for network data...</div>
              )}
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
