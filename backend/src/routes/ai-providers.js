import { Router } from 'express';
import { createAdapter } from '../ai/providers/registry.js';

const r = Router();

function getSetting(key) {
  try {
    const row = globalThis.db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key);
    return row !== undefined ? row : undefined;
  } catch { return undefined; }
}

function parseJson(val, fallback = null) {
  try { return JSON.parse(val); } catch { return fallback; }
}

function getAiSettings() {
  return {
    providers: parseJson(getSetting('ai.providers') || '[]', []),
    defaultProvider: getSetting('ai.defaultProvider') || 'openai',
    defaultModel: getSetting('ai.defaultModel') || 'gpt-4o-mini',
  };
}

function maskKey(key) {
  if (!key || key.length <= 8) return key ? '***' : '';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

const PROVIDER_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1' },
  anthropic: { baseUrl: 'https://api.anthropic.com' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com' },
  ollama: { baseUrl: 'http://localhost:11434' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1' },
  custom: { baseUrl: '' },
};

function detectProviderType(baseUrl) {
  if (!baseUrl) return 'custom';
  const u = baseUrl.toLowerCase();
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('groq.com')) return 'groq';
  if (u.includes('deepseek.com')) return 'deepseek';
  if (u.includes('openai.com')) return 'openai';
  if (u.includes('anthropic.com')) return 'anthropic';
  if (u.includes('googleapis.com')) return 'google';
  if (u.includes('localhost') || u.includes('127.0.0.1')) return 'ollama';
  return 'custom';
}

// GET /api/ai/providers/status — status of all providers
r.get('/status', (req, res) => {
  try {
    const rows = globalThis.db.prepare('SELECT * FROM ai_provider_status').all();
    const aiSettings = getAiSettings();
    const providers = aiSettings.providers.map(p => {
      const status = rows.find(s => s.provider_id === p.id);
      return {
        id: p.id,
        type: p.type,
        name: p.name,
        baseUrl: p.baseUrl,
        maskedKey: maskKey(p.apiKey),
        status: status?.status || 'disconnected',
        latencyMs: status?.latency_ms || null,
        lastVerifiedAt: status?.last_verified_at || null,
        modelCount: status ? parseJson(status.models_json, []).length : 0,
        modelsCachedAt: status?.models_cached_at || null,
        errorMessage: status?.error_message || null,
      };
    });
    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/providers/:id/verify — verify provider connection and retrieve models
r.post('/:id/verify', async (req, res) => {
  const { id } = req.params;
  const aiSettings = getAiSettings();
  const pCfg = aiSettings.providers.find(p => p.id === id);
  if (!pCfg) return res.status(404).json({ error: 'Provider not found' });

  const now = Date.now();
  try {
    globalThis.db.prepare(
      "INSERT OR REPLACE INTO ai_provider_status (provider_id, status, last_verified_at, error_message) VALUES (?, 'connecting', ?, NULL)"
    ).run(id, now);

    const adapter = createAdapter(pCfg);
    const configCheck = adapter.validateConfig();
    if (!configCheck.valid) {
      globalThis.db.prepare(
        "UPDATE ai_provider_status SET status = 'invalid_key', error_message = ?, last_verified_at = ? WHERE provider_id = ?"
      ).run(configCheck.error, now, id);
      return res.json({ status: 'invalid_key', error: configCheck.error });
    }

    const t0 = Date.now();
    let models = [];
    try {
      models = await adapter.listModels();
    } catch (e) {
      console.warn(`[ai-providers] listModels failed for ${id}:`, e.message);
    }
    const latencyMs = Date.now() - t0;

    globalThis.db.prepare(
      "INSERT OR REPLACE INTO ai_provider_status (provider_id, status, last_verified_at, latency_ms, models_json, models_cached_at, error_message) VALUES (?, 'verified', ?, ?, ?, ?, NULL)"
    ).run(id, now, latencyMs, JSON.stringify(models), now);

    res.json({
      status: 'verified',
      latencyMs,
      models,
      modelCount: models.length,
    });
  } catch (err) {
    const errorMsg = err.message || 'Unknown error';
    let status = 'error';
    if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.toLowerCase().includes('invalid') || errorMsg.toLowerCase().includes('unauthorized')) {
      status = 'invalid_key';
    } else if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('rate limit')) {
      status = 'quota_exceeded';
    } else if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('fetch')) {
      status = 'network_error';
    }

    try {
      globalThis.db.prepare(
        "INSERT OR REPLACE INTO ai_provider_status (provider_id, status, last_verified_at, error_message) VALUES (?, ?, ?, ?)"
      ).run(id, status, now, errorMsg);
    } catch {}

    res.json({ status, error: errorMsg });
  }
});

// GET /api/ai/providers/:id/models — get models (cached or fresh)
r.get('/:id/models', async (req, res) => {
  const { id } = req.params;
  const aiSettings = getAiSettings();
  const pCfg = aiSettings.providers.find(p => p.id === id);
  if (!pCfg) return res.status(404).json({ error: 'Provider not found' });

  const forceRefresh = req.query.refresh === 'true';

  if (!forceRefresh) {
    const cached = globalThis.db.prepare('SELECT models_json, models_cached_at FROM ai_provider_status WHERE provider_id = ?').get(id);
    if (cached && cached.models_cached_at) {
      const age = Date.now() - cached.models_cached_at;
      if (age < 3600000) { // 1 hour cache
        return res.json({ models: parseJson(cached.models_json, []), cached: true, lastUpdated: cached.models_cached_at });
      }
    }
  }

  try {
    const adapter = createAdapter(pCfg);
    const models = await adapter.listModels();
    const now = Date.now();

    globalThis.db.prepare(
      "INSERT OR REPLACE INTO ai_provider_status (provider_id, status, last_verified_at, models_json, models_cached_at) VALUES (?, COALESCE((SELECT status FROM ai_provider_status WHERE provider_id = ?), 'verified'), ?, ?, ?)"
    ).run(id, id, now, JSON.stringify(models), now);

    res.json({ models, cached: false, lastUpdated: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/providers/:id/models/refresh — force refresh model cache
r.post('/:id/models/refresh', async (req, res) => {
  const { id } = req.params;
  const aiSettings = getAiSettings();
  const pCfg = aiSettings.providers.find(p => p.id === id);
  if (!pCfg) return res.status(404).json({ error: 'Provider not found' });

  try {
    const adapter = createAdapter(pCfg);
    const models = await adapter.listModels();
    const now = Date.now();

    globalThis.db.prepare(
      "INSERT OR REPLACE INTO ai_provider_status (provider_id, status, last_verified_at, models_json, models_cached_at) VALUES (?, COALESCE((SELECT status FROM ai_provider_status WHERE provider_id = ?), 'verified'), ?, ?, ?)"
    ).run(id, id, now, JSON.stringify(models), now);

    res.json({ ok: true, models, lastUpdated: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/models — all models across providers with preferences
r.get('/', (req, res) => {
  const aiSettings = getAiSettings();
  const { provider, search, sort } = req.query;

  const allPreferences = globalThis.db.prepare('SELECT * FROM ai_model_preferences').all();
  const prefMap = {};
  for (const p of allPreferences) {
    prefMap[`${p.provider_id}:${p.model_id}`] = p;
  }

  const result = [];
  for (const p of aiSettings.providers) {
    if (provider && p.id !== provider) continue;
    if (p.disabled) continue;

    const status = globalThis.db.prepare('SELECT models_json FROM ai_provider_status WHERE provider_id = ?').get(p.id);
    const models = status ? parseJson(status.models_json, []) : (p.models || []);

    for (const modelId of models) {
      const pref = prefMap[`${p.id}:${modelId}`] || {};
      if (pref.hidden) continue;
      if (search && !modelId.toLowerCase().includes(search.toLowerCase())) continue;

      result.push({
        providerId: p.id,
        providerName: p.name,
        providerType: p.type,
        modelId,
        favorited: !!pref.favorited,
        lastUsedAt: pref.last_used_at || null,
      });
    }
  }

  if (sort === 'lastUsed') {
    result.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  } else if (sort === 'name') {
    result.sort((a, b) => a.modelId.localeCompare(b.modelId));
  } else {
    result.sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
  }

  res.json({ models: result });
});

// POST /api/ai/models/preferences — update model preference
r.post('/preferences', (req, res) => {
  const { providerId, modelId, favorited, hidden } = req.body || {};
  if (!providerId || !modelId) return res.status(400).json({ error: 'providerId and modelId are required' });

  const existing = globalThis.db.prepare('SELECT * FROM ai_model_preferences WHERE provider_id = ? AND model_id = ?').get(providerId, modelId);
  const now = Date.now();

  globalThis.db.prepare(
    'INSERT OR REPLACE INTO ai_model_preferences (provider_id, model_id, favorited, hidden, last_used_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    providerId,
    modelId,
    favorited !== undefined ? (favorited ? 1 : 0) : (existing?.favorited || 0),
    hidden !== undefined ? (hidden ? 1 : 0) : (existing?.hidden || 0),
    existing?.last_used_at || now
  );

  res.json({ ok: true });
});

// POST /api/ai/models/mark-used — record model usage
r.post('/mark-used', (req, res) => {
  const { providerId, modelId } = req.body || {};
  if (!providerId || !modelId) return res.status(400).json({ error: 'providerId and modelId are required' });

  globalThis.db.prepare(
    'INSERT INTO ai_model_preferences (provider_id, model_id, last_used_at) VALUES (?, ?, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET last_used_at = excluded.last_used_at'
  ).run(providerId, modelId, Date.now());

  res.json({ ok: true });
});

// GET /api/ai/models/favorites — get favorite models
r.get('/favorites', (req, res) => {
  const favorites = globalThis.db.prepare('SELECT * FROM ai_model_preferences WHERE favorited = 1 ORDER BY last_used_at DESC').all();
  res.json({ favorites });
});

// GET /api/ai/presets — provider base URL presets
r.get('/presets', (req, res) => {
  res.json({ presets: PROVIDER_PRESETS });
});

export default r;
