import { Router } from 'express';
import { existsSync, createReadStream, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getFileWithRelPath } from '../utils/fileResolver.js';
import db from '../db.js';
import { stmts } from '../db.js';
import { spawn } from 'node:child_process';
import { hasEmbeddedCover, extractEmbeddedThumbnail, extractFrameThumbnail, generateImageThumbnail, THUMBNAIL_DIR, getThumbPath } from '../utils/thumbnailUtils.js';
import { get } from '../utils/runtimeSettings.js';

mkdirSync(THUMBNAIL_DIR, { recursive: true });

const router = Router();

const generating = new Map();
let activeGenerations = 0;
const generationQueue = [];

function getMaxConcurrent() {
  return get('thumb.concurrent', 8);
}

function processGenerationQueue() {
  const maxConcurrent = getMaxConcurrent();
  while (generationQueue.length > 0 && activeGenerations < maxConcurrent) {
    const next = generationQueue.shift();
    activeGenerations++;
    next().finally(() => {
      activeGenerations--;
      processGenerationQueue();
    });
  }
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function generateAudioPlaceholder(outPath) {
  return runFfmpeg([
    '-f', 'lavfi',
    '-i', 'color=c=#2a1a3a:s=300x300:d=1',
    '-vf', 'drawtext=text=♪:fontcolor=#a78bfa:fontsize=80:x=(w-text_w)/2:y=(h-text_h)/2',
    '-frames:v', '1',
    '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '6', '-y', outPath,
  ]);
}

async function doGenerateThumbnail(file, outPath) {
  const quality = get('perf.thumbQuality', 10);
  if (file.type === 'image') {
    return generateImageThumbnail(file.fullPath, outPath, quality);
  }

  if (file.type === 'audio') {
    const coverInfo = await hasEmbeddedCover(file.fullPath);
    if (coverInfo) {
      return extractEmbeddedThumbnail(file.fullPath, outPath);
    }
    return generateAudioPlaceholder(outPath);
  }

  const coverInfo = await hasEmbeddedCover(file.fullPath);
  if (coverInfo) {
    return extractEmbeddedThumbnail(file.fullPath, outPath);
  }
  return extractFrameThumbnail(file.fullPath, outPath, quality);
}

async function generateThumbnailSingle(file) {
  const thumbPath = getThumbPath(file.id);
  if (existsSync(thumbPath)) return thumbPath;

  if (generating.has(file.id)) {
    return generating.get(file.id);
  }

  const thumbDir = join(thumbPath, '..');
  mkdirSync(thumbDir, { recursive: true });

  const promise = doGenerateThumbnail(file, thumbPath);
  generating.set(file.id, promise);
  try {
    const result = await promise;
    return result ? thumbPath : null;
  } finally {
    generating.delete(file.id);
  }
}

function runWithinSlot(fn) {
  const maxConcurrent = getMaxConcurrent();
  if (activeGenerations < maxConcurrent) {
    activeGenerations++;
    const result = fn();
    if (result && typeof result.finally === 'function') {
      return result.finally(() => {
        activeGenerations--;
        processGenerationQueue();
      });
    }
    activeGenerations--;
    processGenerationQueue();
    return result;
  }

  return new Promise((resolve, reject) => {
    generationQueue.push(() => {
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.then(resolve, reject);
      }
      resolve(result);
      return Promise.resolve(result);
    });
  });
}

async function ensureThumbnailForFile(file) {
  const thumbPath = getThumbPath(file.id);
  if (existsSync(thumbPath)) return thumbPath;

  return runWithinSlot(() => generateThumbnailSingle(file));
}

async function getFolderPreviewFiles(folderId) {
  const files = db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.mtime
    FROM files f
    WHERE f.dir_id = ?
    ORDER BY f.mtime DESC
    LIMIT 4
  `).all(folderId);

  if (files.length === 0) return [];

  const result = [];
  for (const f of files) {
    const full = getFileWithRelPath(f.id);
    if (full) result.push(full);
  }
  return result;
}

async function generateDefaultFolderThumb(outPath) {
  return runFfmpeg([
    '-f', 'lavfi',
    '-i', 'color=c=#78350f:s=300x300:d=1',
    '-vf', 'drawtext=text=📁:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2',
    '-frames:v', '1',
    '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '6', '-y', outPath,
  ]);
}

async function generateFolderPreview(folderId) {
  const folder = stmts.getFolderById.get(folderId);
  if (!folder) return false;

  const outPath = join(THUMBNAIL_DIR, `folder_${folderId}.jpg`);
  if (existsSync(outPath)) return true;

  const previewFiles = await getFolderPreviewFiles(folderId);

  if (previewFiles.length === 0) {
    return generateDefaultFolderThumb(outPath);
  }

  const tmpDir = join(THUMBNAIL_DIR, 'tmp_folder_preview');
  mkdirSync(tmpDir, { recursive: true });

  try {
    const thumbPaths = [];
    for (const file of previewFiles) {
      const tp = await ensureThumbnailForFile(file);
      if (tp) thumbPaths.push(tp);
    }

    if (thumbPaths.length === 0) {
      return generateDefaultFolderThumb(outPath);
    }

    const CELL = 150;
    const cols = Math.min(thumbPaths.length, 2);
    const rows = Math.ceil(thumbPaths.length / 2);

    if (thumbPaths.length === 1) {
      const args = [
        '-i', thumbPaths[0],
        '-vf', `scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=black`,
        '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '7', '-y', outPath,
      ];
      return await runFfmpeg(args);
    }

    const inputs = [];
    const filterParts = [];
    for (let i = 0; i < thumbPaths.length; i++) {
      inputs.push('-i', thumbPaths[i]);
      filterParts.push(`[${i}:v]scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=black[v${i}]`);
    }

    const padPositions = [];
    for (let i = 0; i < thumbPaths.length; i++) {
      padPositions.push(`${(i % 2) * CELL}:${Math.floor(i / 2) * CELL}`);
    }

    const inputsStr = thumbPaths.map((_, i) => `[v${i}]`).join('');
    const xstackFilter = `${filterParts.join(';')};${inputsStr}xstack=inputs=${thumbPaths.length}:layout=${padPositions.join('|')}`;

    const args = [...inputs, '-filter_complex', xstackFilter, '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '7', '-y', outPath];
    return await runFfmpeg(args);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

router.get('/:id.jpg', async (req, res) => {
  const { id } = req.params;
  const hashedPath = getThumbPath(id);
  const flatPath = join(THUMBNAIL_DIR, `${id}.jpg`);

  const tryServe = (path) => {
    if (existsSync(path)) {
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Type', 'image/jpeg');
      return createReadStream(path).pipe(res);
    }
    return null;
  };

  const served = tryServe(hashedPath) || tryServe(flatPath);
  if (served) return;

  if (generating.has(id)) {
    try { await generating.get(id); } catch {}
    const served2 = tryServe(hashedPath) || tryServe(flatPath);
    if (served2) return;
    return res.status(404).json({ error: 'Thumbnail generation failed' });
  }

  const file = getFileWithRelPath(id);
  if (!file || !file.fullPath) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const thumbPath = await ensureThumbnailForFile(file);
    const served3 = tryServe(thumbPath || '') || tryServe(hashedPath) || tryServe(flatPath);
    if (served3) return;
    return res.status(404).json({ error: 'Thumbnail not found' });
  } catch {
    return res.status(500).json({ error: 'Thumbnail generation failed' });
  }
});

router.get('/folder/:id.jpg', async (req, res) => {
  const { id } = req.params;
  const outPath = join(THUMBNAIL_DIR, `folder_${id}.jpg`);

  if (existsSync(outPath)) {
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Content-Type', 'image/jpeg');
    return createReadStream(outPath).pipe(res);
  }

  const key = `folder_${id}`;
  if (generating.has(key)) {
    try {
      await generating.get(key);
      if (existsSync(outPath)) {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('Content-Type', 'image/jpeg');
        return createReadStream(outPath).pipe(res);
      }
    } catch {}
    return res.status(404).json({ error: 'Folder preview not available' });
  }

  try {
    const ok = await runWithinSlot(() => {
      const promise = generateFolderPreview(id);
      generating.set(key, promise);
      return promise;
    });
    if (ok && existsSync(outPath)) {
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Type', 'image/jpeg');
      return createReadStream(outPath).pipe(res);
    }
    return res.status(404).json({ error: 'Folder preview not available' });
  } catch {
    return res.status(500).json({ error: 'Folder preview generation failed' });
  } finally {
    generating.delete(key);
  }
});

export default router;
export { THUMBNAIL_DIR, ensureThumbnailForFile, runWithinSlot, generateThumbnailSingle };
