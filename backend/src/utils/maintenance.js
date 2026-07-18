import { rmSync, promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { resolveFullPath, enrichDurationsBatch, enrichMetadataBatch } from './fileScanner.js';
import { THUMBNAIL_DIR } from './thumbnailUtils.js';
import db, { stmts } from '../db.js';
import { cleanupOldMetrics } from '../monitor/historical.js';
import { cleanupCache as cleanupPlaybackCache } from './playbackEngine.js';
import { PATHS, SETTINGS } from '../config/paths.js';
import { createLogger } from './logger.js';

const log = createLogger('maintenance');

async function cleanupOrphanEntries() {
  log.info({ msg: 'Checking for orphan entries' });
  let deleted = 0;
  const now = Date.now();
  const orphanIds = [];
  const foldersCache = new Map();
  const getFolderStmt = db.prepare('SELECT id, path FROM folders WHERE id = ?');
  const selectFilesStmt = db.prepare('SELECT id, dir_id, name, size, ext FROM files LIMIT 5000 OFFSET ?');
  const deleteFileStmt = db.prepare('DELETE FROM files WHERE id = ?');
  const deltaDecStmt = stmts.deltaDecrementFolder;

  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const files = selectFilesStmt.all(offset);
    hasMore = files.length === 5000;
    offset += 5000;
    const BATCH = 50;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      await Promise.all(batch.map(async (file) => {
        let folder = foldersCache.get(file.dir_id);
        if (!folder) {
          folder = getFolderStmt.get(file.dir_id);
          if (folder) foldersCache.set(file.dir_id, folder);
        }
        if (!folder) {
          orphanIds.push({ id: file.id, size: file.size, dir_id: file.dir_id });
          return;
        }
        const relPath = folder.path ? join(folder.path, file.name) : file.name;
        const fullPath = resolveFullPath(relPath);
        try {
          await fsPromises.access(fullPath);
        } catch {
          orphanIds.push({ id: file.id, size: file.size, dir_id: file.dir_id });
        }
      }));
      await new Promise(r => setImmediate(r));
    }
  }

  if (orphanIds.length > 0) {
    const tx = db.transaction((orphans) => {
      for (const orb of orphans) {
        deltaDecStmt.run(orb.size, now, orb.dir_id);
        deleteFileStmt.run(orb.id);
        const thumbPath = join(THUMBNAIL_DIR, `${orb.id}.jpg`);
        try { rmSync(thumbPath, { force: true }); } catch {}
        deleted++;
      }
    });
    tx(orphanIds);
    log.info({ msg: 'removed orphan entries', count: deleted });
  }
  return deleted;
}

function walCheckpoint() {
  log.info({ msg: 'Running WAL checkpoint' });
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    log.info({ msg: 'WAL checkpoint complete' });
    return true;
  } catch (err) {
    log.error({ msg: 'WAL checkpoint failed', error: err.message });
    return false;
  }
}

function folderReconciliation() {
  log.info({ msg: 'Running folder reconciliation' });
  try {
    const tx = db.transaction(() => {
      const folders = db.prepare('SELECT id FROM folders').all();
      let reconciled = 0;
      for (const folder of folders) {
        stmts.reconcileFolder.run(folder.id);
        reconciled++;
      }
    });
    tx();
    log.info({ msg: 'Folder reconciliation complete' });
    return true;
  } catch (err) {
    log.error({ msg: 'Folder reconciliation failed', error: err.message });
    return false;
  }
}

async function cleanupHLSStale(ttlMinutes = 60) {
  const hlsDir = PATHS.hls;
  try { await fsPromises.access(hlsDir); } catch { return 0; }

  const now = Date.now();
  const ttl = ttlMinutes * 60 * 1000;
  let cleaned = 0;

  try {
    const entries = await fsPromises.readdir(hlsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(hlsDir, entry.name);
      const stat = await fsPromises.stat(dirPath);
      if (now - stat.mtimeMs > ttl) {
        rmSync(dirPath, { recursive: true, force: true });
        cleaned++;
      }
    }
  } catch (err) {
    log.error({ msg: 'HLS cleanup error', error: err.message });
  }

  if (cleaned > 0) log.info({ msg: 'Cleaned stale HLS directories', count: cleaned });
  return cleaned;
}

let reconciliationInterval = null;
let walCheckpointInterval = null;
let orphanCleanupInterval = null;
let metadataInterval = null;
let analyzeInterval = null;
let metricsCleanupInterval = null;
let playbackCleanupInterval = null;
let maintenanceRunning = false;

function startMaintenanceScheduler() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  log.info({ msg: 'Starting maintenance scheduler' });

  walCheckpointInterval = setInterval(() => { walCheckpoint(); }, 60 * 60 * 1000);

  orphanCleanupInterval = setInterval(() => {
    cleanupOrphanEntries().catch(e => log.error({ msg: 'Orphan cleanup failed', error: e.message }));
  }, 60 * 60 * 1000);

  metadataInterval = setInterval(async () => {
    try {
      await enrichDurationsBatch();
      await new Promise(r => setImmediate(r));
      await enrichMetadataBatch();
    } catch (err) {
      log.error({ msg: 'Metadata enrichment failed', error: err.message });
    }
  }, 30 * 60 * 1000);

  setTimeout(() => {
    metadataInterval && enrichDurationsBatch()
      .then(() => enrichMetadataBatch())
      .catch(e => log.error({ msg: 'Initial enrichment failed', error: e.message }));
  }, 5 * 60 * 1000);

  analyzeInterval = setInterval(() => {
    try {
      db.pragma('ANALYZE');
      log.info({ msg: 'ANALYZE complete' });
    } catch (err) {
      log.error({ msg: 'ANALYZE failed', error: err.message });
    }
  }, 24 * 60 * 60 * 1000);

  metricsCleanupInterval = setInterval(() => {
    try { cleanupOldMetrics(); } catch (e) { log.error({ msg: 'Metrics cleanup failed', error: e.message }); }
  }, 24 * 60 * 60 * 1000);

  playbackCleanupInterval = setInterval(() => {
    try { cleanupPlaybackCache(); } catch (e) { log.error({ msg: 'Playback cleanup failed', error: e.message }); }
  }, SETTINGS.cleanupIntervalMs);

  setTimeout(() => {
    try { cleanupPlaybackCache(); } catch (e) { log.error({ msg: 'Initial playback cleanup failed', error: e.message }); }
  }, 5000);

  setTimeout(() => {
    try { cleanupOldMetrics(); } catch (e) { log.error({ msg: 'Initial metrics cleanup failed', error: e.message }); }
  }, 3000);
}

function stopMaintenanceScheduler() {
  if (!maintenanceRunning) return;
  maintenanceRunning = false;
  log.info({ msg: 'Stopping maintenance scheduler' });

  if (reconciliationInterval) { clearInterval(reconciliationInterval); reconciliationInterval = null; }
  if (walCheckpointInterval) { clearInterval(walCheckpointInterval); walCheckpointInterval = null; }
  if (orphanCleanupInterval) { clearInterval(orphanCleanupInterval); orphanCleanupInterval = null; }
  if (metadataInterval) { clearInterval(metadataInterval); metadataInterval = null; }
  if (analyzeInterval) { clearInterval(analyzeInterval); analyzeInterval = null; }
  if (metricsCleanupInterval) { clearInterval(metricsCleanupInterval); metricsCleanupInterval = null; }
  if (playbackCleanupInterval) { clearInterval(playbackCleanupInterval); playbackCleanupInterval = null; }

  log.info({ msg: 'Maintenance scheduler stopped' });
}

function isMaintenanceRunning() {
  return maintenanceRunning;
}

export {
  cleanupOrphanEntries,
  walCheckpoint,
  folderReconciliation,
  startMaintenanceScheduler,
  stopMaintenanceScheduler,
  isMaintenanceRunning,
};
