export default {
  type: 'function',
  name: 'vault_media_meta',
  description: 'Get detailed metadata for a specific file. Returns format, dimensions, duration, codec, thumbnails, and other metadata.',
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'File ID from the vault' },
    },
    required: ['fileId'],
  },
  async call(ctx, { fileId }) {
    const { db } = ctx;
    try {
      const file = db.prepare('SELECT f.*, COALESCE(fo.path, "") as dir_path FROM files f LEFT JOIN folders fo ON f.dir_id = fo.id WHERE f.id = ?').get(fileId);
      if (!file) return JSON.stringify({ error: 'File not found' });
      const { dir_path, ...meta } = file;
      return JSON.stringify({ id: file.id, name: file.name, type: file.type, ext: file.ext, path: dir_path, meta });
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  },
};
