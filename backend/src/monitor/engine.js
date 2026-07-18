import { collect as collectCpu } from './collectors/cpu.js';
import { collect as collectMemory } from './collectors/memory.js';
import { collect as collectGpu } from './collectors/gpu.js';
import { collect as collectDisk } from './collectors/disk.js';
import { collect as collectNetwork } from './collectors/network.js';
import { collect as collectSystem } from './collectors/system.js';
import { broadcast } from './websocket.js';
import { recordSnapshot, queryHistory, queryHistoryAggregated, cleanupOldMetrics } from './historical.js';
import { checkAlerts } from './alerts.js';
import { get } from '../utils/runtimeSettings.js';
import { getQueueStatus as getThumbQueueStatus } from '../utils/thumbnailQueue.js';

function ts() {
  return new Date().toISOString().slice(11, 23);
}

let intervalId = null;
let collecting = false;
let currentStats = {};
let pollIntervalMs = 3000;
const HISTORY_INTERVAL = 30000;
let historyTick = 0;
let lastBroadcastTime = 0;
const BROADCAST_THROTTLE_MS = 3000;

export function getCurrentStats() {
  return currentStats;
}

const COLLECTOR_TIMEOUT = 3000; // Max 3s per collector

async function collectAll() {
  if (collecting) return;
  collecting = true;
  try {
    const collectors = {
      cpu: collectCpu,
      ram: collectMemory,
      gpu: collectGpu,
      disk: collectDisk,
      network: collectNetwork,
      system: collectSystem,
    };

    const results = [];
    for (const [key, fn] of Object.entries(collectors)) {
      try {
        const result = await Promise.race([
          Promise.resolve(fn()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), COLLECTOR_TIMEOUT)
          ),
        ]);
        results.push({ key, result });
      } catch {
        results.push({ key, result: null });
      }
      await new Promise(r => setImmediate(r));
    }

    const stats = { timestamp: Date.now() };
    for (const res of results) {
      stats[res.key] = res.result;
    }
    try {
      stats.thumbnails = getThumbQueueStatus();
    } catch {
      stats.thumbnails = null;
    }
    currentStats = stats;

    let alerts = [];
    try {
      alerts = checkAlerts(currentStats);
    } catch (err) {
      console.error('[monitor] Alert check failed:', err.message);
    }

    const now = Date.now();
    if (now - lastBroadcastTime >= BROADCAST_THROTTLE_MS) {
      lastBroadcastTime = now;
      try {
        broadcast({ type: 'stats', data: currentStats, alerts });
      } catch (err) {
        console.error('[monitor] Broadcast failed:', err.message);
      }
    }

    historyTick++;
    if (historyTick * pollIntervalMs >= HISTORY_INTERVAL) {
      try { recordSnapshot(currentStats); } catch (err) { console.error('[monitor] Snapshot failed:', err.message); }
      historyTick = 0;
    }
  } finally {
    collecting = false;
  }
}

function clampInterval(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 1000;
  return Math.max(250, Math.min(Math.round(n), 60000));
}

export function setPollInterval(ms) {
  const next = clampInterval(ms);
  if (next === pollIntervalMs) return { intervalMs: pollIntervalMs };
  pollIntervalMs = next;
  historyTick = 0;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = setInterval(collectAll, pollIntervalMs);
  }
  console.log(`[monitor] Engine poll interval set to ${pollIntervalMs}ms`);
  return { intervalMs: pollIntervalMs };
}

export function getPollInterval() { return pollIntervalMs; }

export function startEngine(httpServer) {
  pollIntervalMs = clampInterval(get('monitor.refreshInterval', 3000));
  intervalId = setInterval(collectAll, pollIntervalMs);
  // Set timestamp immediately so /api/ready returns ready without waiting for first collectAll()
  currentStats = { timestamp: Date.now() };
  collectAll().catch(e => console.error('[engine] First poll failed:', e));
  console.log(`[monitor] ${ts()} Engine started (poll every ${pollIntervalMs}ms)`);
}

export function stopEngine() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  console.log('[monitor] Engine stopped');
}

export function restartEngine(httpServer) {
  stopEngine();
  return startEngine(httpServer);
}

export function getEngineStatus() {
  return {
    running: intervalId !== null,
    intervalMs: pollIntervalMs,
    lastStats: currentStats.timestamp ? new Date(currentStats.timestamp).toISOString() : null,
  };
}

export function getHistory(range = '1h') {
  return queryHistory(range);
}

export function getHistoryAggregated(range = '1h') {
  return queryHistoryAggregated(range);
}

export function runCleanup() {
  cleanupOldMetrics();
}
