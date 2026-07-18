import { useState } from 'react';
import { Power, Play, Square, RotateCcw, RefreshCw, Folder, Download, ListMusic, MessageCircle, Activity, Smartphone } from 'lucide-react';
import { useServiceControl } from '../../hooks/useServiceControl';
import ConfirmModal from '../../components/ConfirmModal';

const SERVICE_META = {
  mediaVault: {
    label: 'Media Vault',
    icon: Folder,
    color: 'sky',
    description: 'File browser, scanner, watcher & thumbnails',
  },
  downloader: {
    label: 'Downloader',
    icon: Download,
    color: 'violet',
    description: 'yt-dlp, aria2c & gallery-dl downloads',
  },
  playlists: {
    label: 'Music',
    icon: ListMusic,
    color: 'amber',
    description: 'XSPF playlist scanner & management',
  },
  monitor: {
    label: 'Monitor Engine',
    icon: Activity,
    color: 'cyan',
    description: 'CPU, RAM, GPU, disk & network metrics',
  },
  adbTransfer: {
    label: 'ADB Transfer',
    icon: Smartphone,
    color: 'teal',
    description: 'Android file push/pull via ADB',
  },
};

const COLOR_MAP = {
  sky: {
    dot: 'bg-sky-400',
    border: 'border-sky-500/20',
    bg: 'bg-sky-500/10',
    text: 'text-sky-400',
    hover: 'hover:bg-sky-500/20',
  },
  violet: {
    dot: 'bg-violet-400',
    border: 'border-violet-500/20',
    bg: 'bg-violet-500/10',
    text: 'text-violet-400',
    hover: 'hover:bg-violet-500/20',
  },
  amber: {
    dot: 'bg-amber-400',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    hover: 'hover:bg-amber-500/20',
  },
  cyan: {
    dot: 'bg-cyan-400',
    border: 'border-cyan-500/20',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    hover: 'hover:bg-cyan-500/20',
  },
  teal: {
    dot: 'bg-teal-400',
    border: 'border-teal-500/20',
    bg: 'bg-teal-500/10',
    text: 'text-teal-400',
    hover: 'hover:bg-teal-500/20',
  },
};

function StatusDot({ status, ...rest }) {
  const color = status === 'running' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
    : status === 'restarting' ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.5)]'
    : status === 'error' ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
    : 'bg-neutral-600 ring-1 ring-neutral-500/50';
  return <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} {...rest} />;
}

function ServiceCard({ name, meta, svc, onStart, onStop, onRestart, loading, ...rest }) {
  const [confirm, setConfirm] = useState(null);
  const colors = COLOR_MAP[meta.color];
  const Icon = meta.icon;
  const status = svc?.status || 'stopped';
  const isRunning = status === 'running';
  const isRestarting = status === 'restarting';
  const info = svc?.info || {};

  const handleAction = (action) => {
    setConfirm({
      title: `${action === 'stop' ? 'Stop' : 'Restart'} ${meta.label}?`,
      message: action === 'stop'
        ? `This will stop all ${meta.label.toLowerCase()} processes.`
        : `This will restart ${meta.label.toLowerCase()} processes.`,
      onConfirm: () => {
        if (action === 'stop') onStop(name);
        else onRestart(name);
        setConfirm(null);
      },
      onCancel: () => setConfirm(null),
      variant: action === 'stop' ? 'danger' : 'warning',
    });
  };

  return (
    <>
      <div className={`bg-[#111418] border ${colors.border} rounded-xl overflow-hidden`} {...rest}>
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={16} className={colors.text} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-neutral-200 truncate">{meta.label}</h3>
                <StatusDot status={status} data-debug-id="2.9.2.1" data-debug-name="ServiceStatus" data-debug-type="other" />
              </div>
              <p className="text-[10px] text-neutral-500 truncate">{meta.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3" data-debug-id="2.9.2.2" data-debug-name="ServiceButtons" data-debug-type="other">
            {!isRunning ? (
              <button
                onClick={() => onStart(name)}
                disabled={loading || isRestarting}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-[11px] hover:bg-green-500/20 transition-colors disabled:opacity-40"
              >
                <Play size={11} />
                Start
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleAction('stop')}
                  disabled={loading || isRestarting}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[11px] hover:bg-red-500/20 transition-colors disabled:opacity-40"
                >
                  <Square size={11} />
                  Stop
                </button>
                <button
                  onClick={() => handleAction('restart')}
                  disabled={loading || isRestarting}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[11px] hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={11} />
                  Restart
                </button>
              </>
            )}
          </div>
        </div>

        {/* Info row */}
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
            {name === 'mediaVault' && (
              <>
                <InfoItem label="Watcher" value={info.watcher ? 'On' : 'Off'} ok={info.watcher} />
                <InfoItem label="Maintenance" value={info.maintenance ? 'On' : 'Off'} ok={info.maintenance} />
                <InfoItem label="Thumbnails" value={info.thumbnails ? 'On' : 'Off'} ok={info.thumbnails} />
                {info.thumbPending > 0 && <InfoItem label="Thumb Queue" value={info.thumbPending} />}
              </>
            )}
            {name === 'downloader' && (
              <>
                <InfoItem label="Active" value={info.active || 0} />
                <InfoItem label="Queued" value={info.queued || 0} />
                <InfoItem label="Done" value={info.completed || 0} />
                <InfoItem label="Failed" value={info.failed || 0} ok={info.failed === 0} />
              </>
            )}
            {name === 'playlists' && (
              <>
                <InfoItem label="Music" value={info.playlistCount || 0} />
                {info.lastScanTime && (
                  <InfoItem label="Last Scan" value={formatAgo(info.lastScanTime)} />
                )}
              </>
            )}
            {name === 'monitor' && (
              <>
                <InfoItem label="Interval" value={info.intervalMs ? `${info.intervalMs}ms` : '--'} />
                <InfoItem label="WS Clients" value={info.wsClients || 0} />
                {info.running !== undefined && <InfoItem label="Collecting" value={info.running ? 'Yes' : 'No'} ok={info.running} />}
              </>
            )}
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          open={true}
          title={confirm.title}
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={confirm.onCancel}
          danger={confirm.variant === 'danger'}
        />
      )}
    </>
  );
}

function InfoItem({ label, value, ok }) {
  return (
    <span className="text-neutral-500">
      {label}:{' '}
      <span className={ok === undefined ? 'text-neutral-400 font-mono' : ok ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
        {value}
      </span>
    </span>
  );
}

function formatAgo(ts) {
  if (!ts) return '--';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function ServiceControlPage({ onMenuOpen }) {
  const { services, loading, startService, stopService, restartService, restartAll } = useServiceControl();
  const [showRestartAll, setShowRestartAll] = useState(false);

  const allRunning = Object.keys(SERVICE_META).every(name => services[name]?.status === 'running');

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0d10] overflow-hidden" data-debug-id="2.9" data-debug-name="ServiceControlPage" data-debug-type="container">
      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1e2530]">
        <div className="flex items-center gap-2">
          <Power size={18} className="text-cyan-400" />
          <h1 className="text-base font-semibold text-neutral-100">Service Control</h1>
        </div>
        <button
          onClick={() => setShowRestartAll(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[11px] hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          data-debug-id="2.9.1" data-debug-name="RestartAllButton" data-debug-type="other"
        >
          <RefreshCw size={12} />
          Restart All
        </button>
      </div>

      {/* Service cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {Object.entries(SERVICE_META).map(([name, meta]) => (
          <ServiceCard
            key={name}
            name={name}
            meta={meta}
            svc={services[name]}
            onStart={startService}
            onStop={stopService}
            onRestart={restartService}
            loading={loading}
            data-debug-id="2.9.2" data-debug-name="ServiceCard" data-debug-type="card"
          />
        ))}
      </div>

      {showRestartAll && (
        <ConfirmModal
          open={true}
          title="Restart All Services?"
          message="This will restart all services sequentially. There may be a brief interruption."
          onConfirm={async () => {
            await restartAll();
            setShowRestartAll(false);
          }}
          onCancel={() => setShowRestartAll(false)}
          danger={false}
        />
      )}
    </div>
  );
}
