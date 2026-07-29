export default {
  type: 'function',
  name: 'system_stats',
  description: 'Return basic system statistics about the media server: uptime, total media count, total storage used, and recent scanning activity. Use when the user asks about the server status.',
  parameters: {
    type: 'object',
    properties: {
      detail: { type: 'string', enum: ['summary', 'full'], description: 'Detail level', default: 'summary' },
    },
    required: [],
  },
  async call(ctx, { detail = 'summary' }) {
    const { db } = ctx;
    try {
      const totalFiles = db.prepare('SELECT COUNT(*) as total FROM files').get().total;
      const totalSize = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM files').get().total;
      const byType = db.prepare('SELECT type, COUNT(*) as count, COALESCE(SUM(size), 0) as size FROM files GROUP BY type').all();
      const lastScan = db.prepare('SELECT MAX(last_scanned) as ts FROM folders').get().ts;
      const uptime = process.uptime ? Math.floor(process.uptime()) : 0;
      const stats = { uptimeSeconds: uptime, totalFiles, totalSizeBytes: totalSize, byType, lastScanTimestamp: lastScan };
      return JSON.stringify(stats);
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  },
};
