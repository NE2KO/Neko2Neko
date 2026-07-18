import { useState, useEffect, useCallback, useRef } from 'react';
import GlassCard from '../shared/GlassCard';
import LogTerminal from '../components/LogTerminal';
import { Film, Music, Image, Database, HardDrive, FileVideo, RefreshCw, Play, Clock, Upload, Cpu, Monitor, X } from 'lucide-react';
import { formatBytes } from '../../utils/format.js';
import useMonitoringStore from '../stores/monitoringStore.js';

function formatNumber(n) {
  if (!n) return '0';
  return n.toLocaleString();
}

export default function MediaStatsPage() {
  const [media, setMedia] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genSpeed, setGenSpeed] = useState(null);
  const prevThumbs = useRef(null);
  const prevTime = useRef(null);
  const thumbStats = useMonitoringStore(s => s.stats?.thumbnails);
  const cpuStats = useMonitoringStore(s => s.stats?.cpu);
  const gpuStats = useMonitoringStore(s => s.stats?.gpu);

  const fetchMedia = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/media');
      if (res.ok) {
        const data = await res.json();
        // Calculate generation speed (thumbnails/sec)
        if (prevThumbs.current !== null && prevTime.current !== null) {
          const dt = (Date.now() - prevTime.current) / 1000;
          if (dt > 0) {
            const delta = (data.thumbnails.onDisk - prevThumbs.current);
            setGenSpeed(delta / dt);
          }
        }
        prevThumbs.current = data.thumbnails.onDisk;
        prevTime.current = Date.now();
        setMedia(data);
      }
    } catch {}
  }, []);

  const doRefresh = async () => {
    await fetchMedia();
  };

  const doGenerateThumbnails = async () => {
    setGenerating(true);
    try {
      await fetch('/api/monitoring/media/thumbnails/generate', { method: 'POST' });
    } catch {}
  };

  // Auto-stop generating when queue finishes
  useEffect(() => {
    if (generating && thumbStats && !thumbStats.processing && !thumbStats.scanRunning && thumbStats.pending === 0 && thumbStats.startedAt === null && thumbStats.totalProcessed > 0) {
      setTimeout(() => setGenerating(false), 2000);
    }
  }, [generating, thumbStats]);

  useEffect(() => {
    fetchMedia();
    const id = setInterval(fetchMedia, 3000);
    return () => clearInterval(id);
  }, [fetchMedia]);

  if (!media) {
    return (
      <div className="p-4 md:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-20 text-neutral-600 text-xs">Loading media stats...</div>
        </div>
      </div>
    );
  }

  const total = media.totalFiles || 1;
  const vidPct = Math.round((media.videos / total) * 100);
  const audPct = Math.round((media.audio / total) * 100);
  const imgPct = Math.round((media.images / total) * 100);
  const thumbPct = Math.round((media.thumbnails.onDisk / total) * 100);

  return (
    <div className="p-4 md:p-6" data-debug-id="2.12" data-debug-name="MediaStatsPage" data-debug-type="container">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <FileVideo size={12} /> Media Library
          </h2>
          <div className="flex items-center gap-2">
            {genSpeed !== null && (
              <span className="text-[10px] text-neutral-600 font-mono tabular-nums flex items-center gap-1">
                <Clock size={10} />
                {genSpeed >= 0 ? `+${genSpeed.toFixed(1)}` : genSpeed.toFixed(1)} thumb/s
              </span>
            )}
            <button onClick={doRefresh}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 hover:border-neutral-700 transition-colors">
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Cards Row (non-gauge) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-debug-id="2.12.1" data-debug-name="StatsCards" data-debug-type="grid">
          <GlassCard data-debug-id="2.12.1.1" data-debug-name="StatTotalFiles" data-debug-type="card">
            <div className="p-4">
              <div className="text-[10px] text-neutral-600 mb-0.5">Total Files</div>
              <div className="text-lg font-mono tabular-nums text-neutral-200">{formatNumber(total)}</div>
            </div>
          </GlassCard>
          <GlassCard data-debug-id="2.12.1.2" data-debug-name="StatTotalSize" data-debug-type="card">
            <div className="p-4">
              <div className="text-[10px] text-neutral-600 mb-0.5">Database</div>
              <div className="text-lg font-mono tabular-nums text-neutral-200">{formatBytes(media.database.total)}</div>
            </div>
          </GlassCard>
          <GlassCard data-debug-id="2.12.1.3" data-debug-name="StatVideoCount" data-debug-type="card">
            <div className="p-4">
              <div className="text-[10px] text-neutral-600 mb-0.5">Thumbnails</div>
              <div className="text-lg font-mono tabular-nums text-neutral-200">{formatNumber(media.thumbnails.onDisk)}</div>
            </div>
          </GlassCard>
          <GlassCard data-debug-id="2.12.1.4" data-debug-name="StatAudioCount" data-debug-type="card">
            <div className="p-4">
              <div className="text-[10px] text-neutral-600 mb-0.5">Missing</div>
              <div className="text-lg font-mono tabular-nums text-red-400">{formatNumber(media.thumbnails.missing)}</div>
            </div>
          </GlassCard>
        </div>

        {/* Type Distribution Gauges (share of total files) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-debug-id="2.12.2" data-debug-name="TypeDistribution" data-debug-type="grid">
          <GaugeCard pct={vidPct} label="Videos" valueLabel={formatNumber(media.videos)} color="blue" icon={<Film size={14} />} />
          <GaugeCard pct={audPct} label="Audio" valueLabel={formatNumber(media.audio)} color="purple" icon={<Music size={14} />} />
          <GaugeCard pct={imgPct} label="Images" valueLabel={formatNumber(media.images)} color="green" icon={<Image size={14} />} />
        </div>

        {/* Detail Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4" data-debug-id="2.12.3" data-debug-name="FileBreakdown" data-debug-type="grid">
          <GlassCard title="File Breakdown" data-debug-id="2.12.3" data-debug-name="FileBreakdownCard" data-debug-type="card">
            <div className="px-4 pb-4 space-y-1">
              <StatRow label="Total Files" value={formatNumber(total)} />
              <StatRow label="Videos" value={`${formatNumber(media.videos)} (${vidPct}%)`} />
              <StatRow label="Audio" value={`${formatNumber(media.audio)} (${audPct}%)`} />
              <StatRow label="Images" value={`${formatNumber(media.images)} (${imgPct}%)`} />
              <StatRow label="Other" value={formatNumber(media.other)} />
            </div>
          </GlassCard>

          <GlassCard title="Database" data-debug-id="2.12.4" data-debug-name="DatabaseInfo" data-debug-type="card">
            <div className="px-4 pb-4 space-y-1">
              <StatRow label="DB File" value={formatBytes(media.database.size)} />
              <StatRow label="WAL" value={formatBytes(media.database.walSize)} />
              <StatRow label="Total" value={formatBytes(media.database.total)} />
            </div>
          </GlassCard>
        </div>

        {/* Thumbnail Section */}
        <div data-debug-id="2.12.5" data-debug-name="ThumbnailSection" data-debug-type="panel">
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Database size={12} /> Thumbnail Generation
          </h2>
           <GlassCard data-debug-id="2.12.5" data-debug-name="ThumbnailSectionCard" data-debug-type="card">
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] text-neutral-600">On Disk</div>
                  <div className="text-sm font-mono tabular-nums text-neutral-200">{formatNumber(media.thumbnails.onDisk)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-600">In Database</div>
                  <div className="text-sm font-mono tabular-nums text-neutral-200">{formatNumber(media.thumbnails.inDb)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-600">Missing</div>
                  <div className="text-sm font-mono tabular-nums text-red-400">{formatNumber(media.thumbnails.missing)}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-1">
                  <span>Coverage</span>
                  <span>{thumbPct}%</span>
                </div>
                <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full transition-all duration-500" style={{ width: `${thumbPct}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={doGenerateThumbnails} disabled={generating}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 text-cyan-400 text-xs rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors">
                  <Play size={12} className={generating ? 'animate-pulse' : ''} />
                  {generating ? 'Generating...' : 'Generate Missing Thumbnails'}
                </button>
                <span className="text-[10px] text-neutral-600">
                  {media.thumbnails.missing > 0
                    ? `${formatNumber(media.thumbnails.missing)} pending — generated in background`
                    : 'All thumbnails are ready'}
                  {media.thumbnails.skipped > 0 && (
                    <span className="ml-2 text-neutral-700">({formatNumber(media.thumbnails.skipped)} skipped)</span>
                  )}
                </span>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Real-time Thumbnail Generation Progress */}
        {generating && thumbStats && (
          <div>
            <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Play size={12} className="animate-pulse text-cyan-400" /> Generating Thumbnails
            </h2>
            <GlassCard>
              <div className="p-4 space-y-3">
                {(() => {
                  const total = (thumbStats.totalProcessed + thumbStats.totalSkipped + thumbStats.pending) || 1;
                  const completed = thumbStats.totalProcessed + thumbStats.totalSkipped;
                  const pct = Math.min(Math.round((completed / total) * 100), 100);
                  const elapsed = thumbStats.startedAt ? (Date.now() - thumbStats.startedAt) / 1000 : 0;
                  const speed = elapsed > 0 ? thumbStats.totalProcessed / elapsed : 0;
                  const eta = speed > 0 ? thumbStats.pending / speed : 0;
                  const isPaused = thumbStats.paused;
                  const isDone = !thumbStats.processing && !thumbStats.scanRunning && thumbStats.pending === 0 && thumbStats.startedAt === null;

                  const formatEta = (s) => {
                    if (s < 60) return `${Math.round(s)}s`;
                    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
                    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
                  };

                  const doPause = async () => {
                    const res = await fetch('/api/monitoring/queues/thumbnail/pause', { method: 'POST' });
                    if (res.ok) { const data = await res.json(); if (data.paused) setGenerating(true); }
                  };
                  const doResume = async () => {
                    const res = await fetch('/api/monitoring/queues/thumbnail/resume', { method: 'POST' });
                    if (res.ok) { const data = await res.json(); if (!data.paused) setGenerating(true); }
                  };
                  const doStop = async () => {
                    await fetch('/api/monitoring/queues/thumbnail/stop', { method: 'POST' });
                    setGenerating(false);
                  };

                  return (
                    <>
                      {isDone ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-green-400 text-xs">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            All thumbnails generated
                          </div>
                          <button onClick={() => setGenerating(false)} className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors">Dismiss</button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
                            <span>{formatNumber(completed)} / {formatNumber(total)} files</span>
                            <span>{isPaused ? 'Paused' : `${pct}%`}</span>
                          </div>
                          <div className="w-full h-3 bg-neutral-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ease-out ${isPaused ? 'bg-yellow-500' : ''}`}
                              style={{
                                width: `${pct}%`,
                                background: isPaused ? undefined : 'linear-gradient(90deg, #06b6d4, #22d3ee)',
                              }}
                            />
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                            <div>
                              <div className="text-[10px] text-neutral-600">Speed</div>
                              <div className="text-xs font-mono tabular-nums text-cyan-400">{isPaused ? '—' : `${speed.toFixed(1)} thumb/s`}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-neutral-600">ETA</div>
                              <div className="text-xs font-mono tabular-nums text-neutral-300">{isPaused ? '—' : formatEta(eta)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-neutral-600">Queue</div>
                              <div className="text-xs font-mono tabular-nums text-yellow-400">{formatNumber(thumbStats.pending)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-neutral-600">Skipped</div>
                              <div className="text-xs font-mono tabular-nums text-neutral-400">{formatNumber(thumbStats.totalSkipped)}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/60">
                            {isPaused ? (
                              <button onClick={doResume}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 rounded hover:bg-green-500/20 transition-colors">
                                <Play size={10} /> Resume
                              </button>
                            ) : (
                              <button onClick={doPause}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded hover:bg-yellow-500/20 transition-colors">
                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                Pause
                              </button>
                            )}
                            <button onClick={doStop}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors">
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>
                              Stop
                            </button>
                          </div>
                        </>
                      )}
                      {/* CPU / GPU */}
                      <div className="flex items-center gap-4 pt-2 border-t border-neutral-800/60">
                        <div className="flex items-center gap-1.5">
                          <Cpu size={12} className="text-blue-400" />
                          <span className="text-[10px] text-neutral-500">CPU</span>
                          <span className="text-xs font-mono tabular-nums text-neutral-300">
                            {cpuStats?.usedPercent != null ? `${Math.round(cpuStats.usedPercent)}%` : '—'}
                          </span>
                        </div>
                  <div className="flex items-center gap-1.5">
                    <Monitor size={12} className="text-purple-400" />
                    <span className="text-[10px] text-neutral-500">iGPU</span>
                    <span className="text-xs font-mono tabular-nums text-neutral-300">
                      {gpuStats?.vaapi ? (
                        <>
                          <span className="text-green-400">VAAPI</span>
                          {gpuStats?.usedPercent != null && <span className="ml-1">{Math.round(gpuStats.usedPercent)}%</span>}
                        </>
                      ) : gpuStats?.usedPercent != null ? `${Math.round(gpuStats.usedPercent)}%` : '—'}
                    </span>
                  </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </GlassCard>
          </div>
        )}

        {/* Upload Stats */}
        {media.uploads && (
          <div>
            <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Upload size={12} /> Uploads
            </h2>
            <GlassCard data-debug-id="2.12.6" data-debug-name="UploadStatsCard" data-debug-type="card">
              <div className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[10px] text-neutral-600">Today Completed</div>
                    <div className="text-sm font-mono tabular-nums text-neutral-200">{formatNumber(media.uploads.todayCompleted)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-neutral-600">Active</div>
                    <div className="text-sm font-mono tabular-nums text-cyan-400">{formatNumber(media.uploads.active)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-neutral-600">Pending</div>
                    <div className="text-sm font-mono tabular-nums text-neutral-400">{formatNumber(media.uploads.pending)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-neutral-600">Failed</div>
                    <div className="text-sm font-mono tabular-nums text-red-400">{formatNumber(media.uploads.totalFailed)}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-neutral-800/60">
                  <div className="flex items-center gap-2 text-[10px] text-neutral-600">
                    <HardDrive size={10} />
                    <span>Total uploaded: {formatBytes(media.uploads.totalBytes)}</span>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>
        )}

        {/* Actions */}
        <div data-debug-id="2.12.7" data-debug-name="ActionButtons" data-debug-type="other">
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <HardDrive size={12} /> Actions
          </h2>
          <GlassCard data-debug-id="2.12.8" data-debug-name="ActivityLogCard" data-debug-type="card">
            <div className="p-4 flex items-center gap-3">
              <button onClick={() => fetch('/api/files/refresh', { method: 'POST' }).then(() => setTimeout(doRefresh, 2000))}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-800 text-neutral-300 text-xs rounded-lg border border-neutral-700 hover:bg-neutral-700 transition-colors">
                <RefreshCw size={12} />
                Scan Media Folders
              </button>
            </div>
          </GlassCard>
        </div>

        {/* Activity Log */}
        <div>
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            Activity Log
          </h2>
          <LogTerminal height="240px" />
        </div>

      </div>
    </div>
  );
}

function GaugeCard({ pct, label, valueLabel, color, icon }) {
  const colors = {
    cyan: '#06b6d4', blue: '#3b82f6', purple: '#a855f7',
    green: '#22c55e', yellow: '#eab308', red: '#ef4444',
  };
  const c = colors[color] || colors.cyan;
  const sz = 80;
  const cx = sz / 2;
  const cy = sz / 2 - 2;
  const r = sz / 2 - 8;
  const pathLen = Math.PI * r;
  const clamped = Math.min(pct, 99.99);
  const dash = pathLen * (1 - clamped / 100);

  return (
    <GlassCard data-debug-id="2.12.9" data-debug-name="MediaStatsFooter" data-debug-type="card">
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
