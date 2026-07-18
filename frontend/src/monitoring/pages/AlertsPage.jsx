import { useState, useEffect, useCallback } from 'react';
import GlassCard from '../shared/GlassCard';
import { Bell, BellOff, Clock, AlertTriangle, AlertCircle, Info } from 'lucide-react';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState({ thresholds: {}, history: [] });
  const [editing, setEditing] = useState(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/alerts');
      if (res.ok) setAlerts(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const toggleThreshold = async (key, enabled) => {
    await fetch('/api/monitoring/alerts/threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, config: { enabled } }),
    });
    fetchAlerts();
  };

  const updateThreshold = async (key, field, value) => {
    await fetch('/api/monitoring/alerts/threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, config: { [field]: parseInt(value) || 0 } }),
    });
    fetchAlerts();
  };

  const thresholdLabels = {
    cpu: { label: 'CPU Usage', icon: Info },
    memory: { label: 'Memory Usage', icon: Info },
    disk: { label: 'Disk Usage', icon: Info },
    temperature: { label: 'CPU Temperature', icon: Info },
    gpuTemp: { label: 'GPU Temperature', icon: Info },
  };

  const sevIcons = {
    critical: <AlertCircle size={12} className="text-red-400" />,
    warning: <AlertTriangle size={12} className="text-yellow-400" />,
  };

  const sevColors = {
    critical: 'border-l-red-500/30 bg-red-500/[0.02]',
    warning: 'border-l-yellow-500/30 bg-yellow-500/[0.02]',
  };

  return (
    <div className="p-4 md:p-6" data-debug-id="2.11" data-debug-name="AlertsPage" data-debug-type="container">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Threshold Configuration */}
        <div data-debug-id="2.11.1" data-debug-name="ThresholdConfig" data-debug-type="panel">
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Bell size={12} /> Threshold Alerts
          </h2>
          <GlassCard data-debug-id="2.11.3" data-debug-name="ThresholdsCard" data-debug-type="card">
            <div className="p-4 space-y-3">
              {Object.entries(thresholdLabels).map(([key, meta]) => {
                const t = alerts.thresholds[key];
                if (!t) return null;
                const Icon = meta.icon;
                return (
                  <div key={key} className="flex items-center justify-between gap-4 text-[11px] border-b border-[#1e2530]/30 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon size={14} className="text-neutral-500 flex-shrink-0" />
                      <span className="text-neutral-400">{meta.label}</span>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={t.enabled} onChange={e => toggleThreshold(key, e.target.checked)}
                          className="accent-cyan-500" />
                        <span className="text-neutral-500">{t.enabled ? 'On' : 'Off'}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-500/70">Warn:</span>
                        <input type="number" value={t.warning}
                          onChange={e => updateThreshold(key, 'warning', e.target.value)}
                          className="w-14 bg-[#1e2530] text-neutral-300 text-[11px] px-2 py-1 rounded border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 font-mono tabular-nums text-right" disabled={!t.enabled} />
                        <span className="text-xs text-neutral-600">/</span>
                        <span className="text-red-400/70">Crit:</span>
                        <input type="number" value={t.critical}
                          onChange={e => updateThreshold(key, 'critical', e.target.value)}
                          className="w-14 bg-[#1e2530] text-neutral-300 text-[11px] px-2 py-1 rounded border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 font-mono tabular-nums text-right" disabled={!t.enabled} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>

        {/* Alert History */}
        <div data-debug-id="2.11.2" data-debug-name="AlertHistoryTable" data-debug-type="table">
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Clock size={12} /> History
          </h2>
          <GlassCard data-debug-id="2.11.4" data-debug-name="AlertHistoryCard" data-debug-type="card">
            <div className="max-h-[400px] overflow-y-auto">
              {alerts.history.length > 0 ? (
                <div className="divide-y divide-[#1e2530]/30">
                  {alerts.history.slice(0, 100).map((alert, i) => (
                    <div key={i} className={`px-4 py-2 border-l-2 ${sevColors[alert.severity] || 'border-l-neutral-700'}`}>
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 flex-shrink-0">
                          {sevIcons[alert.severity] || <Info size={12} className="text-neutral-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] text-neutral-400 font-medium capitalize">{alert.type}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${
                              alert.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
                            }`}>{alert.severity}</span>
                            <span className="text-[10px] text-neutral-600 ml-auto font-mono tabular-nums">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="text-[11px] text-neutral-500 mt-0.5">{alert.message}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-neutral-600 text-xs">
                  <BellOff size={24} className="mx-auto mb-2 text-neutral-700" />
                  No alerts triggered yet
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
