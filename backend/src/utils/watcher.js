import { watch } from 'node:fs';
import { MEDIA_ROOTS, VIDEO_EXTS } from './fileScanner.js';
import { stmts } from '../db.js';
import { initScannerWorker, startScan, onScannerEvent } from './scannerClient.js';
import { buildThumbCacheAsync, addFile } from './thumbnailQueue.js';

let watchers = [];
let sseClients = [];
let scanTimeout = null;
let periodicInterval = null;
let isScanning = false;
let pendingRescan = false;
let watcherRunning = false;
const STARTUP_GRACE_MS = 30000;
let watcherStartTime = 0;
let useWorker = true;
let workerInitialized = false;

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

function ensureWorkerReady() {
  if (!workerInitialized) {
    try {
      initScannerWorker();
      workerInitialized = true;
    } catch (e) {
      console.warn('[watcher] Scanner worker init failed, falling back to main-thread scan:', e.message);
      useWorker = false;
    }
  }
  return useWorker;
}

async function runScanWithWorker(source) {
  ensureWorkerReady();
  try {
    const result = await startScan(source);
    if (result?.type === 'scan_finished') {
      await buildThumbCacheAsync();
      for (const file of result.newFiles || []) {
        addFile(file.fullPath, file.type);
      }
    }
    return result;
  } catch (e) {
    console.error(`[watcher] Worker scan failed (${source}):`, e.message);
    if (useWorker) {
      useWorker = false;
      console.warn('[watcher] Falling back to main-thread scan');
      return runScanMainThread(source);
    }
    throw e;
  }
}

async function runScanMainThread(source) {
  const { incrementalSync } = await import('./fileScanner.js');
  const result = await incrementalSync();
  if (result) {
    try { buildThumbCache(); } catch {}
  }
  return result;
}

async function runIncrementalScan() {
  if (isScanning) {
    pendingRescan = true;
    return null;
  }
  isScanning = true;
  try {
    const result = useWorker ? await runScanWithWorker('periodic') : await runScanMainThread('periodic');

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

function debouncedRescan(folderPath) {
  if (Date.now() - watcherStartTime < STARTUP_GRACE_MS) return;
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(async () => {
    if (isScanning) { pendingRescan = true; return; }
    isScanning = true;
    try {
      if (useWorker) {
        await runScanWithWorker('watcher');
      } else {
        const { incrementalSync } = await import('./fileScanner.js');
        await incrementalSync();
      }
      if (folderPath) await broadcastFolderUpdate(folderPath);
    } finally {
      isScanning = false;
      if (pendingRescan) { pendingRescan = false; debouncedRescan(); }
    }
  }, 2000);
}

function isVideoFile(filename) { const ext = '.' + filename.split('.').pop().toLowerCase(); return VIDEO_EXTS.has(ext); }

function startWatcher() {
  if (watcherRunning) return;
  watcherRunning = true;
  watcherStartTime = Date.now();
  console.log('[watcher] Starting file watcher on:', MEDIA_ROOTS.join(', '));

  ensureWorkerReady();

  onScannerEvent('scan_progress', (msg) => {
    if (msg.phase) {
      console.log(`[watcher] Worker: ${msg.source} - ${msg.phase}`);
    }
  });

  onScannerEvent('scan_finished', (msg) => {
    console.log(`[watcher] Worker scan finished: ${msg.source}, ${msg.elapsed}ms`);
  });

  onScannerEvent('scan_error', (msg) => {
    console.error('[watcher] Worker scan error:', msg.error);
  });

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
