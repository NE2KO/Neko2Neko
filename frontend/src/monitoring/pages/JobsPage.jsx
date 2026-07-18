import { useState, useEffect, useCallback, useRef } from 'react';
import GlassCard from '../shared/GlassCard';
import Skeleton from '../shared/Skeleton';
import { RefreshCw, Cpu, HardDrive, Activity, Zap, Clock, CheckCircle, AlertTriangle, Loader } from 'lucide-react';

function EnginePulse({ active }) {
  return (
    <div className="relative w-3 h-3">
      <span className={`absolute inset-0 rounded-full ${active ? 'bg-emerald-400 animate-ping opacity-75' : 'bg-neutral-600'}`} />
      <span className={`relative block w-3 h-3 rounded-full ${active ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
    </div>
  );
}

function StatBlock({ icon, label, value, color = 'text-neutral-300', sub }) {
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
}

function ProgressBar({ value, max, color = 'bg-cyan-500/60', animated = false }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${color} ${animated ? 'transition-all duration-1000 ease-out' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function JobsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/monitoring/jobs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
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
    intervalRef.current = setInterval(() => fetchData(false), 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="p-3 md:p-6">
      <div data-debug-id="2.18.1" data-debug-name="JobList" data-debug-type="list" className="max-w-4xl mx-auto space-y-3 md:space-y-4">
          <Skeleton />
          <Skeleton />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-3 md:p-6">
        <div className="max-w-4xl mx-auto">
           <GlassCard data-debug-id="2.18.3" data-debug-name="JobsOverviewCard" data-debug-type="card">
            <div className="p-8 text-center">
              <AlertTriangle size={24} className="mx-auto mb-2 text-red-400" />
              <p className="text-sm text-neutral-400">Failed to load job data</p>
              <p className="text-xs text-neutral-600 mt-1">{error}</p>
              <button onClick={() => fetchData()} className="mt-3 px-3 py-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg text-xs hover:bg-cyan-500/20">
                Retry
              </button>
            </div>
          </GlassCard>
        </div>
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
    <div className="p-3 md:p-6" data-debug-id="2.18" data-debug-name="JobsPage" data-debug-type="container">
      <div className="max-w-4xl mx-auto space-y-3 md:space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-neutral-100">Background Jobs</h1>
            <p className="text-xs text-neutral-500 mt-0.5">Engine polling and file watcher status</p>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Engine Status */}
        <GlassCard data-debug-id="2.18.2" data-debug-name="JobItem" data-debug-type="card" title="Engine" subtitle="Monitoring poll loop">
          <div className="p-4 space-y-4">
            {/* Status indicator */}
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

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatBlock
                data-debug-id="2.18.3.1" data-debug-name="StatPollInterval" data-debug-type="card"
                icon={<Clock size={14} />}
                label="Poll Interval"
                value={`${pollMs}ms`}
                color="text-cyan-400"
                sub={`${(1000 / pollMs).toFixed(1)} polls/sec`}
              />
              <StatBlock
                data-debug-id="2.18.3.2" data-debug-name="StatCollectors" data-debug-type="card"
                icon={<Cpu size={14} />}
                label="Collectors"
                value="6 Active"
                color="text-emerald-400"
                sub="CPU RAM GPU Disk Net Sys"
              />
              <StatBlock
                data-debug-id="2.18.3.3" data-debug-name="StatHistory" data-debug-type="card"
                icon={<Zap size={14} />}
                label="History"
                value="5s interval"
                color="text-amber-400"
                sub="SQLite 7-day retention"
              />
              <StatBlock
                data-debug-id="2.18.3.4" data-debug-name="StatAlerts" data-debug-type="card"
                icon={<Activity size={14} />}
                label="Alerts"
                value="Active"
                color="text-purple-400"
                sub="Threshold checking"
              />
            </div>

            {/* Visual pulse bar */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-1.5">
                <span>Engine Activity</span>
                <span className="font-mono tabular-nums">poll every {pollMs}ms</span>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-2 rounded-sm"
                    style={{
                      backgroundColor: engineRunning
                        ? `rgba(34, 197, 94, ${0.15 + Math.random() * 0.6})`
                        : 'rgba(255,255,255,0.03)',
                      animation: engineRunning ? `pulse ${1 + Math.random() * 2}s ease-in-out infinite` : 'none',
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Watcher Status */}
        <GlassCard data-debug-id="2.18.2" data-debug-name="JobItem" data-debug-type="card" title="File Watcher" subtitle="Media library scanner">
          <div className="p-4 space-y-4">
            {/* Status indicator */}
            <div className="flex items-center gap-3">
              {watcherActive ? (
                <Loader size={18} className="text-cyan-400 animate-spin" />
              ) : pendingRescan ? (
                <AlertTriangle size={18} className="text-amber-400" />
              ) : (
                <CheckCircle size={18} className="text-emerald-400" />
              )}
              <div>
                <span className={`text-sm font-semibold ${
                  watcherActive ? 'text-cyan-400' : pendingRescan ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {watcherActive ? 'Scanning...' : pendingRescan ? 'Rescan Pending' : 'Idle'}
                </span>
                <span className="text-[11px] text-neutral-600 ml-2">
                  {watcherActive ? 'Processing media files' : pendingRescan ? 'Waiting to start' : 'No active scan'}
                </span>
              </div>
            </div>

            {/* Progress bar for active scan */}
            {watcherActive && total > 0 && (
              <div>
                <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-1.5">
                  <span>Progress</span>
                  <span className="font-mono tabular-nums">{processed} / {total} files ({watcherProgress}%)</span>
                </div>
                <ProgressBar value={processed} max={total} color="bg-cyan-500/60" animated />
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <StatBlock
                data-debug-id="2.18.3.5" data-debug-name="StatWatcherStatus" data-debug-type="card"
                icon={<HardDrive size={14} />}
                label="Status"
                value={watcherActive ? 'Active' : 'Idle'}
                color={watcherActive ? 'text-cyan-400' : 'text-neutral-400'}
              />
              <StatBlock
                data-debug-id="2.18.3.6" data-debug-name="StatPendingRescan" data-debug-type="card"
                icon={<Activity size={14} />}
                label="Pending Rescan"
                value={pendingRescan ? 'Yes' : 'No'}
                color={pendingRescan ? 'text-amber-400' : 'text-neutral-400'}
              />
              <StatBlock
                data-debug-id="2.18.3.7" data-debug-name="StatFilesProcessed" data-debug-type="card"
                icon={<RefreshCw size={14} />}
                label="Files Processed"
                value={`${processed}`}
                color="text-neutral-300"
                sub={total > 0 ? `of ${total} total` : ''}
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
