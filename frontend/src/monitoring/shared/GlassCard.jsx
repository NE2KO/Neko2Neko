import { memo } from 'react';

export default memo(function GlassCard({ children, className = '', title, subtitle, action, onClick, hover = false, ...rest }) {
  return (
    <div
      data-debug-id="S.1"
      data-debug-name="GlassCard"
      data-debug-type="card"
      {...rest}
      onClick={onClick}
      className={`bg-[#111418] border border-[#1e2530] rounded-xl overflow-hidden transition-all duration-200 min-w-0 ${
        hover ? 'hover:border-cyan-500/30 hover:shadow-[0_0_15px_rgba(6,182,212,0.06)] cursor-pointer' : ''
      } ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <div className="min-w-0">
            {title && <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">{title}</h3>}
            {subtitle && <p className="text-[10px] text-neutral-600 mt-0.5 truncate">{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0 ml-2">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
});
