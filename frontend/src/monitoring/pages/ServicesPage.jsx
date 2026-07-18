import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Play, Square, RotateCw, Cpu, HardDrive, FileText, ChevronDown, ChevronRight, Trash2, Search, Info } from 'lucide-react';
import GlassCard from '../shared/GlassCard';
import StatusBadge from '../shared/StatusBadge';
import ConfirmModal from '../../components/ConfirmModal';
import { formatBytes } from '../../utils/format.js';

function stateColor(s) {
  if (s === 'running') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
  if (s === 'exited' || s === 'dead') return 'text-red-400 bg-red-400/10 border-red-400/30';
  return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
}

const actionIcons = {
  start: <Play size={12} />,
  stop: <Square size={12} />,
  restart: <RotateCw size={12} />,
};

export default function ServicesPage() {
  const [tab, setTab] = useState('docker');
  return (
    <div className="p-3 md:p-6" data-debug-id="2.8" data-debug-name="ServicesPage" data-debug-type="container">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('docker')} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${tab === 'docker' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' : 'bg-neutral-900/50 text-neutral-500 border border-neutral-800 hover:text-neutral-300'}`} data-debug-id="2.8.1" data-debug-name="DockerTab" data-debug-type="panel">
            Docker
          </button>
          <button onClick={() => setTab('systemd')} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${tab === 'systemd' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' : 'bg-neutral-900/50 text-neutral-500 border border-neutral-800 hover:text-neutral-300'}`} data-debug-id="2.8.2" data-debug-name="SystemdTab" data-debug-type="panel">
            Systemd
          </button>
        </div>
        {tab === 'docker' ? <DockerTab /> : <SystemdTab />}
      </div>
    </div>
  );
}

/* ──────────── DOCKER TAB ──────────── */
function DockerTab() {
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
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowImages(!showImages)}
            className={`px-2 py-1.5 rounded text-xs transition-colors ${showImages ? 'bg-cyan-500/20 text-cyan-400' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
            Images
          </button>
          {dockerInfo && (
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-green-400">{dockerInfo.containersRunning} running</span>
              <span className="text-red-400">{dockerInfo.containersStopped} stopped</span>
            </div>
          )}
        </div>
        <button onClick={fetchContainers} className="p-2 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {showImages && (
        <div className="p-3 rounded bg-neutral-900/50 border border-neutral-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-neutral-400">Docker Images</h3>
            <button onClick={fetchImages} className="text-neutral-600 hover:text-neutral-400 p-1"><RefreshCw size={12} /></button>
          </div>
          {images.length === 0 ? (
            <div className="text-xs text-neutral-600">No images found</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
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

      {error && <div className="p-3 rounded bg-red-900/30 border border-red-700/50 text-red-300 text-sm">Error: {error}</div>}
      {loading && containers.length === 0 && <div className="text-neutral-500 text-sm">Loading containers...</div>}
      {!loading && containers.length === 0 && !error && <div className="text-neutral-500 text-sm">No containers found or Docker unavailable.</div>}

      <div className="space-y-2" data-debug-id="2.8.1.1" data-debug-name="ContainerList" data-debug-type="list">
        {containers.map(c => {
          const isExpanded = expandedId === c.id;
          const containerLogs = logs[c.id] || [];
          const containerInspect = inspectData[c.id];
          const isBusy = !!busy[c.id];

          return (
            <div key={c.id} className={`rounded border transition-colors ${isExpanded ? 'bg-neutral-900/70 border-neutral-700' : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'}`} data-debug-id="2.8.1.1.1" data-debug-name="ContainerItem" data-debug-type="card">
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
                    <ActionBtn icon={<Play className="w-3 h-3" />} onClick={() => doAction(c.id, 'start')} disabled={isBusy || c.state === 'running'} />
                    <ActionBtn icon={<Square className="w-3 h-3" />} onClick={() => doAction(c.id, 'stop')} disabled={isBusy || c.state !== 'running'} />
                    <ActionBtn icon={<RotateCw className="w-3 h-3" />} onClick={() => doAction(c.id, 'restart')} disabled={isBusy} />
                    <ActionBtn icon={<Trash2 className="w-3 h-3" />} onClick={() => doAction(c.id, 'remove')} disabled={isBusy} danger />
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-[#1e2530] p-3 space-y-3">
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => fetchLogs(c.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200">
                      <FileText size={10} /> Logs
                    </button>
                    <button onClick={() => fetchInspect(c.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200">
                      <Info size={10} /> Inspect
                    </button>
                  </div>
                  {containerLogs.length > 0 && (
                    <div className="bg-black/40 rounded p-2 max-h-60 overflow-y-auto font-mono text-[10px] text-neutral-400 space-y-0.5">
                      {containerLogs.map((line, i) => (
                        <div key={i} className={`whitespace-pre-wrap break-all ${
                          line.includes('error') || line.includes('Error') ? 'text-red-400' :
                          line.includes('warn') || line.includes('Warn') ? 'text-amber-400' : ''
                        }`}>{line}</div>
                      ))}
                    </div>
                  )}
                  {loadingLogs[c.id] && <div className="text-xs text-neutral-600">Loading logs...</div>}
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
                            {m.source} <span className="text-neutral-600">\u2192</span> {m.destination}
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
        message="Are you sure you want to force remove this container? This action cannot be undone."
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}

/* ──────────── SYSTEMD TAB ──────────── */
function SystemdTab() {
  const [services, setServices] = useState([]);
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState(null);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/services');
      if (res.ok) {
        const data = await res.json();
        setServices(data.services || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchServices();
    const id = setInterval(fetchServices, 5000);
    return () => clearInterval(id);
  }, [fetchServices]);

  const doAction = async (name, action) => {
    setActing(`${name}:${action}`);
    try {
      await fetch(`/api/monitoring/services/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 1000));
      await fetchServices();
    } catch {}
    setActing(null);
  };

  const filtered = search
    ? services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase()))
    : services;

  const statCounts = {
    running: services.filter(s => s.active === 'active' && s.sub === 'running').length,
    exited: services.filter(s => s.active === 'active' && s.sub !== 'running').length,
    failed: services.filter(s => s.active === 'failed').length,
    inactive: services.filter(s => s.active === 'inactive').length,
  };

  return (
    <>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search services..."
            className="w-full bg-[#1e2530] text-neutral-300 text-xs pl-8 pr-3 py-2 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30" />
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-green-400">{statCounts.running} running</span>
          <span className="text-red-400">{statCounts.failed} failed</span>
          <span className="text-neutral-600">{statCounts.exited} active</span>
          <span className="text-neutral-600">{statCounts.inactive} inactive</span>
        </div>
        <button onClick={fetchServices} className="text-neutral-600 hover:text-neutral-400 p-1">
          <RefreshCw size={14} />
        </button>
      </div>
      <GlassCard data-debug-id="2.8.3" data-debug-name="ServicesMainCard" data-debug-type="card">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]" data-debug-id="2.8.2.1" data-debug-name="ServicesTable" data-debug-type="table">
            <thead>
              <tr className="border-b border-[#1e2530]">
                <th className="text-left text-neutral-600 font-medium py-2 px-2">Service</th>
                <th className="text-left text-neutral-600 font-medium py-2 px-2">State</th>
                <th className="text-left text-neutral-600 font-medium py-2 px-2 hidden sm:table-cell">Sub</th>
                <th className="text-left text-neutral-600 font-medium py-2 px-2 hidden md:table-cell">Description</th>
                <th className="text-right text-neutral-600 font-medium py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map(s => (
                <tr key={s.name} className="border-b border-[#1e2530]/50 hover:bg-white/[0.02]">
                  <td className="py-1.5 px-2 text-neutral-300 max-w-[200px] truncate font-mono text-[10px]">{s.name}</td>
                  <td className="py-1.5 px-2">
                    <StatusBadge status={s.active === 'active' ? 'active' : s.active === 'failed' ? 'failed' : 'inactive'} />
                  </td>
                  <td className="py-1.5 px-2 hidden sm:table-cell">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      s.sub === 'running' ? 'bg-green-500/10 text-green-400' :
                      s.sub === 'exited' ? 'bg-yellow-500/10 text-yellow-400' :
                      s.sub === 'failed' ? 'bg-red-500/10 text-red-400' :
                      'bg-neutral-500/10 text-neutral-500'
                    }`}>{s.sub || '-'}</span>
                  </td>
                  <td className="py-1.5 px-2 text-neutral-500 max-w-[300px] truncate hidden md:table-cell">{s.description || '-'}</td>
                  <td className="py-1.5 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {s.active !== 'active' && (
                        <button onClick={() => doAction(s.name, 'start')} disabled={acting === `${s.name}:start`}
                          className="text-green-500/60 hover:text-green-400 disabled:opacity-30 p-1"
                          title="Start">{actionIcons.start}</button>
                      )}
                      {s.active === 'active' && (
                        <button onClick={() => doAction(s.name, 'stop')} disabled={acting === `${s.name}:stop`}
                          className="text-red-500/60 hover:text-red-400 disabled:opacity-30 p-1"
                          title="Stop">{actionIcons.stop}</button>
                      )}
                      <button onClick={() => doAction(s.name, 'restart')} disabled={acting === `${s.name}:restart`}
                        className="text-yellow-500/60 hover:text-yellow-400 disabled:opacity-30 p-1"
                        title="Restart">{actionIcons.restart}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-neutral-600 text-xs">No services found</div>
          )}
        </div>
      </GlassCard>
    </>
  );
}

function ActionBtn({ icon, onClick, disabled, danger }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
        danger ? 'text-red-400/60 hover:text-red-400' : 'text-neutral-400 hover:text-neutral-200'
      }`}>
      {icon}
    </button>
  );
}
