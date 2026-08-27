import { createWriteStream, existsSync, unlinkSync, renameSync, mkdirSync, createReadStream, statSync, utimesSync } from 'node:fs';
import { join, extname, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import Busboy from 'busboy';
import db, { stmts } from '../db.js';
import { PATHS } from '../config/paths.js';
import { get } from './runtimeSettings.js';
import { detectType, getFileId } from '@homelab/media-engine';
import { addFile } from './thumbnailQueue.js';
import { createLogger } from './logger.js';

const log = createLogger('upload');

const MEDIA_ROOTS = (process.env.MEDIA_ROOT || '/home/CATIAA/homelab').split(':').filter(Boolean);

const activeUploads = new Map();
let uploadIdCounter = 0;

const UPLOAD_TEMP = PATHS.temp;
mkdirSync(UPLOAD_TEMP, { recursive: true });

export function getActiveUploads() {
  return Array.from(activeUploads.values()).map(u => ({
    id: u.id, filename: u.filename, targetPath: u.targetPath,
    size: u.size, uploaded: u.uploaded, status: u.status, error: u.error,
    type: u.type, ext: u.ext,
    progress: u.size > 0 ? Math.round((u.uploaded / u.size) * 100) : 0,
    speed: u.speed || 0, eta: u.eta || 0, startedAt: u.startedAt,
  }));
}

export function handleUpload(req, res) {
  const targetFolder = (req.query.folder || '').replace(/^\/+|\/+$/g, '');
  const maxSize = (get('upload.maxSizeGB', 100)) * 1024 * 1024 * 1024;
  const concurrent = get('upload.concurrent', 4);
  const duplicateStrategy = get('upload.duplicateStrategy', 'rename');

  const running = Array.from(activeUploads.values()).filter(u => u.status === 'uploading').length;
  if (running >= concurrent) {
    return res.status(429).json({ error: 'Too many concurrent uploads' });
  }

  let busboy;
  try {
    busboy = Busboy({ headers: req.headers, limits: { fileSize: maxSize, files: 50 }, defParamCharset: 'utf8' });
  } catch {
    return res.status(400).json({ error: 'Invalid multipart request' });
  }

  const results = [];
  let pendingFiles = 0;
  let finishedParsing = false;

  function sendUploadResponse() {
    const failed = results.filter(r => r.status === 'failed');
    const succeeded = results.filter(r => r.status === 'completed' || r.status === 'skipped');
    if (!res.headersSent) {
      res.json({
        results,
        summary: { total: results.length, completed: succeeded.length, failed: failed.length },
      });
    }
    if (get('upload.autoScan', true)) {
      setImmediate(async () => {
        try {
          if (globalThis.mediaScanner) await globalThis.mediaScanner.scan();
        } catch (e) {
          log.error({ msg: 'auto-scan error', error: e.message });
        }
      });
    }
  }

  function fileDone() {
    pendingFiles--;
    if (finishedParsing && pendingFiles <= 0) sendUploadResponse();
  }

  let fileMeta = {};
  busboy.on('field', (fieldname, val) => {
    if (fieldname === '_timestamps') {
      try { fileMeta = Object.fromEntries(JSON.parse(val).map(t => [t.name, t])); } catch {}
    }
  });

  busboy.on('file', (fieldname, fileStream, { filename }) => {
    const id = `${Date.now()}-${++uploadIdCounter}`;
    const ext = extname(filename).toLowerCase();
    const type = detectType(ext);
    const safeName = sanitizeFilename(filename);
    const relPath = targetFolder ? join(targetFolder, safeName) : safeName;
    const fullPath = join(MEDIA_ROOTS[0], relPath);
    const existingId = getFileId(relPath);
    const existing = globalThis.mediaEngine?.repository?.getFileById(existingId) || db.prepare('SELECT id FROM files WHERE id = ?').get(existingId);

    let finalPath = fullPath;
    let finalName = safeName;
    let finalRelPath = relPath;
    pendingFiles++;

    if (existing) {
      if (duplicateStrategy === 'skip') {
        fileStream.resume();
        results.push({ id, filename: safeName, status: 'skipped', reason: 'duplicate' });
        log.info({ msg: 'Skipped duplicate', file: safeName });
        fileDone();
        return;
      }
      if (duplicateStrategy === 'rename') {
        const base = basename(safeName, ext);
        finalName = `${base}_${Date.now()}${ext}`;
        finalRelPath = targetFolder ? join(targetFolder, finalName) : finalName;
        finalPath = join(MEDIA_ROOTS[0], finalRelPath);
      }
    }

    mkdirSync(dirname(finalPath), { recursive: true });
    const tmpPath = join(UPLOAD_TEMP, `${id}${ext}`);
    const meta = fileMeta[filename] || fileMeta[finalName] || {};
    const upload = {
      id, filename: finalName, targetPath: finalRelPath,
      size: meta.size || 0, uploaded: 0, status: 'uploading',
      error: null, type, ext, speed: 0, eta: 0,
      lastChunk: Date.now(), startedAt: Date.now(), bytesThisSecond: 0,
    };
    activeUploads.set(id, upload);

    const writeStream = createWriteStream(tmpPath);
    upload._writeStream = writeStream;
    upload._fileStream = fileStream;
    let aborted = false;

    fileStream.on('data', (chunk) => {
      if (aborted) return;
      upload.uploaded += chunk.length;
      const now = Date.now();
      const dt = (now - upload.lastChunk) / 1000;
      if (dt > 0.5) {
        upload.bytesThisSecond += chunk.length;
        upload.speed = Math.round(upload.bytesThisSecond / dt);
        upload.bytesThisSecond = 0;
        upload.lastChunk = now;
        if (upload.speed > 0) upload.eta = Math.round(upload.size / upload.speed);
      } else {
        upload.bytesThisSecond += chunk.length;
      }
      writeStream.write(chunk);
    });

    fileStream.on('limit', () => {
      aborted = true;
      writeStream.destroy();
      try { unlinkSync(tmpPath); } catch {}
      upload.status = 'failed';
      upload.error = 'File exceeds size limit';
      results.push({ id, filename: finalName, status: 'failed', error: 'File exceeds size limit' });
      log.warn({ msg: 'file size limit exceeded', file: finalName });
      setTimeout(() => activeUploads.delete(id), 30000);
      fileDone();
    });

    fileStream.on('end', () => {
      if (aborted) return;
      writeStream.end();
    });

    writeStream.on('finish', async () => {
      if (aborted) { fileDone(); return; }
      upload.status = 'processing';
      upload.size = upload.uploaded;

      try {
        let fsMtime = Date.now();
        try {
          const st = statSync(tmpPath);
          fsMtime = Math.floor(st.mtimeMs);
        } catch {}

        if (existsSync(tmpPath)) renameSync(tmpPath, finalPath);
        log.info({ msg: 'raw file saved', file: finalName });

        let checksum = null;
        if (get('upload.verifyIntegrity', true)) {
          checksum = await computeChecksum(finalPath);
          log.info({ msg: 'integrity verified', file: finalName, sha256: checksum ? checksum.substring(0, 16) + '...' : 'failed' });
        }

        let embeddedCreatedAt = null;
        let duration = 0;
        let metadataSource = 'filesystem';

        if (type === 'video' || type === 'audio' || type === 'image') {
          const meta = await extractFileMetadata(finalPath);
          duration = meta.duration || 0;
          embeddedCreatedAt = meta.creationTime;
          metadataSource = embeddedCreatedAt ? 'ffprobe' : 'filesystem';
          log.info({ msg: 'metadata extracted', file: finalName, duration, created_at_embedded: embeddedCreatedAt });
        }

        log.info({ msg: 'source file untouched', file: finalName });

        const origTs = (fileMeta[filename] || fileMeta[finalName] || {}).lastModified;
        if (origTs && origTs > 1000000000000) {
          const ts = Math.floor(origTs / 1000);
          try { utimesSync(finalPath, ts, ts); } catch {}
          fsMtime = origTs;
          log.info({ msg: 'restored original timestamp', file: finalName });
        }

        const uploadedAt = upload.startedAt;
        const indexedAt = Date.now();
        const fileId = getFileId(finalRelPath);

        const dirId = globalThis.mediaEngine?.repository?.ensureFolder(targetFolder) ?? globalThis.mediaScanner?.ensureFolder(targetFolder);
        const repo = globalThis.mediaEngine?.repository;
        if (repo?.upsertFile) {
          repo.upsertFile({
            id: fileId, dir_id: dirId, name: finalName,
            type, ext: ext.replace('.', ''), size: upload.size, mtime: fsMtime,
            duration, has_thumb: 0, thumb_cache_path: null,
            last_accessed: indexedAt, access_count: 0, last_verified: indexedAt,
            created_at: origTs || indexedAt, created_at_embedded: embeddedCreatedAt,
            modified_at_fs: fsMtime, uploaded_at: uploadedAt, metadata_source: metadataSource,
          });
        } else {
          stmts.upsertFile.run({
            id: fileId, dir_id: dirId, name: finalName,
            type, ext: ext.replace('.', ''), size: upload.size, mtime: fsMtime,
            duration, has_thumb: 0, thumb_cache_path: null,
            last_accessed: indexedAt, access_count: 0, last_verified: indexedAt,
            created_at: origTs || indexedAt, created_at_embedded: embeddedCreatedAt,
            modified_at_fs: fsMtime, uploaded_at: uploadedAt, metadata_source: metadataSource,
          });
        }

        db.prepare(`INSERT INTO uploads (id, filename, target_path, size, status, uploaded, checksum, type, ext, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, finalName, finalRelPath, upload.size, 'completed', upload.uploaded, checksum, type, ext, upload.startedAt, Date.now(), Date.now());

        upload.status = 'completed';
        log.info({ msg: 'upload completed', file: finalName, sizeMB: +(upload.size / 1024 / 1024).toFixed(1) });

        setTimeout(() => activeUploads.delete(id), 5 * 60 * 1000);

        if (get('upload.autoThumbnail', true) && (type === 'video' || type === 'audio' || type === 'image')) {
          try {
            addFile(finalPath, type);
            log.info({ msg: 'thumbnail queued', file: finalName });
          } catch (e) {
            log.error({ msg: 'thumbnail error', file: finalName, error: e.message });
          }
        }

        results.push({ id, filename: finalName, status: 'completed', size: upload.uploaded, target: finalRelPath });
      } catch (err) {
        upload.status = 'failed';
        upload.error = err.message;
        log.error({ msg: 'upload processing failed', file: finalName, error: err.message });
        results.push({ id, filename: finalName, status: 'failed', error: err.message });
        setTimeout(() => activeUploads.delete(id), 30000);
      }
      fileDone();
    });

    writeStream.on('error', (err) => {
      if (aborted) return;
      aborted = true;
      upload.status = 'failed';
      upload.error = err.message;
      results.push({ id, filename: finalName, status: 'failed', error: err.message });
      log.error({ msg: 'write error', file: finalName, error: err.message });
      fileDone();
    });
  });

  busboy.on('finish', () => {
    finishedParsing = true;
    if (pendingFiles <= 0) sendUploadResponse();
  });

  busboy.on('error', (err) => {
    log.error({ msg: 'busboy error', error: err.message });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  req.pipe(busboy);
}

export function cancelUpload(id) {
  const active = activeUploads.get(id);
  if (!active) return false;
  active.status = 'cancelled';
  if (active._fileStream && typeof active._fileStream.destroy === 'function') {
    try { active._fileStream.destroy(); } catch {}
  }
  if (active._writeStream && typeof active._writeStream.destroy === 'function') {
    try { active._writeStream.destroy(); } catch {}
  }
  setTimeout(() => activeUploads.delete(id), 3000);
  return true;
}

function sanitizeFilename(name) {
  name = name.replace(/\.\./g, '').replace(/[\/\\]/g, '_');
  name = name.replace(/\0/g, '');
  const ext = extname(name);
  const chars = Array.from(name);
  if (chars.length > 255) {
    const extChars = Array.from(ext);
    name = chars.slice(0, 255 - extChars.length).join('') + ext;
  }
  return name || `upload_${Date.now()}`;
}

function extractFileMetadata(filePath) {
  return new Promise((resolve) => {
    const result = { duration: 0, creationTime: null };
    const args = [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_entries', 'format_tags:stream_tags:stream=codec_type',
      filePath,
    ];
    let stdout = '';
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.on('close', (code) => {
      if (code !== 0) return resolve(result);
      try {
        const data = JSON.parse(stdout);
        result.duration = Math.round(parseFloat(data.format?.duration || 0));
        const formatTags = data.format?.tags || {};
        const stream0Tags = data.streams?.[0]?.tags || {};
        let rawCreation = formatTags['creation_time'] || stream0Tags['creation_time'];
        if (!rawCreation) {
          rawCreation = formatTags['DATE'] || formatTags['date'] ||
            stream0Tags['DateTimeOriginal'] || stream0Tags['DateTimeDigitized'];
        }
        if (rawCreation) {
          const ts = parseTimestamp(rawCreation);
          if (ts) result.creationTime = ts;
        }
      } catch {}
      resolve(result);
    });
    proc.on('error', () => resolve(result));
  });
}

function parseTimestamp(raw) {
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!isNaN(ts)) return ts;
  const m = raw.match(/(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

function computeChecksum(filePath) {
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

export function getUploadHistory(limit = 20) {
  return db.prepare('SELECT * FROM uploads ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getUploadStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const active = Array.from(activeUploads.values()).filter(u => u.status === 'uploading').length;
  const pending = Array.from(activeUploads.values()).filter(u => u.status === 'pending').length;
  const stats = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' AND created_at >= ? THEN 1 ELSE 0 END) as todayCompleted, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as totalFailed, COALESCE(SUM(size), 0) as totalBytes FROM uploads`).get(today.getTime());
  return {
    active, pending,
    todayCompleted: stats.todayCompleted || 0,
    totalFailed: stats.totalFailed || 0,
    totalUploads: stats.total || 0,
    totalBytes: stats.totalBytes || 0,
    queueSize: active + pending,
  };
}

export async function repairMetadata(limit = 100) {
  const files = db.prepare(`SELECT id, name, type, ext, mtime, created_at, created_at_embedded FROM files WHERE type IN ('video', 'audio', 'image') AND created_at_embedded IS NULL ORDER BY created_at DESC LIMIT ?`).all(limit);

  let repaired = 0, skipped = 0, errors = 0;

  for (const file of files) {
    try {
      const engine = globalThis.mediaEngine;
      let fullPath = null;
      if (engine) {
        try { const r = await engine.resolve(file.id); fullPath = r?.fullPath || null; } catch {}
      }
      if (!fullPath) {
        const { resolveFullPath: rfp } = await import('@homelab/media-engine');
        fullPath = rfp(file.name, engine?.mediaRoots || MEDIA_ROOTS);
      }
      if (!fullPath || !existsSync(fullPath)) { skipped++; continue; }

      const meta = await extractFileMetadata(fullPath);
      if (meta.creationTime) {
        db.prepare('UPDATE files SET created_at_embedded = ?, last_verified = ?, metadata_source = ? WHERE id = ?')
          .run(meta.creationTime, Date.now(), 'ffprobe', file.id);
        repaired++;
        log.info({ msg: 'repaired metadata', file: file.name, embedded: new Date(meta.creationTime).toISOString() });
      } else {
        db.prepare('UPDATE files SET created_at_embedded = 0 WHERE id = ?').run(file.id);
        skipped++;
      }
    } catch (err) {
      errors++;
      log.error({ msg: 'metadata repair error', file: file.name, error: err.message });
    }
  }

  log.info({ msg: 'metadata repair done', repaired, skipped, errors });
  return { repaired, skipped, errors, total: files.length };
}

export async function repairDurations(limit = 100, type = 'audio') {
  // Only repair the requested media type(s) so we don't accidentally ffprobe the
  // entire (potentially huge) video library. Defaults to 'audio' which is what the
  // playlist/Loved duration fix needs.
  const typeList = (typeof type === 'string' && type.includes(','))
    ? type.split(',').map(s => s.trim()).filter(Boolean)
    : [type];
  const placeholders = typeList.map(() => '?').join(',');
  const files = db.prepare(`
    SELECT f.id, d.path AS folder_path, f.name
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE (f.duration IS NULL OR f.duration = 0)
      AND f.type IN (${placeholders})
    LIMIT ?
  `).all(...typeList, limit);

  const { getDuration } = await import('@homelab/media-engine');
  let repaired = 0, errors = 0, skipped = 0;

  for (const file of files) {
    try {
      const engine = globalThis.mediaEngine;
      let fullPath = null;
      if (engine) {
        try { const r = await engine.resolve(file.id); fullPath = r?.fullPath || null; } catch {}
      }
      if (!fullPath) {
        const relPath = file.folder_path ? join(file.folder_path, file.name) : file.name;
        const { resolveFullPath: rfp } = await import('@homelab/media-engine');
        fullPath = rfp(relPath, engine?.mediaRoots || MEDIA_ROOTS);
      }
      if (!fullPath || !existsSync(fullPath)) { skipped++; continue; }
      const dur = await getDuration(fullPath);
      if (Math.round(dur) > 0) {
        db.prepare('UPDATE files SET duration = ? WHERE id = ?').run(Math.round(dur), file.id);
        repaired++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      log.error({ msg: 'duration repair error', file: file.name, error: err.message });
    }
  }

  log.info({ msg: 'duration repair done', repaired, errors, skipped });
  return { repaired, errors, skipped, total: files.length };
}
