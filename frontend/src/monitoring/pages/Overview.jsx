import { useState, useEffect, useCallback, memo, useRef } from 'react';
import useMonitoringStore from '../stores/monitoringStore';
import CpuWidget from '../widgets/CpuWidget';
import MemoryWidget from '../widgets/MemoryWidget';
import GpuWidget from '../widgets/GpuWidget';
import DiskWidget from '../widgets/DiskWidget';
import NetworkWidget from '../widgets/NetworkWidget';
import SystemWidget from '../widgets/SystemWidget';
import GlassCard from '../shared/GlassCard';
import Skeleton from '../shared/Skeleton';
import { AlertTriangle, Cpu, HardDrive, ArrowDown, ArrowUp, Fan } from 'lucide-react';
import { formatBytes } from '../../utils/format.js';

// ── Sub-components ────────────────────────────────────────────────

const QuickStat = memo(function QuickStat({ icon, label, value, sub, color, debugId }) {
  return (
    <div data-debug-id={debugId} className="flex items-center gap-2.5 p-3 bg-neutral-900/40 rounded-lg border border-[#1e2530]">
      <div data-debug-id="2.2.1.1" data-debug-name="QuickStatIcon" data-debug-type="other" className={`p-1.5 rounded-md bg-neutral-800 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <div data-debug-id="2.2.1.3" data-debug-name="QuickStatLabel" data-debug-type="other" className="text-[10px] text-neutral-600 truncate">{label}</div>
        <div data-debug-id="2.2.1.2" data-debug-name="QuickStatValue" data-debug-type="other" className={`text-xs font-semibold font-mono tabular-nums truncate ${color}`}>{value}</div>
        {sub && <div data-debug-id="2.2.5.2" data-debug-name="UptimeSince" data-debug-type="other" className="text-[10px] text-neutral-600 truncate">{sub}</div>}
      </div>
    </div>
  );
});

function Overview() {
  const cpu = useMonitoringStore(s => s.stats?.cpu);
  const ram = useMonitoringStore(s => s.stats?.ram);
  const gpu = useMonitoringStore(s => s.stats?.gpu);
  const disk = useMonitoringStore(s => s.stats?.disk);
  const network = useMonitoringStore(s => s.stats?.network);
const system = useMonitoringStore(s => s.stats?.system);

const stats = useMonitoringStore(s => s.stats);
const rawHasStats = useMonitoringStore(s => s.stats !== null);
const readyRef = useRef(false);
function markReady() {
  if (!readyRef.current) {
    readyRef.current = true;
    console.log('[OVERVIEW_READY]', new Date().toISOString());
  }
}
useEffect(() => {
  if (rawHasStats) markReady();
}, [rawHasStats]);

const hasStats = rawHasStats;
const [showFallback, setShowFallback] = useState(false);

  const [overview, setOverview] = useState(null);

  // Hardware sensors + fan
  const [hw, setHw] = useState({ sensors: {}, fan: {}, disks: [] });
  const [fanApplying, setFanApplying] = useState(false);
  const [fanStatus, setFanStatus] = useState(null);
  const initialLoadDone = useRef(false);
  const userFanPrefRef = useRef(null);
  const savedFan = (() => { try { return JSON.parse(localStorage.getItem('monitor_fan_pref')); } catch { return null; } })();
  const [sliderVal, setSliderVal] = useState(savedFan?.speed ?? 0);
  const [isAuto, setIsAuto] = useState(savedFan?.auto ?? true);
  const sliderTimerRef = useRef(null);

  // Sync fan state from hardware API — only on first load (first time hw.fan.data arrives)
  useEffect(() => {
    if (!hw.fan?.mode || initialLoadDone.current) return;
    if (hw.fan._skip) { initialLoadDone.current = true; return; }
    // If user has a saved preference in localStorage, trust it over API state
    // and re-apply it to hardware
    if (savedFan) {
      const apiAuto = hw.fan.mode === 'auto';
      if (savedFan.auto !== apiAuto) {
        applyFan(savedFan.auto, savedFan.speed ?? 0);
      }
      initialLoadDone.current = true;
      return;
    }
    const apiAuto = hw.fan.mode === 'auto';
    setIsAuto(apiAuto);
    setSliderVal(apiAuto ? 0 : (hw.fan.speed ?? 0));
    initialLoadDone.current = true;
  }, [hw.fan?.mode, hw.fan?.speed]);

  // Save fan preference to localStorage when changed
  const saveFanPref = useCallback((auto, speed) => {
    try { localStorage.setItem('monitor_fan_pref', JSON.stringify({ auto, speed })); } catch {}
  }, []);

  // Refs to always have current values in effects without stale closures
  const sliderValRef = useRef(sliderVal);
  const isAutoRef = useRef(isAuto);
  sliderValRef.current = sliderVal;
  isAutoRef.current = isAuto;

const fetchHardware = useCallback(async () => {
  console.log('[HW] fetch start', new Date().toISOString());
  try {
    const res = await fetch('/api/monitoring/hardware');
    if (res.ok) {
      const data = await res.json();
      if (data.fan?.mode && userFanPrefRef.current && (Date.now() - userFanPrefRef.current.ts < 30000)) {
        data.fan = { ...data.fan, _skip: true };
      }
      setHw(data);
    }
  } catch {}
}, []);

  const applyFan = useCallback(async (auto, speed) => {
    setFanApplying(true);
    setFanStatus(null);
    userFanPrefRef.current = { auto, speed, ts: Date.now() };
    saveFanPref(auto, speed);
    try {
      const body = auto ? { speed: 'auto' } : { speed };
      const res = await fetch('/api/monitoring/hardware/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setFanStatus({ type: 'ok', msg: auto ? 'Auto' : `${speed}%` });
        setIsAuto(auto);
        fetchHardware();
      } else {
        setFanStatus({ type: 'error', msg: data.error || 'Failed' });
      }
    } catch (e) {
      setFanStatus({ type: 'error', msg: e.message });
    } finally {
      setFanApplying(false);
      setTimeout(() => setFanStatus(null), 3000);
    }
  }, [fetchHardware, saveFanPref]);

  // Auto-apply fan speed on slider change (debounced 400ms) in manual mode
  useEffect(() => {
    if (isAutoRef.current) return;
    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      applyFan(false, sliderValRef.current);
    }, 400);
    return () => { if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current); };
  }, [sliderVal, isAuto, applyFan]);

  useEffect(() => {
    fetchHardware();
    const id = setInterval(fetchHardware, 5000);
    return () => clearInterval(id);
  }, [fetchHardware]);

useEffect(() => {
  console.log('[OVERVIEW] hasStats changed', { hasStats, timestamp: new Date().toISOString() });
  if (!hasStats) {
    const timer = setTimeout(() => {
      console.log('[OVERVIEW] FALLBACK trigger — no stats for 10s');
      setShowFallback(true);
    }, 10000);
    return () => clearTimeout(timer);
  } else {
    setShowFallback(false);
  }
}, [hasStats]);

const fetchOverview = useCallback(async () => {
  console.log('[OVERVIEW] fetch start', new Date().toISOString());
  try {
    const res = await fetch('/api/monitoring/overview');
    if (res.ok) {
      const data = await res.json();
      setOverview(data);
    }
  } catch {}
}, []);

  useEffect(() => {
    fetchOverview();
    const id = setInterval(fetchOverview, 20000);
    return () => clearInterval(id);
  }, [fetchOverview]);

  if (!hasStats && showFallback) {
    return (
      <div className="p-3 md:p-6">
        <div className="mx-auto text-center" style={{ maxWidth: '1280px' }}>
          <p className="text-neutral-500 text-sm mb-2">Unable to load monitoring data</p>
          <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg text-xs hover:bg-cyan-500/20">Retry</button>
        </div>
      </div>
    );
  }

  if (!hasStats) {
    return (
      <div className="p-3 md:p-6">
        <div className="h-1 w-full bg-cyan-500/20 animate-pulse mb-2" />
        <div className="mx-auto" style={{ maxWidth: '1280px' }}>
          <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  const recentAlerts = (overview?.alerts || []).slice(0, 5);
  const recentLogs = (overview?.logs || []).slice(0, 5);
  const si = overview?.serverInfo;

  // Extract sensor temps
  const cpuTempObj = Object.values(hw.sensors).find(s => s.label === 'Tctl' || s.label === 'Tdie');
  const igpuTempObj = Object.values(hw.sensors).find(s => (s.label === 'edge' || s.label === 'edge1' || s.label === 'temp1') && s.chip.includes('amdgpu'));
  const nvmeTempObj = Object.values(hw.sensors).find(s => s.feature === 'Composite' && s.chip.includes('nvme'));
  const cpuTempVal = cpuTempObj?.value ?? cpu?.temp?.temp ?? null;
  const igpuTempVal = igpuTempObj?.value ?? null;
  const nvmeTempVal = nvmeTempObj?.value ?? null;

  return (
    <div className="p-3 md:p-6" data-debug-id="2.2" data-debug-name="OverviewPage" data-debug-type="container">
      <div className="mx-auto space-y-4" style={{ maxWidth: '1280px' }}>

        {/* Main Widgets - temps absorbed into each widget */}
        <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <CpuWidget data={cpu} cpuTemp={cpuTempVal} />
          <MemoryWidget data={ram} />
          <GpuWidget data={gpu} igpuTemp={igpuTempVal} />
          <DiskWidget data={disk} nvmeTemp={nvmeTempVal} />
          <NetworkWidget data={network} />
          <SystemWidget data={system} />
        </div>

        {/* Fan Control - compact inline */}
        {hw.fan.available !== false && (
          <GlassCard data-debug-id="2.2.15" data-debug-name="OverviewDockerCard" data-debug-type="card">
            <div className="px-4 py-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Fan size={13} className="text-neutral-500" />
                  <span className="text-[11px] text-neutral-400 font-medium">Fan</span>
                  <div className={`w-1.5 h-1.5 rounded-full ${isAuto ? 'bg-cyan-400' : 'bg-amber-400'}`} />
                  <span className="text-[11px] font-semibold tabular-nums text-cyan-400">
                    {isAuto ? 'Auto' : `${sliderVal}%`}
                  </span>
                </div>

                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => applyFan(true, sliderVal)}
                    disabled={fanApplying || isAuto}
                    className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-all border
                      ${isAuto
                        ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                        : 'bg-neutral-800 text-neutral-500 border-[#1e2530] hover:text-cyan-400'}`}
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => applyFan(false, sliderVal)}
                    disabled={fanApplying || !isAuto}
                    className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-all border
                      ${!isAuto
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-neutral-800 text-neutral-500 border-[#1e2530] hover:text-amber-400'}`}
                  >
                    Manual
                  </button>
                </div>

                {!isAuto && (
                  <div className="flex-1 min-w-[140px]">
                    <input
                      type="range" min={0} max={100} value={sliderVal}
                      onChange={e => setSliderVal(parseInt(e.target.value))}
                      className="w-full h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400
                        [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(34,211,238,0.4)]
                        [&::-webkit-slider-thumb]:cursor-pointer
                        [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3
                        [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyan-400
                        [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #06b6d4 ${sliderVal}%, #1e2530 ${sliderVal}%)`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </GlassCard>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickStat icon={<Cpu size={14} />} label="Heap" value={formatBytes(si?.memory?.heapUsed)} sub={`of ${formatBytes(si?.memory?.heapTotal)}`} color="text-green-400" />
          <QuickStat icon={<HardDrive size={14} />} label="FDs / Conn" value={`${si?.fdCount ?? 0} / ${si?.connCount ?? 0}`} color="text-yellow-400" />
        </div>

        {/* Disk I/O Totals */}
        {overview?.diskIo && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <QuickStat icon={<ArrowDown size={14} />} label="Total Read" value={formatBytes(overview.diskIo.totalReadBytes)} sub={`since ${overview.diskIo.sinceHours}h ago`} color="text-green-400" />
            <QuickStat icon={<ArrowUp size={14} />} label="Total Written" value={formatBytes(overview.diskIo.totalWriteBytes)} sub={`since ${overview.diskIo.sinceHours}h ago`} color="text-blue-400" />
          </div>
        )}

        {/* Bottom Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <GlassCard title="Docker" data-debug-id="2.2.16" data-debug-name="OverviewDockerStats" data-debug-type="card">
            <div className="px-4 pb-4 space-y-2">
              {overview?.dockerInfo ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="flex justify-between"><span className="text-neutral-500">Running</span><span className="text-green-400 font-mono">{overview.dockerInfo.containersRunning}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-500">Stopped</span><span className="text-red-400 font-mono">{overview.dockerInfo.containersStopped}</span></div>
                  </div>
                  {overview.dockerContainers?.length > 0 && (
                    <div className="border-t border-[#1e2530] pt-2 mt-2 space-y-1 max-h-40 overflow-y-auto">
                      {overview.dockerContainers.map(c => {
                        const name = c.Names?.[0]?.replace(/^\//, '') || c.Id?.slice(0, 12);
                        const isRunning = c.State === 'running';
                        return (
                          <div key={c.Id} className="flex items-center justify-between text-[10px] gap-2">
                            <span className={`truncate font-mono ${isRunning ? 'text-neutral-300' : 'text-neutral-500'}`}>{name}</span>
                            <span className={`flex-shrink-0 ${isRunning ? 'text-green-400' : 'text-red-400'}`}>{c.Status}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : <div className="text-xs text-neutral-600">Loading...</div>}
            </div>
          </GlassCard>

          <GlassCard title="Services" data-debug-id="2.2.17" data-debug-name="OverviewServices" data-debug-type="card">
            <div className="px-4 pb-4 space-y-2">
              {overview?.servicesCount ? (
                <div className="grid grid-cols-1 gap-2 text-[11px]">
                  <div className="flex justify-between"><span className="text-neutral-500">Total</span><span className="text-neutral-300 font-mono">{overview.servicesCount.total}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">Running</span><span className="text-green-400 font-mono">{overview.servicesCount.running}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">Failed</span><span className="text-red-400 font-mono">{overview.servicesCount.failed}</span></div>
                </div>
              ) : <div className="text-xs text-neutral-600">Loading...</div>}
            </div>
          </GlassCard>

          <GlassCard title="Recent Alerts" data-debug-id="2.2.18" data-debug-name="OverviewAlerts" data-debug-type="card">
            <div className="px-4 pb-4 space-y-1.5">
              {recentAlerts.length === 0 && <div className="text-xs text-neutral-600">No recent alerts</div>}
              {recentAlerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <AlertTriangle size={12} className={`flex-shrink-0 mt-0.5 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div className="min-w-0">
                    <span className="text-neutral-400 truncate block">{a.metric} {a.severity}</span>
                    <span className="text-neutral-600 text-[10px]">{a.value} ({new Date(a.timestamp).toLocaleTimeString()})</span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Recent Logs */}
        {recentLogs.length > 0 && (
          <GlassCard title="Recent Logs" data-debug-id="2.2.19" data-debug-name="OverviewLogs" data-debug-type="card">
            <div className="px-4 pb-4 max-h-48 overflow-y-auto">
              <div className="space-y-0.5 font-mono text-[10px]">
                {recentLogs.map((line, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-all ${
                    line.includes('error') || line.includes('Error') ? 'text-red-400' :
                    line.includes('warn') || line.includes('Warn') ? 'text-amber-400' : 'text-neutral-500'
                  }`}>{line}</div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}

export default memo(Overview);
