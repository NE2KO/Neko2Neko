import { useState, useEffect, useCallback } from 'react';
import GlassCard from '../shared/GlassCard';
import { Search, ArrowUpDown } from 'lucide-react';

let pollTimer = null;

export default function ProcessesPage() {
  const [processes, setProcesses] = useState([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('cpu');
  const [search, setSearch] = useState('');

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitoring/processes?sort=${sort}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setProcesses(data.processes || []);
        setTotal(data.total || 0);
      }
    } catch {}
  }, [sort]);

  useEffect(() => {
    fetchProcesses();
    pollTimer = setInterval(fetchProcesses, 3000);
    return () => { if (pollTimer) clearInterval(pollTimer); };
  }, [fetchProcesses]);

  const filtered = search
    ? processes.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.cmdline.toLowerCase().includes(search.toLowerCase()) || `${p.pid}` === search)
    : processes;

  const cols = [
    { key: 'pid', label: 'PID', hideOnMobile: true },
    { key: 'name', label: 'Name' },
    { key: 'cpuPercent', label: 'CPU%' },
    { key: 'ramMB', label: 'RAM' },
    { key: 'state', label: 'State', hideOnMobile: true },
    { key: 'threads', label: 'Thr', hideOnMobile: true },
    { key: 'username', label: 'User', hideOnMobile: true },
  ];

  function toggleSort(key) {
    setSort(prev => prev === key ? `-${key}` : key);
  }

  return (
    <div className="p-3 md:p-6" data-debug-id="2.7" data-debug-name="ProcessesPage" data-debug-type="container">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
            <input data-debug-id="2.7.1" data-debug-name="ProcessSearch" data-debug-type="other" type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search processes..."
              className="w-full bg-[#1e2530] text-neutral-300 text-xs pl-8 pr-3 py-2 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30" />
          </div>
          <span className="text-[11px] text-neutral-600">{total} processes</span>
        </div>
        <GlassCard data-debug-id="2.7.3" data-debug-name="ProcessListCard" data-debug-type="card">
          <div className="overflow-x-auto">
            <table data-debug-id="2.7.2" data-debug-name="ProcessTable" data-debug-type="table" className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#1e2530]">
                  {cols.map(c => (
                    <th key={c.key}
                      className={`text-left text-neutral-600 font-medium py-2 px-2 cursor-pointer hover:text-neutral-400 ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                      onClick={() => toggleSort(c.key)}>
                      <div className="flex items-center gap-1">
                        {c.label}
                        {sort.replace('-', '') === c.key && <ArrowUpDown size={10} className="text-cyan-500" />}
                      </div>
                    </th>
                  ))}
                  <th className="text-left text-neutral-600 font-medium py-2 px-2 hidden lg:table-cell">Command</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(p => (
                  <tr key={p.pid} data-debug-id="2.7.2.1" data-debug-name="ProcessRow" data-debug-type="card" className="border-b border-[#1e2530]/50 hover:bg-white/[0.02]">
                    <td className="py-1.5 px-2 font-mono tabular-nums text-neutral-400 hidden md:table-cell">{p.pid}</td>
                    <td className="py-1.5 px-2 text-neutral-300 max-w-[120px] truncate">{p.name}</td>
                    <td className="py-1.5 px-2">
                      <span className={`font-mono tabular-nums ${p.cpuPercent > 80 ? 'text-red-400' : p.cpuPercent > 50 ? 'text-yellow-400' : 'text-neutral-400'}`}>
                        {p.cpuPercent?.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-mono tabular-nums text-neutral-400">{p.ramMB} MB</td>
                    <td className="py-1.5 px-2 hidden md:table-cell">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.state === 'R' ? 'bg-green-500/10 text-green-400' : p.state === 'S' ? 'bg-blue-500/10 text-blue-400' : 'bg-neutral-500/10 text-neutral-500'}`}>
                        {p.state}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-mono tabular-nums text-neutral-500 hidden md:table-cell">{p.threads}</td>
                    <td className="py-1.5 px-2 text-neutral-500 max-w-[60px] truncate hidden md:table-cell">{p.username ?? p.uid}</td>
                    <td className="py-1.5 px-2 text-neutral-500 max-w-[300px] truncate hidden lg:table-cell">{p.cmdline || p.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-8 text-neutral-600 text-xs">No processes found</div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
