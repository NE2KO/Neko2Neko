import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Play, Square, RotateCcw, Terminal, Upload, Settings, Hash, Trash2 } from 'lucide-react';
import GlassCard from '../shared/GlassCard';

const MAX_LOGS = 200;

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function WhatsAppPage() {
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState({});
  const [toast, setToast] = useState('');
  const [configDraft, setConfigDraft] = useState(null);
  const logContainerRef = useRef(null);
  const autoScroll = useRef(true);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/stats');
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setConfigDraft(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchStats();
    fetchConfig();
    const interval = setInterval(() => {
      fetchStatus();
      fetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchStats, fetchConfig]);

  useEffect(() => {
    let es;
    let reconnectTimer;

    const connect = () => {
      es = new EventSource('/api/whatsapp/logs/stream');
      es.onmessage = (e) => {
        try {
          const entry = JSON.parse(e.data);
          setLogs(prev => {
            const next = [...prev, entry];
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
          });
        } catch {}
      };
      es.onerror = () => {
        es.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      if (es) es.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    if (logs.length === 0 || !autoScroll.current) return;
    const el = logContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  const doAction = async (action, body) => {
    setLoading(prev => ({ ...prev, [action]: true }));
    try {
      const res = await fetch(`/api/whatsapp/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'OK');
        fetchStatus();
      } else {
        showToast('Error: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    } finally {
      setLoading(prev => ({ ...prev, [action]: false }));
    }
  };

  const saveConfig = async () => {
    setLoading(prev => ({ ...prev, saveConfig: true }));
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configDraft),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Config saved. Restart bot to apply.');
        setConfig(configDraft);
      } else {
        showToast('Error: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    } finally {
      setLoading(prev => ({ ...prev, saveConfig: false }));
    }
  };

  const setCounter = async (value) => {
    try {
      const res = await fetch('/api/whatsapp/counter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Counter set to ${value}`);
        fetchStatus();
      } else {
        showToast('Error: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  };

  const resetCounter = async () => {
    try {
      const res = await fetch('/api/whatsapp/counter/reset', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('Sent "." to channel & counter reset');
        fetchStatus();
      } else {
        showToast('Error: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  };

  const clearLogs = () => setLogs([]);

  const getLevelColor = (level) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-amber-400';
      default: return 'text-neutral-400';
    }
  };

  const isConnected = status?.connected;
  const isStopped = status?.stopped;
  const isInitializing = status?.initializing;

  return (
    <div className="p-4 space-y-4" data-debug-id="2.14" data-debug-name="WhatsAppPage" data-debug-type="container">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#111418] border border-[#1e2530] rounded-lg px-4 py-2 text-[11px] text-neutral-200 shadow-lg">
          {toast}
        </div>
      )}

      {/* Status + Controls */}
      <GlassCard data-debug-id="2.14.1" data-debug-name="StatusCard" data-debug-type="card" title="WhatsApp Bot" subtitle={isConnected ? 'Connected' : isInitializing ? 'Initializing...' : isStopped ? 'Stopped' : 'Disconnected'}>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : isInitializing ? 'bg-amber-400 animate-pulse' : isStopped ? 'bg-neutral-500' : 'bg-red-400'}`} />
            <span className="text-[11px] text-neutral-300">
              {isConnected ? 'Connected' : isInitializing ? 'Initializing...' : isStopped ? 'Stopped' : 'Disconnected'}
            </span>
            {status?.uptime && (
              <span className="text-[10px] text-neutral-600">
                Uptime: {formatDuration(status.uptime)}
              </span>
            )}
          </div>

          {/* QR Code for web scan */}
          {(status?.lastQr || isInitializing) && !isConnected && (
            <div className="mt-3 p-3 bg-neutral-900/80 border border-neutral-800 rounded-lg">
              <p className="text-[10px] text-amber-400 mb-2">
                Scan with WhatsApp → Linked Devices → Link a Device
              </p>
              {status?.lastQr ? (
                <img
                  src={`/api/whatsapp/qr-image`}
                  alt="QR Code"
                  className="w-40 h-40 mx-auto rounded bg-white"
                  key={status.lastQr}
                />
              ) : (
                <div className="w-40 h-40 mx-auto rounded bg-neutral-800 animate-pulse flex items-center justify-center">
                  <span className="text-[10px] text-neutral-500">Loading QR…</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] text-neutral-500">Target:</span>
            <code className="text-[10px] text-cyan-400 font-mono bg-neutral-900 px-1.5 py-0.5 rounded">
              {status?.targetChannel || '--'}
            </code>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] text-neutral-500">Counter:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                max="3"
                value={status?.uploadCounter ?? stats?.uploadCounter ?? 0}
                onChange={(e) => setCounter(parseInt(e.target.value) || 0)}
                className="w-12 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[10px] text-cyan-400 font-mono text-center outline-none focus:border-cyan-500/50"
              />
              <span className="text-[10px] text-neutral-600">/ 3</span>
              <button
                onClick={resetCounter}
                className="ml-1 flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded text-[10px] hover:bg-amber-500/20 transition-colors"
                  title='Send "." to channel & reset counter'
              >
                <RotateCcw size={10} />
                Reset
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] text-neutral-500">Events:</span>
            <span className="text-[10px] text-neutral-400 font-mono">
              {status?.eventCount ?? 0}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => doAction('start')}
              disabled={loading.start || isConnected || isInitializing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-[11px] hover:bg-green-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={12} />
              {loading.start ? 'Starting...' : 'Start'}
            </button>
            <button
              onClick={() => doAction('stop')}
              disabled={loading.stop || (!isConnected && !isInitializing)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[11px] hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Square size={12} />
              {loading.stop ? 'Stopping...' : 'Stop'}
            </button>
            <button
              onClick={() => doAction('restart')}
              disabled={loading.restart}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[11px] hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={12} />
              {loading.restart ? 'Restarting...' : 'Restart'}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Config Editor */}
      <GlassCard data-debug-id="2.14.2" data-debug-name="ConfigEditorCard" data-debug-type="card" title="Configuration" subtitle="Trigger keywords & hashtags">
        <div className="px-4 pb-4 space-y-3">
          <div>
            <label className="text-[10px] text-neutral-500 block mb-1">Target Channel</label>
            <input
              type="text"
              value={configDraft?.targetChatJid || ''}
              onChange={e => setConfigDraft(prev => ({ ...prev, targetChatJid: e.target.value }))}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-[11px] text-neutral-200 font-mono outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-neutral-500 block mb-1">Trigger Keywords (comma separated)</label>
            <input
              type="text"
              value={configDraft?.triggerKeywords?.join(', ') || ''}
              onChange={e => setConfigDraft(prev => ({ ...prev, triggerKeywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-[11px] text-neutral-200 font-mono outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-neutral-500 block mb-1">Trigger Hashtags (comma separated)</label>
            <input
              type="text"
              value={configDraft?.triggerHashtags?.join(', ') || ''}
              onChange={e => setConfigDraft(prev => ({ ...prev, triggerHashtags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-[11px] text-neutral-200 font-mono outline-none focus:border-cyan-500/50"
            />
          </div>
          <button
            onClick={saveConfig}
            disabled={loading.saveConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-lg text-[11px] hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
          >
            <Settings size={12} />
            {loading.saveConfig ? 'Saving...' : 'Save Config'}
          </button>
        </div>
      </GlassCard>

      {/* Allowed Groups */}
      <GlassCard data-debug-id="2.14.3" data-debug-name="AllowedGroupsCard" data-debug-type="card" title="Allowed Groups" subtitle="Chat IDs that trigger the bot">
        <div className="px-4 pb-4">
          <div className="space-y-1">
            {status?.allowedGroups?.map((group, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${group === '*' ? 'bg-cyan-400' : 'bg-green-400'}`} />
                <code className="text-[10px] text-neutral-300 font-mono">{group}</code>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-neutral-600 mt-2">
            Edit <code className="text-neutral-500">config.js</code> to change allowed groups
          </p>
        </div>
      </GlassCard>

      {/* Log Terminal */}
      <GlassCard data-debug-id="2.14.4" data-debug-name="LogsCard" data-debug-type="card" title="Logs" subtitle={`${logs.length} entries`}>
        <div className="px-4 pb-4">
          <div className="bg-[#0a0c0f] rounded-lg border border-[#1e2530] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d1117] border-b border-[#1e2530]">
              <div className="flex items-center gap-2">
                <Terminal size={12} className="text-neutral-500" />
                <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Bot Activity</span>
              </div>
              <button onClick={clearLogs} className="p-1 rounded text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors">
                <Trash2 size={12} />
              </button>
            </div>
            <div
              ref={logContainerRef}
              className="overflow-y-auto font-mono text-[11px] leading-5 p-2"
              style={{ height: '300px', scrollbarGutter: 'stable' }}
              onScroll={(e) => {
                const el = e.target;
                autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
              }}
            >
              {logs.length === 0 && (
                <div className="text-neutral-700 text-center py-8">No log entries yet</div>
              )}
              {logs.map((entry, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-neutral-700 flex-shrink-0 w-16 tabular-nums">{formatTime(entry.time)}</span>
                  <span className={`flex-shrink-0 w-10 ${getLevelColor(entry.level)}`}>{entry.level}</span>
                  <span className="text-neutral-300 break-all">{entry.message}</span>
                </div>
              ))}
              <div />
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
