import fs from 'node:fs';

function getMemInfo() {
  const info = {};
  try {
    const data = fs.readFileSync('/proc/meminfo', 'utf8');
    for (const line of data.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) info[m[1]] = parseInt(m[2]) * 1024;
    }
  } catch {}
  return info;
}

export function collect() {
  const m = getMemInfo();
  const total = m.MemTotal || 0;
  const free = m.MemFree || 0;
  const buffers = m.Buffers || 0;
  const cached = m.Cached || 0;
  const sReclaimable = m.SReclaimable || 0;
  const shmem = m.Shmem || 0;
  const available = m.MemAvailable || (free + buffers + cached + sReclaimable - shmem);
  const used = total - available;

  const swapTotal = m.SwapTotal || 0;
  const swapFree = m.SwapFree || 0;
  const swapUsed = swapTotal - swapFree;
  const swapPercent = swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0;

  const dirty = m.Dirty || 0;
  const writeback = m.Writeback || 0;

  const active = m.Active || 0;
  const inactive = m.Inactive || 0;
  const mapped = m.Mapped || 0;

  return {
    total,
    used,
    free,
    available,
    usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    breakdown: {
      buffers,
      cached: cached + sReclaimable,
      active,
      inactive,
      mapped,
      dirty,
      writeback,
    },
    swap: {
      total: swapTotal,
      used: swapUsed,
      free: swapFree,
      usedPercent: swapPercent,
    },
  };
}
