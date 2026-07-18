import { useState, useEffect, useCallback } from 'react';
import GlassCard from '../shared/GlassCard';
import { Layers, Pause, Play, Trash2, RefreshCw, RotateCcw, Clock, CheckCircle, XCircle } from 'lucide-react';

export default function QueuePage() {
  const [queues, setQueues] = useState([]);
  const [acting, setActing] = useState(null);

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/queues');
      if (res.ok) {
        const data = await res.json();
        setQueues(data.queues || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchQueues();
    const id = setInterval(fetchQueues, 3000);
    return () => clearInterval(id);
  }, [fetchQueues]);

  const doAction = async (type, action) => {
    setActing(`${type}:${action}`);
    try {
      await fetch(`/api/monitoring/queues/${type}/${action}`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 300));
      await fetchQueues();
    } catch {}
    setActing(null);
  };

  const queueIcons = {
    thumbnail: <Layers size={16} className="text-cyan-400" />,
    scan: <RefreshCw size={16} className="text-green-400" />,
  };

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={12} /> Queue Manager
          </h2>
          <button onClick={fetchQueues}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-neutral-500 hover:text-neutral-300 rounded border border-neutral-800 hover:border-neutral-700 transition-colors">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        <div className="grid gap-4">
          {queues.map(q => (
            <GlassCard data-debug-id="2.17.6" data-debug-name="QueuePageCard" data-debug-type="card" key={q.type}>
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {queueIcons[q.type] || <Layers size={16} className="text-neutral-500" />}
                    <span className="text-sm font-medium text-neutral-300 capitalize">{q.type} Queue</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {q.paused !== undefined && (
                      q.paused ? (
                        <button onClick={() => doAction(q.type, 'resume')} disabled={acting === `${q.type}:resume`}
                          className="p-1.5 rounded text-green-500/60 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 transition-colors"
                          title="Resume">
                          <Play size={14} />
                        </button>
                      ) : (
                        <button onClick={() => doAction(q.type, 'pause')} disabled={acting === `${q.type}:pause`}
                          className="p-1.5 rounded text-yellow-500/60 hover:text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-40 transition-colors"
                          title="Pause">
                          <Pause size={14} />
                        </button>
                      )
                    )}
                    <button onClick={() => doAction(q.type, 'clear')} disabled={acting === `${q.type}:clear`}
                      className="p-1.5 rounded text-red-500/60 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                      title="Clear Queue">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                    <div className="text-[10px] text-neutral-600 mb-0.5">Pending</div>
                    <div className="text-lg font-mono tabular-nums text-neutral-200">{q.pending || 0}</div>
                  </div>
                  <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                    <div className="text-[10px] text-neutral-600 mb-0.5">Status</div>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {q.processing || q.running ? (
                        <><RotateCcw size={14} className="text-green-400 animate-spin" /><span className="text-xs text-green-400">Running</span></>
                      ) : q.paused ? (
                        <><Pause size={14} className="text-yellow-400" /><span className="text-xs text-yellow-400">Paused</span></>
                      ) : (
                        <><CheckCircle size={14} className="text-neutral-600" /><span className="text-xs text-neutral-500">Idle</span></>
                      )}
                    </div>
                  </div>
                  <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                    <div className="text-[10px] text-neutral-600 mb-0.5">Completed</div>
                    <div className="text-lg font-mono tabular-nums text-neutral-200">{q.totalProcessed || 0}</div>
                  </div>
                  <div className="bg-neutral-900/40 rounded-lg p-3 text-center border border-[#1e2530]">
                    <div className="text-[10px] text-neutral-600 mb-0.5">Skipped</div>
                    <div className="text-lg font-mono tabular-nums text-yellow-400">{q.totalSkipped || 0}</div>
                  </div>
                </div>

                {q.phase && (
                  <div className="mt-3 text-[10px] text-neutral-600 font-mono">
                    Phase: {q.phase}
                    {q.total > 0 && ` (${q.current}/${q.total})`}
                  </div>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
