import fs from 'node:fs';

let prevCpuTimes = {};
let passwdCache = null;

function getPasswdCache() {
  if (passwdCache) return passwdCache;
  passwdCache = new Map();
  try {
    const content = fs.readFileSync('/etc/passwd', 'utf8');
    for (const line of content.split('\n')) {
      const parts = line.split(':');
      if (parts.length >= 3) passwdCache.set(parseInt(parts[2]), parts[0]);
    }
  } catch {}
  return passwdCache;
}

function readProcStat() {
  try {
    const data = fs.readFileSync('/proc/stat', 'utf8');
    const m = data.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
    if (m) return parseInt(m[1]) + parseInt(m[2]) + parseInt(m[3]) + parseInt(m[4]);
  } catch {}
  return 0;
}

let cpuCoreCountCache = null;
function getCpuCoreCount() {
  if (cpuCoreCountCache) return cpuCoreCountCache;
  try {
    const data = fs.readFileSync('/proc/stat', 'utf8');
    let count = 0;
    for (const line of data.split('\n')) {
      if (/^cpu\d+\s+/.test(line)) count++;
    }
    cpuCoreCountCache = Math.max(1, count);
  } catch {
    try {
      const info = fs.readFileSync('/proc/cpuinfo', 'utf8');
      cpuCoreCountCache = Math.max(1, (info.match(/^processor/g) || []).length);
    } catch {
      cpuCoreCountCache = 1;
    }
  }
  return cpuCoreCountCache;
}

export function getProcesses(sortBy = 'cpu', limit = 50) {
  const pids = [];
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (/^\d+$/.test(entry)) pids.push(parseInt(entry));
    }
  } catch { return []; }

  const totalCpu = readProcStat();
  const coreCount = getCpuCoreCount();
  const passwd = getPasswdCache();
  const processes = [];
  const now = Date.now();
  const maxPids = Math.min(pids.length, 200);

  for (let i = 0; i < maxPids; i++) {
    const pid = pids[i];
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');

      const commMatch = stat.match(/^\d+\s+\((.+?)\)\s+/);
      if (!commMatch) continue;
      const name = commMatch[1];

      const parts = stat.split(/\s+/);
      if (parts.length < 25) continue;

      const state = parts[2];
      const utime = parseInt(parts[13]) || 0;
      const stime = parseInt(parts[14]) || 0;
      const rssPages = parseInt(parts[23]) || 0;
      const threads = parseInt(parts[20]) || 0;
      const priority = parseInt(parts[17]) || 0;
      const nice = parseInt(parts[18]) || 0;
      const rssMemMB = Math.round((rssPages * 4096) / 1024 / 1024);

      let vmRSS = rssMemMB;
      try {
        const vmMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
        if (vmMatch) vmRSS = Math.round(parseInt(vmMatch[1]) / 1024);
      } catch {}

      let uid = null;
      try {
        const uidMatch = status.match(/Uid:\s+(\d+)/);
        if (uidMatch) uid = parseInt(uidMatch[1]);
      } catch {}

      const username = uid != null ? (passwd.get(uid) || uid) : uid;

      let cmdline = '';
      try {
        cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      } catch {}

      const prev = prevCpuTimes[pid] || { utime: 0, stime: 0, totalCpu: 0, time: now };
      const cpuDelta = Math.max(1, (utime + stime) - (prev.utime + prev.stime));
      const totalDelta = Math.max(1, totalCpu - prev.totalCpu);
      const cpuPercent = Math.min(coreCount * 100, Math.round((cpuDelta / totalDelta * coreCount) * 100 * 100) / 100);

      processes.push({
        pid,
        name: name.substring(0, 60),
        state,
        cpuPercent,
        ramMB: vmRSS,
        threads,
        priority,
        nice,
        uid,
        username,
        cmdline: cmdline.substring(0, 200),
      });

      prevCpuTimes[pid] = { utime, stime, totalCpu, time: now };
    } catch {}
  }

  const currentPids = new Set(pids);
  for (const pid of Object.keys(prevCpuTimes)) {
    if (!currentPids.has(parseInt(pid))) delete prevCpuTimes[parseInt(pid)];
  }

  const validSort = { cpu: 'cpuPercent', ram: 'ramMB', pid: 'pid', name: 'name' };
  const key = validSort[sortBy] || 'cpuPercent';
  processes.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name);
    return (b[key] || 0) - (a[key] || 0);
  });

  return processes.slice(0, limit);
}
