import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatBytesRate, formatSpeed } from '../../../utils/format.js';

const RANGE_HOURS = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return String(ts); }
}

function bucketize(points, hours) {
  const now = Date.now();
  const bucketMs = Math.max(60_000, (hours * 3600_000) / 200);
  const buckets = {};
  for (const p of points) {
    const age = now - p.timestamp;
    const keep = hours < 1 ? age <= hours * 3600_000 : true;
    if (!keep) continue;
    const key = Math.floor(p.timestamp / bucketMs) * bucketMs;
    if (!buckets[key]) buckets[key] = { timestamp: key, sum: 0, count: 0 };
    buckets[key].sum += p.value;
    buckets[key].count += 1;
  }
  return Object.values(buckets)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-200)
    .map(b => ({ time: fmtTime(b.timestamp), value: +(b.sum / b.count).toFixed(2) }));
}

export default function MetricChart({ title, metric, range = '1h', color = '#22d3ee', unit = '%', compact = false }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRange, setSelectedRange] = useState(range);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/history?range=${selectedRange}&metric=${encodeURIComponent(metric)}`);
      if (!res.ok) return;
      const json = await res.json();
      const hours = RANGE_HOURS[selectedRange] || 1;
      const points = (json.data || [])
        .map(d => ({ timestamp: d.timestamp, value: typeof d[metric] === 'number' ? d[metric] : 0 }))
        .filter(p => Number.isFinite(p.value));
      setData(bucketize(points, hours));
    } catch {}
    finally { setLoading(false); }
  }, [metric, selectedRange]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    load();
  }, [selectedRange, load]);

  const chartHeight = compact ? 'h-32' : 'h-44';

  return (
    <div className={`p-3 md:p-4 rounded-lg bg-neutral-900/50 border border-neutral-800 ${compact ? 'p-3' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-neutral-200 truncate">{title}</h3>
          {!compact && (
            <div className="flex items-center gap-1 mt-1">
              {Object.keys(RANGE_HOURS).map(r => (
                <button
                  key={r}
                  onClick={() => setSelectedRange(r)}
                  className={`px-1.5 py-0.5 text-[9px] rounded font-mono tabular-nums transition-colors ${
                    selectedRange === r
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-neutral-600 hover:text-neutral-400 border border-transparent'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={load} className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 flex-shrink-0" title="Refresh">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className={chartHeight}>
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[10px] text-neutral-600">
            {loading ? 'Loading...' : 'No data yet'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, left: compact ? -24 : -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#737373' }} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fontSize: 9, fill: '#737373' }} domain={[0, 'auto']} width={compact ? 28 : 32}
                tickFormatter={v => unit === 'B/s' ? formatBytesRate(v) : unit === 'b/s' ? formatSpeed(v) : `${v}${unit}`} />
              <Tooltip
                contentStyle={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10 }}
                labelStyle={{ color: '#a3a3a3' }}
                formatter={(val) => [unit === 'B/s' ? formatBytesRate(val) : unit === 'b/s' ? formatSpeed(val) : `${val}${unit}`, title]}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
