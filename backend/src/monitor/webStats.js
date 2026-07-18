import fs from 'node:fs';

let queueRequestCount = 0;
let queueRequestCountByPath = {};
let startTime = Date.now();

const IGNORE_PREFIXES = ['/api/monitoring/', '/api/updates', '/ws/'];

export function trackRequest(method, path) {
  if (IGNORE_PREFIXES.some(p => path.startsWith(p))) return;
  if (!path.startsWith('/api/queue')) return;
  queueRequestCount++;
  const key = `${method} ${path}`;
  queueRequestCountByPath[key] = (queueRequestCountByPath[key] || 0) + 1;
}

// Cache for expensive /proc reads — 3-second TTL avoids blocking on every request
const WEB_STATS_CACHE_TTL = 3000;
let fdCountCache = null;
let fdCountTs = 0;
let loadAvgCache = null;
let loadAvgTs = 0;
let connCountCache = null;
let connCountTs = 0;

function getFdCount() {
  const now = Date.now();
  if (fdCountCache !== null && now - fdCountTs < WEB_STATS_CACHE_TTL) return fdCountCache;
  try {
    fdCountCache = fs.readdirSync('/proc/self/fd').length;
  } catch {
    fdCountCache = 0;
  }
  fdCountTs = now;
  return fdCountCache;
}

function getLoadAvg() {
  const now = Date.now();
  if (loadAvgCache !== null && now - loadAvgTs < WEB_STATS_CACHE_TTL) return loadAvgCache;
  try {
    const data = fs.readFileSync('/proc/loadavg', 'utf8');
    const parts = data.trim().split(/\s+/);
    loadAvgCache = {
      '1min': parseFloat(parts[0]),
      '5min': parseFloat(parts[1]),
      '15min': parseFloat(parts[2]),
    };
  } catch {
    loadAvgCache = null;
  }
  loadAvgTs = now;
  return loadAvgCache;
}

function getConnCount() {
  const now = Date.now();
  if (connCountCache !== null && now - connCountTs < WEB_STATS_CACHE_TTL) return connCountCache;
  try {
    const lines = fs.readFileSync('/proc/net/tcp', 'utf8').split('\n');
    let established = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 3 && parts[3] === '01') established++;
    }
    connCountCache = established;
  } catch {
    connCountCache = null;
  }
  connCountTs = now;
  return connCountCache;
}

export function getWebStats() {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  return {
    uptime,
    uptimeFormatted: formatUptime(uptime),
    hostUptime: getHostUptime(),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external || 0,
    },
    queueRequestCount,
    queueRequestsByPath: Object.entries(queueRequestCountByPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, count]) => ({ path, count })),
    fdCount: getFdCount(),
    startedAt: new Date(startTime).toISOString(),
    loadAvg: getLoadAvg(),
    connCount: getConnCount(),
  };
}

function getHostUptime() {
  try {
    const data = fs.readFileSync('/proc/uptime', 'utf8');
    const seconds = parseFloat(data.split(/\s+/)[0]);
    return { seconds, formatted: formatUptime(seconds) };
  } catch {
    return null;
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
