import { memo } from 'react';
import GlassCard from '../shared/GlassCard';
import StatusBadge from '../shared/StatusBadge';
import { Server, Globe, Clock, Users, Box } from 'lucide-react';

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function InfoRow({ label, value, icon }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0 py-1">
      <div className="flex items-center gap-2 flex-shrink-0 truncate min-w-0">
        {icon && <span className="text-neutral-600 flex-shrink-0">{icon}</span>}
        <span className="text-[11px] text-neutral-500 truncate">{label}</span>
      </div>
      <span className="text-[11px] text-neutral-300 font-mono tabular-nums flex-1 min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function UserProfile({ name, distro, color, dotColor, online }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${online ? dotColor + ' shadow-[0_0_4px_rgba(255,255,255,0.15)]' : 'bg-neutral-700'}`} />
        <span className={`text-[11px] font-medium ${color}`}>{name}</span>
        <span className="text-[10px] text-neutral-600">{distro}</span>
      </div>
      <span className={`text-[10px] ${online ? 'text-green-400' : 'text-neutral-600'}`}>
        {online ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}

function SystemWidget({ data }) {
  if (!data) return null;

  const services = data.services || {};

  return (
    <GlassCard data-debug-id="2.2.11.4" data-debug-name="SystemCard" data-debug-type="card" title="System" subtitle={data.hostname ? `CATIAA (${data.hostname})` : 'CATIAA'}>
      <div data-debug-id="2.2.11" data-debug-name="SystemWidget" data-debug-type="widget" className="px-4 pb-4 space-y-0">
        <div data-debug-id="2.2.11.3" data-debug-name="SystemInfo" data-debug-type="other" className="space-y-0">
        <InfoRow label="Hostname" value={data.hostname ? `CATIAA (${data.hostname})` : 'CATIAA'} icon={<Server size={12} />} />
        <InfoRow label="Kernel" value={data.kernel} icon={<Box size={12} />} />
        <InfoRow label="Distro" value={`${data.distro} ${data.distroVersion || ''}`} icon={<Globe size={12} />} />
        <InfoRow label="Uptime" value={formatUptime(data.uptime)} icon={<Clock size={12} />} />
        <InfoRow label="Arch" value={data.arch} />
        <InfoRow label="Node" value={data.nodeVersion} />
        </div>

        {/* User Profiles */}
        <div data-debug-id="2.2.11.2" data-debug-name="UsersList" data-debug-type="other" className="mt-3 pt-3 border-t border-[#1e2530]">
          <div className="text-[10px] text-neutral-600 mb-2 flex items-center gap-1.5">
            <Users size={10} /> Users
          </div>
          <div className="space-y-2">
            <UserProfile name="CATIAA" distro="Arch Linux" color="text-cyan-400" dotColor="bg-cyan-400" online={true} />
            <UserProfile name="ALISAA" distro="Fedora" color="text-violet-400" dotColor="bg-violet-400" online={false} />
            <UserProfile name="AMANDA" distro="--" color="text-neutral-500" dotColor="bg-neutral-600" online={false} />
          </div>
        </div>

        {services.total > 0 && (
          <div data-debug-id="2.2.11.1" data-debug-name="SystemBadges" data-debug-type="other" className="mt-3 pt-3 border-t border-[#1e2530]">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status="running" label={`${services.running || 0} running`} />
              {services.failed > 0 && <StatusBadge status="failed" label={`${services.failed} failed`} />}
              <span className="text-[11px] text-neutral-600">{services.total} total</span>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default memo(SystemWidget);
