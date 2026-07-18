import { memo } from 'react';
import GlassCard from '../shared/GlassCard';
import StatusBadge from '../shared/StatusBadge';
import { ArrowUp, ArrowDown, Wifi, EthernetPort } from 'lucide-react';
import { formatBytes, formatSpeed } from '../../utils/format.js';

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 py-0.5">
      <span className="text-[11px] text-neutral-500 flex-shrink-0 truncate">{label}</span>
      <span className="text-[11px] text-neutral-300 font-mono tabular-nums flex-1 min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function NetworkWidget({ data }) {
  if (!data) return null;

  const interfaces = data.interfaces || [];
  const total = data.total || {};

  return (
    <GlassCard data-debug-id="2.2.10.4" data-debug-name="NetworkCard" data-debug-type="card" title="Network" subtitle={`${interfaces.length} interface(s)`}>
      <div data-debug-id="2.2.10" data-debug-name="NetworkWidget" data-debug-type="widget" className="px-4 pb-4">
        <div data-debug-id="2.2.10.2" data-debug-name="SpeedDisplay" data-debug-type="other" className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-emerald-500/5 rounded-lg p-3 border border-emerald-500/10 min-w-0">
            <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] mb-1">
              <ArrowDown size={12} /> Download
            </div>
            <div className="text-[clamp(14px,2.5vw,22px)] font-bold text-emerald-400 font-mono tabular-nums tracking-tight truncate">
              {formatSpeed(total.rxSpeed)}
            </div>
          </div>
          <div className="bg-blue-500/5 rounded-lg p-3 border border-blue-500/10 min-w-0">
            <div className="flex items-center gap-1.5 text-blue-400 text-[10px] mb-1">
              <ArrowUp size={12} /> Upload
            </div>
            <div className="text-[clamp(14px,2.5vw,22px)] font-bold text-blue-400 font-mono tabular-nums tracking-tight truncate">
              {formatSpeed(total.txSpeed)}
            </div>
          </div>
        </div>

        {data.connections != null && (
          <div className="mb-3">
            <InfoRow label="Active Connections" value={data.connections} />
          </div>
        )}

        {interfaces.length > 0 && (
          <div data-debug-id="2.2.10.1" data-debug-name="NetworkInfo" data-debug-type="card" className="border-t border-[#1e2530] pt-3">
            <div className="text-[10px] text-neutral-600 mb-1.5">Interfaces</div>
            <div className="space-y-1.5">
              {interfaces.map(iface => (
                <div key={iface.name} className="flex items-center justify-between gap-2 text-[11px] overflow-x-auto">
                  <div className="flex items-center gap-2 min-w-0">
                    {iface.name.startsWith('wl') ? <Wifi size={12} className="text-neutral-500 flex-shrink-0" /> : <EthernetPort size={12} className="text-neutral-500 flex-shrink-0" />}
                    <span className={`font-mono tabular-nums whitespace-nowrap ${iface.name === data.primary ? 'text-cyan-400' : 'text-neutral-400'}`}>
                      {iface.name}
                    </span>
                    <StatusBadge status={iface.operstate === 'up' ? 'running' : 'stopped'} />
                  </div>
                  <div data-debug-id="2.2.10.3" data-debug-name="IfaceDetail" data-debug-type="other" className="flex items-center gap-1.5 text-[9px] text-neutral-500 flex-shrink-0">
                    <span className="whitespace-nowrap">↓{formatBytes(iface.speed?.rxBytes || 0)}</span>
                    <span className="whitespace-nowrap">↑{formatBytes(iface.speed?.txBytes || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default memo(NetworkWidget);
