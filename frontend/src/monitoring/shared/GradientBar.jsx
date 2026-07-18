import { memo } from 'react';

export default memo(function GradientBar({ percent = 0, className = '', ...rest }) {
  const pct = Math.min(Math.max(percent, 0), 100);
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e';
  return (
    <div
      data-debug-id="S.4"
      data-debug-name="GradientBar"
      data-debug-type="chart"
      {...rest}
      className={`h-1.5 bg-neutral-800 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(to right, #22c55e, ${color})`,
          transition: 'width 800ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </div>
  );
});
