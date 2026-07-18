import { useState, useEffect, useRef } from 'react';
import GlassCard from '../shared/GlassCard';
import { Globe, Smartphone, Monitor, Users, Wifi, Activity, Clock, X } from 'lucide-react';

export default function SessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, mobile: 0, desktop: 0 });
  const esRef = useRef(null);

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const res = await fetch('/api/monitoring/sessions');
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions || []);
          setStats(data.stats || {});
        }
      } catch {}
    };
    fetchInitial();

    const es = new EventSource('/api/monitoring/sessions/stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setSessions(data.sessions || []);
        setStats(data.stats || {});
      } catch {}
    };
    esRef.current = es;
    return () => es.close();
  }, []);

  const disconnectSession = async (id) => {
    try {
      await fetch(`/api/monitoring/sessions/${id}`, { method: 'DELETE' });
    } catch {}
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const platformIcons = {
    Android: <Smartphone size={12} className="text-green-400" />,
    iOS: <Smartphone size={12} className="text-neutral-400" />,
    Windows: <Monitor size={12} className="text-blue-400" />,
    macOS: <Monitor size={12} className="text-neutral-400" />,
    Linux: <Monitor size={12} className="text-orange-400" />,
  };

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
          <Users size={12} /> Active Sessions
        </h2>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <GlassCard data-debug-id="2.16.3" data-debug-name="SessionCard1" data-debug-type="card">
            <div className="p-4 text-center">
              <Users size={16} className="mx-auto mb-1 text-cyan-400" />
              <div className="text-lg font-mono tabular-nums text-neutral-200">{stats.total || 0}</div>
              <div className="text-[10px] text-neutral-600">Total Sessions</div>
            </div>
          </GlassCard>
          <GlassCard data-debug-id="2.16.4" data-debug-name="SessionCard2" data-debug-type="card">
            <div className="p-4 text-center">
              <Activity size={16} className="mx-auto mb-1 text-green-400" />
              <div className="text-lg font-mono tabular-nums text-neutral-200">{stats.active || 0}</div>
              <div className="text-[10px] text-neutral-600">Active Now</div>
            </div>
          </GlassCard>
          <GlassCard data-debug-id="2.16.5" data-debug-name="SessionCard3" data-debug-type="card">
            <div className="p-4 text-center">
              <Smartphone size={16} className="mx-auto mb-1 text-purple-400" />
              <div className="text-lg font-mono tabular-nums text-neutral-200">{stats.mobile || 0}</div>
              <div className="text-[10px] text-neutral-600">Mobile</div>
            </div>
          </GlassCard>
          <GlassCard data-debug-id="2.16.6" data-debug-name="SessionCard4" data-debug-type="card">
            <div className="p-4 text-center">
              <Monitor size={16} className="mx-auto mb-1 text-blue-400" />
              <div className="text-lg font-mono tabular-nums text-neutral-200">{stats.desktop || 0}</div>
              <div className="text-[10px] text-neutral-600">Desktop</div>
            </div>
          </GlassCard>
        </div>

        {/* Session Table */}
        <GlassCard data-debug-id="2.16.7" data-debug-name="SessionMainCard" data-debug-type="card">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#1e2530]">
                  <th className="text-left text-neutral-600 font-medium py-2 px-2">Client</th>
                  <th className="text-left text-neutral-600 font-medium py-2 px-2">Platform</th>
                  <th className="text-left text-neutral-600 font-medium py-2 px-2">Page</th>
                  <th className="text-right text-neutral-600 font-medium py-2 px-2">Requests</th>
                  <th className="text-right text-neutral-600 font-medium py-2 px-2">Last Seen</th>
                  <th className="text-right text-neutral-600 font-medium py-2 px-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-neutral-600 text-xs">No active sessions</td>
                  </tr>
                ) : (
                  sessions.map(s => (
                    <tr key={s.id} className="border-b border-[#1e2530]/30 hover:bg-white/[0.02]">
                      <td className="py-1.5 px-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-neutral-400">{s.ip}</span>
                        </div>
                        <div className="text-[10px] text-neutral-600 truncate max-w-[200px]">{s.userAgent?.slice(0, 60)}</div>
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex items-center gap-1.5">
                          {platformIcons[s.platform] || <Globe size={12} className="text-neutral-600" />}
                          <span className="text-neutral-400">{s.platform || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="text-neutral-500 font-mono text-[10px]">{s.page}</span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-neutral-400">{s.requestCount}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-neutral-500">
                        <div className="flex items-center justify-end gap-1">
                          <Clock size={10} className="text-neutral-700" />
                          {formatTime(s.lastSeen)}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <button onClick={() => disconnectSession(s.id)}
                          className="p-1 rounded text-neutral-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Disconnect">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
