import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const CACHE_TTL = 3000;
let cachedGpu = null;
let lastRefresh = 0;
let refreshInFlight = false;
const HAS_NVIDIA = fs.existsSync('/proc/driver/nvidia');

function findDrmPath() {
  const base = '/sys/class/drm';
  try {
    for (const entry of fs.readdirSync(base)) {
      if (entry.startsWith('card') && !entry.includes('-')) {
        const dev = `${base}/${entry}/device`;
        if (fs.existsSync(`${dev}/gpu_busy_percent`)) return dev;
      }
    }
  } catch {}
  return null;
}

function readInt(path) {
  try { return parseInt(fs.readFileSync(path, 'utf8').trim(), 10); } catch { return null; }
}

function readStr(path) {
  try { return fs.readFileSync(path, 'utf8').trim(); } catch { return null; }
}

function findHwmonPath(devPath) {
  const hwmon = `${devPath}/hwmon`;
  try {
    for (const entry of fs.readdirSync(hwmon)) {
      const t = readInt(`${hwmon}/${entry}/temp1_input`);
      if (t !== null) return `${hwmon}/${entry}`;
    }
  } catch {}
  return null;
}

async function refreshGpu() {
  const now = Date.now();
  if (refreshInFlight || (cachedGpu && now - lastRefresh < CACHE_TTL)) return;
  refreshInFlight = true;

  try {
    const nvidia = HAS_NVIDIA ? await refreshNvidia() : null;
    if (nvidia) {
      cachedGpu = nvidia;
      lastRefresh = Date.now();
      return;
    }

    const sysfs = collectSysfs();
    if (sysfs) {
      cachedGpu = sysfs;
      lastRefresh = Date.now();
      return;
    }

    cachedGpu = null;
    lastRefresh = Date.now();
  } finally {
    refreshInFlight = false;
  }
}

async function refreshNvidia() {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.current.graphics,clocks.current.memory,power.draw,driver_version --format=csv,noheader,nounits 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 }
    );
    const parts = stdout.trim().split(',').map(s => s.trim());
    if (parts.length >= 5) {
      return {
        available: true,
        vendor: 'nvidia',
        usedPercent: Math.round(parseFloat(parts[0]) * 10) / 10,
        vramUsed: parseFloat(parts[1]) * 1024 * 1024,
        vramTotal: parseFloat(parts[2]) * 1024 * 1024,
        temperature: parseFloat(parts[3]),
        clockGraphics: parseInt(parts[4]),
        clockMemory: parseInt(parts[5] || 0),
        powerDraw: parseFloat((parts[6] || '').trim()) || 0,
        driver: parts[7]?.trim() || '',
      };
    }
  } catch {}
  return null;
}

function collectSysfs() {
  const devPath = findDrmPath();
  if (!devPath) return null;

  const hwmonPath = findHwmonPath(devPath);
  const temp = hwmonPath ? readInt(`${hwmonPath}/temp1_input`) : null;

  const vramTotal = readInt(`${devPath}/mem_info_vram_total`);
  const vramUsed = readInt(`${devPath}/mem_info_vram_used`);
  const vramPercent = vramTotal > 0 ? Math.round((vramUsed / vramTotal) * 100) : 0;

  const gpuBusy = readInt(`${devPath}/gpu_busy_percent`);

  let clockGfx = null;
  let clockMem = null;
  try {
    const dpm = readStr(`${devPath}/pp_dpm_sclk`);
    if (dpm) {
      const lines = dpm.split('\n');
      const active = lines.find(l => l.includes('*'));
      if (active) {
        const match = active.match(/\d+M/);
        if (match) clockGfx = parseInt(match[0]) || 0;
      }
    }
  } catch {}

  let powerDraw = null;
  try {
    const pwr = readStr(`${devPath}/power1_average`);
    if (pwr) powerDraw = parseInt(pwr) / 1000000;
  } catch {}

  const driver = readStr(`${devPath}/driver`) || '';
  const vendor = readStr(`${devPath}/vendor`) || '';

  return {
    available: true,
    vendor: vendor.includes('1002') ? 'amd' : vendor.includes('8086') ? 'intel' : 'unknown',
    usedPercent: gpuBusy ?? 0,
    vramUsed: vramUsed ?? 0,
    vramTotal: vramTotal ?? 0,
    vramUsedPercent: vramPercent,
    temperature: temp !== null ? temp / 1000 : null,
    clockGraphics: clockGfx,
    clockMemory: clockMem,
    powerDraw,
    driver,
    vaapi: fs.existsSync('/dev/dri/renderD128'),
  };
}

export function collect() {
  if (process.env.MONITOR_DISABLE_GPU) return null;
  refreshGpu();
  return cachedGpu;
}

refreshGpu();
