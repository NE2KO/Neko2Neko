export default {
  type: 'function',
  name: 'vault_media_folder',
  description: 'Browse the media vault folder structure. Returns folder contents, subfolders, and file counts.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder path (empty = root)' },
      depth: { type: 'number', description: 'Max folder depth (1-5)', default: 1 },
      limit: { type: 'number', description: 'Max files to return', default: 50 },
    },
    required: ['path'],
  },
  async call(ctx, { path, depth = 1, limit = 50 }) {
    const { db } = ctx;
    const folderPath = path || '/';
    try {
      const folder = db.prepare('SELECT * FROM folders WHERE path = ?').get(folderPath);
      if (!folder) return JSON.stringify({ path: folderPath, error: 'Folder not found', files: [], folders: [] });
      const files = db.prepare('SELECT id, name, type, ext, size, mtime FROM files WHERE dir_id = ? LIMIT ?').all(folder.id, limit);
      const subfolders = db.prepare('SELECT id, path, file_count FROM folders WHERE parent_id = ?').all(folder.id);
      return JSON.stringify({
        path: folderPath,
        fileCount: folder.file_count,
        files: files.map(f => ({ id: f.id, name: f.name, type: f.type, ext: f.ext, size: f.size, mtime: f.mtime })),
        folders: subfolders.map(sf => ({ id: sf.id, path: sf.path, fileCount: sf.file_count })),
      });
    } catch (err) {
      return JSON.stringify({ path: folderPath, error: err.message, files: [], folders: [] });
    }
  },
};
