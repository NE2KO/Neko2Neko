import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, promises as fsPromises } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SENSORS_CACHE = '/tmp/homelab_sensors.json';
const SENSORS_WORKER = join(__dirname, '..', 'sensors-worker.mjs');
const MANUAL_FLAG = '/tmp/nbfc_fan_manual';
const FAN_STATE = '/tmp/nbfc_fan_state';
const MAX_UPTIME_FILE = join(__dirname, '..', '..', '..', 'data', 'max-uptime.json');

function scanBootHistory() {
  try {
    const out = require('node:child_process').execSync('last -x reboot 2>/dev/null').toString();
    let maxSec = 0;
    for (const line of out.split('\n')) {
      const m = line.match(/\((\d+)\+(\d+):(\d+)\)/);
      if (!m) continue;
      const total = parseInt(m[1]) * 86400 + parseInt(m[2]) * 3600 + parseInt(m[3]) * 60;
      if (total > maxSec) maxSec = total;
    }
    if (maxSec > 0) return maxSec;
  } catch {}
  try {
    return Math.floor(parseFloat(readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]));
  } catch { return 0; }
}

function loadMaxUptime() {
  try {
    const raw = readFileSync(MAX_UPTIME_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (typeof data === 'number') return { web: 0, host: data };
    if (data && typeof data.web === 'number' && typeof data.host === 'number') {
      return { web: data.web, host: data.host };
    }
  } catch {}
  return { web: 0, host: scanBootHistory() };
}

function saveMaxUptime(obj) {
  try { writeFileSync(MAX_UPTIME_FILE, JSON.stringify(obj)); } catch {}
}

export const cache = {
  sensors: {},
  cpuFreq: { current: null, max: null, min: null, hardwareMax: null },
  fan: { available: false, mode: null, speed: null },
  battery: { available: false, percent: null, status: null },
  media: null,
  maxUptime: loadMaxUptime(),
};

async function refreshUptimeMax() {
  try {
    const webSec = Math.floor(process.uptime());
    const data = await fsPromises.readFile('/proc/uptime', 'utf8');
    const hostSec = Math.floor(parseFloat(data.split(/\s+/)[0]));
    let changed = false;
    if (webSec > cache.maxUptime.web) { cache.maxUptime.web = webSec; changed = true; }
    if (hostSec > cache.maxUptime.host) { cache.maxUptime.host = hostSec; changed = true; }
    if (changed) saveMaxUptime(cache.maxUptime);
  } catch {}
}

// ─── Sensor refresh (detached child process — sysfs D-safe) ───
function refreshSensors() {
  try {
    const child = spawn('node', [SENSORS_WORKER], { stdio: 'ignore', detached: true, timeout: 3000 });
    child.unref();
    setTimeout(() => {
      try { cache.sensors = JSON.parse(readFileSync(SENSORS_CACHE, 'utf8')); } catch {}
    }, 1500);
  } catch {}
}

// ─── CPU freq refresh (child process — /sys D-safe) ───
function refreshCpuFreq() {
  const script = `process.stdout.write(JSON.stringify((()=>{try{const r={};r.current=Math.round(parseInt(require('fs').readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq','utf8'))/1e3);r.max=Math.round(parseInt(require('fs').readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq','utf8'))/1e3);r.min=Math.round(parseInt(require('fs').readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq','utf8'))/1e3);r.hardwareMax=Math.round(parseInt(require('fs').readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq','utf8'))/1e3);return r}catch{return{current:null,max:null,min:null,hardwareMax:null}}})()))`;
  try {
    const child = spawn('node', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    let data = '';
    child.stdout.on('data', d => { data += d; });
    child.on('close', () => { try { cache.cpuFreq = JSON.parse(data); } catch {} });
    child.unref();
  } catch {}
}

// ─── Fan refresh (tmpfs reads, safe from main thread) ───
async function refreshFan() {
  try {
    const nbfcPath = '/usr/bin/nbfc';
    const nbfcLocalPath = '/usr/local/bin/nbfc';
    const [nbfcExists, nbfcLocalExists] = await Promise.all([
      fsPromises.access(nbfcPath).then(() => true).catch(() => false),
      fsPromises.access(nbfcLocalPath).then(() => true).catch(() => false),
    ]);
    const fan = { available: nbfcExists || nbfcLocalExists, mode: null, speed: null };
    try {
      const state = (await fsPromises.readFile(FAN_STATE, 'utf8')).trim();
      const isManual = existsSync(MANUAL_FLAG);
      fan.mode = isManual ? 'manual' : (state === 'auto' ? 'auto' : 'manual');
      fan.speed = state === 'auto' ? null : parseInt(state) || null;
    } catch {}
    cache.fan = fan;
  } catch {}
}

// ─── Battery refresh (sysfs reads) ───
async function refreshBattery() {
  try {
    const batPath = '/sys/class/power_supply/BAT1';
    const capacity = (await fsPromises.readFile(`${batPath}/capacity`, 'utf8')).trim();
    const status = (await fsPromises.readFile(`${batPath}/status`, 'utf8')).trim();
    cache.battery = { available: true, percent: parseInt(capacity) || null, status };
  } catch {
    cache.battery = { available: false, percent: null, status: null };
  }
}

// Keep thumbnail onDisk count from last scan — updated by thumbnailQueue on success/failure
async function refreshMedia(stmts, dbModule, thumbDir, dbPath) {
  try {
    const combined = dbModule.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(CASE WHEN has_thumb = 1 THEN 1 ELSE 0 END) as with_thumbs,
        SUM(CASE WHEN has_thumb = 0 OR has_thumb IS NULL THEN 1 ELSE 0 END) as without_thumbs,
        SUM(CASE WHEN has_thumb = 2 THEN 1 ELSE 0 END) as skipped
      FROM files
      GROUP BY type
    `).all();
    const totalFiles = combined.reduce((sum, r) => sum + r.count, 0);
    const filesWithThumbs = combined.reduce((sum, r) => sum + r.with_thumbs, 0);
    const filesWithoutThumbs = combined.reduce((sum, r) => sum + r.without_thumbs, 0);
    const filesSkipped = combined.reduce((sum, r) => sum + r.skipped, 0);
    const byType = combined.map(r => ({ type: r.type, count: r.count }));

    let dbSize = 0, walSize = 0;
    try { dbSize = (await fsPromises.stat(dbPath)).size; } catch {}
    try { walSize = (await fsPromises.stat(dbPath + '-wal')).size; } catch {}

    cache.media = {
      totalFiles,
      videos: byType.find(s => s.type === 'video')?.count || 0,
      audio: byType.find(s => s.type === 'audio')?.count || 0,
      images: byType.find(s => s.type === 'image')?.count || 0,
      other: byType.find(s => s.type === 'other')?.count || 0,
      thumbnails: {
        onDisk: filesWithThumbs,
        inDb: filesWithThumbs,
        missing: filesWithoutThumbs,
        skipped: filesSkipped,
      },
      database: { size: dbSize, walSize, total: dbSize + walSize },
      updatedAt: Date.now(),
    };
  } catch {}
}

// ─── Start all background refresh loops ───
export function startMonitoringCache(stmts, dbModule) {
  const thumbDir = join(__dirname, '..', '..', '..', 'data', 'thumbnails');
  const dbPath = join(__dirname, '..', '..', '..', 'data', 'media.db');

  refreshSensors();
  refreshCpuFreq();
  refreshFan();
  refreshBattery();
  refreshMedia(stmts, dbModule, thumbDir, dbPath);
  refreshUptimeMax();

  setInterval(refreshSensors, 30000);
  setInterval(refreshCpuFreq, 15000);
  setInterval(refreshFan, 15000);
  setInterval(refreshBattery, 15000);
  setInterval(() => refreshMedia(stmts, dbModule, thumbDir, dbPath), 15000);
  setInterval(refreshUptimeMax, 10000);

  console.log('[monitoringCache] Background refresh started');
}

export { refreshUptimeMax };
