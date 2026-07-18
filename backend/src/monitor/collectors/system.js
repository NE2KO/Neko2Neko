import os from 'node:os';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

let whoResult = { loggedUsers: 0 };
let whoLastRefresh = 0;
const WHO_TTL = 60_000;

let serviceResult = { total: 0, running: 0, failed: 0 };
let servicesLastRefresh = 0;
const SERVICES_TTL = 60_000;

let distroInfo = { distro: 'Linux', distroVersion: '' };
let distroLoaded = false;

let cpuModel = '';
let cpuLoaded = false;

function loadDistroInfo() {
  try {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    const idMatch = osRelease.match(/^ID=(.+)$/m);
    const versionMatch = osRelease.match(/^VERSION_ID=(.+)$/m);
    const prettyMatch = osRelease.match(/^PRETTY_NAME="(.+)"$/m);
    if (prettyMatch) {
      const parts = prettyMatch[1].split(' ');
      distroInfo = { distro: parts[0], distroVersion: parts.slice(1).join(' ').replace(/"/g, '') };
    } else {
      distroInfo = {
        distro: idMatch ? idMatch[1].replace(/"/g, '') : 'Linux',
        distroVersion: versionMatch ? versionMatch[1].replace(/"/g, '') : '',
      };
    }
  } catch {
    distroInfo = { distro: 'Linux', distroVersion: '' };
  }
  distroLoaded = true;
}

function loadCpuModel() {
  try {
    const data = fs.readFileSync('/proc/cpuinfo', 'utf8');
    for (const line of data.split('\n')) {
      if (line.startsWith('model name')) { cpuModel = line.split(':')[1].trim(); break; }
    }
  } catch {}
  cpuLoaded = true;
}

function refreshWho() {
  execAsync('who 2>/dev/null | wc -l', { encoding: 'utf8', timeout: 3000 })
    .then(({ stdout }) => {
      whoResult = { loggedUsers: parseInt(stdout.trim()) || 0 };
    })
    .catch(() => {
      whoResult = { loggedUsers: 0 };
    })
    .finally(() => { whoLastRefresh = Date.now(); });
}

function refreshServices() {
  const total$ = execAsync('systemctl list-units --type=service --all --no-legend 2>/dev/null | wc -l', { encoding: 'utf8', timeout: 3000 });
  const running$ = execAsync('systemctl list-units --type=service --state=running --no-legend 2>/dev/null | wc -l', { encoding: 'utf8', timeout: 3000 });
  const failed$ = execAsync('systemctl list-units --type=service --state=failed --no-legend 2>/dev/null | wc -l', { encoding: 'utf8', timeout: 3000 });

  Promise.all([total$, running$, failed$])
    .then(([totalOut, runningOut, failedOut]) => {
      serviceResult = {
        total: parseInt(totalOut.stdout.trim()) || 0,
        running: parseInt(runningOut.stdout.trim()) || 0,
        failed: parseInt(failedOut.stdout.trim()) || 0,
      };
    })
    .catch(() => {})
    .finally(() => { servicesLastRefresh = Date.now(); });
}

function maybeRefreshWho() {
  if (Date.now() - whoLastRefresh > WHO_TTL) refreshWho();
}

function maybeRefreshServices() {
  if (Date.now() - servicesLastRefresh > SERVICES_TTL) refreshServices();
}

if (!distroLoaded) loadDistroInfo();
if (!cpuLoaded) loadCpuModel();
refreshWho();
refreshServices();

export function collect() {
  maybeRefreshWho();
  maybeRefreshServices();

  let kernel = '';
  try {
    kernel = fs.readFileSync('/proc/version', 'utf8').split('(')[0].trim().replace('Linux version ', '');
  } catch {
    kernel = os.release();
  }

  return {
    hostname: os.hostname(),
    kernel,
    distro: distroInfo.distro,
    distroVersion: distroInfo.distroVersion,
    platform: os.platform(),
    arch: os.arch() === 'x64' ? 'x86_64' : os.arch(),
    uptime: os.uptime(),
    loadAvg: { '1min': os.loadavg()[0], '5min': os.loadavg()[1], '15min': os.loadavg()[2] },
    loggedUsers: whoResult.loggedUsers,
    services: serviceResult,
    cpuModel,
    totalRam: os.totalmem(),
    nodeVersion: process.version,
  };
}
