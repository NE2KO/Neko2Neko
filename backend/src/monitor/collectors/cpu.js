import fs from 'node:fs';

const HZ = 100;

let prevCpu = null;
let cpuInfo = null;
let freqCache = { data: null, ts: 0 };
let tempCache = { data: null, ts: 0 };

const FREQ_TTL = 5000;
const TEMP_TTL = 3000;

function readProcStat() {
  try {
    return fs.readFileSync('/proc/stat', 'utf8');
  } catch {
    return null;
  }
}

function parseProcStat(stat) {
  if (!stat) return { aggregate: null, perCore: [] };
  const lines = stat.split('\n');
  let aggregate = null;
  const perCore = [];
  for (const line of lines) {
    if (line.startsWith('cpu ')) {
      aggregate = parseCpuTimes(line);
    } else {
      const m = line.match(/^cpu(\d+)\s/);
      if (m) perCore.push({ id: parseInt(m[1]), ...parseCpuTimes(line) });
    }
  }
  return { aggregate, perCore };
}

function parseCpuTimes(line) {
  if (!line) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const user = parts[0] || 0;
  const nice = parts[1] || 0;
  const sys = parts[2] || 0;
  const idle = parts[3] || 0;
  const iowait = parts[4] || 0;
  const irq = parts[5] || 0;
  const softirq = parts[6] || 0;
  const steal = parts[7] || 0;
  const total = user + nice + sys + idle + iowait + irq + softirq + steal;
  return { user, nice, sys, idle, iowait, irq, softirq, steal, total };
}

function calcPercent(prev, curr) {
  const totalDiff = curr.total - prev.total;
  if (totalDiff <= 0) return 0;
  return {
    user: ((curr.user - prev.user) / totalDiff) * 100,
    sys: ((curr.sys - prev.sys) / totalDiff) * 100,
    nice: ((curr.nice - prev.nice) / totalDiff) * 100,
    idle: ((curr.idle - prev.idle) / totalDiff) * 100,
    iowait: ((curr.iowait - prev.iowait) / totalDiff) * 100,
    used: ((curr.total - curr.idle - prev.total + prev.idle) / totalDiff) * 100,
  };
}

function getCpuFreqs() {
  const now = Date.now();
  if (freqCache.data && now - freqCache.ts < FREQ_TTL) return freqCache.data;
  const freqs = [];
  let i = 0;
  while (true) {
    try {
      const f = fs.readFileSync(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`, 'utf8');
      freqs.push({ core: i, mhz: Math.round(parseInt(f.trim()) / 1000) });
      i++;
    } catch {
      break;
    }
  }
  freqCache = { data: freqs, ts: now };
  return freqs;
}

function getCpuTemp() {
  const now = Date.now();
  if (tempCache.data !== null && now - tempCache.ts < TEMP_TTL) return tempCache.data;
  const zones = [];
  for (let i = 0; i < 10; i++) {
    try {
      const t = fs.readFileSync(`/sys/class/thermal/thermal_zone${i}/temp`, 'utf8');
      const type = fs.readFileSync(`/sys/class/thermal/thermal_zone${i}/type`, 'utf8').trim();
      if (type.toLowerCase().includes('cpu') || type.toLowerCase().includes('x86') || type.toLowerCase().includes('k10temp') || type.toLowerCase().includes('core') || type.toLowerCase().includes('acpitz')) {
        zones.push({ temp: parseInt(t.trim()) / 1000, label: type });
      }
    } catch {}
  }
  const result = zones.length > 0 ? zones : null;
  tempCache = { data: result, ts: now };
  return result;
}

function getLoadAvg() {
  try {
    const d = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    return { '1min': parseFloat(d[0]), '5min': parseFloat(d[1]), '15min': parseFloat(d[2]), running: parseInt(d[3].split('/')[0]), total: parseInt(d[3].split('/')[1]) };
  } catch {
    return null;
  }
}

function getProcessCount() {
  try {
    const dirs = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
    return dirs.length;
  } catch {
    return 0;
  }
}

function getCpuInfo() {
  if (cpuInfo) return cpuInfo;
  try {
    const data = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const lines = data.split('\n');
    let model = '';
    for (const line of lines) {
      if (line.startsWith('model name')) { model = line.split(':')[1].trim(); break; }
    }
    const coreCount = lines.filter(l => l.startsWith('cpu cores')).length > 0 ? parseInt(lines.find(l => l.startsWith('cpu cores'))?.split(':')[1].trim()) : 0;
    const threadCount = lines.filter(l => l.startsWith('processor')).length;
    cpuInfo = { model, cores: coreCount || threadCount, threads: threadCount };
  } catch {
    cpuInfo = { model: '', cores: 0, threads: 0 };
  }
  return cpuInfo;
}

export function collect() {
  const stat = readProcStat();
  const { aggregate: curr, perCore: currPerCore } = parseProcStat(stat);

  const perCore = currPerCore.map(c => {
    const pct = calcPercent(prevCpu?.perCore?.[c.id] || c, c);
    return { id: c.id, usedPercent: Math.round(pct.used * 10) / 10 };
  });

  let cpuPct = { used: 0, user: 0, sys: 0, idle: 0, iowait: 0 };
  if (prevCpu?.total && curr) {
    cpuPct = calcPercent(prevCpu.total, curr);
  }

  const cpuTemp = getCpuTemp();
  const result = {
    usedPercent: Math.round(cpuPct.used * 10) / 10,
    userPercent: Math.round(cpuPct.user * 10) / 10,
    sysPercent: Math.round(cpuPct.sys * 10) / 10,
    iowaitPercent: Math.round(cpuPct.iowait * 10) / 10,
    perCore,
    freq: getCpuFreqs(),
    temp: cpuTemp?.[0] ?? null,
    temps: cpuTemp,
    loadAvg: getLoadAvg(),
    threads: getProcessCount(),
    info: getCpuInfo(),
  };

  prevCpu = { total: curr, perCore: currPerCore.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}) };
  return result;
}
