import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchDevices, listDeviceDir, listLocalDir,
  pushFiles, pullFiles, fetchJobs, cancelJob,
  checkDuplicates, pauseJob, resumeJob, retryFailed, resolveConflict,
  subscribeJobProgress, buildTxOptions, sourcesFromDecisions, reassignDevice,
  formatSize, formatSpeed, formatEta
} from '../utils/adbApi';
import DuplicateConfirmModal from './DuplicateConfirmModal';
import ServiceStoppedBanner from './ServiceStoppedBanner';

const ROOT = '/';
const DEFAULT_PHONE_PATH = '/storage/emulated/0/';

function FolderIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function FileIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SmartphoneIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12" y2="18" />
    </svg>
  );
}

function ServerIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6" y2="6" />
      <line x1="6" y1="18" x2="6" y2="18" />
    </svg>
  );
}

function ChevronRight({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ArrowLeft({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ArrowRight({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function RefreshIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

function HomeIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function TrashIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}

function XIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12" y2="16" />
    </svg>
  );
}

function Spinner({ size = 20 }) {
  return (
    <div className="flex items-center justify-center">
      <div className="border-2 border-white/20 border-t-white rounded-full animate-spin" style={{ width: size, height: size }} />
    </div>
  );
}

function Checkbox({ checked, onChange }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
      className={`w-4 h-4 rounded border cursor-pointer flex items-center justify-center transition-colors flex-shrink-0 ${
        checked
          ? 'bg-sky-500 border-sky-500'
          : 'border-neutral-600 hover:border-neutral-400'
      }`}
    >
      {checked && <CheckIcon size={10} />}
    </div>
  );
}

function parsePath(path) {
  if (!path || path === ROOT) return [{ name: '/', path: '/' }];
  const cleaned = path.replace(/\/$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  const crumbs = [];
  for (let i = 0; i < parts.length; i++) {
    crumbs.push({ name: parts[i], path: '/' + parts.slice(0, i + 1).join('/') });
  }
  crumbs.unshift({ name: '/', path: ROOT });
  return crumbs;
}

function DeviceSelector({ devices, selected, onSelect, onRefresh, loading }) {
  return (
    <div className="flex items-center gap-2">
      <SmartphoneIcon size={16} />
      <select
        value={selected || ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-sky-500 min-w-[200px]"
      >
        <option value="">-- Select device --</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.model || d.product || d.id} ({d.id.slice(0, 8)}...)
          </option>
        ))}
      </select>
      <button
        onClick={onRefresh}
        className="p-1.5 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        title="Refresh devices"
      >
        <RefreshIcon size={14} />
      </button>
      {loading && <Spinner size={14} />}
      {devices.length === 0 && !loading && (
        <span className="text-xs text-neutral-500">No devices connected</span>
      )}
    </div>
  );
}

function Breadcrumb({ path, onNavigate }) {
  const crumbs = parsePath(path);
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto flex-shrink-0 scrollbar-none py-1">
      {crumbs.map((crumb, i) => (
        <React.Fragment key={crumb.path}>
          {i > 0 && <ChevronRight size={10} />}
          <button
            onClick={() => onNavigate(crumb.path)}
            className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap transition-colors ${
              i === crumbs.length - 1
                ? 'text-sky-400 bg-sky-500/10'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {crumb.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function FilePane({
  title,
  icon: Icon,
  path,
  entries,
  loading,
  error,
  selection,
  setSelection,
  onNavigate,
  onToggleSelect,
  onPathSubmit,
  iconColor,
}) {
  return (
    <div className="flex flex-col bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden min-h-0 flex-1">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 bg-neutral-900/50 flex-shrink-0">
        <Icon size={14} />
        <span className="text-xs font-medium text-neutral-400">{title}</span>
      </div>

      <div className="px-3 py-1.5 border-b border-neutral-800/50 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNavigate(ROOT)}
            className="p-1 rounded text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors flex-shrink-0"
            title="Root"
          >
            <HomeIcon size={12} />
          </button>
          <Breadcrumb path={path} onNavigate={onNavigate} />
          <button
            onClick={() => onNavigate(path === ROOT ? ROOT : path.split('/').slice(0, -1).join('/') || ROOT)}
            className="p-1 rounded text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors flex-shrink-0 ml-auto"
            title="Parent directory"
            disabled={path === ROOT}
          >
            ...
          </button>
        </div>
        <div className="mt-1">
          <input
            type="text"
            defaultValue={path}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onPathSubmit(e.target.value);
                e.target.blur();
              }
            }}
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-sky-500 font-mono"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarGutter: 'stable' }}>
        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <Spinner size={20} />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 text-xs text-red-400">
            <AlertIcon size={12} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="flex items-center justify-center h-24 text-neutral-600 text-xs">
            Empty directory
          </div>
        )}

        {entries.map((entry) => {
          const isSelected = selection.has(entry.name);
          const isDir = entry.type === 'dir';
          return (
            <div
              key={entry.name}
              onClick={() => isDir ? onNavigate(path === ROOT ? ROOT + entry.name : path + '/' + entry.name) : onToggleSelect(entry.name)}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors text-xs border-b border-neutral-800/30 last:border-0 ${
                isSelected ? 'bg-sky-500/10' : 'hover:bg-neutral-800/50'
              }`}
            >
              <Checkbox checked={isSelected} onChange={() => onToggleSelect(entry.name)} />
              <span className="flex-shrink-0 text-neutral-500">
                {isDir ? <FolderIcon size={14} /> : <FileIcon size={14} />}
              </span>
              <span className={`flex-1 truncate ${isDir ? 'text-neutral-200' : 'text-neutral-300'}`}>
                {entry.name}
              </span>
              <span className="text-neutral-600 flex-shrink-0 tabular-nums">
                {isDir ? '' : formatSize(entry.size)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-neutral-800/50 text-[10px] text-neutral-600 flex-shrink-0">
            {selection.size > 0
              ? `${selection.size} selected`
              : `${entries.length} item${entries.length !== 1 ? 's' : ''}`
            }
            {entries.length > 0 && (
              <button
                onClick={() => {
                  const allItems = new Set(entries.map(e => e.name));
                  if (selection.size === allItems.size) setSelection(new Set());
                  else setSelection(allItems);
                }}
                className="ml-auto text-sky-400 hover:text-sky-300"
              >
                {selection.size > 0 ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
    </div>
  );
}

function TransferButton({ direction, onClick, disabled, label }) {
  const isPush = direction === 'push';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        disabled
          ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
          : isPush
            ? 'bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-700'
            : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
      }`}
    >
      {isPush ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
      {label}
    </button>
  );
}

function TransferHistory({ jobs, onCancel, onPause, onResume, onRetry, onReassign, formatSize, formatSpeed, formatEta }) {
  const ACTIVE = ['queued', 'running', 'paused', 'waiting_conflict'];
  const active = jobs.filter(j => ACTIVE.includes(j.status));
  const history = jobs.filter(j => !ACTIVE.includes(j.status)).slice(0, 20);

  const statusLabel = (job) => {
    if (job.status === 'waiting_conflict') return 'Conflict';
    if (job.status === 'paused') return 'Paused';
    if (job.status === 'running') return 'Running';
    if (job.status === 'queued') return 'Waiting...';
    if (job.status === 'completed') return 'Done';
    if (job.status === 'failed') return 'Failed';
    return 'Cancelled';
  };

  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden flex flex-col min-h-0" style={{ maxHeight: '280px' }}>
      <div className="px-3 py-2 border-b border-neutral-800 text-xs font-medium text-neutral-400 flex-shrink-0">
        Transfers {active.length > 0 && <span className="text-sky-400">({active.length} active)</span>}
      </div>

      <div className="overflow-y-auto flex-1 min-h-0" style={{ scrollbarGutter: 'stable' }}>
        {jobs.length === 0 && (
          <div className="flex items-center justify-center h-16 text-neutral-600 text-xs">
            No transfers yet
          </div>
        )}

        {active.map(job => {
          const summary = job.txSummary;
          const isTransactional = job.engine === 'transactional' && summary;
          return (
            <div key={job.id} className="px-3 py-2 border-b border-neutral-800/50">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 text-xs min-w-0">
                  <span className={`font-mono text-[10px] flex-shrink-0 ${job.type === 'push' ? 'text-sky-500' : 'text-emerald-500'}`}>
                    [{job.type.toUpperCase()}]
                  </span>
                  <span className="text-neutral-300 truncate">
                    {isTransactional
                      ? `${summary.currentIndex}/${summary.total} files`
                      : `${job.sources.length} file${job.sources.length !== 1 ? 's' : ''}`}
                  </span>
                  {job.status === 'waiting_conflict' && (
                    <span className="text-[10px] text-amber-400 flex-shrink-0">conflict</span>
                  )}
                  {job.recovered && (
                    <span className="text-[10px] text-violet-400 flex-shrink-0">recovered</span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-neutral-500 tabular-nums">
                    {job.status === 'running' ? formatSpeed(job.speed) : ''}
                  </span>
                  {job.status === 'running' && (
                    <button onClick={() => onPause(job.id)} className="px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-amber-400 rounded border border-neutral-800" title="Pause">II</button>
                  )}
                  {job.status === 'paused' && (
                    <button onClick={() => onResume(job.id)} className="px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-sky-400 rounded border border-neutral-800" title="Resume">▶</button>
                  )}
                  {job.recovered && job.status === 'queued' && (
                    <button onClick={() => handleReassignDevice(job.id)} className="px-1.5 py-0.5 text-[10px] text-violet-400 hover:text-violet-300 rounded border border-violet-800" title="Reassign device">Reassign</button>
                  )}
                  {(job.status === 'running' || job.status === 'queued' || job.status === 'paused' || job.status === 'waiting_conflict') && (
                    <button onClick={() => onCancel(job.id)} className="p-0.5 rounded text-neutral-600 hover:text-red-400 transition-colors" title="Cancel">
                      <XIcon size={12} />
                    </button>
                  )}
                </div>
              </div>

              {job.currentFile && job.status === 'running' && (
                <div className="text-[10px] text-sky-400/80 truncate mb-1">{job.currentFile}</div>
              )}

              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      job.status === 'waiting_conflict' ? 'bg-amber-500' :
                      job.status === 'paused' ? 'bg-neutral-500' :
                      'bg-sky-500'
                    }`}
                    style={{ width: `${Math.max(job.progress, 2)}%` }}
                  />
                </div>
                <span className="text-[10px] text-neutral-500 tabular-nums w-24 text-right">
                  {job.status === 'running' || job.status === 'paused'
                    ? `${formatSize(job.transferredBytes)} / ${formatSize(job.totalBytes)}`
                    : statusLabel(job)}
                </span>
              </div>

              {job.status === 'running' && job.eta > 0 && (
                <div className="text-[10px] text-neutral-600 mt-0.5">ETA: {formatEta(job.eta)}</div>
              )}

              {isTransactional && summary?.failed > 0 && job.status !== 'running' && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-red-400">{summary.failed} failed</span>
                  <button onClick={() => onRetry(job.id)} className="text-[10px] text-sky-400 hover:text-sky-300">Retry failed</button>
                </div>
              )}
            </div>
          );
        })}

        {active.length > 0 && history.length > 0 && (
          <div className="border-t border-neutral-800/30" />
        )}

        {history.map(job => (
          <div key={job.id} className="px-3 py-1.5 border-b border-neutral-800/30 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`font-mono text-[10px] ${job.type === 'push' ? 'text-sky-500' : 'text-emerald-500'}`}>
                [{job.type.toUpperCase()}]
              </span>
              <span className={`text-[10px] ${
                job.status === 'completed' ? 'text-emerald-500' :
                job.status === 'failed' ? 'text-red-400' :
                'text-neutral-500'
              }`}>
                {job.status === 'completed' ? <CheckIcon size={10} /> : job.status === 'failed' ? <AlertIcon size={10} /> : <XIcon size={10} />}
              </span>
              {job.recovered && (
                <span className="text-[10px] text-violet-400 flex-shrink-0">recovered</span>
              )}
              <span className="text-neutral-400 truncate max-w-[150px]">
                {job.txSummary
                  ? `${job.txSummary.committed}/${job.txSummary.total} files`
                  : `${job.sources.length} file${job.sources.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-neutral-600 text-[10px]">{formatSize(job.totalBytes)}</span>
              {job.txSummary?.failed > 0 && (
                <button onClick={() => onRetry(job.id)} className="text-[10px] text-sky-400 hover:text-sky-300">Retry</button>
              )}
              {job.recovered && (
                <button onClick={() => onReassign(job.id)} className="text-[10px] text-violet-400 hover:text-violet-300">Reassign</button>
              )}
              {job.error && (
                <span className="text-red-400/70 text-[10px] truncate max-w-[120px]" title={job.error}>{job.error}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdbTransfer() {
  const [devices, setDevices] = useState([]);
  const savedDeviceId = sessionStorage.getItem('adbSelectedDevice');
  const [selectedDevice, setSelectedDevice] = useState(savedDeviceId);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const savedServerPath = sessionStorage.getItem('adbServerPath') || '/home/CATIAA';
  const savedPhonePath = sessionStorage.getItem('adbPhonePath') || DEFAULT_PHONE_PATH;

  const [serverPath, setServerPath] = useState(savedServerPath);
  const [serverEntries, setServerEntries] = useState([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [serverSelection, setServerSelection] = useState(new Set());

  const [phonePath, setPhonePath] = useState(savedPhonePath);
  const [phoneEntries, setPhoneEntries] = useState([]);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState(null);
  const [phoneSelection, setPhoneSelection] = useState(new Set());

  const [duplicateModal, setDuplicateModal] = useState(null);
  const pendingPushRef = useRef(null);
  const conflictJobRef = useRef(null);
  const duplicateModalRef = useRef(false);
  const applyAllBlockRef = useRef(null); // Blocks modal re-open after applyAll
  const totalConflictsRef = useRef(0); // Tracks pending conflicts for button text
  const pendingDecisionsRef = useRef([]); // Accumulates pre-transfer decisions for one-by-one resolution

  const [jobs, setJobs] = useState([]);
  const pollingRef = useRef(null);
  const subscribedRef = useRef(new Set()); // Track SSE subscriptions for recovered jobs

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const result = await fetchDevices();
      setDevices(result.devices);
    } catch (err) {
      console.error('[adb] load devices error:', err.message);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const loadServerDir = useCallback(async (path) => {
    setServerLoading(true);
    setServerError(null);
    try {
      const result = await listLocalDir(path);
      setServerEntries(result.entries || []);
      setServerPath(result.path);
    } catch (err) {
      setServerError(err.message);
      setServerEntries([]);
    } finally {
      setServerLoading(false);
    }
  }, []);

  const loadPhoneDir = useCallback(async (device, path) => {
    if (!device) return;
    setPhoneLoading(true);
    setPhoneError(null);
    try {
      const result = await listDeviceDir(device, path);
      setPhoneEntries(result.entries || []);
      setPhonePath(result.path);
    } catch (err) {
      setPhoneError(err.message);
      setPhoneEntries([]);
    } finally {
      setPhoneLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const result = await fetchJobs();
      setJobs(result.jobs);

      // Auto-subscribe SSE for recovered active jobs
      const ACTIVE = ['queued', 'running', 'paused', 'waiting_conflict'];
      for (const j of result.jobs) {
        if (j.recovered && ACTIVE.includes(j.status) && !subscribedRef.current.has(j.id)) {
          subscribedRef.current.add(j.id);
          subscribeJob(j.id);
        }
      }

      // Detect conflict from polling (fallback if SSE missed)
      const conflictJob = result.jobs.find(j => j.status === 'waiting_conflict' && j.conflict);
      if (conflictJob) {
        totalConflictsRef.current = conflictJob.txSummary?.pendingConflicts 
          ?? conflictJob.totalPendingConflicts 
          ?? 0;

        if (!duplicateModalRef.current) {
          // Block if applyAll is active (by ref OR by jobState)
          if (applyAllBlockRef.current === conflictJob.id?.toString()) {
            return;
          }
          if (conflictJob.jobState?.applyAll) {
            applyAllBlockRef.current = conflictJob.id?.toString();
            return;
          }
          conflictJobRef.current = conflictJob.id;
          duplicateModalRef.current = true;
          setDuplicateModal({
            duplicates: [{
              source: conflictJob.conflict.src,
              devicePath: conflictJob.conflict.devicePath || conflictJob.conflict.dst,
              name: conflictJob.conflict.name,
              size: conflictJob.conflict.existingSize || conflictJob.conflict.size,
            }],
            inTransfer: true,
            jobId: conflictJob.id,
          });
        }
      }
    } catch {}
  }, []);

  const subscribeJob = useCallback((jobId) => {
    const unsubscribe = subscribeJobProgress(
      jobId,
      (data) => {
        setJobs(prev => prev.map(j => j.id === data.id ? { ...j, ...data } : j));
      },
      (data) => {
        setJobs(prev => prev.map(j => j.id === data.id ? { ...j, ...data } : j));
      },
      (data) => {
        const conflict = data.conflict || data.job?.conflict;
        if (!conflict) return;
        const incomingJobId = (data.job?.id || jobId)?.toString();
        totalConflictsRef.current = data.job?.txSummary?.pendingConflicts 
          ?? data.job?.totalPendingConflicts 
          ?? 0;

        // Block if applyAll is active (by ref OR by jobState)
        if (applyAllBlockRef.current === incomingJobId) return;
        if (data.job?.jobState?.applyAll) {
          applyAllBlockRef.current = incomingJobId;
          return;
        }
        conflictJobRef.current = incomingJobId;
        duplicateModalRef.current = true;
        setDuplicateModal({
          duplicates: [{
            source: conflict.src,
            devicePath: conflict.devicePath || conflict.dst,
            name: conflict.name,
            size: conflict.existingSize || conflict.size,
          }],
          inTransfer: true,
          jobId: data.job?.id || jobId,
        });
      }
    );
    return unsubscribe;
  }, []);

  useEffect(() => { sessionStorage.setItem('adbServerPath', serverPath); }, [serverPath]);
  useEffect(() => { sessionStorage.setItem('adbPhonePath', phonePath); }, [phonePath]);
  useEffect(() => { if (selectedDevice) sessionStorage.setItem('adbSelectedDevice', selectedDevice); }, [selectedDevice]);

  useEffect(() => {
    loadDevices();
    loadServerDir(serverPath);
    loadJobs();
  }, []);

  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      setSelectedDevice(devices[0].id);
    }
  }, [devices, selectedDevice]);

  useEffect(() => {
    if (selectedDevice) {
      loadPhoneDir(selectedDevice, phonePath);
    }
  }, [selectedDevice]);

  useEffect(() => {
    pollingRef.current = setInterval(() => {
      loadJobs();
    }, 2000);
    return () => clearInterval(pollingRef.current);
  }, []);

  useEffect(() => {
    const ACTIVE = ['queued', 'running', 'paused', 'waiting_conflict'];
    const hasActive = jobs.some(j => ACTIVE.includes(j.status));
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (hasActive) {
      pollingRef.current = setInterval(loadJobs, 2000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [jobs, loadJobs]);

  const handleServerNavigate = useCallback((path) => {
    setServerSelection(new Set());
    loadServerDir(path);
  }, [loadServerDir]);

  const handlePhoneNavigate = useCallback((path) => {
    setPhoneSelection(new Set());
    loadPhoneDir(selectedDevice, path);
  }, [selectedDevice, loadPhoneDir]);

  const handleServerPathSubmit = useCallback((path) => {
    handleServerNavigate(path);
  }, [handleServerNavigate]);

  const handlePhonePathSubmit = useCallback((path) => {
    if (selectedDevice) handlePhoneNavigate(path);
  }, [selectedDevice, handlePhoneNavigate]);

  const handleServerToggleSelect = useCallback((name) => {
    setServerSelection(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handlePhoneToggleSelect = useCallback((name) => {
    setPhoneSelection(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handlePush = useCallback(async () => {
    if (!selectedDevice || serverSelection.size === 0) return;
    const sources = [...serverSelection].map(name =>
      serverPath === ROOT ? ROOT + name : serverPath + '/' + name
    );

    // Check for duplicates before pushing
    try {
      const { duplicates } = await checkDuplicates(selectedDevice, sources, phonePath);
      const conflicts = duplicates.filter(d => d.exists);

      if (conflicts.length > 0) {
        // Pause and show modal
        pendingPushRef.current = { sources, conflicts };
        setDuplicateModal({ duplicates: conflicts, pendingSources: sources });
        return;
      }
    } catch (err) {
      console.error('[adb] duplicate check error:', err.message);
    }

    // No conflicts — push directly
    try {
      const result = await pushFiles(selectedDevice, sources, phonePath, { conflictStrategy: 'ask' });
      await loadJobs();
      setServerSelection(new Set());
      if (result.jobId) subscribeJob(result.jobId);
    } catch (err) {
      console.error('[adb] push error:', err.message);
    }
  }, [selectedDevice, serverSelection, serverPath, phonePath, loadJobs, subscribeJob]);

  const handleDuplicateDecision = useCallback(async (decisions, isFinal = true, explicitApplyAll = false) => {
    const ctx = pendingPushRef.current;
    if (!ctx) return;

    // Accumulate decisions for one-by-one resolution (non-final calls)
    if (!isFinal && !explicitApplyAll) {
      pendingDecisionsRef.current.push(...decisions);
      return;
    }

    // Final call: merge accumulated + current decisions
    const allDecisions = explicitApplyAll
      ? decisions
      : [...pendingDecisionsRef.current, ...decisions];
    pendingDecisionsRef.current = [];

    duplicateModalRef.current = false;
    setDuplicateModal(null);
    pendingPushRef.current = null;

    if (explicitApplyAll) {
      // Apply all: pass action as global conflictStrategy
      const action = allDecisions[0]?.action || 'skip';
      try {
        const result = await pushFiles(selectedDevice, ctx.sources, phonePath, { conflictStrategy: action });
        await loadJobs();
        setServerSelection(new Set());
        if (result.jobId) subscribeJob(result.jobId);
      } catch (err) {
        console.error('[adb] push error:', err.message);
      }
      return;
    }

    if (sourcesFromDecisions(allDecisions).length === 0) return;

    try {
      const txOptions = buildTxOptions(allDecisions);
      const allSkip = allDecisions.every(d => d.action === 'skip');
      const allOverwrite = allDecisions.every(d => d.action === 'overwrite');
      const conflictStrategy = allSkip ? 'skip' : allOverwrite ? 'overwrite' : 'ask';

      const result = await pushFiles(selectedDevice, ctx.sources, phonePath, { txOptions, conflictStrategy });
      await loadJobs();
      setServerSelection(new Set());
      if (result.jobId) subscribeJob(result.jobId);
    } catch (err) {
      console.error('[adb] push error:', err.message);
    }
  }, [selectedDevice, phonePath, loadJobs, subscribeJob]);

  const handleDuplicateCancel = useCallback(async () => {
    if (duplicateModal?.inTransfer && duplicateModal?.jobId) {
      try {
        await resolveConflict(duplicateModal.jobId, { action: 'cancel' });
        await loadJobs();
      } catch (err) {
        console.error('[adb] conflict cancel error:', err.message);
      }
    }
    duplicateModalRef.current = false;
    setDuplicateModal(null);
    pendingPushRef.current = null;
    conflictJobRef.current = null;
  }, [duplicateModal, loadJobs]);

  const handleInTransferDecision = useCallback(async (decisions, isFinal = true, explicitApplyAll = false) => {
    const jobId = duplicateModal?.jobId || conflictJobRef.current;
    if (!jobId || !decisions || decisions.length === 0) return;

    const d = decisions[0];
    const isApplyAll = explicitApplyAll;

    // CRITICAL: Block modal re-open IMMEDIATELY
    if (isApplyAll) {
      applyAllBlockRef.current = jobId?.toString();
    }
    duplicateModalRef.current = false;
    setDuplicateModal(null);
    conflictJobRef.current = null;

    // OPTIMISTIC UPDATE: Set jobState in local state immediately
    // so polling/SSE won't re-open modal while backend catches up
    if (isApplyAll) {
      setJobs(prev => prev.map(j =>
        j.id?.toString() === jobId?.toString()
          ? { ...j, jobState: { ...(j.jobState || {}), applyAll: true, decision: d.action, scope: 'queue', timestamp: Date.now() } }
          : j
      ));
    }

    try {
      await resolveConflict(jobId, {
        action: d.action,
        newName: d.action === 'rename' ? d.newName : undefined,
        newDst: d.action === 'rename' && d.newDst ? d.newDst : undefined,
        applyAll: isApplyAll,
      });
      // Refresh from backend to sync final state
      await loadJobs();
    } catch (err) {
      console.error('[adb] conflict resolve error:', err.message);
    }
  }, [duplicateModal, loadJobs]);

  const handlePull = useCallback(async () => {
    if (!selectedDevice || phoneSelection.size === 0) return;
    const sources = [...phoneSelection].map(name =>
      phonePath === ROOT ? ROOT + name : phonePath + '/' + name
    );
    try {
      const result = await pullFiles(selectedDevice, sources, serverPath);
      await loadJobs();
      setPhoneSelection(new Set());
      if (result.jobId) subscribeJob(result.jobId);
    } catch (err) {
      console.error('[adb] pull error:', err.message);
    }
  }, [selectedDevice, phoneSelection, phonePath, serverPath, loadJobs, subscribeJob]);

  const handleCancelJob = useCallback(async (jobId) => {
    try {
      await cancelJob(jobId);
      await loadJobs();
    } catch {}
  }, [loadJobs]);

  const handlePauseJob = useCallback(async (jobId) => {
    try {
      await pauseJob(jobId);
      await loadJobs();
    } catch (err) {
      console.error('[adb] pause error:', err.message);
    }
  }, [loadJobs]);

  const handleResumeJob = useCallback(async (jobId) => {
    try {
      await resumeJob(jobId);
      await loadJobs();
    } catch (err) {
      console.error('[adb] resume error:', err.message);
    }
  }, [loadJobs]);

  const handleRetryJob = useCallback(async (jobId) => {
    try {
      await retryFailed(jobId);
      await loadJobs();
      subscribeJob(jobId);
    } catch (err) {
      console.error('[adb] retry error:', err.message);
    }
  }, [loadJobs, subscribeJob]);

  const handleReassignDevice = useCallback(async (jobId) => {
    const newDeviceId = window.prompt('Enter new device ID:');
    if (!newDeviceId) return;
    try {
      await reassignDevice(jobId, newDeviceId);
      await loadJobs();
    } catch (err) {
      console.error('[adb] reassign error:', err.message);
    }
  }, [loadJobs]);

  const canPush = selectedDevice && serverSelection.size > 0;
  const canPull = selectedDevice && phoneSelection.size > 0;

  return (
    <div data-debug-id="4.1" data-debug-name="AdbTransfer" data-debug-type="panel" className="flex-1 flex flex-col overflow-hidden bg-neutral-950 text-neutral-200" style={{ height: '100%' }}>
      <ServiceStoppedBanner service="adbTransfer" />
      <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-800 flex-shrink-0" data-debug-id="4.1.1" data-debug-name="DeviceSelector" data-debug-type="dropdown">
        <DeviceSelector
          devices={devices}
          selected={selectedDevice}
          onSelect={setSelectedDevice}
          onRefresh={loadDevices}
          loading={devicesLoading}
        />
      </div>

      <div className="flex-1 flex flex-col gap-3 p-3 min-h-0 overflow-hidden">
        <div className="flex gap-3 flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col min-h-0" data-debug-id="4.1.2" data-debug-name="ServerFilePane" data-debug-type="panel">
<FilePane
               key={`server-${serverPath}`}
               title="Server"
               icon={ServerIcon}
               path={serverPath}
               entries={serverEntries}
               loading={serverLoading}
               error={serverError}
               selection={serverSelection}
               setSelection={setServerSelection}
               onNavigate={handleServerNavigate}
               onToggleSelect={handleServerToggleSelect}
               onPathSubmit={handleServerPathSubmit}
               iconColor="text-sky-500"
             />
          </div>

          <div className="flex flex-col items-center justify-center gap-2 flex-shrink-0 px-1" data-debug-id="4.1.4" data-debug-name="TransferButtons" data-debug-type="other">
            <TransferButton
              direction="push"
              onClick={handlePush}
              disabled={!canPush}
              label="Push"
            />
            <span className="text-[10px] text-neutral-600">or</span>
            <TransferButton
              direction="pull"
              onClick={handlePull}
              disabled={!canPull}
              label="Pull"
            />
          </div>

          <div className="flex-1 min-w-0 flex flex-col min-h-0" data-debug-id="4.1.3" data-debug-name="PhoneFilePane" data-debug-type="panel">
            {!selectedDevice ? (
              <div className="flex-1 flex items-center justify-center bg-neutral-900 rounded-lg border border-neutral-800">
                <div className="text-center text-neutral-500">
                  <SmartphoneIcon size={32} />
                  <p className="text-sm mt-2">Select a device above</p>
                  <p className="text-xs mt-1">Connect your phone via USB with USB debugging enabled</p>
                </div>
              </div>
            ) : (
<FilePane
                 key={`phone-${phonePath}`}
                 title="Phone"
                 icon={SmartphoneIcon}
                 path={phonePath}
                 entries={phoneEntries}
                 loading={phoneLoading}
                 error={phoneError}
                 selection={phoneSelection}
                 setSelection={setPhoneSelection}
                 onNavigate={handlePhoneNavigate}
                 onToggleSelect={handlePhoneToggleSelect}
                 onPathSubmit={handlePhonePathSubmit}
                 iconColor="text-emerald-500"
               />
            )}
          </div>
        </div>

        <div data-debug-id="4.1.5" data-debug-name="TransferHistory" data-debug-type="list">
        <TransferHistory
          jobs={jobs}
          onCancel={handleCancelJob}
          onPause={handlePauseJob}
          onResume={handleResumeJob}
          onRetry={handleRetryJob}
          onReassign={handleReassignDevice}
          formatSize={formatSize}
          formatSpeed={formatSpeed}
          formatEta={formatEta}
        />
        </div>
      </div>

      {duplicateModal && (() => {
        // Type-safe ID comparison
        const currentJob = jobs.find(j => j.id?.toString() === duplicateModal.jobId?.toString());
        const isApplyAllBlocked = applyAllBlockRef.current === duplicateModal.jobId?.toString()
          || currentJob?.jobState?.applyAll === true;
        if (isApplyAllBlocked) return null;
        return (
          <DuplicateConfirmModal
            duplicates={duplicateModal.duplicates}
            inTransfer={duplicateModal.inTransfer}
            onDecision={duplicateModal.inTransfer ? handleInTransferDecision : handleDuplicateDecision}
            onCancel={handleDuplicateCancel}
            applyAllActive={false}
            totalPendingConflicts={totalConflictsRef.current || duplicateModal.duplicates.length}
          />
        );
      })()}
    </div>
  );
}
