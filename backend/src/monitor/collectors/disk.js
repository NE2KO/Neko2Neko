import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

let prevDiskStats = null;

// --- Partition cache (30s) ---
let partitionCache = [];
let partitionCacheTime = 0;
const PARTITION_CACHE_TTL = 30_000;

function getPartitions() {
  const now = Date.now();
  if (partitionCache.length > 0 && now - partitionCacheTime < PARTITION_CACHE_TTL) {
    return partitionCache;
  }
  const disks = [];
  try {
    for (const entry of fs.readdirSync('/sys/block')) {
      if (entry.startsWith('loop') || entry.startsWith('ram') || entry.startsWith('zram')) continue;
      try {
        const size = parseInt(fs.readFileSync(`/sys/block/${entry}/size`, 'utf8').trim()) * 512;
        let model = entry;
        try { model = fs.readFileSync(`/sys/block/${entry}/device/model`, 'utf8').trim(); } catch {}
        if (!model) model = entry;
        const removable = parseInt(fs.readFileSync(`/sys/block/${entry}/removable`, 'utf8').trim()) === 1;
        disks.push({ name: entry, model, size, removable });
      } catch {
        disks.push({ name: entry, model: entry, size: 0, removable: false });
      }
    }
  } catch {}
  partitionCache = disks;
  partitionCacheTime = now;
  return disks;
}

// --- SMART cache (60s) ---
let smartCache = { smart: null, temperature: null };
let smartCacheTime = 0;
const SMART_CACHE_TTL = 60_000;

function isPhysicalDisk(disk) {
  return disk.name && !disk.name.startsWith('dm-') && !disk.name.startsWith('md');
}

async function refreshSmart(partitions) {
  const physDisks = partitions.filter(isPhysicalDisk);
  if (physDisks.length === 0) return;

  let smartHealth = null;
  let diskTemp = null;

  const results = await Promise.allSettled(
    physDisks.map(async (disk) => {
      const device = `/dev/${disk.name}`;
      const [health, temp] = await Promise.allSettled([
        execAsync(['smartctl', '-H', device].join(' '), { timeout: 5000 })
          .then(({ stdout }) => {
            if (stdout.includes('PASSED')) return 'PASSED';
            if (stdout.includes('FAILED')) return 'FAILED';
            return 'Unknown';
          })
          .catch(() => null),
        execAsync(['smartctl', '-A', device].join(' '), { timeout: 5000 })
          .then(({ stdout }) => {
            const line = stdout.split('\n').find(l => l.toLowerCase().includes('temperature'));
            if (line) {
              const m = line.match(/(\d+)/);
              if (m) return parseInt(m[1]);
            }
            return null;
          })
          .catch(() => null),
      ]);
      return {
        status: health.status === 'fulfilled' ? health.value : null,
        temp: temp.status === 'fulfilled' ? temp.value : null,
      };
    })
  );

  const statuses = results
    .filter(r => r.status === 'fulfilled' && r.value.status)
    .map(r => r.value.status);

  if (statuses.length > 0) {
    smartHealth = statuses.includes('FAILED') ? 'FAILED' : 'PASSED';
  }

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.temp != null) {
      diskTemp = r.value.temp;
      break;
    }
  }

  smartCache = { smart: smartHealth, temperature: diskTemp };
  smartCacheTime = Date.now();
}

function getDiskstats() {
  const stats = {};
  try {
    const data = fs.readFileSync('/proc/diskstats', 'utf8');
    for (const line of data.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) continue;
      const name = parts[2];
      if (name.startsWith('loop') || name.startsWith('ram') || name.startsWith('zram')) continue;
      const major = parseInt(parts[0]);
      const minor = parseInt(parts[1]);
      if (minor % 16 !== 0 && minor > 0) continue;
      stats[name] = {
        reads: parseInt(parts[3]),
        readSectors: parseInt(parts[5]),
        readTicks: parseInt(parts[6]),
        writes: parseInt(parts[7]),
        writeSectors: parseInt(parts[9]),
        writeTicks: parseInt(parts[10]),
        ioInFlight: parseInt(parts[11]),
        ioTime: parseInt(parts[12]),
        weightedIoTime: parseInt(parts[13]),
      };
    }
  } catch {}
  return stats;
}

function getFilesystems() {
  const fss = [];
  try {
    const data = fs.readFileSync('/proc/mounts', 'utf8');
    for (const line of data.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [, mountPoint, fstype] = parts;
      if (fstype === 'ext4' || fstype === 'btrfs' || fstype === 'xfs' || fstype === 'zfs' || mountPoint === '/') {
        try {
          const s = fs.statfsSync(mountPoint);
          const total = s.blocks * s.bsize;
          const free = s.bfree * s.bsize;
          const used = total - free;
          fss.push({
            mount: mountPoint,
            fstype,
            total,
            used,
            free,
            usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
          });
        } catch {}
      }
    }
  } catch {}
  return fss;
}

// Kick off first refresh immediately, then on interval
const partitions = getPartitions();
refreshSmart(partitions);
const smartInterval = setInterval(() => {
  const parts = getPartitions();
  refreshSmart(parts);
}, SMART_CACHE_TTL);

// Allow clean shutdown
if (typeof process !== 'undefined' && process.on) {
  process.on('SIGTERM', () => clearInterval(smartInterval));
  process.on('SIGINT', () => clearInterval(smartInterval));
}

export function collect() {
  const currStats = getDiskstats();
  const fss = getFilesystems();
  const partitions = getPartitions();

  const diskIo = {};
  if (prevDiskStats) {
    for (const [name, curr] of Object.entries(currStats)) {
      const prev = prevDiskStats[name];
      if (!prev) continue;
      const reads = curr.reads - prev.reads;
      const writes = curr.writes - prev.writes;
      const readSectors = curr.readSectors - prev.readSectors;
      const writeSectors = curr.writeSectors - prev.writeSectors;
      diskIo[name] = {
        readOps: reads,
        writeOps: writes,
        readBytes: readSectors * 512,
        writeBytes: writeSectors * 512,
        ioInFlight: curr.ioInFlight,
        ioTime: curr.ioTime - prev.ioTime,
      };
    }
  }
  prevDiskStats = currStats;

  const rootFs = fss.find(f => f.mount === '/');
  const mainDisk = {
    total: rootFs?.total || 0,
    used: rootFs?.used || 0,
    free: rootFs?.free || 0,
    usedPercent: rootFs?.usedPercent || 0,
  };

  const now = Date.now();
  if (now - smartCacheTime >= SMART_CACHE_TTL) {
    refreshSmart(partitions);
  }

  return {
    main: mainDisk,
    filesystems: fss,
    partitions: partitions.map(p => ({ name: p.name, model: p.model, size: p.size, removable: p.removable })),
    io: diskIo,
    smart: smartCache.smart,
    temperature: smartCache.temperature,
  };
}
