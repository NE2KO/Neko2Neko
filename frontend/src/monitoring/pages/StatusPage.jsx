import { useState, useEffect, useCallback, memo } from 'react';
import GlassCard from '../shared/GlassCard';
import ConfirmModal from '../../components/ConfirmModal';
import { RefreshCw, RotateCcw, Globe, Cpu, HardDrive, Wifi, Activity, Clock, Users } from 'lucide-react';
import { formatBytes } from '../../utils/format.js';

let pollTimer = null;

const MiniStat = memo(function MiniStat({ icon, label, value, color }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-neutral-900/40 rounded-lg border border-[#1e2530]">
      <div className={`p-1.5 rounded-md ${color || 'bg-neutral-800'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] text-neutral-600 truncate">{label}</div>
        <div className="text-xs text-neutral-300 font-mono tabular-nums truncate">{value}</div>
      </div>
    </div>
  );
});

export default function StatusPage() {
  const [stats, setStats] = useState(null);
  const [restartingBackend, setRestartingBackend] = useState(false);
  const [restartingFrontend, setRestartingFrontend] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmPower, setConfirmPower] = useState(null);
  const [doubleConfirm, setDoubleConfirm] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/web-stats');
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchStats();
    pollTimer = setInterval(fetchStats, 15000);
    return () => { if (pollTimer) clearInterval(pollTimer); };
  }, [fetchStats]);

  const doRestart = async (type) => {
    if (type === 'backend') setRestartingBackend(true);
    else setRestartingFrontend(true);
    setMessage('');
    try {
      const res = await fetch(`/api/monitoring/restart/${type}`, { method: 'POST' });
      const data = await res.json();
      setMessage(data.message || data.error || 'Done');
      if (data.success && type === 'frontend') {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (e) {
      setMessage(e.message);
    }
    setRestartingBackend(false);
    setRestartingFrontend(false);
  };

  const doSystemPower = (action) => {
    setConfirmPower(action);
  };

  const confirmPowerAction = () => {
    setDoubleConfirm(true);
  };

  const finalConfirmPower = async () => {
    const action = confirmPower;
    setConfirmPower(null);
    setDoubleConfirm(false);
    setMessage('');
    try {
      const res = await fetch('/api/monitoring/system/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`${action} initiated — host will ${action} shortly`);
      } else {
        setMessage(data.error || 'Failed');
      }
    } catch (e) {
      setMessage(e.message);
    }
  };

  if (!stats) {
    return (
      <div className="p-4 md:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-20 text-neutral-600 text-xs">Loading web stats...</div>
        </div>
      </div>
    );
  }

  const memPct = stats.memory ? (stats.memory.heapUsed / stats.memory.heapTotal * 100) : 0;
  const memRssPct = stats.memory ? (stats.memory.rss / (stats.memory.heapTotal || 1) * 100) : 0;

  return (
    <div className="p-4 md:p-6" data-debug-id="2.4" data-debug-name="StatusPage" data-debug-type="container">
      <div className="max-w-7xl mx-auto space-y-4">

        <div>
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Globe size={12} /> Web Server Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <GaugeCard value={Math.min(100, (stats.queueRequestCount / 1000) * 100)} max={100} label="Queue Requests" valueLabel={`${stats.queueRequestCount}`} color="cyan" icon={<Activity size={14} />} />
            <GaugeCard value={Math.round(memPct)} max={100} label="Heap Usage" valueLabel={`${formatBytes(stats.memory?.heapUsed)} / ${formatBytes(stats.memory?.heapTotal)}`} color="green" icon={<Cpu size={14} />} />
            <GaugeCard value={Math.min(stats.fdCount || 0, 100)} max={100} label="Open FDs" valueLabel={`${stats.fdCount}`} color="yellow" icon={<HardDrive size={14} />} />
            <GaugeCard value={Math.min(stats.connCount || 0, 100)} max={100} label="TCP Connections" valueLabel={`${stats.connCount}`} color="purple" icon={<Wifi size={14} />} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <GlassCard title="Server Info" data-debug-id="2.4.3" data-debug-name="ServerInfoCard" data-debug-type="card">
            <div className="px-4 pb-4 space-y-1">
              <StatRow label="Uptime" value={stats.uptimeFormatted} />
              <StatRow label="Started" value={new Date(stats.startedAt).toLocaleString()} />
              <StatRow label="PID" value={`${stats.pid}`} />
              <StatRow label="Node" value={stats.nodeVersion} />
              <StatRow label="Platform" value={`${stats.platform} ${stats.arch}`} />
              <StatRow label="Queue Request Count" value={`${stats.queueRequestCount}`} />
            </div>
          </GlassCard>

          <GlassCard title="Memory" data-debug-id="2.4.4" data-debug-name="MemoryCard" data-debug-type="card">
            <div className="px-4 pb-4 space-y-1">
              <StatRow label="RSS" value={formatBytes(stats.memory?.rss)} />
              <StatRow label="Heap Used" value={formatBytes(stats.memory?.heapUsed)} />
              <StatRow label="Heap Total" value={formatBytes(stats.memory?.heapTotal)} />
              <StatRow label="External" value={formatBytes(stats.memory?.external)} />
              <StatRow label="FD Count" value={`${stats.fdCount}`} />
              <StatRow label="TCP Connections" value={`${stats.connCount}`} />
            </div>
          </GlassCard>
        </div>

        {stats.loadAvg && (
          <GlassCard title="System Load" data-debug-id="2.4.5" data-debug-name="SystemLoadCard" data-debug-type="card">
            <div className="px-4 pb-4">
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-neutral-600">1 min</div>
                  <div className="text-lg font-mono tabular-nums text-neutral-300">{stats.loadAvg['1min'].toFixed(2)}</div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-neutral-600">5 min</div>
                  <div className="text-lg font-mono tabular-nums text-neutral-300">{stats.loadAvg['5min'].toFixed(2)}</div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-neutral-600">15 min</div>
                  <div className="text-lg font-mono tabular-nums text-neutral-300">{stats.loadAvg['15min'].toFixed(2)}</div>
                </div>
              </div>
            </div>
          </GlassCard>
        )}

        {stats.queueRequestsByPath?.length > 0 && (
          <GlassCard title="Top Queue Requests" data-debug-id="2.4.6" data-debug-name="TopQueueCard" data-debug-type="card">
            <div className="px-4 pb-4">
              <div className="space-y-1">
                {stats.queueRequestsByPath.slice(0, 10).map(r => (
                  <div key={r.path} className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                    <span className="text-neutral-500 font-mono text-[10px] truncate min-w-0">{r.path}</span>
                    <span className="text-neutral-300 font-mono">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        <div>
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <RefreshCw size={12} /> Server Controls
          </h2>
          <GlassCard data-debug-id="2.4.7" data-debug-name="StatusServicesCard" data-debug-type="card">
            <div className="p-4">
              <div data-debug-id="2.4.1" data-debug-name="RestartAllButton" data-debug-type="other" className="flex items-center gap-3 flex-wrap">
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg border border-red-500/20 hover:bg-red-500/20 disabled:opacity-40 transition-colors">
                  <RotateCcw size={14} className={restartingBackend ? 'animate-spin' : ''} />
                  {restartingBackend ? 'Restarting...' : 'Restart Backend'}
                </button>
                <button onClick={() => doRestart('frontend')} disabled={restartingFrontend}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-400 text-xs rounded-lg border border-yellow-500/20 hover:bg-yellow-500/20 disabled:opacity-40 transition-colors">
                  <RotateCcw size={14} className={restartingFrontend ? 'animate-spin' : ''} />
                  {restartingFrontend ? 'Rebuilding...' : 'Rebuild Frontend'}
                </button>
              </div>
            </div>
          </GlassCard>
        </div>

        <div>
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" /></svg>
            System Power
          </h2>
          <GlassCard data-debug-id="2.4.8" data-debug-name="StatusDockerCard" data-debug-type="card">
            <div className="p-4">
              <p className="text-[11px] text-neutral-500 mb-3">Control the host machine directly. These actions require sudo privileges.</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => doSystemPower('reboot')}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 text-xs rounded-lg border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
                  <RefreshCw size={14} />
                  Reboot Host
                </button>
                <button onClick={() => doSystemPower('shutdown')}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/10 text-red-400 text-xs rounded-lg border border-red-600/20 hover:bg-red-600/20 transition-colors">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" /></svg>
                  Shutdown Host
                </button>
              </div>
            </div>
          </GlassCard>
        </div>

      </div>

      <ConfirmModal
        open={!!confirmPower && !doubleConfirm}
        title={`Confirm ${confirmPower === 'shutdown' ? 'Shutdown' : 'Reboot'}`}
        message={confirmPower === 'shutdown'
          ? 'Are you sure you want to SHUTDOWN the host machine? This will turn off the server.'
          : 'Are you sure you want to REBOOT the host machine?'}
        confirmLabel={confirmPower === 'shutdown' ? 'Yes, Shutdown' : 'Yes, Reboot'}
        danger
        onConfirm={confirmPowerAction}
        onCancel={() => setConfirmPower(null)}
      />
      <ConfirmModal
        open={doubleConfirm}
        title={`Final Confirmation — ${confirmPower === 'shutdown' ? 'Shutdown' : 'Reboot'}`}
        message={`This is your LAST chance. The host machine will ${confirmPower} immediately after confirmation.`}
        confirmLabel={confirmPower === 'shutdown' ? 'SHUTDOWN NOW' : 'REBOOT NOW'}
        danger
        onConfirm={finalConfirmPower}
        onCancel={() => { setDoubleConfirm(false); setConfirmPower(null); }}
      />
    </div>
  );
}

const GaugeCard = memo(function GaugeCard({ value, max, label, valueLabel, color, icon }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const colors = { cyan: '#06b6d4', green: '#22c55e', yellow: '#eab308', purple: '#a855f7' };
  const c = colors[color] || colors.cyan;
  const sz = 80;
  const cx = sz / 2;
  const cy = sz / 2 - 2;
  const r = sz / 2 - 8;
  const pathLen = Math.PI * r;
  const clamped = Math.min(pct, 99.99);
  const dash = pathLen * (1 - clamped / 100);

  return (
    <GlassCard data-debug-id="2.4.9" data-debug-name="StatusControlCard" data-debug-type="card">
      <div className="p-4 flex flex-col items-center justify-center h-full">
        <svg width={sz} height={sz * 0.65} viewBox={`0 0 ${sz} ${sz * 0.65}`}>
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" strokeLinecap="round" />
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke={c} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={pathLen} strokeDashoffset={dash}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
            fill={c} fontSize="11" fontWeight="700" fontFamily="ui-monospace,monospace"
            style={{ fontVariantNumeric: 'tabular-nums' }}>
            {pct}%
          </text>
        </svg>
        <div className="flex items-center gap-1 text-[10px] text-neutral-600 mt-2">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-[10px] text-neutral-500 font-mono tabular-nums truncate max-w-full text-center">{valueLabel}</div>
      </div>
    </GlassCard>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-neutral-500 truncate">{label}</span>
      <span className="text-neutral-300 font-mono tabular-nums flex-shrink-0">{value}</span>
    </div>
  );
}
