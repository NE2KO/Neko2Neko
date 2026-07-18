import { useState, useEffect, useCallback, useRef } from 'react';
import GlassCard from '../shared/GlassCard';
import { Search, Filter, Terminal } from 'lucide-react';

let pollTimer = null;

export default function LogsPage() {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('');
  const [unit, setUnit] = useState('');
  const [lines, setLines] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const containerRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ lines: lines.toString() });
      if (filter) params.set('filter', filter);
      if (unit) params.set('unit', unit);
      const res = await fetch(`/api/monitoring/logs?${params}`);
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        setEntries([]);
        return;
      }
      const data = await res.json();
      setEntries(data.entries || []);
      setFetchError(null);
    } catch (e) {
      setFetchError(e.message || 'Failed to fetch logs');
      setEntries([]);
    }
  }, [filter, unit, lines]);

  useEffect(() => {
    fetchLogs();
    if (autoRefresh) {
      pollTimer = setInterval(fetchLogs, 3000);
      return () => { if (pollTimer) clearInterval(pollTimer); };
    }
    return () => { if (pollTimer) clearInterval(pollTimer); };
  }, [fetchLogs, autoRefresh]);

  const getSeverity = (msg) => {
    if (/error|fail|critical|panic|emerg/i.test(msg)) return 'error';
    if (/warn|warning/i.test(msg)) return 'warning';
    if (/info/i.test(msg)) return 'info';
    return 'debug';
  };

  const severityColors = {
    error: 'text-red-400 bg-red-500/5',
    warning: 'text-yellow-400 bg-yellow-500/5',
    info: 'text-blue-400 bg-blue-500/5',
    debug: 'text-neutral-400',
  };

  const severityDots = {
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500',
    debug: 'bg-neutral-700',
  };

  return (
    <div className="p-3 md:p-6" data-debug-id="2.10" data-debug-name="LogsPage" data-debug-type="container">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
            <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Filter messages..."
              className="w-full bg-[#1e2530] text-neutral-300 text-xs pl-8 pr-3 py-2 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30"
              data-debug-id="2.10.1" data-debug-name="LogFilter" data-debug-type="other" />
          </div>
          <div className="relative max-w-[180px] hidden sm:block">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
            <input type="text" value={unit} onChange={e => setUnit(e.target.value)}
              placeholder="Unit filter..."
              className="w-full bg-[#1e2530] text-neutral-300 text-xs pl-8 pr-3 py-2 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30"
              data-debug-id="2.10.2" data-debug-name="UnitFilter" data-debug-type="dropdown" />
          </div>
          <select value={lines} onChange={e => setLines(parseInt(e.target.value))}
            className="bg-[#1e2530] text-neutral-300 text-xs px-2 py-2 rounded-lg border border-[#2a3340] focus:outline-none"
            data-debug-id="2.10.3" data-debug-name="LineCount" data-debug-type="other">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 cursor-pointer" data-debug-id="2.10.4" data-debug-name="AutoRefresh" data-debug-type="other">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-cyan-500" />
            Auto
          </label>
          <button onClick={fetchLogs} className="text-neutral-600 hover:text-neutral-400 p-1">
            <Terminal size={14} />
          </button>
        </div>
        <GlassCard data-debug-id="2.10.6" data-debug-name="LogTerminalCard" data-debug-type="card">
          <div ref={containerRef} className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            {entries.length > 0 ? (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-[#111418] z-10">
                  <tr className="border-b border-[#1e2530]">
                    <th className="text-left text-neutral-600 font-medium py-2 px-2 w-[120px] sm:w-[180px]">Time</th>
                    <th className="text-left text-neutral-600 font-medium py-2 px-2 w-[60px] sm:w-[80px] hidden sm:table-cell">Unit</th>
                    <th className="text-left text-neutral-600 font-medium py-2 px-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => {
                    const sev = getSeverity(entry.message);
                    return (
                      <tr key={i} className={`border-b border-[#1e2530]/30 ${sev === 'error' ? 'bg-red-500/[0.02]' : ''} hover:bg-white/[0.02]`}>
                        <td className="py-1 px-2 text-neutral-500 font-mono tabular-nums whitespace-nowrap text-[10px]">{entry.timestamp}</td>
                        <td className="py-1 px-2 hidden sm:table-cell">
                          <span className="text-[10px] text-neutral-500 font-mono truncate block max-w-[80px]">{entry.unit}</span>
                        </td>
                        <td className="py-1 px-2">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityDots[sev]}`} />
                            <span className={`${severityColors[sev]} truncate`}>{entry.message}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-neutral-600 text-xs">
                <Terminal size={24} className="mx-auto mb-2 text-neutral-700" />
                {fetchError ? (
                  <div>
                    <div className="text-red-400 mb-1">Failed to load logs</div>
                    <div className="text-neutral-500 text-[10px]">{fetchError}</div>
                    <button onClick={fetchLogs} className="mt-2 px-3 py-1 bg-cyan-500/10 text-cyan-400 rounded text-[10px] hover:bg-cyan-500/20">Retry</button>
                  </div>
                ) : (
                  <div>
                    <div>No log entries found</div>
                    <div className="text-[10px] text-neutral-700 mt-1">journalctl may have no entries or the service may be unavailable</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
