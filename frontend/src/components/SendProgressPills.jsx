import React from 'react';
import { Check, X, Loader2 } from 'lucide-react';

const TARGET_META = {
  telegram: { label: 'Tele' },
  channel: { label: 'WA Ch' },
  status: { label: 'WA St' },
};

const STATE_STYLE = {
  pending: { cls: 'text-neutral-400 bg-neutral-700/30 border-neutral-600', Icon: null, spin: false },
  sending: { cls: 'text-amber-300 bg-amber-500/10 border-amber-500/40', Icon: Loader2, spin: true },
  done: { cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/40', Icon: Check, spin: false },
  err: { cls: 'text-red-300 bg-red-500/10 border-red-500/40', Icon: X, spin: false },
};

export default function SendProgressPills({ progress, targets = ['telegram', 'channel', 'status'] }) {
  if (!progress) return null;
  // Only render targets the backend actually reported (i.e. targets that were
  // attempted). Un-attempted targets are absent from `progress`, so they must not
  // be shown as "pending".
  const active = targets.filter((t) => progress[t] !== undefined);
  if (active.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {active.map((t) => {
        const meta = TARGET_META[t];
        if (!meta) return null;
        const st = STATE_STYLE[progress[t]] || STATE_STYLE.pending;
        const Icon = st.Icon;
        return (
          <span
            key={t}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${st.cls}`}
          >
            {Icon && <Icon size={12} className={st.spin ? 'animate-spin' : ''} />}
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
