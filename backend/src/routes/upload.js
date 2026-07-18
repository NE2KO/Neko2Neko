import { Router } from 'express';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { get } from '../utils/runtimeSettings.js';
import { handleUpload, getActiveUploads, cancelUpload, getUploadHistory, getUploadStats, repairMetadata, repairDurations } from '../utils/uploadManager.js';
import db from '../db.js';

const MEDIA_ROOTS = (process.env.MEDIA_ROOT || '/home/CATIAA/homelab').split(':').filter(Boolean);

const router = Router();

// Check if uploads are enabled
router.use((req, res, next) => {
  if (!get('upload.enabled', true)) {
    return res.status(403).json({ error: 'Uploads are disabled' });
  }
  next();
});

// POST /api/upload — Upload files (multipart)
router.post('/', (req, res) => {
  handleUpload(req, res);
});

// GET /api/upload/status — Active uploads with progress
router.get('/status', (req, res) => {
  res.json({
    active: getActiveUploads(),
    stats: getUploadStats(),
  });
});

// GET /api/upload/history — Past uploads
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json({ entries: getUploadHistory(limit) });
});

// DELETE /api/upload/:id — Cancel an active upload
router.delete('/:id', (req, res) => {
  const ok = cancelUpload(req.params.id);
  res.json({ ok });
});

// DELETE /api/upload/:id/file — Delete uploaded file from disk + DB
router.delete('/:id/file', async (req, res) => {
  const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!upload) {
    return res.status(404).json({ error: 'Upload record not found' });
  }

  const fullPath = join(MEDIA_ROOTS[0], upload.target_path);
  let fileDeleted = false;
  let dbCleaned = false;

  // Delete file from disk
  try {
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
      fileDeleted = true;
    }
  } catch (err) {
    console.error('[upload] Failed to delete file:', fullPath, err.message);
  }

  // Delete from files table
  try {
    // Compute file ID the same way as uploadManager
    const { getFileId } = await import('../utils/fileScanner.js');
    const fileId = getFileId(upload.target_path);
    const result = db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    if (result.changes > 0) dbCleaned = true;
  } catch (err) {
    console.error('[upload] Failed to delete from files table:', err.message);
  }

  // Delete upload record
  try {
    db.prepare('DELETE FROM uploads WHERE id = ?').run(req.params.id);
  } catch (err) {
    console.error('[upload] Failed to delete upload record:', err.message);
  }

  // Cancel active upload if still running
  cancelUpload(req.params.id);

  res.json({ ok: true, fileDeleted, dbCleaned });
});

// GET /api/upload/stats — Aggregate stats for monitoring
router.get('/stats', (req, res) => {
  res.json(getUploadStats());
});

// POST /api/upload/repair-metadata — Re-extract embedded timestamps for existing files
router.post('/repair-metadata', async (req, res) => {
  try {
    const result = await repairMetadata(req.query.limit ? parseInt(req.query.limit) : 100);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload/repair-durations — Re-extract durations for existing media files
router.post('/repair-durations', async (req, res) => {
  try {
    const result = await repairDurations(req.query.limit ? parseInt(req.query.limit) : 100);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
