import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, BarChart3, RefreshCw, HardDrive } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from 'recharts';
import GaugeMeter from '../../components/GaugeMeter';
import GlassCard from '../shared/GlassCard';
import { formatBytes, formatSpeed, formatSpeedCompact, formatBytesRate, formatBytesRateCompact } from '../../utils/format.js';

const MetricGauge = memo(function MetricGauge({ m, s }) {
  let val;
  if (m.unit === 'speed') {
    val = s.avg > 0 ? Math.min((s.avg / 10000000) * 100, 100) : 0;
  } else if (m.unit === 'bytes') {
    const maxRef = 10 * 1024 * 1024;
    val = s.avg > 0 ? Math.min((s.avg / maxRef) * 100, 100) : 0;
  } else {
    val = Math.min(s.avg || 0, 100);
  }
  let dt;
  if (m.unit === 'bytes') {
    const raw = formatBytesRateCompact(s.avg || 0);
    const parts = raw.match(/^([\d.]+?)([A-Za-z].*)$/);
    dt = parts ? { value: parts[1], unit: parts[2] } : { value: raw, unit: '' };
  } else if (m.unit === 'speed') {
    const raw = formatSpeedCompact(s.avg || 0);
    const parts = raw.match(/^([\d.]+?)([A-Za-z].*)$/);
    dt = parts ? { value: parts[1], unit: parts[2] } : { value: '0', unit: 'b/s' };
  } else if (m.key === 'load.1m') {
    dt = (s.avg ?? 0).toFixed(1);
  }
  return (
      <GlassCard data-debug-id="2.3.5" data-debug-name="MetricsGauges" data-debug-type="card">
        <div className="p-3 flex flex-col items-center">
          <GaugeMeter
            value={val}
            label={m.label}
            unit={m.unit === '%' || m.unit === '°C' ? m.unit : ''}
            displayText={dt}
            size={90}
            strokeWidth={6}
            smoothEnabled={true}
            smoothMs={800}
          />
        </div>
      </GlassCard>
  );
});

const RANGES = [
  { key: '1h', label: '1H' },
  { key: '6h', label: '6H' },
  { key: '12h', label: '12H' },
  { key: '24h', label: '24H' },
  { key: '3d', label: '3D' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
];

const METRIC_DEFS = [
  { key: 'cpu.used', label: 'CPU', color: '#22d3ee', unit: '%' },
  { key: 'ram.percent', label: 'RAM', color: '#a78bfa', unit: '%' },
  { key: 'gpu.used', label: 'GPU', color: '#f472b6', unit: '%' },
  { key: 'disk.percent', label: 'Disk', color: '#facc15', unit: '%' },
  { key: 'diskIo.readBytes', label: 'Disk Read', color: '#22c55e', unit: 'bytes' },
  { key: 'diskIo.writeBytes', label: 'Disk Write', color: '#3b82f6', unit: 'bytes' },
  { key: 'net.rx', label: 'Net Rx', color: '#22c55e', unit: 'speed' },
  { key: 'net.tx', label: 'Net Tx', color: '#3b82f6', unit: 'speed' },
  { key: 'load.1m', label: 'Load', color: '#fb923c', unit: '' },
  { key: 'cpu.temp', label: 'Temp', color: '#ef4444', unit: '°C' },
];

const TABLE_COLS = [
  { key: 'ts', label: 'Time', sortable: true, align: 'left' },
  { key: 'cpu.used', label: 'CPU %', sortable: true, unit: '%' },
  { key: 'ram.percent', label: 'RAM %', sortable: true, unit: '%' },
  { key: 'gpu.used', label: 'GPU %', sortable: true, unit: '%' },
  { key: 'disk.percent', label: 'Disk %', sortable: true, unit: '%' },
  { key: 'diskIo.readBytes', label: 'Disk R', sortable: true, unit: 'bytes' },
  { key: 'diskIo.writeBytes', label: 'Disk W', sortable: true, unit: 'bytes' },
  { key: 'net.rx', label: 'Net Rx', sortable: true, unit: 'speed' },
  { key: 'net.tx', label: 'Net Tx', sortable: true, unit: 'speed' },
  { key: 'load.1m', label: 'Load', sortable: true, unit: '' },
  { key: 'cpu.temp', label: 'Temp', sortable: true, unit: '°C' },
  { key: 'sparkline', label: '', sortable: false, align: 'center' },
];

function getVal(row, key) {
  if (key === 'ts') return row.ts;
  const parts = key.split('.');
  let v = row;
  for (const p of parts) v = v?.[p];
  return v ?? null;
}

function sortByKey(data, key, asc) {
  return [...data].sort((a, b) => {
    let va = getVal(a, key);
    let vb = getVal(b, key);
    if (va == null) va = asc ? Infinity : -Infinity;
    if (vb == null) vb = asc ? Infinity : -Infinity;
    return asc ? va - vb : vb - va;
  });
}

function formatValue(val, unit) {
  if (val == null) return '--';
  if (unit === '%') return `${val.toFixed(1)}%`;
  if (unit === '°C') return `${val.toFixed(0)}°C`;
  if (unit === 'speed') return formatSpeedCompact(val);
  if (unit === 'bytes') return formatBytesRate(val);
  return typeof val === 'number' ? val.toFixed(2) : String(val);
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTimeShort(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(ts) {
  return new Date(ts).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTimeForAxis(ts, range) {
  const d = new Date(ts);
  if (range === '1h' || range === '6h' || range === '12h' || range === '24h') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

function formatDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function generateSmartTicks(data, range) {
  if (!data || data.length < 2) return [];
  const tsArr = data.map(d => d.ts).sort((a, b) => a - b);
  const first = tsArr[0];
  const last = tsArr[tsArr.length - 1];
  const durationMs = last - first;
  if (durationMs <= 0) return [first];

  const targetLabels = 6;

  if (range === '1h' || range === '6h' || range === '12h' || range === '24h') {
    const step = durationMs / targetLabels;
    const ticks = [];
    for (let i = 0; i <= targetLabels; i++) {
      const target = first + step * i;
      let closest = tsArr[0];
      let minDist = Infinity;
      for (const ts of tsArr) {
        const dist = Math.abs(ts - target);
        if (dist < minDist) { minDist = dist; closest = ts; }
      }
      if (ticks.length === 0 || closest !== ticks[ticks.length - 1]) ticks.push(closest);
    }
    return ticks;
  }

  if (range === '3d' || range === '7d' || range === '30d') {
    const midnights = generateMidnights(first, last);
    if (midnights.length === 0) return [first, last];

    const step = midnights.length > targetLabels * 2
      ? Math.ceil(midnights.length / targetLabels)
      : 1;

    const ticks = [];
    const seenDays = new Set();

    for (let i = 0; i < midnights.length; i += step) {
      const midnight = midnights[i];
      let closest = tsArr[0];
      let minDist = Infinity;
      for (const ts of tsArr) {
        const dist = Math.abs(ts - midnight);
        if (dist < minDist) { minDist = dist; closest = ts; }
      }
      const dayKey = formatDayKey(closest);
      if (!seenDays.has(dayKey)) {
        seenDays.add(dayKey);
        ticks.push(closest);
      }
    }

    const lastDayKey = formatDayKey(tsArr[tsArr.length - 1]);
    if (!seenDays.has(lastDayKey)) {
      ticks.push(tsArr[tsArr.length - 1]);
    }
    return ticks;
  }

  return [first, last];
}

function generateMidnights(firstTs, lastTs) {
  const firstDate = new Date(firstTs);
  const startMidnight = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + 1, 0, 0, 0, 0).getTime();
  const midnights = [];
  for (let t = startMidnight; t < lastTs; t += 86400000) {
    midnights.push(t);
  }
  return midnights;
}

function generateDayBoundaries(data, range) {
  if (!data || data.length < 2) return [];
  if (range !== '3d' && range !== '7d' && range !== '30d') return [];
  const tsArr = data.map(d => d.ts).sort((a, b) => a - b);
  const first = tsArr[0];
  const last = tsArr[tsArr.length - 1];
  return generateMidnights(first, last);
}

const SmartAxisTick = memo(function SmartAxisTick({ x, y, payload, smartTickSet, range }) {
  if (!payload?.value) return null;
  const ts = payload.value;
  if (!smartTickSet.has(ts)) return null;
  const label = formatTimeForAxis(ts, range);
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill="#525252" fontWeight="600">
      {label}
    </text>
  );
});

function calcStats(data, key) {
  const vals = data.map(d => getVal(d, key)).filter(v => v != null);
  if (vals.length === 0) return { avg: 0, min: 0, max: 0, latest: 0 };
  return {
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    latest: vals[vals.length - 1],
  };
}

function calcDailyAvg(data, key) {
  if (!data || data.length === 0) return [];
  const buckets = {};
  for (const row of data) {
    const d = new Date(row.ts);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!buckets[dayKey]) buckets[dayKey] = [];
    const v = getVal(row, key);
    if (v != null) buckets[dayKey].push(v);
  }
  return Object.entries(buckets).map(([day, vals]) => ({
    day,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    max: Math.max(...vals),
    min: Math.min(...vals),
  }));
}

function getPercentileData(data, key, max = 100) {
  const vals = data.map(d => getVal(d, key)).filter(v => v != null);
  if (vals.length === 0) return [];
  const buckets = [
    { name: '0-25%', range: [0, max * 0.25], count: 0, color: '#22c55e' },
    { name: '25-50%', range: [max * 0.25, max * 0.5], count: 0, color: '#84cc16' },
    { name: '50-75%', range: [max * 0.5, max * 0.75], count: 0, color: '#facc15' },
    { name: '75-100%', range: [max * 0.75, max], count: 0, color: '#ef4444' },
  ];
  for (const v of vals) {
    for (const b of buckets) {
      if (v >= b.range[0] && v < b.range[1]) { b.count++; break; }
      if (b === buckets[3] && v >= b.range[0]) { b.count++; break; }
    }
  }
  return buckets.filter(b => b.count > 0);
}

function getStatusColor(val, thresholds = { warn: 65, crit: 85 }) {
  if (val == null) return 'text-neutral-500';
  if (val >= thresholds.crit) return 'text-red-400 font-semibold';
  if (val >= thresholds.warn) return 'text-amber-400';
  return 'text-emerald-400';
}

function getTempColor(val) {
  if (val == null) return 'text-neutral-500';
  if (val >= 80) return 'text-red-400 font-semibold';
  if (val >= 65) return 'text-amber-400';
  return 'text-emerald-400';
}

function getLoadColor(val) {
  if (val == null) return 'text-neutral-500';
  if (val >= 8) return 'text-red-400 font-semibold';
  if (val >= 4) return 'text-amber-400';
  return 'text-emerald-400';
}

function getSpeedColor(val) {
  if (val == null || val === 0) return 'text-neutral-500';
  return 'text-cyan-400';
}

function CustomTooltip({ active, payload, label, metrics }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d1117] border border-[#2a3040] rounded-lg px-3 py-2 shadow-xl text-[11px]">
      <div className="text-neutral-400 mb-1 font-mono">{formatTimeFull(label)}</div>
      {payload.map((p, i) => {
        const metric = metrics?.find(m => m.normKey === p.dataKey);
        const rawValue = metric ? payload[0]?.payload?.[metric.label] : p.value;
        let displayVal;
        if (metric?.unit === 'bytes' || p.dataKey?.startsWith('_Disk')) {
          displayVal = formatBytesRate(rawValue);
        } else if (metric?.unit === 'speed' || p.dataKey?.startsWith('_Net')) {
          displayVal = formatSpeed(rawValue);
        } else if (metric?.unit === '°C' || p.name === 'Temp') {
          displayVal = `${rawValue?.toFixed(1) ?? '--'}°C`;
        } else if (typeof rawValue === 'number') {
          displayVal = rawValue.toFixed(1);
        } else {
          displayVal = rawValue ?? '--';
        }
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-neutral-400">{metric?.label || p.name}:</span>
            <span className="text-neutral-200 font-mono font-semibold">{displayVal}</span>
          </div>
        );
      })}
    </div>
  );
}

const MiniSparkline = memo(function MiniSparkline({ data, dataKey, color = '#22d3ee', height = 24, width = 80 }) {
  if (!data || data.length < 2) return <span className="text-neutral-600">-</span>;
  const values = data.map(d => getVal(d, dataKey)).filter(v => v != null);
  if (values.length < 2) return <span className="text-neutral-600">-</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const trend = lastVal > firstVal ? '#ef4444' : lastVal < firstVal ? '#22c55e' : color;
  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={points} fill="none" stroke={trend} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <circle cx={width} cy={height - ((lastVal - min) / range) * (height - 4) - 2} r="2" fill={trend} />
    </svg>
  );
});

const MAX_CHART_POINTS = { '1h': 60, '6h': 100, '12h': 150, '24h': 200, '3d': 250, '7d': 300, '30d': 100 };
const MAX_TABLE_ROWS = 150;

function smoothData(arr, windowSize = 3) {
  if (!arr || arr.length <= windowSize) return arr;
  const result = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(arr.length, i + half + 1);
    const slice = arr.slice(start, end);
    const smoothed = { ...arr[i] };
    for (const key of Object.keys(arr[i])) {
      if (key === 'ts') continue;
      const vals = slice.map(s => s[key]).filter(v => typeof v === 'number');
      if (vals.length > 0) {
        smoothed[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    }
    result.push(smoothed);
  }
  return result;
}

function getMaxPoints(range) {
  return MAX_CHART_POINTS[range] || 800;
}

function downsampleData(arr, max) {
  if (!arr || arr.length <= max) return arr;
  const stride = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % stride === 0 || i === arr.length - 1);
}

const NORMALIZATION_REFS = {
  bytes: 1 * 1024 * 1024,
  speed: 10000000,
  load: 8,
};

// ─── Isolated sub-components (memoized — skip re-render when parent updates) ──

const MetricGaugeRow = memo(function MetricGaugeRow({ stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {METRIC_DEFS.map(m => <MetricGauge key={m.key} m={m} s={stats[m.key]} />)}
    </div>
  );
});

const MetricCharts = memo(function MetricCharts({
  data, lineData, dailyAvgs, pieData, pieTotal, stats,
  selectedMetric, showPie, selectedDef, pieDef,
  onMetricChange, onPieChange, diskIoDaily, range
}) {
  const allMetricsData = useMemo(() => smoothData(lineData, 5), [lineData]);

  const smartTicks1 = useMemo(() => generateSmartTicks(lineData, range), [lineData, range]);
  const smartTickSet1 = useMemo(() => new Set(smartTicks1), [smartTicks1]);
  const smartTicks2 = useMemo(() => generateSmartTicks(allMetricsData, range), [allMetricsData, range]);
  const smartTickSet2 = useMemo(() => new Set(smartTicks2), [smartTicks2]);

  const dayBoundaries = useMemo(() => generateDayBoundaries(lineData, range), [lineData, range]);

  const chartMetrics = useMemo(() => METRIC_DEFS.map(m => ({
    label: m.label,
    color: m.color,
    unit: m.unit,
    normKey: `_${m.label} %`,
    rawKey: m.key,
    hasData: lineData.some(d => d[m.label] != null),
  })), [lineData]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Line Chart */}
      <GlassCard title="Trend" subtitle={`${selectedDef?.label} over time`} data-debug-id="2.3.6" data-debug-name="MetricsTrend" data-debug-type="card">
        <div className="px-4 pb-4">
          <div className="flex gap-1 mb-3 flex-wrap">
            {METRIC_DEFS.filter(m => m.unit === '%' || m.unit === '°C' || m.unit === '' || m.unit === 'bytes' || m.unit === 'speed').map(m => (
              <button key={m.key} onClick={() => onMetricChange(m.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                  selectedMetric === m.key ? 'text-white' : 'text-neutral-500 hover:text-neutral-300 bg-neutral-800/50'
                }`}
                style={selectedMetric === m.key ? { backgroundColor: m.color + '30', color: m.color, border: `1px solid ${m.color}40` } : {}}>
                {m.label}
              </button>
            ))}
          </div>
<div className="h-64">
             <ResponsiveContainer width="100%" height="100%">
<AreaChart data={lineData} margin={{ top: 5, right: 5, bottom: 5, left: -15 }} animationDuration={200}>
                  <defs>
                    <linearGradient id={`grad-${selectedMetric}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={selectedDef?.color || '#22d3ee'} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={selectedDef?.color || '#22d3ee'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                 <CartesianGrid strokeDasharray="3 3" stroke="#1e2530" />
                 <XAxis dataKey="ts" ticks={smartTicks1} tick={<SmartAxisTick smartTickSet={smartTickSet1} range={range} />} tickLine={false} stroke="#1e2530" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#525252' }} stroke="#1e2530" tickLine={false}
                  domain={['dataMin - 5', 'dataMax + 5']}
                  tickFormatter={v => typeof v === 'number' ? (selectedDef?.unit === 'bytes' ? formatBytes(v) : selectedDef?.unit === 'speed' ? formatSpeed(v) : (v % 1 === 0 ? v : v.toFixed(1))) : v} />
                <Tooltip content={<CustomTooltip />} />
                {dailyAvgs.length > 1 && dailyAvgs.map(d => (
                  <ReferenceLine key={d.day} y={d.avg} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} />
                ))}
                {dayBoundaries.map(midnight => (
                  <ReferenceLine key={`day-${midnight}`} x={midnight} stroke="#334155" strokeDasharray="6 3" strokeOpacity={0.5} />
                ))}
                <Area type="monotone" dataKey={selectedDef?.label || 'CPU'} stroke={selectedDef?.color || '#22d3ee'} strokeWidth={1.5}
                  fill={`url(#grad-${selectedMetric})`} dot={false} activeDot={{ r: 3, stroke: selectedDef?.color, strokeWidth: 2, fill: '#0d1117' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className={`mt-2 pt-2 border-t border-[#1e2530] transition-all duration-300 overflow-hidden ${dailyAvgs.length > 1 ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0 pt-0 border-t-0'}`}>
              <div className="text-[10px] text-neutral-600 mb-1 flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed border-amber-500" /> Daily Average (dashed line)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1">
                {dailyAvgs.map(d => (
                  <div key={d.day} className="flex items-center justify-between text-[10px] py-0.5">
                    <span className="text-neutral-500">{d.day}</span>
                    <span className="text-amber-400 font-mono tabular-nums">{selectedDef?.unit === 'bytes' ? formatBytesRate(d.avg) : selectedDef?.unit === 'speed' ? formatSpeed(d.avg) : `${d.avg.toFixed(1)}${selectedDef?.unit}`}</span>
                  </div>
                ))}
              </div>
            </div>
        </div>
      </GlassCard>

      {/* Multi-line comparison — all metrics */}
      <GlassCard title="All Metrics" subtitle={`${chartMetrics.filter(m => m.hasData).length} series`} data-debug-id="2.3.7" data-debug-name="MetricsAllOverlay" data-debug-type="card">
        <div className="px-4 pb-4">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
<LineChart data={allMetricsData} margin={{ top: 5, right: 5, bottom: 5, left: -15 }} animationDuration={200}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#1e2530" />
                 {dayBoundaries.map(midnight => (
                   <ReferenceLine key={`day-all-${midnight}`} x={midnight} stroke="#334155" strokeDasharray="6 3" strokeOpacity={0.5} />
                 ))}
                 <XAxis dataKey="ts" ticks={smartTicks2} tick={<SmartAxisTick smartTickSet={smartTickSet2} range={range} />} tickLine={false} stroke="#1e2530" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#525252' }} stroke="#1e2530" tickLine={false} domain={[0, 100]}
                  tickFormatter={v => `${v}%`} />
                <Tooltip content={<CustomTooltip metrics={chartMetrics} />} />
                {chartMetrics.filter(m => m.hasData).map(m => (
                  <Line key={m.label} type="monotone" dataKey={m.normKey} stroke={m.color} strokeWidth={1.5} dot={false} opacity={0.8} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-[#1e2530]">
            {chartMetrics.filter(m => m.hasData).map(m => (
                <div key={m.label} className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                  <span className="text-neutral-500">{m.label}</span>
                </div>
            ))}
          </div>
        </div>
      </GlassCard>
    </div>
  );
});

const MetricTable = memo(function MetricTable({ data, sorted, sortKey, sortAsc, onSort }) {
  return (
    <GlassCard title="Data Table" subtitle={`${sorted.length} rows`} data-debug-id="2.3.9" data-debug-name="MetricsDataTableCard" data-debug-type="card">
      <div className="max-h-[60vh] overflow-y-auto">
        <table data-debug-id="2.3.4" data-debug-name="DataTable" data-debug-type="table" className="w-full text-[11px]">
          <thead>
            <tr data-debug-id="2.3.4.1" data-debug-name="SortHeader" data-debug-type="other" className="border-b border-[#1e2530]">
              {TABLE_COLS.map(col => (
                <th key={col.key} onClick={() => col.sortable && onSort(col.key)}
                  className={`px-2 py-2 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap ${
                    col.sortable ? 'cursor-pointer hover:text-neutral-200 select-none' : ''
                  } ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'} ${
                    sortKey === col.key ? 'text-cyan-400' : 'text-neutral-600'
                  }`}>
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && (
                      sortKey === col.key
                        ? (sortAsc ? <ArrowUp size={10} className="text-cyan-400" /> : <ArrowDown size={10} className="text-cyan-400" />)
                        : <ArrowUpDown size={10} className="text-neutral-600" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.ts} data-debug-id="2.3.4.2" data-debug-name="TableRow" data-debug-type="card" className={`border-b border-[#1e2530]/50 hover:bg-neutral-800/30 transition-colors ${i % 2 === 0 ? 'bg-neutral-900/20' : ''}`}>
                <td className="px-2 py-1.5 text-left text-neutral-400 font-mono tabular-nums whitespace-nowrap">{formatTime(row.ts)}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getStatusColor(getVal(row, 'cpu.used'))}`}>{formatValue(getVal(row, 'cpu.used'), '%')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getStatusColor(getVal(row, 'ram.percent'))}`}>{formatValue(getVal(row, 'ram.percent'), '%')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getStatusColor(getVal(row, 'gpu.used'))}`}>{formatValue(getVal(row, 'gpu.used'), '%')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getStatusColor(getVal(row, 'disk.percent'))}`}>{formatValue(getVal(row, 'disk.percent'), '%')}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-green-400">{formatValue(getVal(row, 'diskIo.readBytes'), 'bytes')}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-blue-400">{formatValue(getVal(row, 'diskIo.writeBytes'), 'bytes')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getSpeedColor(getVal(row, 'net.rx'))}`}>{formatValue(getVal(row, 'net.rx'), 'speed')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getSpeedColor(getVal(row, 'net.tx'))}`}>{formatValue(getVal(row, 'net.tx'), 'speed')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getLoadColor(getVal(row, 'load.1m'))}`}>{formatValue(getVal(row, 'load.1m'), '')}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${getTempColor(getVal(row, 'cpu.temp'))}`}>{formatValue(getVal(row, 'cpu.temp'), '°C')}</td>
                <td className="px-2 py-1.5 text-center">
                  <MiniSparkline data={sorted.slice(Math.max(0, i - 20), i + 1)} dataKey="cpu.used" color="#22d3ee" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
});

export default function MetricsTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('24h');
  const [sortKey, setSortKey] = useState('ts');
  const [sortAsc, setSortAsc] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState('cpu.used');
  const [showPie, setShowPie] = useState('cpu.used');
  const [diskIoDaily, setDiskIoDaily] = useState([]);
  const [effectiveRange, setEffectiveRange] = useState('24h');
  const hasDataRef = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitoring/history?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data || []);
      hasDataRef.current = (json.data || []).length > 0;
      setEffectiveRange(range);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  const switchRange = useCallback((newRange) => {
    setRange(newRange);
  }, []);

  useEffect(() => {
    if (!hasDataRef.current) setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchData, range === '1h' ? 10000 : 30000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData, range]);

  useEffect(() => {
    fetch('/api/monitoring/disk-io/daily?days=7')
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setDiskIoDaily(d.data || []))
      .catch(() => {});
  }, []);

  const handleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) { setSortAsc(a => !a); return prev; }
      setSortAsc(key === 'ts' ? false : true);
      return key;
    });
  }, []);

  const chartData = useMemo(() => {
    const sorted = [...data].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const downsampled = downsampleData(sorted, getMaxPoints(effectiveRange));
    return smoothData(downsampled, effectiveRange === '1h' ? 3 : effectiveRange === '6h' ? 5 : 7);
  }, [data, effectiveRange]);
  const tableData = useMemo(() => data.length > MAX_TABLE_ROWS ? data.slice(data.length - MAX_TABLE_ROWS) : data, [data]);

  const sorted = useMemo(() => sortByKey(tableData, sortKey, sortAsc), [tableData, sortKey, sortAsc]);

  const lineDataRef = useRef([]);
  const lineData = useMemo(() => {
    const result = chartData.map(d => ({
      ts: d.ts,
      ...METRIC_DEFS.reduce((acc, m) => {
        acc[m.label] = getVal(d, m.key);
        return acc;
      }, {}),
      '_CPU %': getVal(d, 'cpu.used'),
      '_RAM %': getVal(d, 'ram.percent'),
      '_GPU %': getVal(d, 'gpu.used'),
      '_Disk %': getVal(d, 'disk.percent'),
      '_Disk Read %': (() => { const v = getVal(d, 'diskIo.readBytes'); return v != null ? Math.min((v / NORMALIZATION_REFS.bytes) * 100, 100) : null; })(),
      '_Disk Write %': (() => { const v = getVal(d, 'diskIo.writeBytes'); return v != null ? Math.min((v / NORMALIZATION_REFS.bytes) * 100, 100) : null; })(),
      '_Net Rx %': (() => { const v = getVal(d, 'net.rx'); return v != null ? Math.min((v / NORMALIZATION_REFS.speed) * 100, 100) : null; })(),
      '_Net Tx %': (() => { const v = getVal(d, 'net.tx'); return v != null ? Math.min((v / NORMALIZATION_REFS.speed) * 100, 100) : null; })(),
      '_Load %': (() => { const v = getVal(d, 'load.1m'); return v != null ? Math.min((v / NORMALIZATION_REFS.load) * 100, 100) : null; })(),
      '_Temp %': getVal(d, 'cpu.temp'),
    }));
    if (lineDataRef.current.length === result.length &&
        lineDataRef.current[0]?.ts === result[0]?.ts &&
        lineDataRef.current[lineDataRef.current.length - 1]?.ts === result[result.length - 1]?.ts) {
      return lineDataRef.current;
    }
    lineDataRef.current = result;
    return result;
  }, [chartData]);

  const dailyAvgs = useMemo(() => {
    const all = calcDailyAvg(data, selectedMetric);
    return all.length > 7 ? all.slice(all.length - 7) : all;
  }, [data, selectedMetric]);
  const selectedDef = useMemo(() => METRIC_DEFS.find(m => m.key === selectedMetric), [selectedMetric]);
  const pieData = useMemo(() => getPercentileData(chartData, showPie), [chartData, showPie]);
  const pieDef = useMemo(() => METRIC_DEFS.find(m => m.key === showPie), [showPie]);
  const pieTotal = useMemo(() => pieData.reduce((a, b) => a + b.count, 0), [pieData]);

  const stableStatsRef = useRef(null);
  const [stableStats, setStableStats] = useState(() => {
    const s = {};
    for (const m of METRIC_DEFS) s[m.key] = calcStats(chartData, m.key);
    stableStatsRef.current = s;
    return s;
  });

  useEffect(() => {
    const newStats = {};
    for (const m of METRIC_DEFS) newStats[m.key] = calcStats(chartData, m.key);
    const prev = stableStatsRef.current;
    if (!prev) { stableStatsRef.current = newStats; setStableStats(newStats); return; }
    let changed = false;
    for (const key of METRIC_DEFS.map(m => m.key)) {
      const p = prev[key];
      const c = newStats[key];
      if (!p || Math.abs((p.avg || 0) - (c.avg || 0)) > 3 || Math.abs((p.max || 0) - (c.max || 0)) > 3) {
        changed = true;
        break;
      }
    }
    if (changed) { stableStatsRef.current = newStats; setStableStats(newStats); }
  }, [chartData]);

  return (
    <div className="p-3 md:p-4 space-y-4" data-debug-id="2.3" data-debug-name="MetricsTable" data-debug-type="table">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
            <BarChart3 size={18} /> Historical Metrics
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {data.length} data points &middot; {RANGES.find(r => r.key === range)?.label} view
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
              autoRefresh ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-neutral-800 text-neutral-500 border border-neutral-700'
            }`}
          >
            <RefreshCw size={10} className={autoRefresh ? 'animate-spin' : ''} />
            Auto
          </button>
        </div>
      </div>

      {/* Time Range Selector */}
      <div data-debug-id="2.3.1" data-debug-name="RangeSelector" data-debug-type="other" className="flex items-center gap-1 flex-wrap">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => switchRange(r.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              range === r.key
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                : 'bg-neutral-900/50 text-neutral-500 border border-neutral-800 hover:bg-neutral-800 hover:text-neutral-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded bg-red-900/30 border border-red-700/50 text-red-300 text-xs">Error: {error}</div>}
      
      {!loading && data.length === 0 && (
        <div className="text-neutral-500 text-xs py-8 text-center">No data for this range</div>
      )}

      {data.length > 0 && !loading && (
        <>
          {/* === GAUGES ROW === */}
          <MetricGaugeRow stats={stableStats} />

          {/* === LINE CHART + PIE CHART ROW === */}
          <MetricCharts
            data={chartData}
            lineData={lineData}
            dailyAvgs={dailyAvgs}
            pieData={pieData}
            pieTotal={pieTotal}
            stats={stableStats}
            selectedMetric={selectedMetric}
            showPie={showPie}
            selectedDef={selectedDef}
            pieDef={pieDef}
            range={effectiveRange}
            onMetricChange={setSelectedMetric}
            onPieChange={setShowPie}
            diskIoDaily={diskIoDaily}
          />

          {/* === SORTABLE TABLE === */}
          <MetricTable data={tableData} sorted={sorted} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
        </>
      )}

      {loading && data.length === 0 && (
        <div className="space-y-4">
    <div data-debug-id="2.3.2" data-debug-name="MetricGaugeRow" data-debug-type="grid" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {METRIC_DEFS.map(m => (
              <div key={m.key} className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3 flex flex-col items-center animate-pulse">
                <div className="w-[90px] h-[90px] rounded-full bg-neutral-800/60" />
                <div className="h-3 w-16 bg-neutral-800/60 rounded mt-2" />
              </div>
            ))}
          </div>
    <div data-debug-id="2.3.3" data-debug-name="MetricChart" data-debug-type="chart" className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 h-64 animate-pulse" />
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 h-64 animate-pulse" />
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 h-44 animate-pulse" />
          </div>
        </div>
      )}

      {/* Daily Disk I/O Summary */}
      {diskIoDaily.length > 0 && !loading && (
        <GlassCard data-debug-id="2.3.10" data-debug-name="MetricsFooter" data-debug-type="card">
          <div className="p-4">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <HardDrive size={12} /> Disk I/O — Last 7 Days
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
              {diskIoDaily.map(d => (
                <div key={d.day} className="bg-neutral-900/50 rounded-lg p-2.5 border border-neutral-800/50">
                  <div className="text-[10px] text-neutral-500 font-mono mb-1.5">{d.day}</div>
                  <div className="flex items-center gap-1 text-[10px] text-green-400">
                    <ArrowDown size={8} /> {formatBytes(d.totalReadBytes)}
                  </div>
                  <div className="text-[9px] text-neutral-600">avg {formatBytesRate(d.avgReadBytesPerSec)}</div>
                  <div className="flex items-center gap-1 text-[10px] text-blue-400 mt-1">
                    <ArrowUp size={8} /> {formatBytes(d.totalWriteBytes)}
                  </div>
                  <div className="text-[9px] text-neutral-600">avg {formatBytesRate(d.avgWriteBytesPerSec)}</div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
