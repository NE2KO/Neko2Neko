import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import useMonitoringStore from '../stores/monitoringStore';
import StatusBadge from '../shared/StatusBadge';

function formatTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatBytes(b) {
  if (b == null || b === 0) return '0';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)}`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)}`;
  return `${(b / 1024).toFixed(0)}`;
}

function formatBytesUnit(b) {
  if (b == null || b === 0) return '';
  if (b >= 1073741824) return 'GB';
  if (b >= 1048576) return 'MB';
  return 'KB';
}

function TopBar({ onToggleSidebar, onBackToMedia }) {
  const navigate = useNavigate();
  const timeRef = useRef(null);
  const stats = useMonitoringStore(s => s.stats);
  const lastUpdated = useMonitoringStore(s => s.lastUpdated);
  const connected = useMonitoringStore(s => s.connected);
  const setAlertCount = useMonitoringStore(s => s.setAlertCount);

  const cpuPct = stats?.cpu?.usedPercent;
  const ramUsed = stats?.ram?.used;
  const ramTotal = stats?.ram?.total;
  const ramPct = stats?.ram?.usedPercent;
  const diskPct = stats?.disk?.main?.usedPercent;
  const gpuPct = stats?.gpu?.usedPercent;
  const gpuVramPct = stats?.gpu?.vramUsedPercent;

  const [freq, setFreq] = useState({ current: null, max: null, hardwareMax: null });
  const [hw, setHw] = useState({ fan: null, battery: null });
  const [alerts, setAlerts] = useState(0);
  const alertRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      if (timeRef.current) timeRef.current.textContent = formatTime(new Date());
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, []);

  const fetchFreq = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/cpu-freq');
      if (res.ok) setFreq(await res.json());
    } catch {}
  }, []);

  const fetchHw = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/hardware');
      if (res.ok) {
        const d = await res.json();
        setHw({ fan: d.fan || null, battery: d.battery || null });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchFreq();
    fetchHw();
    const id = setInterval(() => { fetchFreq(); fetchHw(); }, 5000);
    return () => clearInterval(id);
  }, [fetchFreq, fetchHw]);

  const fetchActiveAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/alerts');
      if (!res.ok) return;
      const data = await res.json();
      const cutoff = Date.now() - 5 * 60 * 1000;
      const count = data.history ? data.history.filter(e => new Date(e.timestamp).getTime() > cutoff).length : 0;
      setAlertCount(count);
      if (alertRef.current) alertRef.current.textContent = count;
    } catch {}
  }, [setAlertCount]);

  useEffect(() => {
    fetchActiveAlerts();
    const id = setInterval(fetchActiveAlerts, 30000);
    return () => clearInterval(id);
  }, [fetchActiveAlerts]);

  const now = Date.now();
  const stale = lastUpdated && (now - lastUpdated) > 10000;
  const isLive = (connected || cpuPct != null || ramPct != null) && !stale;

  const cpuLabel = freq.current != null && freq.hardwareMax != null
    ? `${(freq.current / 1000).toFixed(1)} / ${(freq.hardwareMax / 1000).toFixed(1)} GHz`
    : cpuPct != null ? `${cpuPct}%` : null;
  const cpuColor = cpuPct != null ? (cpuPct > 85 ? 'text-red-400' : cpuPct > 65 ? 'text-amber-400' : 'text-emerald-400') : 'text-neutral-400';

  const ramLabel = ramUsed != null && ramTotal != null
    ? `${formatBytes(ramUsed)} / ${formatBytes(ramTotal)} ${formatBytesUnit(ramTotal)}`
    : ramPct != null ? `${ramPct}%` : null;
  const ramColor = ramPct != null ? (ramPct > 90 ? 'text-red-400' : ramPct > 75 ? 'text-amber-400' : 'text-emerald-400') : 'text-neutral-400';

  const gpuLabel = gpuPct != null ? `${gpuPct}%` : null;
  const gpuColor = gpuPct != null ? (gpuPct > 85 ? 'text-red-400' : gpuPct > 65 ? 'text-amber-400' : 'text-emerald-400') : 'text-neutral-400';

  const fanLabel = hw.fan?.speed != null ? `${hw.fan.speed}%` : null;

  const batPercent = hw.battery?.available ? hw.battery.percent : null;
  const batLabel = batPercent != null ? `${batPercent}%` : null;

  return (
    <div data-debug-id="2.1.2" data-debug-name="TopBar" data-debug-type="container" className="h-9 bg-[#0d1117] border-b border-[#1e2530] flex items-center px-2 sm:px-3 gap-2 sm:gap-3 flex-shrink-0">
      <button onClick={onToggleSidebar} className="p-1 rounded text-cyan-500 hover:text-cyan-400 hover:bg-neutral-800/50 md:hidden" title="Monitoring menu">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
      </button>

      <div className="flex items-center gap-2 sm:gap-3 ml-1 sm:ml-4 min-w-0 overflow-x-auto flex-1">
        {cpuLabel && <MiniStat data-debug-id="2.1.2.4" data-debug-name="MiniStatCpu" data-debug-type="other" label="CPU" value={cpuLabel} color={cpuColor} />}
        {ramLabel && <MiniStat data-debug-id="2.1.2.5" data-debug-name="MiniStatRam" data-debug-type="other" label="RAM" value={ramLabel} color={ramColor} />}
        {diskPct != null && <MiniStat data-debug-id="2.1.2.6" data-debug-name="MiniStatDisk" data-debug-type="other" label="DISK" value={`${diskPct}%`} color={diskPct > 90 ? 'text-red-400' : diskPct > 75 ? 'text-amber-400' : 'text-emerald-400'} hideOnMobile />}
        {gpuLabel && <MiniStat data-debug-id="2.1.2.7" data-debug-name="MiniStatGpu" data-debug-type="other" label="GPU" value={gpuLabel} color={gpuColor} />}
        {fanLabel && <MiniStat data-debug-name="MiniStatFan" data-debug-type="other" label="Fan" value={fanLabel} color="text-neutral-400" />}
        {batLabel && <MiniStat data-debug-name="MiniStatBat" data-debug-type="other" label="Bat" value={batLabel} color={batPercent < 20 ? 'text-red-400' : batPercent < 50 ? 'text-amber-400' : 'text-emerald-400'} />}
      </div>

      <div className="flex items-center gap-2 sm:gap-3 ml-auto min-w-0 flex-shrink-0">
        {alerts > 0 && (
          <button data-debug-id="2.1.2.2" data-debug-name="AlertBadge" data-debug-type="other" onClick={() => navigate('/alerts')} className="flex items-center gap-1 text-[11px] text-red-400 flex-shrink-0 hover:text-red-300 transition-colors cursor-pointer">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span ref={alertRef} className="hidden sm:inline">{alerts} alert{alerts > 1 ? 's' : ''}</span>
            <span className="sm:hidden">{alerts}</span>
          </button>
        )}
        {stale && (
          <div className="flex items-center gap-1 text-[11px] text-amber-400 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="hidden sm:inline">Stale</span>
          </div>
        )}
        <StatusBadge status={isLive ? 'active' : 'inactive'} label={isLive ? 'Live' : '...'} pulse={connected} />
        <span ref={timeRef} data-debug-id="2.1.2.1" data-debug-name="Clock" data-debug-type="other" className="text-[11px] text-neutral-600 font-mono tabular-nums hidden sm:inline">--:--:--</span>
      </div>
    </div>
  );
}

const MiniStat = memo(function MiniStat({ label, value, color, hideOnMobile = false, ...rest }) {
  return (
    <div {...rest} className={`flex items-center gap-1 text-[11px] min-w-0 ${hideOnMobile ? 'hidden sm:flex' : ''}`}>
      <span className="text-neutral-600 flex-shrink-0">{label}</span>
      <span className={`font-mono tabular-nums font-semibold ${color} truncate`}>{value}</span>
    </div>
  );
});

export default memo(TopBar);
