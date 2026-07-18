import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Activity, HardDrive, FileText, Bell, Globe, Film, Settings, Cpu, X, CheckSquare, Network, BarChart3, Power } from 'lucide-react';

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, debugId: '2.1.1.1', debugName: 'NavOverview' },
  { path: '/metrics', label: 'Metrics', icon: BarChart3, debugId: '2.1.1.2', debugName: 'NavMetrics' },
  { path: '/service-control', label: 'Service Control', icon: Power, debugId: '2.1.1.3', debugName: 'NavServiceControl' },
  { path: '/services', label: 'System Services', icon: Activity, debugId: '2.1.1.4', debugName: 'NavServices' },
  { path: '/processes', label: 'Processes', icon: Cpu, debugId: '2.1.1.5', debugName: 'NavProcesses' },
  { path: '/tasks', label: 'Tasks', icon: CheckSquare, debugId: '2.1.1.6', debugName: 'NavTasks' },
  { path: '/storage', label: 'Storage', icon: HardDrive, debugId: '2.1.1.7', debugName: 'NavStorage' },
  { path: '/network', label: 'Network', icon: Network, debugId: '2.1.1.8', debugName: 'NavNetwork' },
  { path: '/logs', label: 'Logs', icon: FileText, debugId: '2.1.1.9', debugName: 'NavLogs' },
  { path: '/alerts', label: 'Alerts', icon: Bell, debugId: '2.1.1.10', debugName: 'NavAlerts' },
  { path: '/media', label: 'Media', icon: Film, debugId: '2.1.1.11', debugName: 'NavMediaStats' },
  { path: '/settings', label: 'Settings', icon: Settings, debugId: '2.1.1.12', debugName: 'NavSettings' },
];

const SERVICE_KEYS = ['mediaVault', 'downloader', 'playlists', 'adbTransfer'];
const SERVICE_LABELS = { mediaVault: 'Media', downloader: 'Downloads', playlists: 'Music', adbTransfer: 'ADB' };

function StatusDot({ status }) {
  const color = status === 'running' ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.4)]'
    : status === 'restarting' ? 'bg-amber-400 animate-pulse shadow-[0_0_4px_rgba(251,191,36,0.4)]'
    : status === 'error' ? 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]'
    : 'bg-neutral-600 ring-1 ring-neutral-500/50';
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

export default function Sidebar({ onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [services, setServices] = useState({});

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/services');
        if (res.ok && !cancelled) setServices(await res.json());
      } catch {}
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div data-debug-id="2.1.1" data-debug-name="Sidebar" data-debug-type="panel" className="w-56 bg-[#0d1117] border-r border-[#1e2530] flex flex-col h-full flex-shrink-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-[#1e2530]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Globe size={14} className="text-cyan-400" />
            </div>
            <span className="text-sm font-semibold text-neutral-200">Node</span>
          </div>
          <button onClick={onClose} className="p-1 rounded text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800/50 md:hidden">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Service Status Summary */}
      <div className="px-3 py-2 border-b border-[#1e2530]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Services</span>
          <span className="text-[9px] text-neutral-600">
            {SERVICE_KEYS.filter(k => services[k]?.status === 'running').length}/{SERVICE_KEYS.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {SERVICE_KEYS.map(key => (
            <div key={key} className="flex items-center gap-1.5">
              <StatusDot status={services[key]?.status} />
              <span className="text-[10px] text-neutral-500 truncate">{SERVICE_LABELS[key]}</span>
            </div>
          ))}
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map(item => {
          const active = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              data-debug-id={item.debugId} data-debug-name={item.debugName} data-debug-type="other"
              onClick={() => { navigate(item.path); onClose?.(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border transition-colors duration-100 ${
                active
                  ? 'bg-cyan-500/10 text-cyan-400 font-medium border-cyan-500/10'
                  : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/40 border-transparent'
              }`}
            >
              <Icon size={16} strokeWidth={active ? 2 : 1.5} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
