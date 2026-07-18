import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GlassCard from '../shared/GlassCard';
import LogTerminal from '../components/LogTerminal';
import {
  Save, Settings, RefreshCw, Clock, RotateCcw, History, Search, X, Check, AlertTriangle,
  Monitor, Cpu, Gauge, Activity, Bell, Database, Wifi, HardDrive, Upload, Eye,
  Bot, Scan, Server, Globe, Layout, Shield, Zap, ChevronDown, ChevronUp, ArrowDown, ArrowUp,
  Trash2, Play, Wrench, BarChart3,
} from 'lucide-react';

const CATEGORY_META = {
  general:    { label: 'General',          icon: Settings,   color: 'text-neutral-400',   bg: 'bg-neutral-500/10', border: 'border-neutral-500/20' },
  dashboard:  { label: 'Dashboard',        icon: Layout,     color: 'text-cyan-400',      bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20' },
  performance:{ label: 'Performance',       icon: Zap,        color: 'text-yellow-400',    bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20' },
  monitoring: { label: 'Monitoring',        icon: Activity,   color: 'text-green-400',     bg: 'bg-green-500/10',   border: 'border-green-500/20' },
  alerts:     { label: 'Alerts',            icon: Bell,       color: 'text-orange-400',    bg: 'bg-orange-500/10',  border: 'border-orange-500/20' },
  retention:  { label: 'Data Retention',    icon: Database,   color: 'text-purple-400',    bg: 'bg-purple-500/10',  border: 'border-purple-500/20' },
  system:     { label: 'System',            icon: Server,     color: 'text-red-400',       bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  whatsapp:   { label: 'WhatsApp Bot',      icon: Bot,        color: 'text-emerald-400',   bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  scanner:    { label: 'Scan Settings',     icon: Scan,       color: 'text-blue-400',      bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  database:   { label: 'Database',          icon: Database,   color: 'text-amber-400',     bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  api:        { label: 'API',               icon: Globe,      color: 'text-teal-400',      bg: 'bg-teal-500/10',    border: 'border-teal-500/20' },
  serve:      { label: 'Serve & Delivery',  icon: HardDrive,  color: 'text-indigo-400',    bg: 'bg-indigo-500/10',  border: 'border-indigo-500/20' },
  render:     { label: 'Render Engine',     icon: Eye,        color: 'text-pink-400',      bg: 'bg-pink-500/10',    border: 'border-pink-500/20' },
  network:    { label: 'Network',           icon: Wifi,       color: 'text-sky-400',       bg: 'bg-sky-500/10',     border: 'border-sky-500/20' },
  upload:     { label: 'Upload',            icon: Upload,     color: 'text-lime-400',      bg: 'bg-lime-500/10',    border: 'border-lime-500/20' },
};

const CATEGORY_ORDER = [
  'general', 'dashboard', 'performance', 'monitoring', 'alerts', 'retention',
  'system', 'whatsapp', 'scanner', 'database', 'api', 'serve', 'render', 'network', 'upload',
];

const RETENTION_OPTIONS = [
  { value: 7, label: '7 Days' },
  { value: 14, label: '14 Days' },
  { value: 30, label: '30 Days' },
  { value: 90, label: '90 Days' },
  { value: 180, label: '180 Days' },
  { value: 365, label: '365 Days' },
  { value: 0, label: 'Unlimited' },
];

function HistoricalMetricsPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [confirmOptimize, setConfirmOptimize] = useState(false);
  const [result, setResult] = useState(null);
  const [retentionValue, setRetentionValue] = useState(7);
  const [savingRetention, setSavingRetention] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/metrics/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setRetentionValue(data.retentionDays ?? 7);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleCleanup = async () => {
    setCleaning(true);
    setConfirmCleanup(false);
    try {
      const res = await fetch('/api/monitoring/metrics/cleanup', { method: 'POST' });
      const data = await res.json();
      setResult({ type: 'cleanup', ...data });
      fetchStats();
    } catch (err) {
      setResult({ type: 'cleanup', success: false, error: err.message });
    }
    setCleaning(false);
    setTimeout(() => setResult(null), 5000);
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    setConfirmOptimize(false);
    try {
      const res = await fetch('/api/monitoring/metrics/optimize', { method: 'POST' });
      const data = await res.json();
      setResult({ type: 'optimize', ...data });
      fetchStats();
    } catch (err) {
      setResult({ type: 'optimize', success: false, error: err.message });
    }
    setOptimizing(false);
    setTimeout(() => setResult(null), 5000);
  };

  const handleRetentionChange = async (days) => {
    setRetentionValue(days);
    setSavingRetention(true);
    try {
      const res = await fetch('/api/settings/retention.historyDays', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: days }),
      });
      if (res.ok) {
        try { window.dispatchEvent(new CustomEvent('runtime-setting', { detail: { key: 'retention.historyDays', value: days } })); } catch {}
      }
    } catch {}
    setSavingRetention(false);
  };

  const formatTs = (ts) => ts ? new Date(ts).toLocaleString() : '--';
  const formatDuration = (ms) => ms ? `${(ms / 1000).toFixed(1)}s` : '--';

  if (loading) {
    return (
      <GlassCard>
        <div className="p-4 animate-pulse">
          <div className="h-4 w-48 bg-neutral-800 rounded mb-3" />
          <div className="grid grid-cols-2 gap-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-neutral-800/50 rounded" />)}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 flex items-center justify-center rounded-lg bg-purple-500/10 border border-purple-500/20">
            <BarChart3 size={12} className="text-purple-400" />
          </div>
          <div>
            <span className="text-[11px] text-neutral-300 font-semibold">Historical Metrics</span>
            <span className="text-[9px] text-neutral-600 ml-2">Storage Management</span>
          </div>
        </div>

        {/* Retention Selector */}
        <div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">Retention</div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {RETENTION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleRetentionChange(opt.value)}
                disabled={savingRetention}
                className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all border ${
                  retentionValue === opt.value
                    ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                    : 'bg-neutral-900/50 text-neutral-500 border-neutral-800 hover:bg-neutral-800 hover:text-neutral-300'
                } disabled:opacity-40`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Database Statistics */}
        <div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">Database Statistics</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Rows" value={stats?.totalRows?.toLocaleString() ?? '--'} />
            <StatBox label="Metrics Size" value={stats?.estimatedSizeMb ? `${stats.estimatedSizeMb} MB` : '--'} />
            <StatBox label="Oldest Sample" value={formatTs(stats?.oldestTs)} />
            <StatBox label="Newest Sample" value={formatTs(stats?.newestTs)} />
            <StatBox label="Growth / Day" value={stats?.dailyGrowth ? `~${stats.dailyGrowth.toLocaleString()} rows` : '--'} />
            <StatBox label="Growth / Month" value={stats?.monthlyGrowthMb ? `~${stats.monthlyGrowthMb} MB` : '--'} />
            <StatBox label="Last Cleanup" value={formatTs(stats?.lastCleanup)} />
            <StatBox label="Next Cleanup" value={stats?.nextCleanup ? formatTs(stats.nextCleanup) : 'after 24h'} />
          </div>
        </div>

        {/* Result Toast */}
        {result && (
          <div className={`px-3 py-2 rounded-lg text-[11px] border ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border-red-500/20'
          }`}>
            {result.type === 'cleanup' && result.success && (
              <span>Deleted {result.rowsDeleted?.toLocaleString() ?? 0} rows in {formatDuration(result.durationMs)}</span>
            )}
            {result.type === 'optimize' && result.success && (
              <span>Optimize complete in {formatDuration(result.durationMs)}</span>
            )}
            {result.error && <span>Error: {result.error}</span>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {confirmCleanup ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400">Delete old data?</span>
              <button onClick={handleCleanup} disabled={cleaning}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/30 transition-colors disabled:opacity-40">
                <Trash2 size={10} /> {cleaning ? 'Cleaning...' : 'Confirm'}
              </button>
              <button onClick={() => setConfirmCleanup(false)}
                className="px-2 py-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmCleanup(true)} disabled={cleaning}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-neutral-400 bg-neutral-900/50 hover:bg-neutral-800 rounded border border-neutral-800 hover:border-neutral-700 transition-colors disabled:opacity-40">
              <Play size={10} /> Run Cleanup Now
            </button>
          )}

          {confirmOptimize ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400">Rewrite database?</span>
              <button onClick={handleOptimize} disabled={optimizing}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded border border-amber-500/30 transition-colors disabled:opacity-40">
                <Wrench size={10} /> {optimizing ? 'Optimizing...' : 'Confirm'}
              </button>
              <button onClick={() => setConfirmOptimize(false)}
                className="px-2 py-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmOptimize(true)} disabled={optimizing}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-neutral-400 bg-neutral-900/50 hover:bg-neutral-800 rounded border border-neutral-800 hover:border-neutral-700 transition-colors disabled:opacity-40">
              <Wrench size={10} /> Optimize Database
            </button>
          )}

          <button onClick={fetchStats}
            className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 hover:border-neutral-700 transition-colors ml-auto">
            <RefreshCw size={10} /> Refresh
          </button>
        </div>

        <div className="text-[9px] text-neutral-700 leading-relaxed">
          Optimize rewrites the database file. Only use during maintenance windows.
          Cleanup runs automatically every 24 hours.
        </div>
      </div>
    </GlassCard>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-neutral-900/50 rounded-lg px-2.5 py-2 border border-neutral-800/50">
      <div className="text-[9px] text-neutral-600 uppercase tracking-wider">{label}</div>
      <div className="text-[11px] text-neutral-300 font-mono mt-0.5 truncate">{value}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [rollbacking, setRollbacking] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('general');
  const [collapsed, setCollapsed] = useState({});
  const tabRefs = useRef({});

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) setData(await res.json());
    } catch {}
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/history?limit=50');
      if (res.ok) {
        const d = await res.json();
        setHistory(d.entries || []);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const doRollback = async (id) => {
    setRollbacking(id);
    try {
      const res = await fetch(`/api/settings/rollback/${id}`, { method: 'POST' });
      if (res.ok) {
        setToast('Rolled back!');
        setTimeout(() => setToast(''), 2000);
        fetchSettings();
        fetchHistory();
      }
    } catch {}
    setRollbacking(null);
  };

  const formatTime = (ts) => new Date(ts).toLocaleString();

  const handleChange = (key, value) => setDirty(prev => ({ ...prev, [key]: value }));

  const handleSave = async (key) => {
    setSaving(key);
    const value = dirty[key];
    try {
      const res = await fetch(`/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        try { window.dispatchEvent(new CustomEvent('runtime-setting', { detail: { key, value } })); } catch {}
        setDirty(prev => { const { [key]: _, ...rest } = prev; return rest; });
        setToast(`Saved ${key}`);
        setTimeout(() => setToast(''), 2000);
      }
    } catch {}
    setSaving(null);
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    const keys = Object.keys(dirty);
    let saved = 0;
    for (const key of keys) {
      try {
        const res = await fetch(`/api/settings/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: dirty[key] }),
        });
        if (res.ok) {
          try { window.dispatchEvent(new CustomEvent('runtime-setting', { detail: { key, value: dirty[key] } })); } catch {}
          saved++;
        }
      } catch {}
    }
    setDirty({});
    setToast(`Saved ${saved} settings`);
    setTimeout(() => setToast(''), 2000);
    setSavingAll(false);
  };

  const handleDiscardAll = () => {
    setDirty({});
    setToast('Changes discarded');
    setTimeout(() => setToast(''), 2000);
  };

  // Count dirty per category
  const dirtyCounts = useMemo(() => {
    const counts = {};
    for (const key of Object.keys(dirty)) {
      const cat = key.split('.')[0];
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [dirty]);

  // Filter settings by search
  const matchesSearch = useCallback((setting) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      setting.key.toLowerCase().includes(q) ||
      (setting.label || '').toLowerCase().includes(q) ||
      (setting.description || '').toLowerCase().includes(q)
    );
  }, [search]);

  // Scroll tab into view on category change
  useEffect(() => {
    if (tabRefs.current[activeTab]) {
      tabRefs.current[activeTab].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeTab]);

  const renderToggle = (setting) => {
    const val = setting.key in dirty ? dirty[setting.key] : setting.value;
    const on = val === true || val === 'true';
    return (
      <button
        onClick={() => handleChange(setting.key, !on)}
        className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${
          on ? 'bg-cyan-500/30' : 'bg-neutral-800'
        }`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
          on ? 'left-[22px] bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.4)]' : 'left-0.5 bg-neutral-600'
        }`} />
      </button>
    );
  };

  const renderNumber = (setting) => {
    const val = setting.key in dirty ? dirty[setting.key] : setting.value;
    const num = Number(val);
    const min = setting.key.includes('timeout') || setting.key.includes('interval') ? 0 : -99999;
    const max = 999999;
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => handleChange(setting.key, Math.max(min, num - 1))}
          className="w-6 h-6 flex items-center justify-center rounded bg-neutral-800 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors text-[10px]"
        >
          <ArrowDown size={10} />
        </button>
        <input
          type="number"
          value={val}
          onChange={e => handleChange(setting.key, e.target.value)}
          className="w-20 text-center text-[11px] bg-neutral-900 text-neutral-200 border border-neutral-800 rounded px-1 py-1 outline-none font-mono focus:border-cyan-500/50 transition-colors"
        />
        <button
          onClick={() => handleChange(setting.key, Math.min(max, num + 1))}
          className="w-6 h-6 flex items-center justify-center rounded bg-neutral-800 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors text-[10px]"
        >
          <ArrowUp size={10} />
        </button>
      </div>
    );
  };

  const renderEnum = (setting) => {
    const val = setting.key in dirty ? dirty[setting.key] : setting.value;
    return (
      <select
        value={String(val)}
        onChange={e => handleChange(setting.key, e.target.value)}
        className="text-[11px] bg-neutral-900 text-neutral-200 border border-neutral-800 rounded px-2 py-1.5 outline-none flex-shrink-0 font-mono focus:border-cyan-500/50 transition-colors cursor-pointer"
      >
        {(setting.options?.enum || []).map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  };

  const renderString = (setting) => {
    const val = setting.key in dirty ? dirty[setting.key] : setting.value;
    return (
      <input
        type="text"
        value={val}
        onChange={e => handleChange(setting.key, e.target.value)}
        className="text-[11px] bg-neutral-900 text-neutral-200 border border-neutral-800 rounded px-2 py-1.5 outline-none w-48 font-mono focus:border-cyan-500/50 transition-colors"
      />
    );
  };

  const renderField = (setting) => {
    const isDirty = setting.key in dirty;
    const isSaving = saving === setting.key;

    let input;
    switch (setting.type) {
      case 'boolean': input = renderToggle(setting); break;
      case 'number': input = renderNumber(setting); break;
      case 'enum': input = renderEnum(setting); break;
      default: input = renderString(setting);
    }

    return (
      <div key={setting.key} className={`flex items-center gap-2 sm:gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        isDirty ? 'bg-cyan-500/5 border border-cyan-500/20' : 'border border-transparent hover:bg-neutral-800/30'
      }`} data-debug-id="2.13.2" data-debug-name="SettingRow" data-debug-type="other">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-neutral-300 font-medium">{setting.label || setting.key}</span>
            {isDirty && <span className="text-[9px] text-cyan-400 bg-cyan-500/10 px-1 py-0.5 rounded font-mono">modified</span>}
          </div>
          {setting.description && (
            <div className="text-[10px] text-neutral-600 mt-0.5 leading-tight">{setting.description}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {input}
          {isDirty && (
            <button
              onClick={() => handleSave(setting.key)}
              disabled={isSaving}
              className="p-1.5 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-40"
            >
              <Save size={12} className={isSaving ? 'animate-pulse' : ''} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const activeCat = CATEGORY_ORDER.find(c => {
    if (search) return data?.settings?.[c]?.some(matchesSearch);
    return c === activeTab;
  }) || activeTab;

  return (
    <div className="p-4 md:p-6" data-debug-id="2.13" data-debug-name="SettingsPage" data-debug-type="container">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Toast */}
        {toast && (
          <div className="fixed top-4 right-4 z-50 px-4 py-2 bg-cyan-500/20 text-cyan-400 text-xs rounded-lg border border-cyan-500/30 animate-pulse backdrop-blur">
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Settings size={12} /> Settings
            </h2>
            {Object.keys(dirty).length > 0 && (
              <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded-full font-mono">
                {Object.keys(dirty).length} unsaved
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={fetchSettings}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 hover:border-neutral-700 transition-colors">
              <RefreshCw size={12} /> Reload
            </button>
          </div>
        </div>

        {/* Sticky controls: tabs + search + save all */}
        <div className="sticky top-0 z-40 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-[#0d1117]/95 backdrop-blur border-b border-neutral-800/50 space-y-2">
          {/* Search + save buttons */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search settings..."
                className="w-full text-[11px] bg-neutral-900 text-neutral-300 border border-neutral-800 rounded-lg pl-7 pr-2 py-1.5 outline-none font-mono focus:border-cyan-500/50 transition-colors placeholder:text-neutral-600"
              />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400 transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>
            {Object.keys(dirty).length > 0 && (
              <>
                <button onClick={handleDiscardAll}
                  className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-neutral-500 hover:text-red-400 rounded border border-neutral-800 hover:border-red-500/30 transition-colors">
                  <X size={12} /> Discard
                </button>
                <button onClick={handleSaveAll} disabled={savingAll}
                  className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded border border-cyan-500/30 transition-colors disabled:opacity-40">
                  <Save size={12} className={savingAll ? 'animate-pulse' : ''} /> Save All
                </button>
              </>
            )}
          </div>

          {/* Category tabs */}
          {!search && (
            <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1" data-debug-id="2.13.1" data-debug-name="CategoryTabs" data-debug-type="other">
              {CATEGORY_ORDER.map(cat => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                const isActive = activeTab === cat;
                const count = dirtyCounts[cat] || 0;
                return (
                  <button
                    key={cat}
                    ref={el => tabRefs.current[cat] = el}
                    onClick={() => setActiveTab(cat)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all duration-200 border ${
                      isActive
                        ? `${meta.bg} ${meta.color} ${meta.border}`
                        : 'text-neutral-600 hover:text-neutral-400 border-transparent hover:bg-neutral-800/50'
                    }`}
                  >
                    <Icon size={11} />
                    {meta.label}
                    {count > 0 && (
                      <span className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center text-[8px] bg-cyan-500/20 text-cyan-400 rounded-full font-mono">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Settings content */}
        {data && (
          <>
            {search ? (
              // Search results: group by category
              CATEGORY_ORDER.map(cat => {
                const settings = data.settings?.[cat]?.filter(matchesSearch);
                if (!settings || settings.length === 0) return null;
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                return (
                  <GlassCard key={cat} data-debug-id="2.13.3" data-debug-name="SettingCategoryCard" data-debug-type="card">
                    <div className="px-4 pb-3 space-y-1">
                      <div className="flex items-center gap-2 mb-2 pt-1">
                        <div className={`w-5 h-5 flex items-center justify-center rounded ${meta.bg}`}>
                          <Icon size={10} className={meta.color} />
                        </div>
                        <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">{meta.label}</span>
                        <span className="text-[9px] text-neutral-700">{settings.length}</span>
                      </div>
                      {settings.map(renderField)}
                    </div>
                  </GlassCard>
                );
              })
            ) : (
              // Active tab only
              (() => {
                const settings = data.settings?.[activeTab];
                if (!settings || settings.length === 0) return (
                  <div className="text-center py-12 text-neutral-600 text-xs">No settings in this category</div>
                );
                const meta = CATEGORY_META[activeTab];
                const Icon = meta.icon;
                return (
                  <GlassCard data-debug-id="2.13.4" data-debug-name="SettingPreviewCard" data-debug-type="card">
                    <div className="px-4 pb-3 space-y-1">
                      <div className="flex items-center justify-between mb-1 pt-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 flex items-center justify-center rounded-lg ${meta.bg} ${meta.border} border`}>
                            <Icon size={12} className={meta.color} />
                          </div>
                          <div>
                            <span className="text-[11px] text-neutral-300 font-semibold">{meta.label}</span>
                            <span className="text-[9px] text-neutral-700 ml-2">{settings.length} settings</span>
                          </div>
                        </div>
                        {dirtyCounts[activeTab] > 0 && (
                          <span className="text-[9px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded-full font-mono">
                            {dirtyCounts[activeTab]} modified
                          </span>
                        )}
                      </div>
                      <div className="divide-y divide-neutral-800/30">
                        {settings.map(renderField)}
                      </div>
                    </div>
                  </GlassCard>
                );
              })()
            )}
          </>
        )}

        {/* Activity Log Terminal */}
        <div>
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Activity size={12} /> Activity Log
          </h2>
          <LogTerminal height="300px" />
        </div>

        {/* Historical Metrics Management */}
        {activeTab === 'retention' && <HistoricalMetricsPanel />}

        {/* Config History */}
        <div>
          <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchHistory(); }}
            className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 hover:text-neutral-400 transition-colors">
            <History size={12} />
            Change History
            <span className="text-neutral-700 font-normal">{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <GlassCard data-debug-id="2.13.5" data-debug-name="SettingRawCard" data-debug-type="card">
              <div className="max-h-[400px] overflow-y-auto">
                {history.length === 0 ? (
                  <div className="text-center py-8 text-neutral-600 text-xs">No history yet</div>
                ) : (
                  <div className="divide-y divide-[#1e2530]/30">
                    {history.map(h => (
                      <div key={h.id} className="px-4 py-2 flex items-start gap-3 text-[11px]">
                        <Clock size={12} className="text-neutral-700 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] text-neutral-400">{h.setting_key}</span>
                            <span className={`text-[10px] px-1 py-0.5 rounded uppercase font-semibold ${
                              h.action === 'rollback' ? 'bg-purple-500/10 text-purple-400' :
                              h.action === 'create' ? 'bg-green-500/10 text-green-400' :
                              h.action === 'delete' ? 'bg-red-500/10 text-red-400' :
                              'bg-blue-500/10 text-blue-400'
                            }`}>{h.action}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                            {h.old_value !== null && h.old_value !== undefined && (
                              <span className="text-neutral-600 line-through">{String(h.old_value).slice(0, 40)}</span>
                            )}
                            {h.old_value !== null && h.old_value !== undefined && h.new_value !== null && (
                              <span className="text-neutral-500">→</span>
                            )}
                            {h.new_value !== null && h.new_value !== undefined && (
                              <span className="text-neutral-300">{String(h.new_value).slice(0, 40)}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-neutral-700 mt-0.5 font-mono">{formatTime(h.timestamp)}</div>
                        </div>
                        {h.old_value !== null && h.action === 'update' && (
                          <button onClick={() => doRollback(h.id)} disabled={rollbacking === h.id}
                            className="p-1 rounded text-neutral-700 hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-30 flex-shrink-0"
                            title="Rollback">
                            <RotateCcw size={12} className={rollbacking === h.id ? 'animate-spin' : ''} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </GlassCard>
          )}
        </div>

      </div>
    </div>
  );
}
