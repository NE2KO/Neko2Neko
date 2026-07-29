import { Router } from 'express';
import { createAdapter, knownProviderTypes } from '../ai/providers/registry.js';
import { createToolRegistry } from '../ai/tool-registry.js';
import ToolRegistry from '../ai/registry.js';
import ContextManager from '../ai/context-manager.js';
import MemoryManager from '../ai/memory-manager.js';

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
    defaultSearchProvider: getSetting('ai.defaultSearchProvider') || 'duckduckgo',
    tools: {
      enabled: parseJson(getSetting('ai.tools.enabled') || '[]', []),
      vault: getSetting('ai.tools.vault') || 'disabled',
      system: getSetting('ai.tools.system') || 'disabled',
    },
    streaming: getSetting('ai.streaming') !== 'false',
    maxContextMessages: parseInt(getSetting('ai.maxContextMessages') || '50', 10),
    maxOutputTokens: parseInt(getSetting('ai.maxOutputTokens') || '4096', 10),
    temperature: parseFloat(getSetting('ai.temperature') || '0.7'),
    search: parseJson(getSetting('ai.search') || 'null', null),
  };
}

function getLocalId(req) {
  return (req.headers['x-ai-local-id'] || req.query?.localId || '').toString().trim();
}

function getCurrentProvider(aiSettings) {
  const p = aiSettings.providers.find(p => p.id === aiSettings.defaultProvider && !p.disabled);
  if (p) return p;
  return aiSettings.providers.find(p => !p.disabled);
}

function prepareAdapter(provider, aiSettings) {
  const adapter = createAdapter(provider);
  const model = provider.model || provider.selectedModel || aiSettings.defaultModel;
  adapter.selectModel(model);
  return adapter;
}

function getSearchConfig(aiSettings) {
  const sid = aiSettings.defaultSearchProvider;
  const arr = Array.isArray(aiSettings.search) ? aiSettings.search : [];
  return arr.find(s => s.type === sid) || arr[0] || null;
}

function maskKey(key) {
  if (!key || key.length <= 8) return key ? '***' : '';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function sendSSE(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
}

function loadHistory(cid, max) {
  const rows = globalThis.db.prepare('SELECT role, content, tool_calls, tool_results FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(cid, max);
  return rows.reverse().map(r => ({
    role: r.role,
    content: r.content,
    ...(r.tool_calls ? { tool_calls: parseJson(r.tool_calls) } : {}),
    ...(r.tool_results ? { tool_results: parseJson(r.tool_results) } : {}),
  }));
}

async function executeToolCall(toolRegistry, tc, aiSettings) {
  let args = {};
  try { args = JSON.parse(tc.arguments || '{}'); } catch {}
  const ctx = { db: globalThis.db, stmts: globalThis.stmts, aiSettings };
  const result = await toolRegistry.callTool(tc.name, args, ctx);
  return { id: tc.id, name: tc.name, result };
}

r.get('/', (req, res) => {
  const aiSettings = getAiSettings();
  const registry = new ToolRegistry(globalThis.db, aiSettings);
  res.json({
    status: 'ok',
    streaming: aiSettings.streaming,
    providers: aiSettings.providers.map(p => ({ id: p.id, type: p.type, name: p.name, baseUrl: p.baseUrl || '', disabled: !!p.disabled, maskedKey: maskKey(p.apiKey) })),
    activeProvider: aiSettings.defaultProvider,
    defaultModel: aiSettings.defaultModel,
    tools: registry.available(),
  });
});

r.get('/settings', (req, res) => {
  const rows = globalThis.db.prepare("SELECT * FROM settings WHERE category = 'ai' ORDER BY key").all();
  res.json({ settings: rows });
});

r.put('/settings/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (!key.startsWith('ai.')) return res.status(400).json({ error: 'Key must start with ai.' });
  const now = Date.now();
  const existing = globalThis.db.prepare("SELECT * FROM settings WHERE key = ?").get(key);
  if (existing) {
    globalThis.db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").run(JSON.stringify(value), now, key);
  } else {
    globalThis.db.prepare("INSERT INTO settings (key, value, type, category, label, description, updated_at) VALUES (?, ?, 'json', 'ai', '', '', ?)").run(key, JSON.stringify(value), now);
  }
  res.json({ ok: true, key, value });
});

r.get('/providers', (req, res) => {
  const aiSettings = getAiSettings();
  res.json({ providers: aiSettings.providers.map(p => ({ ...p, apiKey: maskKey(p.apiKey) })), knownTypes: knownProviderTypes() });
});

r.post('/providers', (req, res) => {
  const body = req.body || {};
  if (!body.id || !body.type) return res.status(400).json({ error: 'id and type are required' });
  const aiSettings = getAiSettings();
  const idx = aiSettings.providers.findIndex(p => p.id === body.id);
  const existing = idx >= 0 ? aiSettings.providers[idx] : null;
  const entry = {
    id: body.id,
    type: body.type,
    name: body.name || body.id,
    baseUrl: body.baseUrl || '',
    apiKey: body.apiKey || existing?.apiKey || '',
    models: body.models || [],
    customHeaders: body.customHeaders || existing?.customHeaders || {},
    disabled: false,
  };
  if (idx >= 0) aiSettings.providers[idx] = entry;
  else aiSettings.providers.push(entry);
  globalThis.db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'ai.providers'").run(JSON.stringify(aiSettings.providers), Date.now());
  res.json({ ok: true, provider: { ...entry, apiKey: maskKey(entry.apiKey) } });
});

r.delete('/providers/:id', (req, res) => {
  const { id } = req.params;
  const aiSettings = getAiSettings();
  aiSettings.providers = aiSettings.providers.filter(p => p.id !== id);
  globalThis.db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'ai.providers'").run(JSON.stringify(aiSettings.providers), Date.now());
  res.json({ ok: true });
});

r.get('/models/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const aiSettings = getAiSettings();
  const pCfg = aiSettings.providers.find(p => p.id === providerId);
  if (!pCfg) return res.status(404).json({ error: 'Provider not found' });
  try {
    const adapter = createAdapter(pCfg);
    const models = await adapter.listModels();
    res.json({ providerId, models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/conversations', (req, res) => {
  const localId = getLocalId(req);
  if (!localId) return res.json({ conversations: [] });
  const rows = globalThis.db.prepare('SELECT id, title, pinned, archived, created_at, updated_at FROM conversations WHERE local_id = ? ORDER BY pinned DESC, updated_at DESC').all(localId);
  res.json({ conversations: rows.map(c => ({ ...c, createdAt: new Date(c.created_at).toISOString(), updatedAt: new Date(c.updated_at).toISOString() })) });
});

r.post('/conversations', (req, res) => {
  const localId = getLocalId(req);
  if (!localId) return res.status(400).json({ error: 'Missing X-AI-Local-Id header' });
  const title = req.body?.title || 'New Chat';
  const now = Date.now();
  const result = globalThis.db.prepare('INSERT INTO conversations (local_id, title, pinned, archived, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)').run(localId, title, now, now);
  res.json({ id: result.lastInsertRowid, title, createdAt: new Date(now).toISOString() });
});

r.get('/conversations/:id', (req, res) => {
  const localId = getLocalId(req);
  const cid = parseInt(req.params.id, 10);
  const conv = globalThis.db.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?').get(cid, localId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const msgs = globalThis.db.prepare('SELECT role, content, tool_calls, tool_results, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(cid);
  res.json({
    conversation: { ...conv, createdAt: new Date(conv.created_at).toISOString(), updatedAt: new Date(conv.updated_at).toISOString() },
    messages: msgs.map(m => ({ role: m.role, content: m.content, toolCalls: parseJson(m.tool_calls), toolResults: parseJson(m.tool_results), createdAt: new Date(m.created_at).toISOString() })),
  });
});

r.patch('/conversations/:id', (req, res) => {
  const localId = getLocalId(req);
  const cid = parseInt(req.params.id, 10);
  const { title, pinned, archived } = req.body || {};
  const conv = globalThis.db.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?').get(cid, localId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const uTitle = typeof title === 'string' ? title : conv.title;
  const uPinned = typeof pinned === 'boolean' ? (pinned ? 1 : 0) : conv.pinned;
  const uArchived = typeof archived === 'boolean' ? (archived ? 1 : 0) : conv.archived;
  globalThis.db.prepare('UPDATE conversations SET title = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ? AND local_id = ?').run(uTitle, uPinned, uArchived, Date.now(), cid, localId);
  res.json({ ok: true });
});

r.delete('/conversations/:id', (req, res) => {
  const localId = getLocalId(req);
  const cid = parseInt(req.params.id, 10);
  const conv = globalThis.db.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?').get(cid, localId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  globalThis.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(cid);
  globalThis.db.prepare('DELETE FROM conversations WHERE id = ?').run(cid);
  res.json({ ok: true });
});

r.get('/conversations/:id/export', (req, res) => {
  const localId = getLocalId(req);
  const cid = parseInt(req.params.id, 10);
  const conv = globalThis.db.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?').get(cid, localId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const msgs = globalThis.db.prepare('SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(cid);
  const lines = [`# ${conv.title}\n`, `Exported: ${new Date().toISOString()}\n\n`];
  for (const m of msgs) {
    lines.push(`[${new Date(m.created_at).toISOString()}] ${m.role.toUpperCase()}:\n${m.content}\n\n`);
  }
  const text = lines.join('');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=conversation-${conv.title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)}-${conv.id}.md`);
  res.send(text);
});

r.get('/conversations/:id/search', (req, res) => {
  const localId = getLocalId(req);
  const cid = parseInt(req.params.id, 10);
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ messages: [] });
  const conv = globalThis.db.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?').get(cid, localId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const rows = globalThis.db.prepare('SELECT role, content, tool_calls, tool_results, created_at FROM messages WHERE conversation_id = ? AND content LIKE ? ORDER BY id ASC').all(cid, `%${q}%`);
  res.json({ messages: rows.map(m => ({ role: m.role, content: m.content, toolCalls: parseJson(m.tool_calls), toolResults: parseJson(m.tool_results), createdAt: new Date(m.created_at).toISOString() })) });
});

r.get('/tools', (req, res) => {
  const aiSettings = getAiSettings();
  const registry = createToolRegistry(globalThis.db, aiSettings);
  res.json({ tools: registry.available(), known: ToolRegistry.knownTools() });
});

r.post('/conversations/:id/message', async (req, res) => {
  const localId = getLocalId(req);
  const cid = parseInt(req.params.id, 10);
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
  const conv = globalThis.db.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?').get(cid, localId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const aiSettings = getAiSettings();
  const provider = getCurrentProvider(aiSettings);
  if (!provider) return res.status(400).json({ error: 'No AI provider configured. Add a provider in settings.' });

  globalThis.db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, 'user', message, null, null, Date.now());
  globalThis.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), cid);

  let messages;
  try {
    const cm = new ContextManager(globalThis.db);
    const context = await cm.composeContext(cid);
    messages = [...context.messages, { role: 'user', content: message }];
  } catch {
    messages = loadHistory(cid, aiSettings.maxContextMessages);
    messages.push({ role: 'user', content: message });
  }

  if (aiSettings.streaming) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    try {
      await streamResponse(res, provider, messages, aiSettings, cid);
    } catch (err) {
      sendSSE(res, { type: 'error', error: err.message });
    }
    sendSSE(res, { type: 'done' });
    res.end();
  } else {
    try {
      const toolRegistry = createToolRegistry(globalThis.db, aiSettings);
      const result = await runNonStreaming(provider, messages, aiSettings, toolRegistry);
      globalThis.db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, 'assistant', result.text || '', JSON.stringify(result.toolCalls || []), null, Date.now());
      globalThis.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), cid);

      // Auto-extract memories and compact context in background
      try {
        const mm = new MemoryManager(globalThis.db);
        if (await mm.shouldExtract(cid)) {
          mm.extractMemories(cid).catch(e => console.warn('[ai] Memory extraction failed:', e.message));
        }
        const cm = new ContextManager(globalThis.db);
        if (await cm.shouldCompact(cid)) {
          cm.compactContext(cid).catch(e => console.warn('[ai] Context compaction failed:', e.message));
        }
      } catch {}

      res.json({ text: result.text, toolCalls: result.toolCalls || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
});

async function runNonStreaming(provider, messages, aiSettings, toolRegistry) {
  let currentMessages = [...messages];
  let finalResult = { text: '', toolCalls: [] };
  for (let round = 0; round < 5; round++) {
    const toolDefs = await toolRegistry.getDefinitions({ search: getSearchConfig(aiSettings) });
    const adapter = prepareAdapter(provider, aiSettings);
    const result = await adapter.chat({ messages: currentMessages, tools: toolDefs, temperature: aiSettings.temperature, maxTokens: aiSettings.maxOutputTokens, stream: false });
    const toolCalls = result.toolCalls || [];
    finalResult = { text: result.text || '', toolCalls };
    if (toolCalls.length === 0) break;
    const toolResults = [];
    for (const tc of toolCalls) {
      const tr = await executeToolCall(toolRegistry, tc, aiSettings);
      toolResults.push(tr);
      currentMessages.push({ role: 'tool', content: tr.result, tool_call_id: tc.id });
    }
    currentMessages.push({ role: 'assistant', content: result.text, tool_calls: toolCalls });
  }
  return finalResult;
}

async function streamResponse(res, provider, messages, aiSettings, cid) {
  let currentMessages = [...messages];
  for (let round = 0; round < 5; round++) {
    const toolRegistry = createToolRegistry(globalThis.db, aiSettings);
    const toolDefs = await toolRegistry.getDefinitions({ search: getSearchConfig(aiSettings) });
    const adapter = prepareAdapter(provider, aiSettings);
    const chatResult = await adapter.chat({
      messages: currentMessages,
      tools: toolDefs,
      temperature: aiSettings.temperature,
      maxTokens: aiSettings.maxOutputTokens,
      stream: true,
    });
    if (!chatResult.stream) {
      const result = chatResult;
      if (result.text) sendSSE(res, { type: 'text', text: result.text });
      sendSSE(res, { type: 'done', finishReason: 'stop' });
      globalThis.db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, 'assistant', result.text || '', JSON.stringify(result.toolCalls || []), null, Date.now());
      globalThis.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), cid);
      return;
    }
    let fullText = '';
    const newToolCalls = [];
    const toolCallsByName = new Map();
    for await (const chunk of chatResult.stream) {
      if (chunk.type === 'text_delta') {
        fullText += chunk.text;
        sendSSE(res, { type: 'delta', text: chunk.text });
      } else if (chunk.type === 'tool_call_delta') {
        const idx = chunk.index ?? 0;
        if (!newToolCalls[idx]) newToolCalls[idx] = { id: '', name: '', arguments: '' };
        if (chunk.id) newToolCalls[idx].id = chunk.id;
        if (chunk.name) newToolCalls[idx].name += chunk.name;
        if (chunk.arguments) newToolCalls[idx].arguments += chunk.arguments;
        sendSSE(res, { type: 'tool_call_delta', index: idx, id: chunk.id || newToolCalls[idx].id, name: newToolCalls[idx].name, arguments: chunk.arguments });
      } else if (chunk.type === 'tool_call_start') {
        sendSSE(res, { type: 'tool_call_start', id: chunk.id, name: chunk.name });
      } else if (chunk.type === 'done') {
        const tcs = newToolCalls.filter(t => t.id || t.name).map(t => ({
          id: t.id || ('call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
          name: t.name,
          arguments: t.arguments,
        }));
        if (chunk.finishReason === 'tool_calls' && tcs.length > 0) {
          for (const tc of tcs) {
            const toolResult = await executeToolCall(toolRegistry, tc, aiSettings);
            sendSSE(res, { type: 'tool_result', id: tc.id, name: tc.name, result: toolResult.result });
            currentMessages.push({ role: 'assistant', content: '', tool_calls: [tc] });
            currentMessages.push({ role: 'tool', content: toolResult.result, tool_call_id: tc.id });
          }
        } else {
          sendSSE(res, { type: 'done', finishReason: 'stop' });
          globalThis.db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, 'assistant', fullText, JSON.stringify(tcs.length ? tcs : []), null, Date.now());
          globalThis.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), cid);

          // Auto-extract memories and compact context in background
          try {
            const mm = new MemoryManager(globalThis.db);
            if (await mm.shouldExtract(cid)) {
              mm.extractMemories(cid).catch(e => console.warn('[ai] Memory extraction failed:', e.message));
            }
            const cm = new ContextManager(globalThis.db);
            if (await cm.shouldCompact(cid)) {
              cm.compactContext(cid).catch(e => console.warn('[ai] Context compaction failed:', e.message));
            }
          } catch {}

          return;
        }
      }
    }
  }
}

r.post('/tools/:name', async (req, res) => {
  const { name } = req.params;
  const args = req.body?.args || {};
  const aiSettings = getAiSettings();
  const toolRegistry = createToolRegistry(globalThis.db, aiSettings);
  try {
    const ctx = { db: globalThis.db, stmts: globalThis.stmts, aiSettings };
    const result = await toolRegistry.callTool(name, args, ctx);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default r;
