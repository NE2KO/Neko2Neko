export default {
  type: 'function',
  name: 'vault_media_search',
  description: 'Search the media vault using full-text search. Returns matching files and folders with metadata. Use this when the user asks to find specific media.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (title, name, keywords)' },
      limit: { type: 'number', description: 'Max results (1-50)', default: 20 },
      type: { type: 'string', enum: ['all', 'video', 'audio', 'image'], description: 'Filter by media type', default: 'all' },
    },
    required: ['query'],
  },
  async call(ctx, { query, limit = 20, type = 'all' }) {
    const { stmts, db } = ctx;
    const folderIds = new Set();
    let sql = `SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.dir_id, COALESCE(fo.path,'') as dir_path FROM files f LEFT JOIN folders fo ON f.dir_id = fo.id WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)`;
    const params = [query];
    if (type !== 'all') { sql += ` AND f.type = ?`; params.push(type); }
    sql += ` ORDER BY f.created_at DESC LIMIT ?`;
    params.push(limit);
    try {
      const rows = db.prepare(sql).all(...params);
      return JSON.stringify({ query, results: rows.map(r => ({ id: r.id, name: r.name, type: r.type, ext: r.ext, size: r.size, path: r.dir_path })) });
    } catch (err) {
      return JSON.stringify({ query, error: err.message, results: [] });
    }
  },
};
