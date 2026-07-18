import { Router } from 'express';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import db, { stmts } from '../db.js';
import { getFileWithRelPath } from '../utils/fileResolver.js';
import { THUMBNAIL_DIR } from '../utils/thumbnailUtils.js';
import { ensureThumbnailForFile } from './thumbnails.js';
mkdirSync(THUMBNAIL_DIR, { recursive: true });

const DEFAULT_LIMIT = 5000;

const router = Router();

// GET /api/files?path=&folder_id=&cursor=&limit=&view=&sortBy=&sortOrder=
router.get('/', async (req, res) => {
  try {
    console.time('[files] API request');
    const folderPath = req.query.path || '';
    const folderIdQuery = req.query.folder_id ? parseInt(req.query.folder_id, 10) : null;
    const cursor = req.query.cursor || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 10000);
    const view = req.query.view || 'grid';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'desc';

    let folder;
    if (folderIdQuery) {
      folder = stmts.getFolder.get(folderIdQuery);
    } else {
      folder = stmts.getFolderByPath.get(folderPath);
      if (!folder) {
        const { ensureFolder } = await import('../utils/fileScanner.js');
        try {
          const newId = ensureFolder(folderPath);
          folder = stmts.getFolder.get(newId);
        } catch (e) {
          console.timeEnd('[files] API request');
          return res.json({ items: [], folders: [], next_cursor: null, has_more: false, total_count: 0 });
        }
      }
    }
    if (!folder) {
      console.timeEnd('[files] API request');
      return res.json({ items: [], folders: [], next_cursor: null, has_more: false, total_count: 0 });
    }

    const folders = stmts.getFoldersByParentDistinct.all(folder.id);

    let items;
    const hasCursor = !!cursor;
    const queryLimit = limit + 1;

    // Helper: extract cursor value for any sort field
    function parseCursor(c) {
      try { return JSON.parse(c); } catch { return null; }
    }

    if (hasCursor && sortBy === 'created_at' && sortOrder === 'desc') {
      // Cursor pagination for created_at DESC (original format, kept for backward compat)
      const [cursorCreatedAt, cursorId] = cursor.split('_');
      const createdAtNum = parseInt(cursorCreatedAt, 10) || 0;
      items = stmts.getFilesCursorWithPath.all(folder.id, createdAtNum, cursorId, queryLimit);
    } else if (hasCursor && sortBy === 'created_at' && sortOrder === 'asc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesCursorAscWithPath.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesFirstPageAscWithPath.all(folder.id, queryLimit);
    } else if (hasCursor && sortBy === 'mtime' && sortOrder === 'desc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesSortedByMtimeDescCursor.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesSortedByMtimeDescWithPath.all(folder.id, queryLimit);
    } else if (hasCursor && sortBy === 'mtime' && sortOrder === 'asc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesSortedByMtimeAscCursor.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesSortedByMtimeAscWithPath.all(folder.id, queryLimit);
    } else if (hasCursor && sortBy === 'name' && sortOrder === 'desc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesSortedByNameDescCursor.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesSortedByNameDescWithPath.all(folder.id, queryLimit);
    } else if (hasCursor && sortBy === 'name' && sortOrder === 'asc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesSortedByNameAscCursor.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesSortedByNameAscWithPath.all(folder.id, queryLimit);
    } else if (hasCursor && sortBy === 'size' && sortOrder === 'desc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesSortedBySizeDescCursor.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesSortedBySizeDescWithPath.all(folder.id, queryLimit);
    } else if (hasCursor && sortBy === 'size' && sortOrder === 'asc') {
      const c = parseCursor(cursor);
      if (c) items = stmts.getFilesSortedBySizeAscCursor.all(folder.id, c.v, c.v, c.id, queryLimit);
      else items = stmts.getFilesSortedBySizeAscWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'name' && sortOrder === 'asc') {
      items = stmts.getFilesSortedByNameAscWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'name' && sortOrder === 'desc') {
      items = stmts.getFilesSortedByNameDescWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'mtime' && sortOrder === 'asc') {
      items = stmts.getFilesSortedByMtimeAscWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'mtime' && sortOrder === 'desc') {
      items = stmts.getFilesSortedByMtimeDescWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'size' && sortOrder === 'asc') {
      items = stmts.getFilesSortedBySizeAscWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'size' && sortOrder === 'desc') {
      items = stmts.getFilesSortedBySizeDescWithPath.all(folder.id, queryLimit);
    } else if (sortBy === 'created_at' && sortOrder === 'asc') {
      items = stmts.getFilesFirstPageAscWithPath.all(folder.id, queryLimit);
    } else {
      // Default: created_at desc - first page when no cursor
      items = stmts.getFilesFirstPageWithPath.all(folder.id, queryLimit);
    }

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    // Generate cursor value from last item
    const lastItem = items[items.length - 1];
    let nextCursor = null;
    if (lastItem) {
      if (sortBy === 'created_at') {
        // Use legacy format for desc, JSON for asc
        if (sortOrder === 'desc') {
          nextCursor = `${lastItem.created_at}_${lastItem.id}`;
        } else {
          nextCursor = JSON.stringify({ v: lastItem.created_at, id: lastItem.id });
        }
      } else if (sortBy === 'mtime') {
        nextCursor = JSON.stringify({ v: lastItem.mtime, id: lastItem.id });
      } else if (sortBy === 'name') {
        nextCursor = JSON.stringify({ v: lastItem.name, id: lastItem.id });
      } else if (sortBy === 'size') {
        nextCursor = JSON.stringify({ v: lastItem.size, id: lastItem.id });
      } else {
        nextCursor = `${lastItem.created_at}_${lastItem.id}`;
      }
    }

    const shapedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      ext: item.ext,
      size: item.size,
      mtime: item.mtime,
      created_at: item.created_at,
      has_thumb: item.has_thumb,
      dir_path: item.dir_path,
      duration: item.duration || 0,
      bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
      uploaded_at: item.uploaded_at || null,
      is_favorite: item.is_favorite || 0,
    }));

    // Batch fetch folder previews (single query, no N+1)
    let previewsByFolder = {};
    if (folders.length > 0) {
      const folderIds = folders.map(f => f.id);
      const placeholders = folderIds.map(() => '?').join(',');
      const previewRows = db.prepare(`
        SELECT id, type, has_thumb, dir_id FROM files
        WHERE dir_id IN (${placeholders})
        ORDER BY
          CASE type
            WHEN 'image' THEN 1
            WHEN 'video' THEN 2
            WHEN 'audio' THEN 3
            ELSE 4
          END,
          id ASC
      `).all(...folderIds);
      previewsByFolder = {};
      for (const row of previewRows) {
        if (!previewsByFolder[row.dir_id]) {
          previewsByFolder[row.dir_id] = [];
        }
        if (previewsByFolder[row.dir_id].length < 4) {
          previewsByFolder[row.dir_id].push({ id: row.id, name: row.name, type: row.type, has_thumb: row.has_thumb });
        }
      }
    }

    // Pre-generate thumbnails for first page items in background. Kept tiny
    // (2) and skips video: video thumbs are the most expensive ffmpeg job, and
    // generating a burst of them on *every* folder open spikes CPU right when the
    // user is about to click into media — which is what made folder open feel
    // heavy. Image/audio covers are cheap; video thumbs generate lazily on demand.
    if (shapedItems.length > 0) {
      const pregenLimit = Math.min(shapedItems.length, 2);
      for (let i = 0; i < pregenLimit; i++) {
        const item = shapedItems[i];
        if (item.has_thumb || item.type === 'video') continue;
        const file = getFileWithRelPath(item.id);
        if (file && file.fullPath) {
          ensureThumbnailForFile(file).catch(() => {});
        }
      }
    }

    console.timeEnd('[files] API request');
    res.json({
      items: shapedItems,
      folders: folders.map((f) => ({
        id: f.id,
        path: f.path,
        name: f.path.split('/').pop(),
        type: 'folder',
        file_count: f.file_count,
        total_size: f.total_size,
        subfolder_count: f.subfolder_count,
        previews: previewsByFolder[f.id] || [],
      })),
      current_folder: {
        id: folder.id,
        path: folder.path,
        name: folder.path.split('/').pop(),
        type: 'folder',
        file_count: folder.file_count,
        total_size: folder.total_size,
      },
      next_cursor: nextCursor,
      has_more: hasMore,
      total_count: folder.file_count,
    });
  } catch (err) {
    console.error('[files] Error:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

const SHUFFLE_LIMIT = 50000;

// GET /api/files/shuffle — all playable files in random order
router.get('/shuffle', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || SHUFFLE_LIMIT, 100000);
    const items = db.prepare(`
      SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.duration, f.created_at, f.uploaded_at, f.is_favorite,
             d.path as dir_path
      FROM files f
      JOIN folders d ON f.dir_id = d.id
      WHERE f.ROWID IN (
        SELECT ROWID FROM files
        WHERE type IN ('video', 'audio')
        ORDER BY RANDOM()
        LIMIT ?
      )
    `).all(limit);

    const shapedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      ext: item.ext,
      size: item.size,
      mtime: item.mtime,
      created_at: item.created_at,
      uploaded_at: item.uploaded_at || null,
      has_thumb: item.has_thumb,
      dir_id: item.dir_id,
      dir_path: item.dir_path,
      duration: item.duration || 0,
      bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
    }));

    // Pre-generate thumbnails for first items in background (limited)
    if (shapedItems.length > 0) {
      const pregenLimit = Math.min(shapedItems.length, 4);
      for (let i = 0; i < pregenLimit; i++) {
        const item = shapedItems[i];
        if (item.has_thumb) continue;
        const file = getFileWithRelPath(item.id);
        if (file && file.fullPath) {
          ensureThumbnailForFile(file).catch(() => {});
        }
      }
    }

    res.json({ items: shapedItems, has_more: items.length === limit });
  } catch (err) {
    console.error('[files/shuffle] Error:', err);
    res.status(500).json({ error: 'Failed to fetch shuffle' });
  }
});

// POST /api/refresh - trigger incremental sync + orphan cleanup
router.post('/refresh', async (req, res) => {
  try {
    const { runIncrementalScan } = await import('../utils/watcher.js');
    await runIncrementalScan();

    // Also run orphan cleanup
    const { cleanupOrphanEntries } = await import('../utils/maintenance.js');
    const deleted = cleanupOrphanEntries();

    const total = stmts.countTotalFiles.get();
    res.json({ message: 'Sync complete', total: total.total, deleted });
  } catch (err) {
    console.error('[files/refresh] Error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// POST /api/files/cleanup - remove orphan entries
router.post('/cleanup', async (req, res) => {
  try {
    const { cleanupOrphanEntries } = await import('../utils/maintenance.js');
    const deleted = cleanupOrphanEntries();
    res.json({ message: `Removed ${deleted} orphan entries`, deleted });
  } catch (err) {
    console.error('[files/cleanup] Error:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// GET /api/files/stats - quick file type stats
router.get('/stats', async (req, res) => {
  try {
    const stats = stmts.countFilesByType.all();
    const total = stmts.countTotalFiles.get();

    res.json({
      total: total.total,
      videos: stats.find((s) => s.type === 'video')?.count || 0,
      audio: stats.find((s) => s.type === 'audio')?.count || 0,
      images: stats.find((s) => s.type === 'image')?.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// GET /api/folders/:id - resolve folder ID to path
router.get('/folders/:id', async (req, res) => {
  try {
    const folder = db.prepare('SELECT id, path, parent_id, depth, file_count, total_size FROM folders WHERE id = ?').get(req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json(folder);
  } catch (err) {
    console.error('[folders/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch folder' });
  }
});

// GET /api/folders/:id/previews - get a few preview file IDs for a folder
router.get('/:id/previews', async (req, res) => {
  try {
    const folderId = parseInt(req.params.id, 10);
    if (isNaN(folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID' });
    }
    const previewFiles = stmts.getPreviewFilesForFolder.all(folderId, 4); // Get up to 4 previews
    return res.json(previewFiles.map(f => ({ id: f.id, type: f.type, has_thumb: f.has_thumb })));
  } catch (err) {
    console.error('[folders/:id/previews] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch folder previews' });
  }
});

// GET /api/search?q=&scope=&folder_id=&type=&sort=&limit=
router.get('/search', async (req, res) => {
  try {
    const { q, scope = 'all', folder_id, type = 'all', sort = 'name_asc', limit = 100 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ folders: [], files: [], total: 0 });
    }

    const query = q.trim();
    const limitNum = Math.min(parseInt(limit, 10) || 100, 200);
    
    // Escape FTS special chars
    const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"*`).join(' ');
    
    let folders = [];
    let files = [];
    
    // === Search Folders (always via LIKE for folders) ===
    const folderLikeQuery = `%${query}%`;
    
    if (scope === 'current' && folder_id) {
      // Search in current folder + direct subfolders
      folders = stmts.searchFoldersScoped.all(folderLikeQuery, parseInt(folder_id), parseInt(folder_id), limitNum);
    } else {
      // Global search - all folders
      folders = stmts.searchFolders.all(folderLikeQuery, limitNum);
    }
    
    // === Search Files (FTS for speed) ===
    if (type === 'folder') {
      files = [];
    } else {
      const ftsResults = scope === 'current' && folder_id
        ? stmts.searchFilesFTSScoped.all(ftsQuery, parseInt(folder_id), limitNum)
        : stmts.searchFilesFTS.all(ftsQuery, limitNum);
      
      // Filter by type if needed
      if (type && type !== 'all') {
        files = ftsResults.filter(f => f.type === type);
      } else {
        files = ftsResults;
      }
      
      // Additional sort if needed
      if (sort === 'name_asc') {
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      } else if (sort === 'name_desc') {
        files.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
      } else if (sort === 'mtime_desc') {
        files.sort((a, b) => b.mtime - a.mtime);
      } else if (sort === 'mtime_asc') {
        files.sort((a, b) => a.mtime - b.mtime);
      } else if (sort === 'size_desc') {
        files.sort((a, b) => b.size - a.size);
      } else if (sort === 'size_asc') {
        files.sort((a, b) => a.size - b.size);
      }
    }
    
    // Shape output
    const shapedFolders = folders.map(f => ({
      id: f.id,
      path: f.path,
      name: f.path.split('/').pop(),
      type: 'folder',
      file_count: f.file_count,
      total_size: f.total_size,
      subfolder_count: f.subfolder_count,
    }));
    
    const shapedFiles = files.map(f => ({
      id: f.id,
      name: f.name,
      type: f.type,
      ext: f.ext,
      size: f.size,
      mtime: f.mtime,
      created_at: f.created_at,
      uploaded_at: f.uploaded_at || null,
      has_thumb: f.has_thumb,
      dir_path: f.dir_path || '',
    }));
    
    res.json({
      folders: shapedFolders,
      files: shapedFiles,
      total: shapedFolders.length + shapedFiles.length,
    });
  } catch (err) {
    console.error('[search] Error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/search/suggest?q= - quick suggestions for autocomplete
router.get('/search/suggest', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ suggestions: [] });
    }
    
    const query = `%${q.trim()}%`;
    const suggestions = db.prepare(`
      SELECT DISTINCT name FROM files 
      WHERE name LIKE ? 
      ORDER BY name 
      LIMIT 10
    `).all(query);
    
    res.json({ suggestions: suggestions.map(s => s.name) });
  } catch (err) {
    res.status(500).json({ error: 'Suggestions failed' });
  }
});

// PATCH /api/files/:id/favorite — toggle favorite
router.patch('/:id/favorite', (req, res) => {
  try {
    const file = stmts.getFile.get(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    const newVal = file.is_favorite ? 0 : 1;
    db.prepare('UPDATE files SET is_favorite = ? WHERE id = ?').run(newVal, req.params.id);
    res.json({ id: req.params.id, is_favorite: newVal });
  } catch (err) {
    console.error('[files/favorite] Error:', err);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// GET /api/files/:id - get single file by ID
router.get('/:id', async (req, res) => {
  try {
    const file = stmts.getFileWithPath.get(req.params.id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json({
      ...file,
      bitrate: file.duration > 0 ? Math.round(file.size / file.duration) : 0,
      is_favorite: file.is_favorite || 0,
    });
  } catch (err) {
    console.error('[files/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// POST /api/files/resolve-batch — batch resolve filenames to file IDs
router.post('/resolve-batch', (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'filenames array required' });
    }
    const unique = [...new Set(filenames)];
    const placeholders = unique.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, name FROM files WHERE name IN (${placeholders})`).all(...unique);
    const results = {};
    for (const row of rows) {
      results[row.name] = row.id;
    }
    res.json({ results });
  } catch (err) {
    console.error('[files/resolve-batch] Error:', err);
    res.status(500).json({ error: 'Failed to resolve batch' });
  }
});

export default router;
export { THUMBNAIL_DIR };
