export default function StatusBadge({ status, label, pulse = false }) {
  const colors = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
    info: 'bg-sky-500',
    inactive: 'bg-neutral-600',
    running: 'bg-emerald-500',
    stopped: 'bg-red-500',
    failed: 'bg-red-500',
    passed: 'bg-emerald-500',
    active: 'bg-emerald-500',
    yes: 'bg-emerald-500',
    no: 'bg-neutral-600',
  };

  const dot = colors[status?.toLowerCase()] || 'bg-neutral-500';

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${pulse ? 'animate-pulse' : ''}`} />
      {label && <span className="text-[11px] text-neutral-400">{label}</span>}
    </div>
  );
}
