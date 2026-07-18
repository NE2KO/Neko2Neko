import { memo } from 'react';
import GaugeMeter from '../../components/GaugeMeter';
import GradientBar from '../shared/GradientBar';
import GlassCard from '../shared/GlassCard';
import useMonitoringStore from '../stores/monitoringStore';
import { formatBytes } from '../../utils/format.js';

const GAUGE_SIZE = typeof window !== 'undefined' && window.innerWidth < 640 ? 90 : 120;

const BarRow = memo(function BarRow({ label, value, total }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] text-neutral-500 flex-shrink-0 w-14 text-right truncate">{label}</span>
      <GradientBar data-debug-id="2.2.7.3.1" data-debug-name="MemGradientBar" data-debug-type="chart" percent={pct} className="flex-1 min-w-0" />
      <span className="text-[10px] text-neutral-500 font-mono tabular-nums flex-shrink-0 text-right w-16">{formatBytes(value)}</span>
    </div>
  );
});

const InfoRow = memo(function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 py-0.5">
      <span className="text-[11px] text-neutral-500 flex-shrink-0 truncate">{label}</span>
      <span className="text-[11px] text-neutral-300 font-mono tabular-nums flex-1 min-w-0 truncate text-right">{value}</span>
    </div>
  );
});

export default memo(function MemoryWidget({ data }) {
  const smoothEnabled = useMonitoringStore(s => s.smoothEnabled);
  const smoothMs = useMonitoringStore(s => s.smoothMs);

  if (!data) return null;

  return (
    <GlassCard data-debug-id="2.2.7.5" data-debug-name="MemoryCard" data-debug-type="card" title="Memory" subtitle={`${formatBytes(data.total)} total`}>
      <div data-debug-id="2.2.7" data-debug-name="MemoryWidget" data-debug-type="widget" className="px-4 pb-4">
        <div data-debug-id="2.2.7.3" data-debug-name="BarRow" data-debug-type="chart" className="flex flex-col items-center gap-3">
          <GaugeMeter value={data.usedPercent} size={GAUGE_SIZE} strokeWidth={8} smoothEnabled={smoothEnabled} smoothMs={smoothMs} />
          <div data-debug-id="2.2.7.1" data-debug-name="MemoryBar" data-debug-type="chart" className="w-full space-y-1">
            <BarRow label="Used" value={data.used} total={data.total} />
            <BarRow label="Cache" value={data.breakdown?.cached} total={data.total} />
            <BarRow label="Buffer" value={data.breakdown?.buffers} total={data.total} />
            <BarRow label="Free" value={data.free} total={data.total} />
          </div>
        </div>

        {data.swap && data.swap.total > 0 && (
          <div className="mt-3 pt-3 border-t border-[#1e2530]">
            <div className="flex items-center gap-1.5 mb-2 text-[10px] text-neutral-600">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 11l5 5 5-5M12 4v12"/></svg>
              Swap
            </div>
            <div className="mb-2">
              <BarRow label="Used" value={data.swap.used} total={data.swap.total} />
            </div>
            <div data-debug-id="2.2.7.4" data-debug-name="InfoRow" data-debug-type="other" className="grid grid-cols-3 gap-2">
              <InfoRow label="Used" value={formatBytes(data.swap.used)} />
              <InfoRow label="Total" value={formatBytes(data.swap.total)} />
              <InfoRow label="Percent" value={`${data.swap.usedPercent}%`} />
            </div>
          </div>
        )}

        {data.breakdown && (
          <div data-debug-id="2.2.7.2" data-debug-name="MemoryStats" data-debug-type="card" className="mt-3 pt-3 border-t border-[#1e2530] grid grid-cols-2 gap-x-4 gap-y-0.5">
            <InfoRow label="Active" value={formatBytes(data.breakdown.active)} />
            <InfoRow label="Inactive" value={formatBytes(data.breakdown.inactive)} />
            <InfoRow label="Mapped" value={formatBytes(data.breakdown.mapped)} />
            <InfoRow label="Dirty" value={formatBytes(data.breakdown.dirty)} />
          </div>
        )}
      </div>
    </GlassCard>
  );
});
