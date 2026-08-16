import { readdirSync, statSync, lstatSync, realpathSync, existsSync, rmSync, accessSync, constants, openSync, readSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import fs from 'node:fs';
import { readdir, stat, realpath, opendir } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import db, { stmts, syncFTSIndex } from '../db.js';
import { addFile, existingThumbs, buildThumbCache } from './thumbnailQueue.js';
import { THUMBNAIL_DIR } from './thumbnailUtils.js';
import { get } from './runtimeSettings.js';
import { registerSubsystem, recordMemoryUsage, setPaused, getSnapshot } from './resourceManager.js';

// Support multiple roots (colon-separated in MEDIA_ROOT env var)
const DEFAULT_MEDIA_ROOTS = '/home/CATIAA/homelab';
const MEDIA_ROOTS = (process.env.MEDIA_ROOT || DEFAULT_MEDIA_ROOTS).split(':').filter(Boolean);

let scanRunning = false;
let scanProgress = { phase: '', total: 0, current: 0 };
const SCAN_TIMESTAMP_FILE = join(process.cwd(), 'data', '.last-scan-time');

registerSubsystem('scanner', {
  memoryBudget: 128 * 1024 * 1024,
  ioPriority: 'low',
  cpuPriority: 'low',
});

function getScannerStatus() {
  return {
    type: 'scan',
    running: scanRunning,
    ...scanProgress,
  };
}

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.3gp', '.hevc', '.h265']);
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.opus', '.wav', '.ogg', '.aac', '.m4a', '.wma', '.webm']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg', '.avif']);

function getBatchSize() {
  const workers = get('scan.workers', 4);
  return Math.max(100, workers * 250);
}

function getFileId(relPath) {
  return createHash('md5').update(relPath).digest('hex');
}

function detectType(ext) {
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

// Fast content hash: first 64KB + last 64KB + size — catches most changes without reading full file
async function computeContentHash(filePath, size) {
  try {
    const SAMPLE = 65536;
    const h = createHash('md5');
    h.update(String(size));
    const fd = await fs.open(filePath, 'r');
    try {
      const buf1 = Buffer.allocUnsafe(Math.min(SAMPLE, size));
      await fd.read(buf1, 0, Math.min(SAMPLE, size), 0);
      h.update(buf1);
      if (size > SAMPLE * 2) {
        const buf2 = Buffer.allocUnsafe(SAMPLE);
        await fd.read(buf2, 0, SAMPLE, size - SAMPLE);
        h.update(buf2);
      }
    } finally {
      await fd.close();
    }
    return h.digest('hex');
  } catch {
    return null;
  }
}

function resolveFullPath(relPath) {
  if (!relPath) return MEDIA_ROOTS[0];
  // Single root: just join root + relPath
  if (MEDIA_ROOTS.length === 1) {
    return join(MEDIA_ROOTS[0], relPath);
  }
  // Multi-root: check first segment matches a root basename
  const parts = relPath.split('/');
  const firstPart = parts[0];
  const root = MEDIA_ROOTS.find(r => basename(r) === firstPart);
  if (root) {
    return join(dirname(root), relPath);
  }
  return join(MEDIA_ROOTS[0], relPath);
}

function getRelPath(fullPath) {
  for (const root of MEDIA_ROOTS) {
    if (fullPath.startsWith(root)) {
      const rel = fullPath.substring(root.length).replace(/^\/+/, '');
      return rel || basename(fullPath);
    }
  }
  return basename(fullPath);
}

function getDuration(filePath) {
  return new Promise((resolve) => {
    try {
      const proc = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      
      let out = '';
      proc.stdout.on('data', (chunk) => { out += chunk; });
      proc.on('close', () => {
        try {
          const data = JSON.parse(out);
          resolve(parseFloat(data.format?.duration) || 0);
        } catch { resolve(0); }
      });
      proc.on('error', () => resolve(0));
    } catch { resolve(0); }
  });
}

// Canonical codec names used by the WhatsApp preflight. Maps ffprobe codec_name
// (and a few codec tags) to a small normalized vocabulary so the send path can
// reason about "H.264" / "AAC" without re-parsing tags everywhere.
const VIDEO_CANON = {
  h264: 'h264', avc1: 'h264', avc3: 'h264',
  hevc: 'hevc', h265: 'hevc', hev1: 'hevc', hvc1: 'hevc',
  av1: 'av1', av01: 'av1',
  vp9: 'vp9', vp09: 'vp9', vp8: 'vp8',
  mpeg4: 'mpeg4', mpeg2video: 'mpeg2', mjpeg: 'mjpeg',
};
const AUDIO_CANON = {
  aac: 'aac', mp4a: 'aac',
  opus: 'opus',
  mp3: 'mp3', mp3float: 'mp3',
  ac3: 'ac3', eac3: 'eac3', 'ac-3': 'ac3',
  vorbis: 'vorbis', flac: 'flac',
  pcm_s16le: 'pcm', pcm_s24le: 'pcm', pcm_s32le: 'pcm', pcm_f32le: 'pcm',
  alac: 'alac', amr_nb: 'amr', amr_wb: 'amr',
};
function normalizeVideoCodec(name) {
  return VIDEO_CANON[(name || '').toLowerCase()] || (name || '').toLowerCase() || 'unknown';
}
function normalizeAudioCodec(name) {
  return AUDIO_CANON[(name || '').toLowerCase()] || (name || '').toLowerCase() || '';
}

function probeVideoMetadata(filePath) {
  try {
    const result = spawnSync('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_entries', 'format=format_name:stream=index,codec_type,codec_name,codec_tag_string,width,height,profile',
      filePath,
    ], { encoding: 'utf-8', timeout: 15000 });
    if (result.status !== 0) return null;
    const data = JSON.parse(result.stdout || '{}');
    const video = (data.streams || []).find(s => s.codec_type === 'video');
    const audio = (data.streams || []).find(s => s.codec_type === 'audio');
    if (!video) return null;

    const vCodec = (video.codec_name || '').toLowerCase();
    const vTag = (video.codec_tag_string || '').toLowerCase();
    const aCodec = (audio?.codec_name || '').toLowerCase();
    const aTag = (audio?.codec_tag_string || '').toLowerCase();
    const ext = extname(filePath).toLowerCase();
    const isMuxableBrowserContainer = ['.mp4', '.m4v', '.mov'].includes(ext);
    const codec = `${vCodec} ${vTag} ${aCodec} ${aTag}`.toLowerCase();
    const isH264 = /(^|\s)(avc1|h264)(\s|$)/.test(codec);
    const isHevc = /(^|\s)(hev1|hvc1|hevc)(\s|$)/.test(codec);
    const isCompatible = isMuxableBrowserContainer && (isH264 || isHevc);

    return {
      video_codec: vCodec,
      video_codec_tag: vTag,
      audio_codec: aCodec,
      audio_codec_tag: aTag,
      // Normalized, target-agnostic vocabulary (H.264 / HEVC / AAC / Opus …).
      // `is_stream_compatible` is intentionally the BROWSER/HLS streamability
      // flag (video codec + muxable container); it is NOT the WhatsApp contract.
      // The WA preflight must compute its own whole-media check from
      // videoCodec + audioCodec instead of trusting is_stream_compatible.
      videoCodec: normalizeVideoCodec(vCodec),
      audioCodec: normalizeAudioCodec(aCodec),
      width: video.width || 0,
      height: video.height || 0,
      profile: video.profile || '',
      format: (data.format?.format_name || '').toLowerCase(),
      is_stream_compatible: isCompatible ? 1 : 0,
    };
  } catch {
    return null;
  }
}

function updateCodecInfo(filePath, fileId) {
  try {
    const probe = probeVideoMetadata(filePath);
    if (!probe) return;
    stmts.updateCodecInfo.run(JSON.stringify(probe), probe.is_stream_compatible, fileId);
  } catch {}
}

function ensureFolder(relPath) {
  // Always upsert — atomic, idempotent, no read-then-insert race window
  if (!relPath) {
    stmts.upsertFolder.run({
      path: '',
      parent_id: null,
      depth: 0,
      file_count: 0,
      total_size: 0,
      last_scanned: Date.now(),
      last_updated: Date.now(),
    });
    return stmts.getFolderByPath.get('').id;
  }

  const lastSlash = relPath.lastIndexOf('/');
  const parentPath = lastSlash > 0 ? relPath.substring(0, lastSlash) : '';
  const parentId = ensureFolder(parentPath);
  const depth = (stmts.getFolderByPath.get(parentPath)?.depth || 0) + 1;

  stmts.upsertFolder.run({
    path: relPath,
    parent_id: parentId,
    depth,
    file_count: 0,
    total_size: 0,
    last_scanned: Date.now(),
    last_updated: Date.now(),
  });

  return stmts.getFolderByPath.get(relPath).id;
}

// Scan filesystem with streaming directory traversal (opendir).
// Yields entries immediately after stat, without collecting an entire
// directory into memory. Directory handles are consumed one entry at a time.
async function* streamFileSystem(rootPath, rootRelPath = '') {
  const queue = [{ dir: rootPath, relPath: rootRelPath }];

  while (queue.length > 0) {
    const { dir, relPath } = queue.shift();

    let dirHandle;
    try {
      dirHandle = await opendir(dir);
    } catch {
      continue;
    }

    const batch = [];
    for await (const dirent of dirHandle) {
      if (dirent.name.startsWith('.')) continue;
      const fullPath = join(dir, dirent.name);
      const itemRelPath = relPath ? join(relPath, dirent.name) : dirent.name;

      if (dirent.isSymbolicLink()) {
        try {
          const targetStat = await stat(fullPath);
          if (targetStat.isDirectory()) {
            queue.push({ dir: fullPath, relPath: itemRelPath });
          }
        } catch {}
        continue;
      }

      if (dirent.isDirectory()) {
        if (get('scan.recursive', true)) {
          queue.push({ dir: fullPath, relPath: itemRelPath });
        }
        continue;
      }

      const ext = extname(dirent.name).toLowerCase();
      const type = detectType(ext);
      if (type === 'other') continue;

      batch.push({ dirent, fullPath, itemRelPath, type, ext });

      if (batch.length >= 16) {
        for (const r of await Promise.all(batch.map(processFileEntry))) {
          if (r) yield r;
        }
        batch.length = 0;
        await new Promise(r => setImmediate(r));
      }
    }

    for (const r of await Promise.all(batch.map(processFileEntry))) {
      if (r) yield r;
    }
    await new Promise(r => setImmediate(r));
  }
}

async function processFileEntry({ dirent, fullPath, itemRelPath, type, ext }) {
  try {
    const st = await stat(fullPath);
    let realFullPath;
    try { realFullPath = await realpath(fullPath); } catch { realFullPath = fullPath; }
    return {
      id: getFileId(itemRelPath),
      relPath: itemRelPath,
      name: dirent.name,
      type,
      ext,
      fullPath: realFullPath,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      birthtime: Math.floor(st.birthtimeMs) || Math.floor(st.mtimeMs),
    };
  } catch {
    return null;
  }
}

// Scan filesystem iteratively, return flat list of entries (non-blocking async I/O)
async function scanFileSystem(rootPath, rootRelPath = '') {
  const entries = [];
  for await (const entry of streamFileSystem(rootPath, rootRelPath)) {
    entries.push(entry);
  }
  return entries;
}

// Incremental sync: compare filesystem entries with DB, update only changes
async function incrementalSync(onNewFile, skipThumbCache = false) {
  if (scanRunning) return;
  scanRunning = true;
  scanProgress = { phase: 'scanning', total: 0, current: 0 };
  console.log('[scanner] Starting incremental scan...');
  const startTime = Date.now();

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;

  const validRootNames = MEDIA_ROOTS.map(r => basename(r));

  // Loop each root in MEDIA_ROOTS
  for (const root of MEDIA_ROOTS) {
    // For single root, put files directly in root folder (empty path)
    // For multiple roots, use folder names as subfolders
    const useDirectRoot = MEDIA_ROOTS.length === 1;
    const folderName = useDirectRoot ? '' : basename(root);
    console.log(`[scanner] Processing root: ${useDirectRoot ? 'direct to root' : folderName}`);

    // Ensure root entry exists in DB
    ensureFolder(folderName);

    // Phase 1: Scan filesystem
    const fsEntries = await scanFileSystem(root, folderName);
    console.log(`[scanner] Found ${fsEntries.length} media files in ${useDirectRoot ? 'root' : folderName}`);

    // Phase 2: Get existing DB entries for this root (chunked to bound memory)
    const subfolderPattern = useDirectRoot ? '%' : folderName + '/%';
    const existingIds = new Set();
    const existingLookup = new Map();
    const DB_BATCH = 5000;
    let dbOffset = 0;
    while (true) {
      const batch = db.prepare(`
        SELECT id, size, mtime, dir_id, duration, checksum
        FROM files
        WHERE dir_id IN (SELECT id FROM folders WHERE path = ? OR path LIKE ?)
        LIMIT ? OFFSET ?
      `).all(folderName, subfolderPattern, DB_BATCH, dbOffset);
      if (batch.length === 0) break;
      for (const row of batch) {
        existingIds.add(row.id);
        existingLookup.set(row.id, { size: row.size, mtime: row.mtime, dir_id: row.dir_id, duration: row.duration, checksum: row.checksum });
      }
      dbOffset += DB_BATCH;
      await new Promise(r => setImmediate(r));
    }
    recordMemoryUsage('scanner', Buffer.byteLength(JSON.stringify({ existingLookup: Array.from(existingLookup.keys()), fsEntries: fsEntries.length })));

    // Phase 3: Ensure all subfolders exist
    const folderPaths = new Set([folderName]);
    for (const entry of fsEntries) {
      const slashIdx = entry.relPath.lastIndexOf('/');
      if (slashIdx > 0) {
        const subFolderPath = entry.relPath.substring(0, slashIdx);
        if (useDirectRoot) {
          folderPaths.add(subFolderPath);
        } else {
          folderPaths.add(folderName + '/' + subFolderPath);
        }
      } else if (useDirectRoot) {
        folderPaths.add('');
      }
    }

    const folderInsertTx = db.transaction((paths) => {
      for (const p of paths) ensureFolder(p);
    });
    folderInsertTx([...folderPaths]);

    // Phase 4: Batch upsert files
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const upsertTx = db.transaction((batch) => {
      for (const entry of batch) {
        const existing = existingLookup.get(entry.id);

        if (existing && existing.size === entry.size && existing.mtime === entry.mtime) {
          // Size + mtime match — verify with content hash if available
          const useHashCheck = get('scan.compareByHash', false);
          if (useHashCheck && existing.checksum) {
            const currentHash = entry._currentHash;
            if (currentHash && currentHash === existing.checksum) {
              skipped++;
              existingIds.delete(entry.id);
              continue;
            }
            // Hash mismatch — file changed despite same size/mtime
          } else {
            skipped++;
            existingIds.delete(entry.id);
            continue;
          }
        }

        // Scanner does NOT overwrite created_at_embedded / modified_at_fs / uploaded_at
        // for existing files — those are preserved via COALESCE in upsertFile.

        const slashIdx = entry.relPath.lastIndexOf('/');
        let folderPath;
        if (useDirectRoot) {
          // For single root, subfolders go directly under root
          folderPath = slashIdx > 0 ? entry.relPath.substring(0, slashIdx) : '';
        } else {
          // For multiple roots, maintain folderName as base
          folderPath = slashIdx > 0 ? entry.relPath.substring(0, slashIdx) : folderName;
        }
        const dirId = ensureFolder(folderPath);

        if (existing) {
              updated++;
              const thumbExists = !existing.has_thumb && existingThumbs.has(entry.id + '.jpg');
              stmts.upsertFile.run({
                id: entry.id,
                dir_id: dirId,
                name: entry.name,
                type: entry.type,
                ext: entry.ext,
                size: entry.size,
                mtime: entry.mtime,
                duration: existing.duration ?? 0,
                has_thumb: thumbExists ? 1 : (existing.has_thumb || 0),
                thumb_cache_path: thumbExists ? join(THUMBNAIL_DIR, `${entry.id}.jpg`) : null,
                last_accessed: 0,
                access_count: 0,
                last_verified: now,
                created_at: existing.created_at || entry.birthtime || entry.mtime,
                created_at_embedded: null,
                modified_at_fs: entry.mtime,
                uploaded_at: null,
                metadata_source: null,
                checksum: entry.checksum,
              });
              if (entry.size !== existing.size) {
                db.prepare('UPDATE folders SET total_size = MAX(0, total_size + ?), last_updated = ? WHERE id = ?').run(entry.size - existing.size, now, dirId);
              }
              // Fix old files where created_at was incorrectly set to mtime
              if (existing.created_at === existing.mtime && entry.birthtime && entry.birthtime !== existing.mtime) {
                db.prepare('UPDATE files SET created_at = ? WHERE id = ?').run(entry.birthtime, entry.id);
              }
        } else {
              inserted++;
              if (entry.type !== 'folder') (onNewFile || addFile)(entry.fullPath, entry.type);
              stmts.upsertFile.run({
                id: entry.id,
                dir_id: dirId,
                name: entry.name,
                type: entry.type,
                ext: entry.ext,
                size: entry.size,
                mtime: entry.mtime,
                duration: 0,
                has_thumb: 0,
                thumb_cache_path: null,
                last_accessed: 0,
                access_count: 0,
                last_verified: now,
                created_at: entry.birthtime || entry.mtime,
                created_at_embedded: null,
                modified_at_fs: entry.mtime,
                uploaded_at: null,
                metadata_source: null,
                checksum: entry.checksum,
              });
              stmts.deltaIncrementFolder.run(entry.size, now, dirId);
            }
        existingIds.delete(entry.id);
      }
    });

    const batchSize = getBatchSize();
    for (let i = 0; i < fsEntries.length; i += batchSize) {
      const batchSlice = fsEntries.slice(i, i + batchSize);
      for (const entry of batchSlice) {
        const existing = existingLookup.get(entry.id);
        if (existing && existing.size === entry.size && existing.mtime === entry.mtime && get('scan.compareByHash', false) && existing.checksum) {
          entry._currentHash = await computeContentHash(entry.fullPath, entry.size);
        }
      }
      upsertTx(batchSlice);
      if (i + batchSize < fsEntries.length) {
        await new Promise(r => setImmediate(r));
      }
    }

    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;

    // Yield to event loop between roots
    await new Promise(r => setImmediate(r));

    // Phase 5: Delete orphan files
    const deleteTx = db.transaction((orphanIds) => {
      for (const id of orphanIds) {
        const file = stmts.getFile.get(id);
        if (file) {
          stmts.deltaDecrementFolder.run(file.size, now, file.dir_id);
        }
        stmts.deleteFile.run(id);
        // Remove orphan thumbnail
        const thumbPath = join(THUMBNAIL_DIR, `${id}.jpg`);
        try { rmSync(thumbPath, { force: true }); } catch {}
        totalDeleted++;
      }
    });

    if (existingIds.size > 0) {
      deleteTx([...existingIds]);
    }
  }

  // Phase 5.5: Cleanup stale folders
  console.log('[scanner] Cleaning up stale folders...');
  const isSingleRoot = MEDIA_ROOTS.length === 1;
  
  const allFolders = db.prepare('SELECT id, path FROM folders WHERE id > 1').all();
  let folderDel = 0;
  const staleFolderIds = [];
    for (const folder of allFolders) {
      if (isSingleRoot) {
        // Single root: folder path is relative to root (e.g. 'Instagram', 'Instagram/2024')
        const exists = existsSync(join(MEDIA_ROOTS[0], folder.path));
        if (!exists) staleFolderIds.push(folder.id);
      } else {
        const rootName = folder.path.split('/')[0];
        if (!validRootNames.includes(rootName)) {
          staleFolderIds.push(folder.id);
        } else {
          const rootDir = MEDIA_ROOTS.find(r => basename(r) === rootName);
          const subPath = folder.path.substring(rootName.length + 1);
          const exists = rootDir ? existsSync(join(rootDir, subPath)) : false;
          if (!exists) staleFolderIds.push(folder.id);
        }
      }
    }

  if (staleFolderIds.length > 0) {
    const deleteFilesStmt = db.prepare('DELETE FROM files WHERE dir_id = ?');
    const deleteFolderStmt = db.prepare('DELETE FROM folders WHERE id = ?');
    const cleanupTx = db.transaction((ids) => {
      for (const id of ids) {
        deleteFilesStmt.run(id);
        deleteFolderStmt.run(id);
        folderDel++;
      }
    });
    cleanupTx(staleFolderIds);
    console.log(`[scanner] Removed ${folderDel} stale folders`);
  }

  // Rebuild thumb cache after any deletions to prevent stale lookups
  if (!skipThumbCache) {
    try { buildThumbCache(); } catch {}
  }

  // Phase 6: Reconcile folder table counts
  console.log('[scanner] Running folder reconciliation...');
  const remainingFolders = db.prepare('SELECT id FROM folders').all();
  for (const folder of remainingFolders) {
    stmts.reconcileFolder.run(folder.id);
  }

  // Phase 6.5: Sync FTS index after bulk file changes
  await syncFTSIndex();

  const elapsed = Date.now() - startTime;
  const hashCheckEnabled = get('scan.compareByHash', false);
  console.log(`[scanner] Sync complete in ${elapsed}ms: +${totalInserted} inserted, ~${totalUpdated} updated, •${totalSkipped} skipped, -${totalDeleted} deleted (hash_check=${hashCheckEnabled})`);
  if (totalSkipped > 0 && totalInserted === 0 && totalUpdated === 0) {
    console.log(`[scanner] All files unchanged — DB is in sync with filesystem`);
  }
  try { writeFileSync(SCAN_TIMESTAMP_FILE, String(Date.now())); } catch {}
  scanRunning = false;
  scanProgress = { phase: 'idle', total: 0, current: 0 };
  return { inserted: totalInserted, updated: totalUpdated, skipped: totalSkipped, deleted: totalDeleted, elapsed };
}

// Background ffprobe enrichment (LOW priority).
// Drains duration/codec for files that are still missing them. Previously this
// only processed 20 files per run on a 30-minute interval, so large libraries
// (1000+ tracks) took days and `f.duration` stayed 0 — making playlist/Loved
// total durations wildly wrong. Now it processes a much larger batch and loops
// until the backlog is cleared (bounded by a per-run time/count budget so it
// never blocks scans/playback), keeps `playlist_tracks.duration` in sync, and
// recomputes stored playlist totals afterwards.
async function enrichDurationsBatch() {
  const BATCH = 500;
  const MAX_PER_RUN = 6000;
  const TIME_BUDGET_MS = 2 * 60 * 1000;
  const start = Date.now();

  const updateDuration = db.prepare('UPDATE files SET duration = ? WHERE id = ?');

  let processed = 0;
  let pending = BATCH;

  while (pending > 0 && processed < MAX_PER_RUN && (Date.now() - start) < TIME_BUDGET_MS) {
    const files = db.prepare(`
      SELECT f.id, d.path, f.name, f.type, f.codec_info
      FROM files f
      JOIN folders d ON f.dir_id = d.id
      WHERE (f.duration = 0 OR f.codec_info IS NULL)
        AND f.type IN ('video', 'audio')
      LIMIT ?
    `).all(pending);

    pending = files.length;
    if (pending === 0) break;

    for (const file of files) {
      const relPath = file.path ? join(file.path, file.name) : file.name;
      const fullPath = resolveFullPath(relPath);
      if (file.type === 'video') updateCodecInfo(fullPath, file.id);
      const dur = await getDuration(fullPath);
      if (dur > 0) {
        const secs = Math.round(dur);
        updateDuration.run(secs, file.id);
        // Keep playlist track durations in sync so stored playlist totals are
        // correct even for playlists built before this file was enriched.
        try { stmts.updatePlaylistTrackDurationByPath.run(secs, fullPath); } catch {}
      }
      processed++;
      if ((Date.now() - start) >= TIME_BUDGET_MS) break;
    }

    pending = BATCH;
  }

  // Refresh any playlist track durations still missing, then recompute every
  // playlist's stored totals from (now-updated) playlist_tracks.
  try { stmts.refreshPlaylistTrackDurations.run(); } catch (e) { console.error('[scanner] refresh playlist track durations failed:', e.message); }
  try { stmts.recomputeAllPlaylistTotals.run(); } catch (e) { console.error('[scanner] recompute playlist totals failed:', e.message); }

  return processed;
}

const TAG_DATE_PATTERNS = [
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
  /(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/,
  /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
];

function parseTimestamp(value) {
  if (!value) return null;
  for (const pat of TAG_DATE_PATTERNS) {
    const m = value.match(pat);
    if (m) {
      const d = new Date(m[1].replace(/(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function extractTags(filePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_entries', 'format_tags:stream_tags', filePath];
    let out = '';
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); }
      catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}

const CREATION_TAG_NAMES = ['creation_time', 'DATE', 'Media_Create_Date', 'CreationDate'];

async function enrichMetadataBatch() {
  const files = db.prepare(`
    SELECT f.id, d.path, f.name, f.type
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.created_at_embedded IS NULL
      AND f.type IN ('image','video','audio')
    LIMIT 20
  `).all();

  const updateCreatedAt = db.prepare('UPDATE files SET created_at_embedded = ?, metadata_source = ? WHERE id = ?');

  for (const file of files) {
    const relPath = file.path ? join(file.path, file.name) : file.name;
    const fullPath = resolveFullPath(relPath);
    const data = await extractTags(fullPath);
    if (!data) continue;

    let creationTime = null;
    let source = 'ffprobe';

    for (const tagName of CREATION_TAG_NAMES) {
      creationTime = parseTimestamp(data.format?.tags?.[tagName]) || parseTimestamp(data.streams?.[0]?.tags?.[tagName]);
      if (creationTime) break;
    }

    if (creationTime) {
      updateCreatedAt.run(creationTime, source, file.id);
    }
  }

  return files.length;
}

export {
  MEDIA_ROOTS,
  VIDEO_EXTS,
  AUDIO_EXTS,
  IMAGE_EXTS,
  getFileId,
  getRelPath,
  detectType,
  getDuration,
  ensureFolder,
  resolveFullPath,
  incrementalSync,
  getBatchSize,
  getScannerStatus,
  enrichDurationsBatch,
  enrichMetadataBatch,
};
