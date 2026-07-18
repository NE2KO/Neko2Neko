import fs from 'node:fs';

let prevNet = {};
let cachedIfaces = [];
let cachedDefaultIface = null;
let lastIfaceRefresh = 0;
let lastDefaultRefresh = 0;

const IFACE_CACHE_MS = 10_000;
const DEFAULT_CACHE_MS = 30_000;

function getNetDev() {
  const ifaces = {};
  try {
    const data = fs.readFileSync('/proc/net/dev', 'utf8');
    for (const line of data.split('\n')) {
      const m = line.match(/^\s*(\w+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if (m) {
        ifaces[m[1]] = { rxBytes: parseInt(m[2]), txBytes: parseInt(m[3]) };
      }
    }
  } catch {}
  return ifaces;
}

function getConnectionCount() {
  let count = 0;
  try {
    const data = fs.readFileSync('/proc/net/tcp', 'utf8');
    count += data.split('\n').length - 2;
  } catch {}
  try {
    const data = fs.readFileSync('/proc/net/tcp6', 'utf8');
    count += data.split('\n').length - 2;
  } catch {}
  return Math.max(0, count);
}

function readDefaultIface() {
  try {
    const data = fs.readFileSync('/proc/net/route', 'utf8');
    for (const line of data.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1] === '00000000') return parts[0];
    }
  } catch {}
  return null;
}

function readInterfaceList() {
  const ifaces = [];
  try {
    const base = '/sys/class/net';
    for (const name of fs.readdirSync(base)) {
      if (name === 'lo') continue;
      try {
        const addr = fs.readFileSync(`${base}/${name}/address`, 'utf8').trim();
        const flags = parseInt(fs.readFileSync(`${base}/${name}/flags`, 'utf8').trim());
        const mtu = parseInt(fs.readFileSync(`${base}/${name}/mtu`, 'utf8').trim());
        const operstate = fs.readFileSync(`${base}/${name}/operstate`, 'utf8').trim();
        try {
          fs.readFileSync('/proc/net/fib_trie', 'utf8');
        } catch {}
        ifaces.push({
          name,
          mac: addr.toUpperCase(),
          mtu,
          up: (flags & 1) !== 0,
          running: (flags & 0x40) !== 0,
          operstate,
        });
      } catch {}
    }
  } catch {}
  return ifaces;
}

function refreshIfaceCache() {
  const now = Date.now();
  if (now - lastIfaceRefresh >= IFACE_CACHE_MS) {
    cachedIfaces = readInterfaceList();
    lastIfaceRefresh = now;
  }
}

function refreshDefaultCache() {
  const now = Date.now();
  if (now - lastDefaultRefresh >= DEFAULT_CACHE_MS) {
    cachedDefaultIface = readDefaultIface();
    lastDefaultRefresh = now;
  }
}

function getDefaultIface() {
  refreshDefaultCache();
  return cachedDefaultIface;
}

function getInterfaceList() {
  refreshIfaceCache();
  return cachedIfaces;
}

export function collect() {
  const curr = getNetDev();
  const defaultIface = getDefaultIface();
  const ifaces = getInterfaceList();
  const connections = getConnectionCount();

  const speeds = {};
  const total = { rxBytes: 0, txBytes: 0, rxSpeed: 0, txSpeed: 0 };

  for (const [name, stats] of Object.entries(curr)) {
    const prev = prevNet[name];
    if (prev) {
      const rxSpeed = Math.max(0, stats.rxBytes - prev.rxBytes);
      const txSpeed = Math.max(0, stats.txBytes - prev.txBytes);
      speeds[name] = { rxSpeed, txSpeed, rxBytes: stats.rxBytes, txBytes: stats.txBytes };
      total.rxSpeed += rxSpeed;
      total.txSpeed += txSpeed;
    } else {
      speeds[name] = { rxSpeed: 0, txSpeed: 0, rxBytes: stats.rxBytes, txBytes: stats.txBytes };
    }
  }

  prevNet = curr;

  const primary = defaultIface || Object.keys(speeds).find(k => k.startsWith('eth') || k.startsWith('en') || k.startsWith('wl')) || Object.keys(speeds)[0] || '';

  return {
    primary,
    interfaces: ifaces.map(iface => ({
      ...iface,
      speed: speeds[iface.name] || { rxSpeed: 0, txSpeed: 0, rxBytes: 0, txBytes: 0 },
    })),
    total: {
      rxSpeed: total.rxSpeed,
      txSpeed: total.txSpeed,
    },
    connections,
  };
}

refreshIfaceCache();
refreshDefaultCache();
