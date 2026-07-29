export default {
  type: 'function',
  name: 'vault_playlists',
  description: 'List playlists and collections from the media vault. Returns playlist names, track counts, and durations.',
  parameters: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Filter playlists by title (optional)' },
      limit: { type: 'number', description: 'Max results (1-50)', default: 20 },
    },
    required: [],
  },
  async call(ctx, { search = '', limit = 20 }) {
    const { db } = ctx;
    try {
      let rows;
      if (search) {
        rows = db.prepare('SELECT id, path, title, track_count, total_duration, total_size FROM playlists WHERE deleted_at IS NULL AND title LIKE ? ORDER BY title ASC LIMIT ?').all(`%${search}%`, limit);
      } else {
        rows = db.prepare('SELECT id, path, title, track_count, total_duration, total_size FROM playlists WHERE deleted_at IS NULL ORDER BY title ASC LIMIT ?').all(limit);
      }
      return JSON.stringify({ playlists: rows.map(p => ({ id: p.id, title: p.title, path: p.path, trackCount: p.track_count, duration: p.total_duration, size: p.total_size })) });
    } catch (err) {
      return JSON.stringify({ error: err.message, playlists: [] });
    }
  },
};
