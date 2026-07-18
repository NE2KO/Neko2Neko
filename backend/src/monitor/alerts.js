import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALERTS_FILE = path.join(__dirname, '../../../data/alerts.json');

const defaultThresholds = {
  cpu: { enabled: true, warning: 80, critical: 95 },
  memory: { enabled: true, warning: 85, critical: 95 },
  disk: { enabled: true, warning: 85, critical: 95 },
  temperature: { enabled: true, warning: 75, critical: 85 },
  gpuTemp: { enabled: true, warning: 80, critical: 90 },
};

let alertsCache = null;
let writeTimeout = null;

function loadAlerts() {
  if (alertsCache) return alertsCache;
  try {
    const data = fs.readFileSync(ALERTS_FILE, 'utf8');
    alertsCache = JSON.parse(data);
    return alertsCache;
  } catch {
    alertsCache = { thresholds: { ...defaultThresholds }, history: [] };
    return alertsCache;
  }
}

function flushToDisk() {
  try {
    if (!alertsCache) return;
    fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alertsCache, null, 2));
  } catch {}
}

function debouncedSaveAlerts() {
  if (writeTimeout) clearTimeout(writeTimeout);
  writeTimeout = setTimeout(() => {
    flushToDisk();
    writeTimeout = null;
  }, 5000); // Debounce writes to disk by 5 seconds
}

export function getAlerts() {
  return loadAlerts();
}

export function setThreshold(key, config) {
  const alerts = loadAlerts();
  alerts.thresholds[key] = { ...alerts.thresholds[key], ...config };
  alertsCache = alerts;
  debouncedSaveAlerts();
  return alerts;
}

export function checkAlerts(currentStats) {
  const alerts = loadAlerts();
  const now = new Date().toISOString();
  let triggered = [];

  const cpu = currentStats.cpu;
  const ram = currentStats.ram;
  const disk = currentStats.disk;
  const gpu = currentStats.gpu;

  if (alerts.thresholds.cpu?.enabled && cpu?.usedPercent != null) {
    const val = cpu.usedPercent;
    if (val >= alerts.thresholds.cpu.critical) {
      triggered.push({ type: 'cpu', severity: 'critical', value: val, threshold: alerts.thresholds.cpu.critical, message: `CPU usage at ${val}% (critical: ${alerts.thresholds.cpu.critical}%)`, timestamp: now });
    } else if (val >= alerts.thresholds.cpu.warning) {
      triggered.push({ type: 'cpu', severity: 'warning', value: val, threshold: alerts.thresholds.cpu.warning, message: `CPU usage at ${val}% (warning: ${alerts.thresholds.cpu.warning}%)`, timestamp: now });
    }
  }

  if (alerts.thresholds.memory?.enabled && ram?.usedPercent != null) {
    const val = ram.usedPercent;
    if (val >= alerts.thresholds.memory.critical) {
      triggered.push({ type: 'memory', severity: 'critical', value: val, threshold: alerts.thresholds.memory.critical, message: `Memory usage at ${val}% (critical: ${alerts.thresholds.memory.critical}%)`, timestamp: now });
    } else if (val >= alerts.thresholds.memory.warning) {
      triggered.push({ type: 'memory', severity: 'warning', value: val, threshold: alerts.thresholds.memory.warning, message: `Memory usage at ${val}% (warning: ${alerts.thresholds.memory.warning}%)`, timestamp: now });
    }
  }

  if (alerts.thresholds.disk?.enabled && disk?.main?.usedPercent != null) {
    const val = disk.main.usedPercent;
    if (val >= alerts.thresholds.disk.critical) {
      triggered.push({ type: 'disk', severity: 'critical', value: val, threshold: alerts.thresholds.disk.critical, message: `Disk usage at ${val}% (critical: ${alerts.thresholds.disk.critical}%)`, timestamp: now });
    } else if (val >= alerts.thresholds.disk.warning) {
      triggered.push({ type: 'disk', severity: 'warning', value: val, threshold: alerts.thresholds.disk.warning, message: `Disk usage at ${val}% (warning: ${alerts.thresholds.disk.warning}%)`, timestamp: now });
    }
  }

  if (alerts.thresholds.temperature?.enabled && cpu?.temp?.temp != null) {
    const val = cpu.temp.temp;
    if (val >= alerts.thresholds.temperature.critical) {
      triggered.push({ type: 'cpuTemp', severity: 'critical', value: val, threshold: alerts.thresholds.temperature.critical, message: `CPU temperature at ${val}°C (critical: ${alerts.thresholds.temperature.critical}°C)`, timestamp: now });
    } else if (val >= alerts.thresholds.temperature.warning) {
      triggered.push({ type: 'cpuTemp', severity: 'warning', value: val, threshold: alerts.thresholds.temperature.warning, message: `CPU temperature at ${val}°C (warning: ${alerts.thresholds.temperature.warning}°C)`, timestamp: now });
    }
  }

  if (alerts.thresholds.gpuTemp?.enabled && gpu?.temperature != null) {
    const val = gpu.temperature;
    if (val >= alerts.thresholds.gpuTemp.critical) {
      triggered.push({ type: 'gpuTemp', severity: 'critical', value: val, threshold: alerts.thresholds.gpuTemp.critical, message: `GPU temperature at ${val}°C (critical: ${alerts.thresholds.gpuTemp.critical}°C)`, timestamp: now });
    } else if (val >= alerts.thresholds.gpuTemp.warning) {
      triggered.push({ type: 'gpuTemp', severity: 'warning', value: val, threshold: alerts.thresholds.gpuTemp.warning, message: `GPU temperature at ${val}°C (warning: ${alerts.thresholds.gpuTemp.warning}°C)`, timestamp: now });
    }
  }

  if (triggered.length > 0) {
    const newAlerts = triggered.filter(t => {
      const prev = alerts.history.find(e => e.type === t.type && e.severity === t.severity);
      if (!prev) return true;
      return (new Date(t.timestamp) - new Date(prev.timestamp)) > 60000;
    });
    if (newAlerts.length > 0) {
      alerts.history.unshift(...newAlerts);
      if (alerts.history.length > 200) alerts.history = alerts.history.slice(0, 200);
      alertsCache = alerts;
      debouncedSaveAlerts();
    }
  }

  return triggered;
}
