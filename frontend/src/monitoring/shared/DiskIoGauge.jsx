import { memo } from 'react';
import GaugeMeter from '../../components/GaugeMeter';
import { formatBytesRateCompact } from '../../utils/format.js';

export default memo(function DiskIoGauge({ readBytes = 0, writeBytes = 0, size = 120, smoothEnabled = true, smoothMs = 900 }) {
  const MAX_BPS = 500 * 1024 * 1024;
  const writePct = Math.min((writeBytes / MAX_BPS) * 100, 100);
  const readPct = Math.min((readBytes / MAX_BPS) * 100, 100);

  const fmt = (bps) => {
    const raw = formatBytesRateCompact(bps);
    const parts = raw.match(/^([\d.]+?)([A-Za-z].*)$/);
    const num = parts ? parseFloat(parts[1]) : 0;
    const display = num === Math.floor(num) ? String(Math.floor(num)) : parts[1];
    return parts ? { value: display, unit: parts[2] } : { value: raw, unit: '' };
  };

  return (
    <div className="flex items-start justify-center gap-2">
      <GaugeMeter
        value={readPct} size={size} strokeWidth={8}
        displayText={fmt(readBytes)} unit=""
        label="Read"
        smoothEnabled={smoothEnabled} smoothMs={smoothMs}
      />
      <GaugeMeter
        value={writePct} size={size} strokeWidth={8}
        displayText={fmt(writeBytes)} unit=""
        label="Write"
        smoothEnabled={smoothEnabled} smoothMs={smoothMs}
      />
    </div>
  );
});
