import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Play, Square, RotateCw, Cpu, HardDrive, FileText, ChevronDown, ChevronRight, Trash2, Terminal, Info, X } from 'lucide-react';
import ConfirmModal from '../../components/ConfirmModal';
import { formatBytes } from '../../utils/format.js';

function stateColor(s) {
  if (s === 'running') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
  if (s === 'exited' || s === 'dead') return 'text-red-400 bg-red-400/10 border-red-400/30';
  return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
}

export default function DockerPage() {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [inspectData, setInspectData] = useState({});
  const [logs, setLogs] = useState({});
  const [loadingLogs, setLoadingLogs] = useState({});
  const [loadingInspect, setLoadingInspect] = useState({});
  const [dockerInfo, setDockerInfo] = useState(null);
  const [images, setImages] = useState([]);
  const [showImages, setShowImages] = useState(false);
  const logsEndRef = useRef({});
  const [confirmAction, setConfirmAction] = useState(null);

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/monitoring/docker');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContainers(data.containers || []);
    } catch (err) {
      setError(err.message);
      setContainers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDockerInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/docker-info');
      if (res.ok) setDockerInfo(await res.json());
    } catch {}
  }, []);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/docker-images');
      if (res.ok) {
        const data = await res.json();
        setImages(data.images || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchContainers();
    fetchDockerInfo();
    const id = setInterval(fetchContainers, 5000);
    return () => clearInterval(id);
  }, [fetchContainers, fetchDockerInfo]);

  useEffect(() => {
    if (showImages) fetchImages();
  }, [showImages, fetchImages]);

  const doAction = async (id, action) => {
    if (action === 'remove') {
      setConfirmAction({ id, action });
      return;
    }
    setBusy(b => ({ ...b, [id]: action }));
    try {
      const res = await fetch(`/api/monitoring/docker/${id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Action failed');
      setTimeout(fetchContainers, 500);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(b => ({ ...b, [id]: null }));
    }
  };

  const confirmRemove = async () => {
    if (!confirmAction) return;
    const { id } = confirmAction;
    setConfirmAction(null);
    setBusy(b => ({ ...b, [id]: 'remove' }));
    try {
      const res = await fetch(`/api/monitoring/docker/${id}/remove`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Action failed');
      setTimeout(fetchContainers, 500);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(b => ({ ...b, [id]: null }));
    }
  };

  const fetchLogs = async (id) => {
    setLoadingLogs(b => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/monitoring/docker/${id}/logs?tail=100`);
      if (res.ok) {
        const data = await res.json();
        setLogs(b => ({ ...b, [id]: data.logs || [] }));
      }
    } catch {}
    setLoadingLogs(b => ({ ...b, [id]: false }));
  };

  const fetchInspect = async (id) => {
    setLoadingInspect(b => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/monitoring/docker/${id}/inspect`);
      if (res.ok) {
        const data = await res.json();
        setInspectData(b => ({ ...b, [id]: data }));
      }
    } catch {}
    setLoadingInspect(b => ({ ...b, [id]: false }));
  };

  const toggleExpand = (id) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!inspectData[id]) fetchInspect(id);
      if (!logs[id]) fetchLogs(id);
    }
  };

  return (
    <div className="p-3 md:p-4 space-y-3 md:space-y-4" data-debug-id="2.16" data-debug-name="DockerPage" data-debug-type="container">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-neutral-100">Docker</h1>
          <p className="text-xs text-neutral-500 mt-0.5">Container management & monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImages(!showImages)}
            className={`px-2 py-1.5 rounded text-xs transition-colors ${showImages ? 'bg-cyan-500/20 text-cyan-400' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
            Images
          </button>
          <button onClick={fetchContainers} className="p-2 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Docker Info Summary */}
      {dockerInfo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <InfoCard label="Running" value={dockerInfo.containersRunning} color="text-emerald-400" />
          <InfoCard label="Stopped" value={dockerInfo.containersStopped} color="text-red-400" />
          <InfoCard label="Images" value={dockerInfo.images} color="text-cyan-400" />
          <InfoCard label="Version" value={dockerInfo.serverVersion} color="text-neutral-300" />
        </div>
      )}

      {error && <div className="p-3 rounded bg-red-900/30 border border-red-700/50 text-red-300 text-sm">Error: {error}</div>}

      {loading && containers.length === 0 && <div className="text-neutral-500 text-sm">Loading containers...</div>}

      {!loading && containers.length === 0 && !error && <div className="text-neutral-500 text-sm">No containers found or Docker unavailable.</div>}

      {/* Images Panel */}
      {showImages && (
        <div className="p-3 rounded bg-neutral-900/50 border border-neutral-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-neutral-400">Docker Images</h3>
            <button onClick={fetchImages} className="text-neutral-600 hover:text-neutral-400 p-1"><RefreshCw size={12} /></button>
          </div>
          {images.length === 0 ? (
            <div className="text-xs text-neutral-600">No images found</div>
          ) : (
            <div data-debug-id="2.16.2" data-debug-name="ImageList" data-debug-type="list" className="space-y-1 max-h-48 overflow-y-auto">
              {images.map(img => (
                <div key={img.id} className="flex items-center justify-between text-[11px] py-1 border-b border-[#1e2530]/30 last:border-0">
                  <span className="text-neutral-400 font-mono truncate max-w-[60%]">{img.tags[0] || img.id.slice(0, 12)}</span>
                  <span className="text-neutral-600">{formatBytes(img.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Containers */}
      <div data-debug-id="2.16.1" data-debug-name="ContainerList" data-debug-type="list" className="space-y-2">
        {containers.map(c => {
          const isExpanded = expandedId === c.id;
          const containerLogs = logs[c.id] || [];
          const containerInspect = inspectData[c.id];
          const isBusy = !!busy[c.id];

          return (
            <div key={c.id} className={`rounded border transition-colors ${isExpanded ? 'bg-neutral-900/70 border-neutral-700' : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'}`}>
              {/* Container Header */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${stateColor(c.state)}`}>
                        {c.state}
                      </span>
                      <span className="text-xs text-neutral-500 font-mono truncate">{c.names?.join?.(' ') || c.id.slice(0, 12)}</span>
                    </div>
                    <div className="text-sm text-neutral-300 font-mono truncate">{c.image}</div>
                    {c.state === 'running' && (
                      <div className="flex gap-3 sm:gap-4 mt-2 text-[11px] text-neutral-400 flex-wrap">
                        <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{c.cpuPercent.toFixed(1)}%</span>
                        <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{c.memPercent.toFixed(1)}% ({formatBytes(c.memUsage)})</span>
                        {c.restartCount > 0 && <span className="text-amber-400">restarts: {c.restartCount}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0 items-center">
                    <button onClick={() => toggleExpand(c.id)} className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400" title="Details">
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    <ActionBtn icon={<Play className="w-3 h-3" />} label="Start" onClick={() => doAction(c.id, 'start')} disabled={isBusy || c.state === 'running'} />
                    <ActionBtn icon={<Square className="w-3 h-3" />} label="Stop" onClick={() => doAction(c.id, 'stop')} disabled={isBusy || c.state !== 'running'} />
                    <ActionBtn icon={<RotateCw className="w-3 h-3" />} label="Restart" onClick={() => doAction(c.id, 'restart')} disabled={isBusy} />
                    <ActionBtn icon={<Trash2 className="w-3 h-3" />} label="Remove" onClick={() => doAction(c.id, 'remove')} disabled={isBusy} danger />
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="border-t border-[#1e2530] p-3 space-y-3">
                  {/* Tabs */}
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => fetchLogs(c.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200">
                      <FileText size={10} /> Logs
                    </button>
                    <button onClick={() => fetchInspect(c.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200">
                      <Info size={10} /> Inspect
                    </button>
                  </div>

                  {/* Logs */}
                  {containerLogs.length > 0 && (
                    <div className="bg-black/40 rounded p-2 max-h-60 overflow-y-auto font-mono text-[10px] text-neutral-400 space-y-0.5">
                      {containerLogs.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">
                          {line.includes('error') || line.includes('Error') ? (
                            <span className="text-red-400">{line}</span>
                          ) : line.includes('warn') || line.includes('Warn') ? (
                            <span className="text-amber-400">{line}</span>
                          ) : (
                            line
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {loadingLogs[c.id] && <div className="text-xs text-neutral-600">Loading logs...</div>}

                  {/* Inspect Details */}
                  {containerInspect && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="space-y-1">
                        <div className="text-neutral-600 font-semibold uppercase text-[10px]">Ports</div>
                        {Object.entries(containerInspect.ports || {}).map(([k, v]) => (
                          <div key={k} className="text-neutral-400 font-mono">{k} {v?.[0] ? `\u2192 ${v[0].HostPort}` : ''}</div>
                        ))}
                        {Object.keys(containerInspect.ports || {}).length === 0 && <div className="text-neutral-600">None</div>}
                      </div>
                      <div className="space-y-1">
                        <div className="text-neutral-600 font-semibold uppercase text-[10px]">Volumes</div>
                        {(containerInspect.mounts || []).map((m, i) => (
                          <div key={i} className="text-neutral-400 font-mono truncate" title={`${m.source} \u2192 ${m.destination}`}>
                            {m.source} <span className="text-neutral-600">→</span> {m.destination}
                          </div>
                        ))}
                        {(containerInspect.mounts || []).length === 0 && <div className="text-neutral-600">None</div>}
                      </div>
                      <div className="space-y-1">
                        <div className="text-neutral-600 font-semibold uppercase text-[10px]">Networks</div>
                        <div className="text-neutral-400 font-mono">{(containerInspect.networks || []).join(', ') || 'None'}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-neutral-600 font-semibold uppercase text-[10px]">Env</div>
                        {(containerInspect.env || []).slice(0, 5).map((e, i) => (
                          <div key={i} className="text-neutral-400 font-mono truncate" title={e}>{e}</div>
                        ))}
                        {(containerInspect.env || []).length > 5 && <div className="text-neutral-600">+{containerInspect.env.length - 5} more</div>}
                        {(containerInspect.env || []).length === 0 && <div className="text-neutral-600">None</div>}
                      </div>
                    </div>
                  )}
                  {loadingInspect[c.id] && <div className="text-xs text-neutral-600">Loading inspect...</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ConfirmModal
        open={!!confirmAction}
        title="Force Remove Container"
        message={`Are you sure you want to force remove this container? This action cannot be undone.`}
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

function InfoCard({ label, value, color }) {
  return (
    <div className="p-2 rounded bg-neutral-900/40 border border-[#1e2530]">
      <div className="text-[10px] text-neutral-600">{label}</div>
      <div className={`text-sm font-semibold font-mono tabular-nums ${color}`}>{value ?? '-'}</div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, disabled, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
        danger ? 'text-red-400/60 hover:text-red-400' : 'text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {icon}
    </button>
  );
}
