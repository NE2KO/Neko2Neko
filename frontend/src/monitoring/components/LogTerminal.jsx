import { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2 } from 'lucide-react';

const MAX_VISIBLE = 200;

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getLevelColor(level) {
  switch (level) {
    case 'error': return 'text-red-400';
    case 'warn': return 'text-amber-400';
    default: return 'text-neutral-400';
  }
}

export default function LogTerminal({ height = '240px' }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const containerRef = useRef(null);
  const autoScroll = useRef(true);
  const initDone = useRef(false);

  const scrollToBottom = (smooth) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  };

  const onScroll = (e) => {
    const el = e.target;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  useEffect(() => {
    const es = new EventSource('/api/logs/stream');
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        setLogs(prev => {
          const next = [...prev, entry];
          if (next.length > MAX_VISIBLE) return next.slice(-MAX_VISIBLE);
          return next;
        });
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }, []);

  useEffect(() => {
    if (logs.length === 0) return;
    if (!initDone.current) {
      initDone.current = true;
      scrollToBottom(false);
      return;
    }
    if (autoScroll.current) {
      scrollToBottom(true);
    }
  }, [logs]);

  const clearLogs = () => setLogs([]);

  const sources = ['all', ...new Set(logs.map(l => l.source))];
  const filtered = filter === 'all' ? logs : logs.filter(l => l.source === filter);

  return (
    <div className="bg-[#0a0c0f] rounded-lg border border-[#1e2530] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d1117] border-b border-[#1e2530]">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-neutral-500" />
          <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Activity Log</span>
          <span className="text-[10px] text-neutral-700 font-mono">{logs.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-[10px] bg-neutral-900 text-neutral-400 border border-neutral-800 rounded px-1.5 py-0.5 outline-none"
          >
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={clearLogs} className="p-1 rounded text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="overflow-y-auto font-mono text-[11px] leading-5 p-2"
        style={{ height, scrollbarGutter: 'stable' }}
        onScroll={onScroll}
      >
        {filtered.length === 0 && (
          <div className="text-neutral-700 text-center py-8">No log entries yet</div>
        )}
        {filtered.map((entry, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-neutral-700 flex-shrink-0 w-16 tabular-nums">{formatTime(entry.time)}</span>
            <span className={`flex-shrink-0 w-16 ${getLevelColor(entry.level)}`}>{entry.source}</span>
            <span className="text-neutral-300 break-all">{entry.message}</span>
          </div>
        ))}
        <div />
      </div>
    </div>
  );
}
