import { memo } from 'react';
import GlassCard from '../shared/GlassCard';
import GradientBar from '../shared/GradientBar';
import StatusBadge from '../shared/StatusBadge';
import GaugeMeter from '../../components/GaugeMeter';
import { Thermometer, Zap, Clock } from 'lucide-react';
import useMonitoringStore from '../stores/monitoringStore';
import { formatBytesCompact } from '../../utils/format.js';

const GAUGE_SIZE = typeof window !== 'undefined' && window.innerWidth < 640 ? 90 : 120;

function safeVal(value, fn, fallback = 'N/A') {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return fallback;
  return fn(value);
}

const InfoRow = memo(function InfoRow({ label, value, icon }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 py-0.5">
      <div className="flex items-center gap-1.5 flex-shrink-0 truncate min-w-0">
        {icon && <span className="text-neutral-600 flex-shrink-0">{icon}</span>}
        <span className="text-[11px] text-neutral-500 truncate">{label}</span>
      </div>
      <span className="text-[11px] text-neutral-300 font-mono tabular-nums flex-1 min-w-0 text-right">{value}</span>
    </div>
  );
});

function GpuWidget({ data, igpuTemp }) {
  const smoothEnabled = useMonitoringStore(s => s.smoothEnabled);
  const smoothMs = useMonitoringStore(s => s.smoothMs);
  if (!data || !data.available) {
    return (
      <GlassCard data-debug-id="2.2.9.4" data-debug-name="GpuCardA" data-debug-type="card" title="GPU">
        <div data-debug-id="2.2.9" data-debug-name="GpuWidget" data-debug-type="widget" className="px-4 pb-4">
          <div className="flex items-center justify-center py-6 text-neutral-600 text-xs">
            No GPU data available
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard data-debug-id="2.2.9.5" data-debug-name="GpuCardB" data-debug-type="card" title="GPU" subtitle={safeVal(data.vendor, v => v.toUpperCase())}>
      <div data-debug-id="2.2.9" data-debug-name="GpuWidget" data-debug-type="widget" className="px-4 pb-4">
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <div className="flex-shrink-0 self-center sm:self-start flex flex-col items-center gap-2">
            <GaugeMeter value={data.usedPercent} size={GAUGE_SIZE} strokeWidth={8} smoothEnabled={smoothEnabled} smoothMs={smoothMs} label="GPU" />
            {igpuTemp != null && (
              <GaugeMeter
                value={Math.min((igpuTemp / 95) * 100, 100)}
                size={GAUGE_SIZE} strokeWidth={8}
                smoothEnabled={smoothEnabled} smoothMs={smoothMs}
                displayText={`${Math.round(igpuTemp)}°`}
                label="Temp"
              />
            )}
          </div>
          <div className="flex-1 min-w-0 w-full sm:w-auto space-y-1.5 pt-1">
            {/* VRAM full width with bar */}
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 min-w-0 py-0.5">
                <span className="text-[11px] text-neutral-500 flex-shrink-0">VRAM</span>
                <span className="text-[11px] text-neutral-300 font-mono tabular-nums">
                  {data.vramTotal > 0
                    ? `${formatBytesCompact(data.vramUsed)}/${formatBytesCompact(data.vramTotal)}`
                    : 'N/A'}
                </span>
              </div>
              {data.vramTotal > 0 && (
                <GradientBar data-debug-id="2.2.9.2" data-debug-name="VramBar" data-debug-type="chart" percent={data.vramUsedPercent ?? 0} />
              )}
            </div>
            {/* Other stats */}
            <div data-debug-id="2.2.9.1" data-debug-name="GpuStats" data-debug-type="card" className="grid grid-cols-2 gap-x-3 gap-y-1">
              <InfoRow label="VRAM %" value={safeVal(data.vramUsedPercent, v => `${v}%`)} />
              <InfoRow label="Temp" value={safeVal(data.temperature, v => `${v.toFixed(0)}°C`)} icon={<Thermometer size={10} />} />
              <InfoRow label="Power" value={safeVal(data.powerDraw, v => `${v.toFixed(1)} W`)} icon={<Zap size={10} />} />
            </div>
            {(data.clockGraphics || data.clockMemory) && (
              <div className="mt-2 pt-2 border-t border-[#1e2530] space-y-0.5">
                <InfoRow label="Clock GFX" value={safeVal(data.clockGraphics, v => `${v} MHz`)} icon={<Clock size={10} />} />
                <InfoRow label="Clock MEM" value={safeVal(data.clockMemory, v => `${v} MHz`)} />
              </div>
            )}
            <div data-debug-id="2.2.9.3" data-debug-name="GpuInfo" data-debug-type="other" className="mt-2 flex items-center gap-2 text-[10px] text-neutral-600">
              <StatusBadge status={data.available ? 'active' : 'inactive'} pulse />
              <span className="truncate min-w-0">Driver: {data.driver || 'unknown'}</span>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

export default memo(GpuWidget);
