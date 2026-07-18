import React, { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

// === API HELPERS ===
async function apiFetch(url, opts = {}) {
  const res = await fetch(`${API}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

const fetchDevices = () => apiFetch('/api/scrcpy/devices');
const fetchStatus = () => apiFetch('/api/scrcpy/status');
const startScrcpy = (data) => apiFetch('/api/scrcpy/start', { method: 'POST', body: data });
const stopScrcpy = (device) => apiFetch('/api/scrcpy/stop', { method: 'POST', body: { device } });
const stopAll = () => apiFetch('/api/scrcpy/stop-all', { method: 'POST' });
const sendInput = (data) => apiFetch('/api/scrcpy/input', { method: 'POST', body: data });

// === ICONS ===
function MonitorIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function HeadphonesIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0118 0v6" />
      <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z" />
    </svg>
  );
}

function VideoIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function PlayIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function StopIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function SmartphoneIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function SettingsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function ChevronDown({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PowerIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 11-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

// === TOGGLE SWITCH ===
function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${checked ? 'bg-sky-500' : 'bg-neutral-700'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

// === SLIDER ===
function Slider({ label, value, onChange, min, max, step = 1, unit = '', disabled = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-neutral-400 whitespace-nowrap min-w-[80px]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-500 disabled:opacity-40"
      />
      <span className="text-xs text-neutral-300 w-16 text-right">{value}{unit}</span>
    </div>
  );
}

// === MAIN COMPONENT ===
export default function ScrcpyView({ onMenuOpen }) {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [mode, setMode] = useState('full');
  const [running, setRunning] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    videoBitrate: '2M',
    maxSize: 1024,
    fps: 30,
    audioBitrate: '128k',
    turnScreenOff: true,
    stayAwake: false,
    showTouches: false,
    clipboardAutosync: true,
    powerOffOnClose: false,
    noPowerOn: false,
    crop: '',
    windowTitle: 'scrcpy',
  });

  const updateSetting = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const refreshDevices = useCallback(async () => {
    try {
      const data = await fetchDevices();
      setDevices(data.devices || []);
    } catch (err) {
      setError('Failed to fetch devices');
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setRunning(data.processes || {});
    } catch {}
  }, []);

  useEffect(() => {
    refreshDevices();
    refreshStatus();
    const interval = setInterval(() => {
      refreshStatus();
      refreshDevices();
    }, 3000);
    const onFocus = () => { refreshDevices(); refreshStatus(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [refreshDevices, refreshStatus]);

  const isDeviceRunning = (deviceId) => {
    return running[deviceId]?.running || false;
  };

  const handleStart = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await startScrcpy({
        device: selectedDevice,
        mode,
        settings,
      });
      if (result.error) {
        setError(result.error);
        if (result.logs) setLogs(result.logs);
      } else {
        refreshStatus();
        refreshDevices();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (deviceId) => {
    setLoading(true);
    try {
      await stopScrcpy(deviceId);
      refreshStatus();
      refreshDevices();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStopAll = async () => {
    setLoading(true);
    try {
      await stopAll();
      refreshStatus();
      refreshDevices();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickInput = async (command) => {
    try {
      await sendInput({ device: selectedDevice, command });
    } catch (err) {
      setError(err.message);
    }
  };

  const runningCount = Object.values(running).filter(p => p.running).length;

  const modeOptions = [
    { id: 'full', label: 'Video + Audio', desc: 'Mirror layar + suara', icon: MonitorIcon, activeClass: 'bg-sky-500/10 border-sky-500/30 text-sky-400' },
    { id: 'audio', label: 'Audio Only', desc: 'Audio dari HP saja', icon: HeadphonesIcon, activeClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
    { id: 'video-only', label: 'Video Only', desc: 'Mirror layar saja', icon: VideoIcon, activeClass: 'bg-violet-500/10 border-violet-500/30 text-violet-400' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-neutral-950">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onMenuOpen}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold text-neutral-200">Scrcpy Mirror</h1>
          {runningCount > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400 rounded-full">
              {runningCount} active
            </span>
          )}
        </div>
        {runningCount > 0 && (
          <button
            onClick={handleStopAll}
            className="px-3 py-1.5 text-xs font-medium bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition-colors"
          >
            Stop All
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Error Display */}
        {error && (
          <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{error}</span>
              <button onClick={() => { setError(''); setLogs([]); }} className="text-red-500 hover:text-red-300">✕</button>
            </div>
            {logs.length > 0 && (
              <div className="bg-neutral-900 rounded p-2 max-h-32 overflow-y-auto font-mono text-[10px] text-neutral-400 space-y-0.5">
                {logs.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Device Selection */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Perangkat</h3>
          {devices.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 bg-neutral-900 rounded-lg border border-neutral-800">
              <SmartphoneIcon size={16} />
              <span className="text-xs text-neutral-500">Tidak ada perangkat. Colok HP via USB & aktifkan USB Debugging.</span>
            </div>
          ) : (
            <div className="space-y-1">
              {devices.map(dev => (
                <div
                  key={dev.id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all cursor-pointer ${
                    selectedDevice === dev.id
                      ? 'bg-sky-500/10 border-sky-500/30'
                      : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'
                  }`}
                  onClick={() => setSelectedDevice(dev.id === selectedDevice ? null : dev.id)}
                >
                  <div className="flex items-center gap-2.5">
                    <SmartphoneIcon size={16} />
                    <div>
                      <p className="text-xs font-medium text-neutral-200">{dev.model}</p>
                      <p className="text-[10px] text-neutral-500">{dev.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isDeviceRunning(dev.id) && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                    {selectedDevice === dev.id && (
                      <span className="w-2 h-2 rounded-full bg-sky-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Mode Selection */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Mode</h3>
          <div className="grid grid-cols-3 gap-2">
            {modeOptions.map(opt => {
              const Icon = opt.icon;
              const isActive = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setMode(opt.id)}
                  className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border transition-all ${
                    isActive
                      ? opt.activeClass
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-[11px] font-medium">{opt.label}</span>
                  <span className="text-[10px] text-neutral-500">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Settings Panel */}
        <section className="space-y-2">
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider hover:text-neutral-300 transition-colors w-full"
          >
            <SettingsIcon size={14} />
            <span>Settings</span>
            <span className={`ml-auto transition-transform ${settingsExpanded ? 'rotate-180' : ''}`}>
              <ChevronDown />
            </span>
          </button>

          {settingsExpanded && (
            <div className="space-y-3 px-1">
              {/* Video Settings */}
              {(mode === 'full' || mode === 'video-only') && (
                <div className="space-y-2.5 p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                  <span className="text-[10px] font-medium text-neutral-500 uppercase">Video</span>
                  <Slider
                    label="Bitrate"
                    value={parseInt(settings.videoBitrate) || 2}
                    onChange={(v) => updateSetting('videoBitrate', `${v}M`)}
                    min={1}
                    max={20}
                    unit="M"
                  />
                  <Slider
                    label="Max Size"
                    value={settings.maxSize}
                    onChange={(v) => updateSetting('maxSize', v)}
                    min={256}
                    max={2560}
                    step={64}
                  />
                  <Slider
                    label="FPS"
                    value={settings.fps}
                    onChange={(v) => updateSetting('fps', v)}
                    min={1}
                    max={120}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Crop</span>
                    <input
                      type="text"
                      value={settings.crop}
                      onChange={(e) => updateSetting('crop', e.target.value)}
                      placeholder="W:H:X:Y"
                      className="w-28 px-2 py-1 text-[11px] bg-neutral-800 border border-neutral-700 rounded text-neutral-300 placeholder-neutral-600 outline-none focus:border-sky-500/50"
                    />
                  </div>
                </div>
              )}

              {/* Audio Settings */}
              {(mode === 'full' || mode === 'audio') && (
                <div className="space-y-2.5 p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                  <span className="text-[10px] font-medium text-neutral-500 uppercase">Audio</span>
                  <Slider
                    label="Bitrate"
                    value={parseInt(settings.audioBitrate) || 128}
                    onChange={(v) => updateSetting('audioBitrate', `${v}k`)}
                    min={32}
                    max={512}
                    step={32}
                    unit="k"
                  />
                </div>
              )}

              {/* Behavior Settings */}
              <div className="space-y-2 p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                <span className="text-[10px] font-medium text-neutral-500 uppercase">Behavior</span>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Matikan layar saat start</span>
                    <Toggle checked={settings.turnScreenOff} onChange={(v) => updateSetting('turnScreenOff', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Tetap aktif (stay awake)</span>
                    <Toggle checked={settings.stayAwake} onChange={(v) => updateSetting('stayAwake', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Tampilkan sentuhan</span>
                    <Toggle checked={settings.showTouches} onChange={(v) => updateSetting('showTouches', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Sinkron clipboard</span>
                    <Toggle checked={settings.clipboardAutosync} onChange={(v) => updateSetting('clipboardAutosync', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Power off saat tutup</span>
                    <Toggle checked={settings.powerOffOnClose} onChange={(v) => updateSetting('powerOffOnClose', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Jangan nyalakan layar</span>
                    <Toggle checked={settings.noPowerOn} onChange={(v) => updateSetting('noPowerOn', v)} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">Window Title</span>
                <input
                  type="text"
                  value={settings.windowTitle}
                  onChange={(e) => updateSetting('windowTitle', e.target.value)}
                  className="w-32 px-2 py-1 text-[11px] bg-neutral-800 border border-neutral-700 rounded text-neutral-300 outline-none focus:border-sky-500/50"
                />
              </div>
            </div>
          )}
        </section>

        {/* Quick Input (only when running) */}
        {runningCount > 0 && selectedDevice && isDeviceRunning(selectedDevice) && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Quick Input</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: 'Power', cmd: 'power' },
                { label: 'Back', cmd: 'back' },
                { label: 'Home', cmd: 'home' },
                { label: 'Menu', cmd: 'menu' },
                { label: 'Vol +', cmd: 'volume_up' },
                { label: 'Vol -', cmd: 'volume_down' },
                { label: 'Enter', cmd: 'enter' },
                { label: 'Tab', cmd: 'tab' },
              ].map(btn => (
                <button
                  key={btn.cmd}
                  onClick={() => handleQuickInput(btn.cmd)}
                  className="px-2 py-2 text-[11px] font-medium bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors active:scale-95"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Running Instances */}
        {runningCount > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Running</h3>
            <div className="space-y-1">
              {Object.entries(running).filter(([, p]) => p.running).map(([deviceId, proc]) => (
                <div key={deviceId} className="flex items-center justify-between px-3 py-2 bg-neutral-900 rounded-lg border border-neutral-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-neutral-300">{deviceId}</span>
                    <span className="text-[10px] text-neutral-600">PID {proc.pid}</span>
                  </div>
                  <button
                    onClick={() => handleStop(deviceId)}
                    className="px-2 py-1 text-[10px] font-medium bg-red-500/15 text-red-400 rounded hover:bg-red-500/25 transition-colors"
                  >
                    Stop
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {devices.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <SmartphoneIcon size={32} />
            <p className="text-xs text-neutral-500 text-center max-w-[250px]">
              Hubungkan HP via USB dan aktifkan USB Debugging untuk memulai mirror
            </p>
          </div>
        )}
      </div>

      {/* Start Button (fixed bottom) */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-neutral-800 bg-neutral-950">
        <button
          onClick={handleStart}
          disabled={!devices.length || loading}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            devices.length && !loading
              ? 'bg-sky-500 text-white hover:bg-sky-400 active:scale-[0.98]'
              : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
          }`}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Loading...
            </>
          ) : isDeviceRunning(selectedDevice || devices[0]?.id) ? (
            <>
              <StopIcon size={16} />
              Stop
            </>
          ) : (
            <>
              <PlayIcon size={16} />
              Start Mirror
            </>
          )}
        </button>
      </div>
    </div>
  );
}
