import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, RotateCcw, Terminal, Settings, Trash2, Send, QrCode, LogOut } from 'lucide-react';
import QRCode from 'qrcode';

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

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-[#111418] border border-[#1e2530] rounded-xl overflow-hidden">
      {(title || subtitle) && (
        <div className="px-4 py-3 border-b border-[#1e2530]">
          <div className="flex items-center justify-between">
            <div>
              {title && <h3 className="text-sm font-medium text-neutral-200">{title}</h3>}
              {subtitle && <p className="text-[10px] text-neutral-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export default function WhatsAppView({ onMenuOpen }) {
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState({});
  const [toast, setToast] = useState('');
  const [configDraft, setConfigDraft] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [qrSvg, setQrSvg] = useState('');
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

  const fetchTelegramStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/send/telegram/status');
      if (res.ok) setTelegramStatus(await res.json());
    } catch {}
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/logs?limit=100');
      if (!res.ok) return;
      const data = await res.json();
      const incoming = data.logs || [];
      if (incoming.length === 0) return;
      setLogs(prev => {
        const seen = new Set(prev.map(e => e.time));
        const merged = prev.slice();
        for (const e of incoming) if (!seen.has(e.time)) merged.push(e);
        merged.sort((a, b) => a.time - b.time);
        return merged.length > MAX_LOGS ? merged.slice(-MAX_LOGS) : merged;
      });
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchStats();
    fetchConfig();
    fetchTelegramStatus();
    fetchLogs();
    const interval = setInterval(() => {
      fetchStatus();
      fetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchStats, fetchConfig, fetchTelegramStatus, fetchLogs]);

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
    if (!showQr) return;
    if (status?.connected) {
      setShowQr(false);
      showToast('WhatsApp connected');
      return;
    }
    const t = setTimeout(() => fetchStatus(), 2000);
    return () => clearTimeout(t);
  }, [showQr, status?.connected, fetchStatus]);

  useEffect(() => {
    if (!showQr || status?.connected || !status?.lastQr) {
      setQrSvg('');
      return;
    }
    let cancelled = false;
    QRCode.toString(status.lastQr, {
      type: 'svg',
      margin: 1,
      width: 256,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(svg => { if (!cancelled) setQrSvg(svg); })
      .catch(() => { if (!cancelled) setQrSvg(''); });
    return () => { cancelled = true; };
  }, [showQr, status?.connected, status?.lastQr]);

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

  const setCounter = async (value, type = 'whatsapp') => {
    try {
      const res = await fetch('/api/whatsapp/counter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, type }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`${type} counter set to ${value}`);
        fetchStatus();
      } else {
        showToast('Error: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  };

  const resetCounter = async (type = 'whatsapp') => {
    try {
      const res = await fetch('/api/whatsapp/counter/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(type === 'telegram' ? 'Telegram counter reset' : 'Sent "." to WA channel & counter reset');
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
    <div data-debug-id="7.1" data-debug-name="WhatsAppView" data-debug-type="panel" className="flex-1 flex flex-col h-full bg-[#0b0d10] overflow-hidden">
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-[#111418] border border-[#1e2530] rounded-lg px-4 py-2 text-[11px] text-neutral-200 shadow-lg">
            {toast}
          </div>
        )}

        {/* Status + Controls */}
        <div data-debug-id="7.1.1" data-debug-name="WhatsAppStatusCard" data-debug-type="card">
        <Card title="Status" subtitle={isConnected ? 'Connected' : isInitializing ? 'Initializing...' : isStopped ? 'Stopped' : 'Disconnected'}>
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-3">
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

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-500">Target:</span>
              <code className="text-[10px] text-cyan-400 font-mono bg-neutral-900 px-1.5 py-0.5 rounded">
                {status?.targetChannel || '--'}
              </code>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-500">Counter:</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="3"
                  value={status?.whatsappCount ?? 0}
                  onChange={(e) => setCounter(parseInt(e.target.value) || 0, 'whatsapp')}
                  className="w-12 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[10px] text-cyan-400 font-mono text-center outline-none focus:border-cyan-500/50"
                />
                <span className="text-[10px] text-neutral-600">/ 3</span>
                <button
                  onClick={() => resetCounter('whatsapp')}
                  className="ml-1.5 flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded text-[10px] hover:bg-amber-500/20 transition-colors"
                  title='Reset WA counter (sends "." to channel)'
                >
                  <RotateCcw size={10} />
                  Reset
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
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
        </Card>
        </div>

        {/* QR Code (generate after logout) */}
        <div data-debug-id="7.1.6" data-debug-name="WhatsAppQrCard" data-debug-type="card">
          <Card title="QR Code" subtitle="Pair a new device (logs out first)">
            <div className="px-4 pb-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    doAction('generate-qr');
                    setShowQr(true);
                  }}
                  disabled={loading['generate-qr']}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-[11px] hover:bg-green-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <QrCode size={12} />
                  {loading['generate-qr'] ? 'Generating...' : 'Generate QR'}
                </button>
                <button
                  onClick={() => doAction('logout')}
                  disabled={loading.logout}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[11px] hover:bg-red-500/20 transition-colors disabled:opacity-40"
                >
                  <LogOut size={12} />
                  {loading.logout ? 'Logging out...' : 'Logout'}
                </button>
              </div>

              {showQr && (
                status?.connected ? (
                  <div className="flex items-center gap-2 text-[11px] text-green-400">
                    <div className="w-2 h-2 rounded-full bg-green-400" /> Connected — QR hidden
                  </div>
                ) : qrSvg ? (
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className="w-48 rounded-lg bg-white p-2 [&_svg]:w-full [&_svg]:h-auto"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                    <p className="text-[10px] text-neutral-500 text-center">
                      Open WhatsApp → Linked Devices → Link a Device, then scan.<br />
                      Generating logs out the previous session first.
                    </p>
                  </div>
                ) : (
                  <div className="text-[11px] text-neutral-400 py-4">Generating QR…</div>
                )
              )}
            </div>
          </Card>
        </div>

        {/* Telegram Status */}
        <div data-debug-id="7.1.5" data-debug-name="TelegramStatusCard" data-debug-type="card">
        <Card title="Telegram" subtitle={telegramStatus?.configured ? 'Bot configured' : 'Not configured'}>
          <div className="px-4 pb-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${telegramStatus?.botReady ? 'bg-green-400' : telegramStatus?.configured ? 'bg-amber-400' : 'bg-neutral-600'}`} />
                <span className="text-[11px] text-neutral-300">
                  {telegramStatus?.botReady ? 'Connected' : telegramStatus?.configured ? 'Token set' : 'No token'}
                </span>
              </div>
              <code className="text-[10px] text-sky-400 font-mono bg-neutral-900 px-1.5 py-0.5 rounded">
                {telegramStatus?.chatId || '--'}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-500">Counter:</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="3"
                  value={status?.telegramCount ?? 0}
                  onChange={(e) => setCounter(parseInt(e.target.value) || 0, 'telegram')}
                  className="w-12 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[10px] text-sky-400 font-mono text-center outline-none focus:border-sky-500/50"
                />
                <span className="text-[10px] text-neutral-600">/ 3</span>
                <button
                  onClick={() => resetCounter('telegram')}
                  className="ml-1.5 flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded text-[10px] hover:bg-sky-500/20 transition-colors"
                  title="Reset Telegram counter"
                >
                  <RotateCcw size={10} />
                  Reset
                </button>
              </div>
            </div>
          </div>
        </Card>
        </div>

        {/* Config Editor */}
        <div data-debug-id="7.1.2" data-debug-name="WhatsAppConfigCard" data-debug-type="card">
        <Card title="Configuration" subtitle="WA Channel target">
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
            <button
              onClick={saveConfig}
              disabled={loading.saveConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-lg text-[11px] hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
            >
              <Settings size={12} />
              {loading.saveConfig ? 'Saving...' : 'Save Config'}
            </button>
          </div>
        </Card>
        </div>

        {/* Allowed Groups */}
        <div data-debug-id="7.1.3" data-debug-name="WhatsAppGroupsCard" data-debug-type="card">
        <Card title="Allowed Groups" subtitle="Chat IDs that trigger the bot">
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
        </Card>
        </div>

        {/* Log Terminal */}
        <div data-debug-id="7.1.4" data-debug-name="WhatsAppLogsCard" data-debug-type="card">
        <Card title="Logs" subtitle={`${logs.length} entries`}>
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
        </Card>
        </div>
      </div>
    </div>
  );
}
