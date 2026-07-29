export default {
  type: 'function',
  name: 'vault_media_filter',
  description: 'Filter media vault files by type, recency, or favorites. Useful when the user asks for recently added files or favorites.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['all', 'video', 'audio', 'image'], description: 'Media type filter', default: 'all' },
      favoritesOnly: { type: 'boolean', description: 'Only favorites', default: false },
      recentSince: { type: 'string', description: 'ISO date or relative (e.g. 7d)', default: '' },
      limit: { type: 'number', description: 'Max results (1-50)', default: 20 },
      sortBy: { type: 'string', enum: ['name', 'mtime', 'size'], description: 'Sort field', default: 'mtime' },
      sortOrder: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order', default: 'desc' },
    },
    required: [],
  },
  async call(ctx, { type = 'all', favoritesOnly = false, recentSince = '', limit = 20, sortBy = 'mtime', sortOrder = 'desc' }) {
    const { db } = ctx;
    let sql = 'SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, COALESCE(fo.path,"") as dir_path FROM files f LEFT JOIN folders fo ON f.dir_id = fo.id WHERE 1=1';
    const params = [];
    if (type !== 'all') { sql += ` AND f.type = ?`; params.push(type); }
    if (favoritesOnly) { sql += ` AND f.is_favorite = 1`; }
    if (recentSince) {
      const ms = new Date(recentSince).getTime();
      if (!isNaN(ms)) { sql += ` AND f.created_at > ?`; params.push(ms); }
    }
    const orderCol = sortBy === 'name' ? 'f.name COLLATE NOCASE' : sortBy === 'size' ? 'f.size' : 'f.mtime';
    sql += ` ORDER BY ${orderCol} ${sortOrder.toUpperCase()}, f.id ASC LIMIT ?`;
    params.push(limit);
    try {
      const rows = db.prepare(sql).all(...params);
      return JSON.stringify({ filters: { type, favoritesOnly, recentSince }, results: rows.map(r => ({ id: r.id, name: r.name, type: r.type, ext: r.ext, size: r.size, path: r.dir_path })) });
    } catch (err) {
      return JSON.stringify({ error: err.message, results: [] });
    }
  },
};
