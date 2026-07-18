import { useState, useEffect, useCallback, useRef, memo } from 'react';
import GlassCard from '../shared/GlassCard';
import { Layers, Pause, Play, Trash2, RefreshCw, RotateCcw, Clock, CheckCircle, XCircle, Cpu, HardDrive, Activity, Zap, AlertTriangle, Loader } from 'lucide-react';

const EnginePulse = memo(function EnginePulse({ active }) {
  return (
    <div className="relative w-3 h-3">
      <span className={`absolute inset-0 rounded-full ${active ? 'bg-emerald-400 animate-ping opacity-75' : 'bg-neutral-600'}`} />
      <span className={`relative block w-3 h-3 rounded-full ${active ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
    </div>
  );
});

const ProgressBar = memo(function ProgressBar({ value, max, color = 'bg-cyan-500/60', animated = false }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} ${animated ? 'transition-all duration-1000 ease-out' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
});

export default function TasksPage() {
  const [tab, setTab] = useState('engine');
  return (
    <div className="p-3 md:p-6" data-debug-id="2.17" data-debug-name="TasksPage" data-debug-type="container">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('engine')} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${tab === 'engine' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' : 'bg-neutral-900/50 text-neutral-500 border border-neutral-800 hover:text-neutral-300'}`}>
            Engine & Watcher
          </button>
          <button onClick={() => setTab('queues')} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${tab === 'queues' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' : 'bg-neutral-900/50 text-neutral-500 border border-neutral-800 hover:text-neutral-300'}`}>
            Queues
          </button>
        </div>
        {tab === 'engine' ? <EngineTab /> : <QueueTab />}
      </div>
    </div>
  );
}

/* ──────────── ENGINE TAB ──────────── */
function EngineTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/monitoring/jobs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading && !data) {
    return <div className="text-neutral-500 text-xs py-8 text-center">Loading...</div>;
  }

  if (error && !data) {
    return (
      <div className="text-center py-8">
        <AlertTriangle size={24} className="mx-auto mb-2 text-red-400" />
        <p className="text-sm text-neutral-400">Failed to load</p>
        <button onClick={() => fetchData()} className="mt-2 px-3 py-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg text-xs">Retry</button>
      </div>
    );
  }

  const { engine = {}, watcher = {} } = data || {};
  const engineRunning = engine.running !== false;
  const pollMs = engine.pollIntervalMs || 1000;
  const watcherActive = watcher.isScanning || false;
  const pendingRescan = watcher.pendingRescan || false;
  const processed = watcher.processedFiles ?? watcher.processed ?? 0;
  const total = watcher.totalFiles ?? watcher.total ?? 0;
  const watcherProgress = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Engine */}
      <GlassCard data-debug-id="2.17.3" data-debug-name="EngineCard" data-debug-type="card" title="Engine" subtitle="Monitoring poll loop">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <EnginePulse active={engineRunning} />
            <div>
              <span className={`text-sm font-semibold ${engineRunning ? 'text-emerald-400' : 'text-red-400'}`}>
                {engineRunning ? 'Running' : 'Stopped'}
              </span>
              <span className="text-[11px] text-neutral-600 ml-2">
                {engineRunning ? 'Collecting metrics' : 'Engine is offline'}
              </span>
            </div>
          </div>
          <div data-debug-id="2.17.1.3" data-debug-name="TaskList" data-debug-type="list" className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBlock data-debug-id="2.17.3.1" data-debug-name="StatPollInterval" data-debug-type="card" icon={<Clock size={14} />} label="Poll Interval" value={`${pollMs}ms`} color="text-cyan-400" sub={`${(1000 / pollMs).toFixed(1)} polls/sec`} />
            <StatBlock data-debug-id="2.17.3.2" data-debug-name="StatCollectors" data-debug-type="card" icon={<Cpu size={14} />} label="Collectors" value="6 Active" color="text-emerald-400" sub="CPU RAM GPU Disk Net Sys" />
            <StatBlock data-debug-id="2.17.3.3" data-debug-name="StatHistory" data-debug-type="card" icon={<Zap size={14} />} label="History" value="5s interval" color="text-amber-400" sub="SQLite 7-day retention" />
            <StatBlock data-debug-id="2.17.3.4" data-debug-name="StatAlerts" data-debug-type="card" icon={<Activity size={14} />} label="Alerts" value="Active" color="text-purple-400" sub="Threshold checking" />
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-1.5">
              <span>Engine Activity</span>
              <span className="font-mono tabular-nums">poll every {pollMs}ms</span>
            </div>
            <div className="flex gap-0.5">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="flex-1 h-2 rounded-sm" style={{
                  backgroundColor: engineRunning ? `rgba(34, 197, 94, ${0.15 + Math.random() * 0.6})` : 'rgba(255,255,255,0.03)',
                  animation: engineRunning ? `pulse ${1 + Math.random() * 2}s ease-in-out infinite` : 'none',
                  animationDelay: `${i * 0.1}s`,
                }} />
              ))}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Watcher */}
      <GlassCard data-debug-id="2.17.4" data-debug-name="WatcherCard" data-debug-type="card" title="File Watcher" subtitle="Media library scanner">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            {watcherActive ? (
              <Loader size={18} className="text-cyan-400 animate-spin" />
            ) : pendingRescan ? (
              <AlertTriangle size={18} className="text-amber-400" />
            ) : (
              <CheckCircle size={18} className="text-emerald-400" />
            )}
            <div>
              <span className={`text-sm font-semibold ${watcherActive ? 'text-cyan-400' : pendingRescan ? 'text-amber-400' : 'text-emerald-400'}`}>
                {watcherActive ? 'Scanning...' : pendingRescan ? 'Rescan Pending' : 'Idle'}
              </span>
              <span className="text-[11px] text-neutral-600 ml-2">
                {watcherActive ? 'Processing media files' : pendingRescan ? 'Waiting to start' : 'No active scan'}
              </span>
            </div>
          </div>
          {watcherActive && total > 0 && (
            <div>
              <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-1.5">
                <span>Progress</span>
                <span className="font-mono tabular-nums">{processed} / {total} files ({watcherProgress}%)</span>
              </div>
              <div data-debug-id="2.17.1.4" data-debug-name="ProgressBar" data-debug-type="chart"><ProgressBar value={processed} max={total} color="bg-cyan-500/60" animated /></div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <StatBlock data-debug-id="2.17.4.1" data-debug-name="StatWatcherStatus" data-debug-type="card" icon={<HardDrive size={14} />} label="Status" value={watcherActive ? 'Active' : 'Idle'} color={watcherActive ? 'text-cyan-400' : 'text-neutral-400'} />
            <StatBlock data-debug-id="2.17.4.2" data-debug-name="StatPendingRescan" data-debug-type="card" icon={<Activity size={14} />} label="Pending Rescan" value={pendingRescan ? 'Yes' : 'No'} color={pendingRescan ? 'text-amber-400' : 'text-neutral-400'} />
            <StatBlock data-debug-id="2.17.4.3" data-debug-name="StatFilesProcessed" data-debug-type="card" icon={<RefreshCw size={14} />} label="Files Processed" value={`${processed}`} color="text-neutral-300" sub={total > 0 ? `of ${total} total` : ''} />
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

/* ──────────── QUEUE TAB ──────────── */
function QueueTab() {
  const [queues, setQueues] = useState([]);
  const [acting, setActing] = useState(null);

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/queues');
      if (res.ok) {
        const data = await res.json();
        setQueues(data.queues || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchQueues();
    const id = setInterval(fetchQueues, 3000);
    return () => clearInterval(id);
  }, [fetchQueues]);

  const doAction = async (type, action) => {
    setActing(`${type}:${action}`);
    try {
      await fetch(`/api/monitoring/queues/${type}/${action}`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 300));
      await fetchQueues();
    } catch {}
    setActing(null);
  };

  const queueIcons = {
    thumbnail: <Layers size={16} className="text-cyan-400" />,
    scan: <RefreshCw size={16} className="text-green-400" />,
  };

  return (
    <div data-debug-id="2.17.2" data-debug-name="QueuesTab" data-debug-type="panel" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
          <Layers size={12} /> Queue Manager
        </h2>
        <button onClick={fetchQueues}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 hover:border-neutral-700 transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {queues.length === 0 && <div className="text-neutral-600 text-xs text-center py-8">No queues</div>}

      {queues.map(q => (
        <GlassCard data-debug-id="2.17.5" data-debug-name="QueueCard" data-debug-type="card" key={q.type}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {queueIcons[q.type] || <Layers size={16} className="text-neutral-500" />}
                <span className="text-sm font-medium text-neutral-300 capitalize">{q.type} Queue</span>
              </div>
              <div className="flex items-center gap-1.5">
                {q.paused !== undefined && (
                  q.paused ? (
                    <button onClick={() => doAction(q.type, 'resume')} disabled={acting === `${q.type}:resume`}
                      className="p-1.5 rounded text-green-500/60 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 transition-colors" title="Resume">
                      <Play size={14} />
                    </button>
                  ) : (
                    <button onClick={() => doAction(q.type, 'pause')} disabled={acting === `${q.type}:pause`}
                      className="p-1.5 rounded text-yellow-500/60 hover:text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-40 transition-colors" title="Pause">
                      <Pause size={14} />
                    </button>
                  )
                )}
                <button onClick={() => doAction(q.type, 'clear')} disabled={acting === `${q.type}:clear`}
                  className="p-1.5 rounded text-red-500/60 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors" title="Clear Queue">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                <div className="text-[10px] text-neutral-600 mb-0.5">Pending</div>
                <div className="text-lg font-mono tabular-nums text-neutral-200">{q.pending || 0}</div>
              </div>
              <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                <div className="text-[10px] text-neutral-600 mb-0.5">Status</div>
                <div className="flex items-center justify-center gap-1 mt-1">
                  {q.processing || q.running ? (
                    <><RotateCcw size={14} className="text-green-400 animate-spin" /><span className="text-xs text-green-400">Running</span></>
                  ) : q.paused ? (
                    <><Pause size={14} className="text-yellow-400" /><span className="text-xs text-yellow-400">Paused</span></>
                  ) : (
                    <><CheckCircle size={14} className="text-neutral-600" /><span className="text-xs text-neutral-500">Idle</span></>
                  )}
                </div>
              </div>
              <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                <div className="text-[10px] text-neutral-600 mb-0.5">Completed</div>
                <div className="text-lg font-mono tabular-nums text-neutral-200">{q.totalProcessed || 0}</div>
              </div>
              <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                <div className="text-[10px] text-neutral-600 mb-0.5">Skipped</div>
                <div className="text-lg font-mono tabular-nums text-yellow-400">{q.totalSkipped || 0}</div>
              </div>
            </div>
            {q.phase && (
              <div className="mt-3 text-[10px] text-neutral-600 font-mono">
                Phase: {q.phase}{q.total > 0 && ` (${q.current}/${q.total})`}
              </div>
            )}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

const StatBlock = memo(function StatBlock({ icon, label, value, color = 'text-neutral-300', sub }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-neutral-900/40 rounded-lg border border-[#1e2530]">
      <div className={`p-1.5 rounded-md bg-neutral-800/80 ${color}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-neutral-600 uppercase tracking-wider">{label}</div>
        <div className={`text-sm font-semibold font-mono tabular-nums truncate ${color}`}>{value}</div>
        {sub && <div className="text-[10px] text-neutral-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
});
