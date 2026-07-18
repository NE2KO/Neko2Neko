import { Router } from 'express';
import db from '../db.js';
import { reload } from '../utils/runtimeSettings.js';
import { setPollInterval } from '../monitor/engine.js';

const router = Router();

const VALID_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'json', 'array']);

function castValue(value, type) {
  switch (type) {
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? 0 : n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      return Boolean(value);
    }
    case 'json':
    case 'array':
      try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; }
    default:
      return String(value);
  }
}

const dbSet = db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?');
const dbGetSetting = db.prepare('SELECT * FROM settings WHERE key = ?');
const dbInsertHistory = db.prepare('INSERT INTO settings_history (setting_key, old_value, new_value, type, action, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
const dbGetHistory = db.prepare('SELECT * FROM settings_history ORDER BY id DESC LIMIT ? OFFSET ?');
const dbGetHistoryById = db.prepare('SELECT * FROM settings_history WHERE id = ?');
const dbGetHistoryCount = db.prepare('SELECT COUNT(*) as cnt FROM settings_history');

router.get('/', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings ORDER BY category, key').all();
    const grouped = {};
    for (const s of settings) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push({
        ...s,
        value: s.type === 'boolean' ? (s.value === 'true' || s.value === '1') : castValue(s.value, s.type),
        options: s.options ? JSON.parse(s.options) : null,
      });
    }
    res.json({ settings: grouped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const entries = dbGetHistory.all(limit, offset);
    const total = dbGetHistoryCount.get().cnt;
    res.json({ entries, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rollback/:id', (req, res) => {
  try {
    const entry = dbGetHistoryById.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'History entry not found' });

    const existing = dbGetSetting.get(entry.setting_key);
    if (!existing) return res.status(404).json({ error: 'Setting no longer exists' });

    // Restore old value
    dbSet.run(entry.old_value, Date.now(), entry.setting_key);
    dbInsertHistory.run(entry.setting_key, entry.new_value, entry.old_value, existing.type, 'rollback', Date.now());
    reload();

    res.json({ key: entry.setting_key, value: castValue(entry.old_value, existing.type) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:category', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE category = ? ORDER BY key').all(req.params.category);
    res.json({ settings: settings.map(s => ({
      ...s,
      value: s.type === 'boolean' ? (s.value === 'true' || s.value === '1') : castValue(s.value, s.type),
      options: s.options ? JSON.parse(s.options) : null,
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:key', (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'Missing value' });

    const existing = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
    if (!existing) return res.status(404).json({ error: 'Setting not found' });

    if (req.params.key === 'retention.historyDays') {
      const n = Number(value);
      const valid = [0, 7, 14, 30, 90, 180, 365];
      if (!Number.isFinite(n) || !valid.includes(Math.floor(n))) {
        return res.status(400).json({ error: 'Invalid retention days. Must be one of: ' + valid.join(', ') });
      }
    }

    const converted = castValue(value, existing.type);
    const strValue = String(converted);
    const now = Date.now();

    // Store history before update
    dbInsertHistory.run(req.params.key, existing.value, strValue, existing.type, 'update', now);
    dbSet.run(strValue, now, req.params.key);
    reload();

    // Apply certain settings immediately without restart
    if (req.params.key === 'monitor.refreshInterval') {
      try { setPollInterval(converted); } catch {}
    }

    res.json({ key: req.params.key, value: converted, type: existing.type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { key, value, type = 'string', category = 'general', label = '', description = '', options } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    if (!VALID_TYPES.has(type)) return res.status(400).json({ error: `Invalid type: ${type}` });

    const strValue = String(value);
    const optsStr = options ? JSON.stringify(options) : null;
    const now = Date.now();

    // Check if replacing existing
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, type, category, label, description, options, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(key, strValue, type, category, label, description, optsStr, now);
    dbInsertHistory.run(key, existing || null, strValue, type, existing ? 'update' : 'create', now);
    reload();

    res.json({ key, value: castValue(strValue, type), type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:key', (req, res) => {
  try {
    const existing = db.prepare('SELECT value, type FROM settings WHERE key = ?').get(req.params.key);
    if (existing) {
      dbInsertHistory.run(req.params.key, existing.value, null, existing.type, 'delete', Date.now());
    }
    db.prepare('DELETE FROM settings WHERE key = ?').run(req.params.key);
    reload();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
