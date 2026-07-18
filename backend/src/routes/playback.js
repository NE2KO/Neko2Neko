import { Router } from 'express';
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { statfs } from 'node:fs/promises';
import db, { stmts } from '../db.js';
import { getPlaybackStats, getPlaybackConfig, cleanupCache, getActiveJobs, requestShutdown, waitForDrain } from '../utils/playbackEngine.js';
import { isMaintenanceRunning } from '../utils/maintenance.js';
import { createLogger } from '../utils/logger.js';
import { PATHS, SETTINGS } from '../config/paths.js';

const log = createLogger('api');
const router = Router();

const PROBE_CACHE_TTL_MS = 5000;
const probeCache = { ts: 0, ffmpeg: null, ffprobe: null, cacheWritable: null, logsWritable: null, maintenanceRunning: null, diskFreeBytes: null, sqlite: null };

function cachedProbe(key, probeFn) {
  const now = Date.now();
  if (now - probeCache.ts < PROBE_CACHE_TTL_MS && probeCache[key] !== null) return probeCache[key];
  const result = probeFn();
  probeCache[key] = result;
  probeCache.ts = now;
  return result;
}

function probeBinary(name) {
  try {
    const r = spawnSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    if (r.error || r.status !== 0) return { available: false };
    return { available: true, path: r.stdout?.toString().trim() || '/usr/bin/' + name };
  } catch {
    return { available: false };
  }
}

function probeDirWritable(path) {
  try { accessSync(path, constants.W_OK); return { writable: true }; }
  catch (e) { return { writable: false, error: e.code }; }
}

function probeSQLite() {
  try { db.prepare('SELECT 1').get(); return { reachable: true }; }
  catch (e) { return { reachable: false, error: e.message }; }
}

async function probeDisk() {
  try {
    const s = await statfs(PATHS.cacheRoot);
    return { available: true, freeBytes: s.bfree * s.bsize };
  } catch {
    return { available: false };
  }
}

router.get('/stats', (req, res) => {
  try {
    res.json(getPlaybackStats());
  } catch (err) {
    log.error({ msg: 'playback/stats failed', error: err.message });
    res.status(500).json({ error: 'Failed to fetch playback stats' });
  }
});

router.get('/config', (req, res) => {
  try {
    res.json(getPlaybackConfig());
  } catch (err) {
    log.error({ msg: 'playback/config failed', error: err.message });
    res.status(500).json({ error: 'Failed to fetch playback config' });
  }
});

router.get('/health', async (req, res) => {
  const t0 = Date.now();
  try {
    const ffmpeg = cachedProbe('ffmpeg', () => probeBinary('ffmpeg'));
    const ffprobe = cachedProbe('ffprobe', () => probeBinary('ffprobe'));
    const cacheWritable = cachedProbe('cacheWritable', () => probeDirWritable(PATHS.playbackRemux));
    const logsWritable = cachedProbe('logsWritable', () => probeDirWritable(PATHS.logsRoot));
    const sqlite = cachedProbe('sqlite', () => probeSQLite());
    const maintenance = cachedProbe('maintenanceRunning', () => ({ running: isMaintenanceRunning() }));
    const disk = await probeDisk();

    const playbackStats = getPlaybackStats();
    const cacheStats = playbackStats.cache;

    const criticalFailures = [];
    if (!sqlite.reachable) criticalFailures.push('sqlite_unreachable');
    if (!cacheWritable.writable) criticalFailures.push('cache_not_writable');
    if (!logsWritable.writable) criticalFailures.push('logs_not_writable');

    const warnings = [];
    if (!ffmpeg.available) warnings.push('ffmpeg_unavailable');
    if (!ffprobe.available) warnings.push('ffprobe_unavailable');
    if (!maintenance.running) warnings.push('maintenance_not_running');

    let status = 'healthy';
    if (criticalFailures.length > 0) status = 'critical';
    else if (warnings.length > 0) status = 'degraded';

    res.json({
      status,
      version: {
        app: PATHS.appVersion,
        backend: PATHS.backendVersion,
      },
      uptimeMs: playbackStats.uptime,
      startupDurationMs: Date.now() - playbackStats.startTime,
      responseTimeMs: Date.now() - t0,
      checks: { ffmpeg, ffprobe, cacheWritable, logsWritable, sqlite, maintenance, disk },
      cache: {
        ...cacheStats,
        evictions: playbackStats.evictions,
        cleanupCount: playbackStats.cleanupCount,
        oldestCacheEntry: playbackStats.oldestCacheEntry,
        newestCacheEntry: playbackStats.newestCacheEntry,
        largestCachedFile: playbackStats.largestCachedFile,
        smallestCachedFile: playbackStats.smallestCachedFile,
        avgCachedFileSize: playbackStats.avgCachedFileSize,
        activeJobs: getActiveJobs().remux,
      },
      activeJobs: getActiveJobs().remux,
      lastCleanup: playbackStats.lastCleanup,
      nextCleanup: playbackStats.nextCleanup,
      warnings,
      failures: criticalFailures,
    });
  } catch (err) {
    log.error({ msg: 'playback/health failed', error: err.message });
    res.status(503).json({ status: 'critical', error: err.message });
  }
});

router.post('/cleanup', (req, res) => {
  try {
    const result = cleanupCache();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ msg: 'playback/cleanup failed', error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
