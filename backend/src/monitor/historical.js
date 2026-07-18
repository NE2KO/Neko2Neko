import db from '../db.js';
import { get } from '../utils/runtimeSettings.js';

let insertSnapshotStmt = null;
let queryHistoryStmt = null;
let queryAggSql = null;
let queryDiskIoSql = null;
let getTotalDiskIoStmt = null;

const METRIC_COLS = [
  'cpu_used', 'cpu_user', 'cpu_sys', 'cpu_iowait', 'cpu_temp',
  'ram_used', 'ram_total', 'ram_percent', 'swap_used', 'swap_total',
  'gpu_used', 'gpu_vram_used', 'gpu_vram_total', 'gpu_temp',
  'disk_used', 'disk_total', 'disk_percent',
  'net_rx', 'net_tx',
  'load_1m', 'load_5m', 'load_15m',
  'disk_io_read', 'disk_io_write',
];

const BATCH_SIZE = 5000;
const VALID_RETENTION_DAYS = [0, 7, 14, 30, 90, 180, 365];

let cleanupState = {
  lastCleanup: null,
  nextCleanup: null,
  lastRowsDeleted: 0,
  lastDurationMs: 0,
  lastRetentionDays: 7,
};

function ensureStmts() {
  if (insertSnapshotStmt) return;
  insertSnapshotStmt = db.prepare(`INSERT INTO historical_metrics (
    timestamp, cpu_used, cpu_user, cpu_sys, cpu_iowait, cpu_temp,
    ram_used, ram_total, ram_percent,
    swap_used, swap_total,
    gpu_used, gpu_vram_used, gpu_vram_total, gpu_temp,
    disk_used, disk_total, disk_percent,
    net_rx, net_tx,
    load_1m, load_5m, load_15m,
    disk_io_read, disk_io_write
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  queryHistoryStmt = db.prepare(`
    SELECT * FROM historical_metrics WHERE timestamp >= ? ORDER BY timestamp ASC
  `);

  const avgCols = METRIC_COLS.map(c => `AVG(${c}) AS ${c}`).join(', ');
  queryAggSql = `
    SELECT (timestamp / (? * 1000)) * (? * 1000) AS ts, ${avgCols}
    FROM historical_metrics WHERE timestamp >= ? GROUP BY ts ORDER BY ts ASC
  `;

  queryDiskIoSql = `
    SELECT
      date(timestamp / 1000, 'unixepoch', 'localtime') AS day,
      AVG(disk_io_read) AS avg_read,
      AVG(disk_io_write) AS avg_write,
      SUM(disk_io_read) AS total_read,
      SUM(disk_io_write) AS total_write,
      COUNT(*) AS samples
    FROM historical_metrics
    WHERE timestamp >= ? AND disk_io_read IS NOT NULL
    GROUP BY day ORDER BY day ASC
  `;

  getTotalDiskIoStmt = db.prepare(`
    SELECT
      SUM(disk_io_read) AS total_read_bytes,
      SUM(disk_io_write) AS total_write_bytes,
      COUNT(*) AS total_samples
    FROM historical_metrics WHERE disk_io_read IS NOT NULL
  `);
}

export function getRetentionMs() {
  const raw = get('retention.historyDays', 7);
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) return 7 * 86400000;
  if (days === 0) return 0;
  if (!VALID_RETENTION_DAYS.includes(Math.floor(days))) return 7 * 86400000;
  return Math.floor(days) * 86400000;
}

export function getRetentionDays() {
  return Math.round(getRetentionMs() / 86400000);
}

export function validateRetentionDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored === 0) return 0;
  if (VALID_RETENTION_DAYS.includes(floored)) return floored;
  return null;
}

export function getCleanupState() {
  return { ...cleanupState };
}

function setCleanupState(patch) {
  Object.assign(cleanupState, patch);
}

function getDbSizeBytes() {
  try {
    const row = db.prepare('SELECT page_count AS pc, page_size AS ps FROM pragma_page_count(), pragma_page_size()').get();
    return (row?.pc || 0) * (row?.ps || 0);
  } catch { return 0; }
}

export function initHistoricalTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      cpu_used REAL, cpu_user REAL, cpu_sys REAL, cpu_iowait REAL, cpu_temp REAL,
      ram_used REAL, ram_total REAL, ram_percent REAL,
      swap_used REAL, swap_total REAL,
      gpu_used REAL, gpu_vram_used REAL, gpu_vram_total REAL, gpu_temp REAL,
      disk_used REAL, disk_total REAL, disk_percent REAL,
      net_rx REAL, net_tx REAL,
      load_1m REAL, load_5m REAL, load_15m REAL,
      disk_io_read REAL, disk_io_write REAL
    );
    CREATE INDEX IF NOT EXISTS idx_historical_ts ON historical_metrics(timestamp);
  `);
  try { db.prepare('ALTER TABLE historical_metrics ADD COLUMN disk_io_read REAL').run(); } catch {}
  try { db.prepare('ALTER TABLE historical_metrics ADD COLUMN disk_io_write REAL').run(); } catch {}
  ensureStmts();
}

export function recordSnapshot(stats) {
  ensureStmts();
  const ts = Date.now();
  const cpu = stats.cpu || {};
  const ram = stats.ram || {};
  const gpu = stats.gpu || {};
  const disk = stats.disk?.main || {};
  const net = stats.network?.total || {};
  const load = cpu.loadAvg || {};
  const ioEntries = Object.values(stats.disk?.io || {});
  const primaryIo = ioEntries[0] || {};

  try {
    insertSnapshotStmt.run(
      ts,
      cpu.usedPercent ?? null, cpu.userPercent ?? null, cpu.sysPercent ?? null, cpu.iowaitPercent ?? null, cpu.temp?.temp ?? null,
      ram.used ?? null, ram.total ?? null, ram.usedPercent ?? null,
      ram.swap?.used ?? null, ram.swap?.total ?? null,
      gpu.usedPercent ?? null, gpu.vramUsed ?? null, gpu.vramTotal ?? null, gpu.temperature ?? null,
      disk.used ?? null, disk.total ?? null, disk.usedPercent ?? null,
      net.rxSpeed ?? null, net.txSpeed ?? null,
      load['1min'] ?? null, load['5min'] ?? null, load['15min'] ?? null,
      primaryIo.readBytes ?? null, primaryIo.writeBytes ?? null
    );
  } catch (err) {
    console.error('[metrics] Failed to record snapshot:', err.message);
  }
}

export function queryHistory(range = '1h') {
  ensureStmts();
  const now = Date.now();
  const ranges = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
  const since = now - (ranges[range] || 3600000);

  try {
    const rows = queryHistoryStmt.all(since);
    return (rows || []).map(r => ({
      ts: r.timestamp,
      cpu: { used: r.cpu_used, user: r.cpu_user, sys: r.cpu_sys, iowait: r.cpu_iowait, temp: r.cpu_temp },
      ram: { used: r.ram_used, total: r.ram_total, percent: r.ram_percent, swapUsed: r.swap_used, swapTotal: r.swap_total },
      gpu: { used: r.gpu_used, vramUsed: r.gpu_vram_used, vramTotal: r.gpu_vram_total, temp: r.gpu_temp },
      disk: { used: r.disk_used, total: r.disk_total, percent: r.disk_percent },
      diskIo: { readBytes: r.disk_io_read, writeBytes: r.disk_io_write },
      net: { rx: r.net_rx, tx: r.net_tx },
      load: { '1m': r.load_1m, '5m': r.load_5m, '15m': r.load_15m },
    }));
  } catch (err) {
    console.error('[metrics] Failed to query history:', err.message);
    return [];
  }
}

export function cleanupOldMetrics() {
  ensureStmts();
  const retentionMs = getRetentionMs();
  if (retentionMs === 0) {
    console.log('[metrics-cleanup] Retention is unlimited, skipping cleanup');
    return { rowsDeleted: 0, durationMs: 0, sizeBefore: 0, sizeAfter: 0, retentionDays: 0 };
  }

  const retentionDays = Math.round(retentionMs / 86400000);
  const cutoff = Date.now() - retentionMs;
  const sizeBefore = getDbSizeBytes();
  const start = Date.now();

  console.log(`[metrics-cleanup] Starting cleanup (retention: ${retentionDays} days)`);

  let totalDeleted = 0;
  try {
    const countRow = db.prepare('SELECT COUNT(*) AS c FROM historical_metrics WHERE timestamp < ?').get(cutoff);
    const toDelete = countRow?.c || 0;

    if (toDelete === 0) {
      const duration = Date.now() - start;
      console.log(`[metrics-cleanup] No rows to delete (took ${duration}ms)`);
      setCleanupState({
        lastCleanup: Date.now(),
        lastRowsDeleted: 0,
        lastDurationMs: duration,
        lastRetentionDays: retentionDays,
      });
      return { rowsDeleted: 0, durationMs: duration, sizeBefore, sizeAfter: sizeBefore, retentionDays };
    }

    console.log(`[metrics-cleanup] ${toDelete} rows to delete, processing in batches of ${BATCH_SIZE}`);

    let deleted = 0;
    while (deleted < toDelete) {
      const result = db.prepare(
        'DELETE FROM historical_metrics WHERE id IN (SELECT id FROM historical_metrics WHERE timestamp < ? ORDER BY id LIMIT ?)'
      ).run(cutoff, BATCH_SIZE);
      const batchDeleted = result.changes;
      if (batchDeleted === 0) break;
      deleted += batchDeleted;
    }

    totalDeleted = deleted;
    const duration = Date.now() - start;
    const sizeAfter = getDbSizeBytes();

    console.log(`[metrics-cleanup] Deleted ${totalDeleted.toLocaleString()} rows in ${(duration / 1000).toFixed(1)}s (DB: ${(sizeBefore / 1024 / 1024).toFixed(1)}MB → ${(sizeAfter / 1024 / 1024).toFixed(1)}MB)`);
    console.log(`[metrics-cleanup] Cleanup complete`);

    setCleanupState({
      lastCleanup: Date.now(),
      lastRowsDeleted: totalDeleted,
      lastDurationMs: duration,
      lastRetentionDays: retentionDays,
    });

    return { rowsDeleted: totalDeleted, durationMs: duration, sizeBefore, sizeAfter, retentionDays };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[metrics-cleanup] Failed: ${err.message} (deleted ${totalDeleted} rows before failure, ${duration}ms)`);
    setCleanupState({
      lastCleanup: Date.now(),
      lastRowsDeleted: totalDeleted,
      lastDurationMs: duration,
      lastRetentionDays: retentionDays,
    });
    return { rowsDeleted: totalDeleted, durationMs: duration, sizeBefore, sizeAfter: getDbSizeBytes(), retentionDays, error: err.message };
  }
}

export function getMetricsStats() {
  ensureStmts();
  try {
    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM historical_metrics').get();
    const oldestRow = db.prepare('SELECT MIN(timestamp) AS ts FROM historical_metrics').get();
    const newestRow = db.prepare('SELECT MAX(timestamp) AS ts FROM historical_metrics').get();
    const dayAgo = Date.now() - 86400000;
    const dailyRow = db.prepare('SELECT COUNT(*) AS c FROM historical_metrics WHERE timestamp >= ?').get(dayAgo);
    const sizeBytes = getDbSizeBytes();
    const dailyGrowth = dailyRow?.c || 0;
    const monthlyGrowthMb = (dailyGrowth * 30 * 527 / 1024 / 1024);

    const state = getCleanupState();
    const nextCleanup = state.lastCleanup ? state.lastCleanup + 86400000 : null;

    return {
      totalRows: totalRow?.c || 0,
      oldestTs: oldestRow?.ts || null,
      newestTs: newestRow?.ts || null,
      estimatedSizeMb: Math.round(sizeBytes / 1024 / 1024 * 10) / 10,
      dailyGrowth,
      monthlyGrowthMb: Math.round(monthlyGrowthMb * 10) / 10,
      retentionDays: getRetentionDays(),
      retentionUnlimited: getRetentionMs() === 0,
      lastCleanup: state.lastCleanup,
      nextCleanup,
      lastRowsDeleted: state.lastRowsDeleted,
      lastDurationMs: state.lastDurationMs,
      lastRetentionDays: state.lastRetentionDays,
    };
  } catch (err) {
    console.error('[metrics] Failed to get stats:', err.message);
    return { totalRows: 0, oldestTs: null, newestTs: null, estimatedSizeMb: 0, dailyGrowth: 0, monthlyGrowthMb: 0, retentionDays: 7, retentionUnlimited: false, lastCleanup: null, nextCleanup: null, lastRowsDeleted: 0, lastDurationMs: 0, error: err.message };
  }
}

export function optimizeMetricsTable() {
  ensureStmts();
  const sizeBefore = getDbSizeBytes();
  const start = Date.now();
  console.log(`[metrics-optimize] Running PRAGMA optimize (size: ${(sizeBefore / 1024 / 1024).toFixed(1)}MB)`);
  try {
    db.pragma('optimize');
    const duration = Date.now() - start;
    const sizeAfter = getDbSizeBytes();
    console.log(`[metrics-optimize] Optimize complete (took ${(duration / 1000).toFixed(1)}s, ${(sizeBefore / 1024 / 1024).toFixed(1)}MB → ${(sizeAfter / 1024 / 1024).toFixed(1)}MB)`);
    return { sizeBefore, sizeAfter, durationMs: duration };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[metrics-optimize] Failed: ${err.message} (${duration}ms)`);
    return { sizeBefore, sizeAfter: sizeBefore, durationMs: duration, error: err.message };
  }
}

export function vacuumMetricsTable() {
  ensureStmts();
  const sizeBefore = getDbSizeBytes();
  const start = Date.now();
  console.log(`[metrics-vacuum] Running VACUUM (size: ${(sizeBefore / 1024 / 1024).toFixed(1)}MB)`);
  try {
    db.pragma('VACUUM');
    const duration = Date.now() - start;
    const sizeAfter = getDbSizeBytes();
    console.log(`[metrics-vacuum] VACUUM complete (took ${(duration / 1000).toFixed(1)}s, ${(sizeBefore / 1024 / 1024).toFixed(1)}MB → ${(sizeAfter / 1024 / 1024).toFixed(1)}MB)`);
    return { sizeBefore, sizeAfter, durationMs: duration };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[metrics-vacuum] Failed: ${err.message} (${duration}ms)`);
    return { sizeBefore, sizeAfter: sizeBefore, durationMs: duration, error: err.message };
  }
}

const RANGE_CONFIG = {
  '1h':  { ms: 3600000,     bucket: 5000,       label: '5s' },
  '6h':  { ms: 21600000,    bucket: 60000,      label: '1m' },
  '12h': { ms: 43200000,    bucket: 120000,     label: '2m' },
  '24h': { ms: 86400000,    bucket: 300000,     label: '5m' },
  '3d':  { ms: 259200000,   bucket: 900000,     label: '15m' },
  '7d':  { ms: 604800000,   bucket: 3600000,    label: '1h' },
  '30d': { ms: 2592000000,  bucket: 14400000,   label: '4h' },
};

const aggCache = new Map();
const AGG_CACHE_TTL = 15000;

export function queryHistoryAggregated(range = '1h') {
  ensureStmts();
  const config = RANGE_CONFIG[range] || RANGE_CONFIG['1h'];
  const now = Date.now();
  const since = now - config.ms;

  try {
    if (config.bucket <= 5000) return queryHistory(range);

    const cacheKey = range + ':' + Math.floor(now / AGG_CACHE_TTL);
    const cached = aggCache.get(cacheKey);
    if (cached) return cached;

    const bucketSec = Math.floor(config.bucket / 1000);
    const rows = db.prepare(queryAggSql).all(bucketSec, bucketSec, since);

    const result = (rows || []).map(r => ({
      ts: r.ts,
      cpu: { used: r.cpu_used, user: r.cpu_user, sys: r.cpu_sys, iowait: r.cpu_iowait, temp: r.cpu_temp },
      ram: { used: r.ram_used, total: r.ram_total, percent: r.ram_percent, swapUsed: r.swap_used, swapTotal: r.swap_total },
      gpu: { used: r.gpu_used, vramUsed: r.gpu_vram_used, vramTotal: r.gpu_vram_total, temp: r.gpu_temp },
      disk: { used: r.disk_used, total: r.disk_total, percent: r.disk_percent },
      diskIo: { readBytes: r.disk_io_read, writeBytes: r.disk_io_write },
      net: { rx: r.net_rx, tx: r.net_tx },
      load: { '1m': r.load_1m, '5m': r.load_5m, '15m': r.load_15m },
    }));

    aggCache.set(cacheKey, result);
    if (aggCache.size > 20) {
      const oldest = aggCache.keys().next().value;
      aggCache.delete(oldest);
    }

    return result;
  } catch (err) {
    console.error('[metrics] Failed to query aggregated history:', err.message);
    return [];
  }
}

export function queryDiskIoDailySummary(days = 7) {
  ensureStmts();
  const since = Date.now() - days * 86400000;
  const snapshotIntervalSec = 30;
  try {
    const rows = db.prepare(queryDiskIoSql).all(since);
    return rows.map(r => ({
      day: r.day,
      avgReadBytesPerSec: r.total_read / (r.samples * snapshotIntervalSec),
      avgWriteBytesPerSec: r.total_write / (r.samples * snapshotIntervalSec),
      totalReadBytes: r.total_read,
      totalWriteBytes: r.total_write,
      samples: r.samples,
    }));
  } catch (err) {
    console.error('[metrics] Failed to query disk I/O daily summary:', err.message);
    return [];
  }
}

export function getTotalDiskIo() {
  ensureStmts();
  try {
    const row = getTotalDiskIoStmt.get();
    return {
      totalReadBytes: row?.total_read_bytes || 0,
      totalWriteBytes: row?.total_write_bytes || 0,
      totalSamples: row?.total_samples || 0,
      sinceHours: row?.total_samples ? Math.round(row.total_samples * 30 / 3600) : 0,
    };
  } catch (err) {
    console.error('[metrics] Failed to query total disk I/O:', err.message);
    return { totalReadBytes: 0, totalWriteBytes: 0, totalSamples: 0, sinceHours: 0 };
  }
}
