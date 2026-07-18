import useMonitoringStore from '../stores/monitoringStore';
import GlassCard from '../shared/GlassCard';
import StatusBadge from '../shared/StatusBadge';
import GaugeMeter from '../../components/GaugeMeter';
import { HardDrive, Thermometer, Activity, Database, Layers } from 'lucide-react';
import { formatBytes, formatBytesCompact, formatBytesRateCompact } from '../../utils/format.js';

export default function StoragePage() {
  const stats = useMonitoringStore(s => s.stats);
  const disk = stats?.disk;
  if (!disk) return null;

  const fss = disk.filesystems || [];
  const ioEntries = Object.entries(disk.io || {});
  const partitions = disk.partitions || [];

  return (
    <div className="p-3 md:p-6" data-debug-id="2.6" data-debug-name="StoragePage" data-debug-type="container">
      <div className="max-w-7xl mx-auto space-y-3 md:space-y-4">
        {/* All filesystems */}
        <div>
          <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Layers size={12} /> Filesystems
          </h2>
          <div data-debug-id="2.6.1" data-debug-name="FilesystemsCards" data-debug-type="grid" className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {fss.map(fs => (
              <GlassCard key={fs.mount} title={fs.mount} subtitle={`${fs.fstype?.toUpperCase() || '?'}`} data-debug-id="2.6.1.1" data-debug-name="FilesystemCard" data-debug-type="card">
                <div data-debug-id="2.6.1.1" data-debug-name="FilesystemCard" data-debug-type="card" className="px-4 pb-4">
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="flex-shrink-0">
                      <GaugeMeter data-debug-id="2.6.1.1.1" data-debug-name="FsGaugeMeter" data-debug-type="chart" value={fs.usedPercent} size={90} strokeWidth={6} />
                    </div>
                    <div className="w-full sm:w-auto space-y-1 flex-1 min-w-0">
                      <InfoRow label="Used" value={formatBytes(fs.used)} />
                      <InfoRow label="Free" value={formatBytes(fs.free)} />
                      <InfoRow label="Total" value={formatBytes(fs.total)} />
                      <InfoRow label="Usage" value={`${fs.usedPercent}%`} />
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>

        {/* Disk I/O */}
        {ioEntries.length > 0 && (
          <div>
            <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Activity size={12} /> Disk I/O
            </h2>
            <div data-debug-id="2.6.2" data-debug-name="DiskIoCards" data-debug-type="grid" className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {ioEntries.slice(0, 4).map(([name, io]) => (
                <GlassCard key={name} title={name} data-debug-id="2.6.2.1" data-debug-name="DiskIoCard" data-debug-type="card">
                  <div data-debug-id="2.6.2.1" data-debug-name="DiskIoCard" data-debug-type="card" className="px-4 pb-4">
                    <div className="space-y-1">
                      <InfoRow label="Read" value={formatBytesRateCompact(io.readBytes)} />
                      <InfoRow label="Write" value={formatBytesRateCompact(io.writeBytes)} />
                      <InfoRow label="IOPS" value={`${io.readOps + io.writeOps} ops/s`} />
                      <InfoRow label="In Flight" value={`${io.ioInFlight}`} />
                      <InfoRow label="I/O Time" value={`${(io.ioTime || 0).toFixed(0)} ms`} />
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>
        )}

        {/* Partitions */}
        {partitions.length > 0 && (
          <div>
            <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Database size={12} /> Partitions
            </h2>
            <GlassCard data-debug-id="2.6.4" data-debug-name="PartitionsCard" data-debug-type="card">
              <div data-debug-id="2.6.3" data-debug-name="PartitionsTable" data-debug-type="table" className="px-4 pb-4">
                <div className="space-y-1">
                  {partitions.map(p => (
                    <div key={p.name} data-debug-id="2.6.3.1" data-debug-name="PartitionRow" data-debug-type="card" className="flex items-center justify-between gap-2 py-1 text-[11px] border-b border-[#1e2530]/30 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <HardDrive size={12} className="text-neutral-600 flex-shrink-0" />
                        <span className="font-mono tabular-nums text-neutral-400">{p.name}</span>
                        <span className="text-neutral-500 truncate min-w-0 hidden sm:inline">{p.model || ''}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="font-mono tabular-nums text-neutral-500">{formatBytesCompact(p.size)}</span>
                        {p.removable && <span className="text-[10px] text-yellow-500/70">Removable</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </div>
        )}

        {/* SMART / Temperature */}
        {(disk.smart || disk.temperature) && (
          <div className="flex items-center gap-3">
            {disk.smart && <StatusBadge status={disk.smart === 'PASSED' ? 'passed' : 'failed'} label={`SMART: ${disk.smart}`} pulse={disk.smart === 'PASSED'} />}
            {disk.temperature && (
              <span className="flex items-center gap-1 text-[11px] text-neutral-500">
                <Thermometer size={10} /> {disk.temperature}°C
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 py-0.5">
      <span className="text-[11px] text-neutral-500 flex-shrink-0 truncate">{label}</span>
      <span className="text-[11px] text-neutral-300 font-mono tabular-nums flex-1 min-w-0 text-right">{value}</span>
    </div>
  );
}
