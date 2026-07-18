import { watch, stat } from 'node:fs';
import { join } from 'node:path';
import { MEDIA_ROOTS, VIDEO_EXTS, incrementalSync, resolveFullPath } from './fileScanner.js';
import db, { stmts, updateAllRecursiveCounts } from '../db.js';
import { THUMBNAIL_DIR } from './thumbnailUtils.js';
import { existsSync } from 'node:fs';

let watchers = [];
let sseClients = [];
let scanTimeout = null;
let periodicInterval = null;
let isScanning = false;
let pendingRescan = false;
let watcherRunning = false;
const STARTUP_GRACE_MS = 30000;
let watcherStartTime = 0;

async function broadcastFolderUpdate(folderPath) {
  const msg = `data: ${JSON.stringify({
    type: 'folder_updated',
    path: folderPath || '',
    timestamp: Date.now()
  })}\n\n`;
  sseClients = sseClients.filter((res) => {
    try {
      res.write(msg);
      return true;
    } catch {
      return false;
    }
  });
}

function debouncedRescan(folderPath) {
  if (Date.now() - watcherStartTime < STARTUP_GRACE_MS) return;
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(async () => {
    if (isScanning) { pendingRescan = true; return; }
    isScanning = true;
    try {
      await incrementalSync();
      if (folderPath) await broadcastFolderUpdate(folderPath);
    } finally {
      isScanning = false;
      if (pendingRescan) { pendingRescan = false; debouncedRescan(); }
    }
  }, 2000);
}

async function runIncrementalScan() {
  isScanning = true;
  try {
    const result = await incrementalSync();

    // Recursive counts update runs in background — never blocks SSE broadcast
    updateAllRecursiveCountsAsync().then((updated) => {
      console.log(`[watcher] Recursive counts updated for ${updated} folders`);
    }).catch((err) => {
      console.error('[watcher] Recursive count update failed:', err);
    });

    const stats = stmts.countFilesByType.all();
    const total = stats.reduce((sum, s) => sum + s.count, 0);
    const statsMsg = `data: ${JSON.stringify({ type: 'stats_updated', data: { total, videos: stats.find((s) => s.type === 'video')?.count || 0, audio: stats.find((s) => s.type === 'audio')?.count || 0, images: stats.find((s) => s.type === 'image')?.count || 0 } })}\n\n`;
    sseClients = sseClients.filter((res) => { try { res.write(statsMsg); return true; } catch { return false; } });
    await broadcastFolderUpdate('');
    return result;
  } catch (err) {
    console.error('[watcher] Scan error:', err);
    return null;
  } finally {
    isScanning = false;
    if (pendingRescan) { pendingRescan = false; await runIncrementalScan(); }
  }
}

async function updateAllRecursiveCountsAsync() {
  await new Promise(r => setImmediate(r));
  return updateAllRecursiveCounts();
}

function isVideoFile(filename) { const ext = '.' + filename.split('.').pop().toLowerCase(); return VIDEO_EXTS.has(ext); }

function startWatcher() {
  if (watcherRunning) return;
  watcherRunning = true;
  watcherStartTime = Date.now();
  console.log('[watcher] Starting file watcher on:', MEDIA_ROOTS.join(', '));

  for (const root of MEDIA_ROOTS) {
    try {
      const w = watch(root, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.startsWith('.')) {
          debouncedRescan();
        }
      });
      w.on('error', (err) => { console.error(`[watcher] Error watching ${root}:`, err.message); });
      watchers.push(w);
    } catch (err) { console.error(`[watcher] Failed to watch ${root}:`, err.message); }
  }

  // Stagger first periodic scan to 6 minutes to avoid competing with initial server boot scan
  periodicInterval = setInterval(async () => {
    await runIncrementalScan();
  }, 15 * 60 * 1000);
  setTimeout(() => runIncrementalScan().catch(() => {}), 6 * 60 * 1000);
}

function stopWatcher() {
  if (!watcherRunning) return;
  watcherRunning = false;
  console.log('[watcher] Stopping file watcher...');

  for (const w of watchers) {
    try { w.close(); } catch {}
  }
  watchers = [];

  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }

  if (scanTimeout) {
    clearTimeout(scanTimeout);
    scanTimeout = null;
  }

  console.log('[watcher] File watcher stopped');
}

function isWatcherRunning() {
  return watcherRunning;
}

function addSseClient(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  const stats = stmts.countFilesByType.all();
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  res.write(`data: ${JSON.stringify({ type: 'stats_updated', data: { total, videos: stats.find((s) => s.type === 'video')?.count || 0, audio: stats.find((s) => s.type === 'audio')?.count || 0, images: stats.find((s) => s.type === 'image')?.count || 0 } })}\n\n`);
  const onClose = () => { sseClients = sseClients.filter((c) => c !== res); };
  res.on('close', onClose);
}

export function getWatcherStatus() {
  return { isScanning, pendingRescan };
}

export { startWatcher, stopWatcher, isWatcherRunning, addSseClient, runIncrementalScan, debouncedRescan, broadcastFolderUpdate };
