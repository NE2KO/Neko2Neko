import { memo } from 'react';
import GaugeMeter from '../../components/GaugeMeter';
import GlassCard from '../shared/GlassCard';
import DiskIoGauge from '../shared/DiskIoGauge';
import { Thermometer, HardDrive, Activity } from 'lucide-react';
import useMonitoringStore from '../stores/monitoringStore';
import { formatBytes, formatBytesRate } from '../../utils/format.js';

const GAUGE_SIZE = typeof window !== 'undefined' && window.innerWidth < 640 ? 90 : 120;

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 py-0.5">
      <span className="text-[11px] text-neutral-500 flex-shrink-0 truncate">{label}</span>
      <span className="text-[11px] text-neutral-300 font-mono tabular-nums flex-1 min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function StatusBadge({ status, label, pulse }) {
  const color = status === 'passed' ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : status === 'active' ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : 'text-red-400 bg-red-500/10 border-red-500/20';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${color}`}>
      {pulse && <span className="w-1 h-1 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  );
}

function DiskWidget({ data, nvmeTemp }) {
  const smoothEnabled = useMonitoringStore(s => s.smoothEnabled);
  const smoothMs = useMonitoringStore(s => s.smoothMs);

  if (!data) return null;

  const main = data.main || {};
  const fss = (data.filesystems || []).slice(0, 2);
  const ioEntries = Object.entries(data.io || {});
  const showGrid = fss.length > 1;

  return (
    <GlassCard data-debug-id="2.2.8.5" data-debug-name="DiskCard" data-debug-type="card" title="Storage">
      <div data-debug-id="2.2.8" data-debug-name="DiskWidget" data-debug-type="widget" className="px-4 pb-4">
        {/* NVMe temp gauge - outside partition grid */}
        {nvmeTemp != null && (
          <div className="mb-3 pb-3">
            <div className="flex items-center gap-3">
              <GaugeMeter
                value={Math.min((nvmeTemp / 95) * 100, 100)}
                size={GAUGE_SIZE} strokeWidth={8}
                smoothEnabled={smoothEnabled} smoothMs={smoothMs}
                displayText={`${Math.round(nvmeTemp)}°`}
                label="Temp"
              />
              <div className="text-[11px] text-neutral-500">
                <div>Lexar NM610 Pro 1TB</div>
                <div className="text-[10px] text-neutral-600">Drive Temperature</div>
              </div>
            </div>
          </div>
        )}

        <div data-debug-id="2.2.8.2" data-debug-name="DiskList" data-debug-type="card" className={showGrid ? 'grid grid-cols-2 gap-3' : ''}>
          {fss.map(fs => (
            <div key={fs.mount} className={showGrid ? 'bg-neutral-900/50 rounded-lg p-3 border border-[#1e2530] min-w-0' : ''}>
              <div className="flex flex-col items-center gap-2">
                <GaugeMeter value={fs.usedPercent} size={showGrid ? 80 : 110} strokeWidth={showGrid ? 5 : 7} label={fs.mount === '/' ? 'System' : fs.mount.replace('/', '')} smoothEnabled={smoothEnabled} smoothMs={smoothMs} />
                <div className="w-full space-y-0.5">
                  <InfoRow label="Used" value={formatBytes(fs.used)} />
                  <InfoRow label="Free" value={formatBytes(fs.free)} />
                  <InfoRow label="Total" value={formatBytes(fs.total)} />
                </div>
              </div>
            </div>
          ))}
          {!fss.length && (
            <div className="flex flex-col sm:flex-row items-start gap-3">
              <div className="flex-shrink-0 self-center sm:self-start">
                <GaugeMeter value={main.usedPercent || 0} size={110} strokeWidth={7} smoothEnabled={smoothEnabled} smoothMs={smoothMs} />
              </div>
              <div className="flex-1 min-w-0 w-full sm:w-auto space-y-1.5 pt-1">
                <InfoRow label="Used" value={formatBytes(main.used)} />
                <InfoRow label="Free" value={formatBytes(main.free)} />
                <InfoRow label="Total" value={formatBytes(main.total)} />
              </div>
            </div>
          )}
        </div>

        {(data.smart || data.temperature) && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {data.smart && <StatusBadge status={data.smart === 'PASSED' ? 'passed' : 'failed'} label={`SMART: ${data.smart}`} pulse={data.smart === 'PASSED'} />}
            {data.temperature && (
              <span className="flex items-center gap-1 text-[11px] text-neutral-500">
                <Thermometer size={10} /> {data.temperature}°C
              </span>
            )}
          </div>
        )}

        {ioEntries.length > 0 && (
          <div data-debug-id="2.2.8.1" data-debug-name="DiskIoBar" data-debug-type="chart" className="mt-3 pt-3 border-t border-[#1e2530]">
            <div className="flex items-center gap-1.5 mb-3">
              <Activity size={10} className="text-neutral-600" />
              <span className="text-[10px] text-neutral-600">Disk I/O</span>
            </div>
            <div className="flex justify-center">
              <DiskIoGauge
                readBytes={ioEntries[0][1].readBytes}
                writeBytes={ioEntries[0][1].writeBytes}
                size={GAUGE_SIZE}
                label={ioEntries[0][0]}
                smoothEnabled={smoothEnabled}
                smoothMs={smoothMs}
              />
            </div>
            {ioEntries.length > 1 && (
        <div className="mt-3 pt-3 border-t border-[#1e2530]">
                {ioEntries.slice(1, 3).map(([name, io]) => (
                  <div key={name} className="flex items-center gap-x-3 text-[10px] whitespace-nowrap py-0.5">
                    <span className="text-neutral-500 font-mono tabular-nums w-10 flex-shrink-0">{name}</span>
                    <span data-debug-id="2.2.8.3" data-debug-name="ReadSpeed" data-debug-type="other" className="text-neutral-400">R: {formatBytesRate(io.readBytes)}</span>
                    <span data-debug-id="2.2.8.4" data-debug-name="WriteSpeed" data-debug-type="other" className="text-neutral-400">W: {formatBytesRate(io.writeBytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {data.partitions && data.partitions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#1e2530]">
            <div className="text-[10px] text-neutral-600 mb-1.5 flex items-center gap-1.5">
              <HardDrive size={10} /> Partitions
            </div>
            <div className="grid grid-cols-2 gap-1">
              {data.partitions.slice(0, 4).map(p => (
                <div key={p.name} className="text-[10px] text-neutral-500 truncate min-w-0">
                  <span className="text-neutral-400 font-mono tabular-nums">{p.name}</span> {p.model || ''}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.filesystems && data.filesystems.length > 2 && (
          <div className="mt-3 pt-3 border-t border-[#1e2530]">
            <div className="text-[10px] text-neutral-600 mb-1">Other mounts</div>
            {data.filesystems.slice(2, 5).map(fs => (
              <div key={fs.mount} className="flex items-center justify-between gap-2 min-w-0 text-[10px] py-0.5">
                <span className="text-neutral-500 truncate min-w-0">{fs.mount}</span>
                <span className="text-neutral-500 font-mono tabular-nums flex-shrink-0">{fs.usedPercent}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default memo(DiskWidget);
