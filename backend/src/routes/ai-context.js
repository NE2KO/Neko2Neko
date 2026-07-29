import { Router } from 'express';
import MemoryManager from '../ai/memory-manager.js';
import ContextManager from '../ai/context-manager.js';
import PromptComposer from '../ai/prompt-composer.js';

const r = Router();

function getLocalId(req) {
  return (req.headers['x-ai-local-id'] || req.query?.localId || '').toString().trim();
}

// ─── Memories ───

// GET /api/ai/memories — list memories
r.get('/memories', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const { search, limit, includeDisabled } = req.query;
    const memories = mm.list({
      limit: parseInt(limit) || 100,
      search: search || null,
      includeDisabled: includeDisabled === 'true',
    });
    res.json({ memories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/memories/count
r.get('/memories/count', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const count = mm.count();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/memories — create memory
r.post('/memories', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const { content, conversationId, confidence, tags } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content is required' });
    const memory = mm.create(content, { conversationId, confidence, tags });
    res.json({ memory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ai/memories/:id — update memory
r.put('/memories/:id', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const id = parseInt(req.params.id, 10);
    const memory = mm.update(id, req.body || {});
    res.json({ memory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/memories/:id — delete memory
r.delete('/memories/:id', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const id = parseInt(req.params.id, 10);
    mm.delete(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/memories/:id/toggle-pin
r.post('/memories/:id/toggle-pin', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const id = parseInt(req.params.id, 10);
    const existing = globalThis.db.getMemory.get(id);
    if (!existing) return res.status(404).json({ error: 'Memory not found' });
    const memory = mm.update(id, { pinned: !existing.pinned });
    res.json({ memory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/memories/:id/toggle-enabled
r.post('/memories/:id/toggle-enabled', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const id = parseInt(req.params.id, 10);
    const existing = globalThis.db.getMemory.get(id);
    if (!existing) return res.status(404).json({ error: 'Memory not found' });
    const memory = mm.update(id, { enabled: !existing.enabled });
    res.json({ memory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/memories/extract/:conversationId — extract memories from conversation
r.post('/memories/extract/:conversationId', async (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const conversationId = parseInt(req.params.conversationId, 10);
    const memories = await mm.extractMemories(conversationId);
    res.json({ memories, count: memories.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/memories/export — export memories as JSON
r.get('/memories/export', (req, res) => {
  try {
    const mm = new MemoryManager(globalThis.db);
    const memories = mm.list({ limit: 10000, includeDisabled: true });
    res.setHeader('Content-Disposition', 'attachment; filename="ai-memories.json"');
    res.json({ memories, exportedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Conversation Settings ───

// GET /api/ai/conversations/:id/settings
r.get('/conversations/:id/settings', (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const settings = globalThis.db.getConversationSettings.get(cid);
    res.json({ settings: settings || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ai/conversations/:id/settings
r.put('/conversations/:id/settings', (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const pc = new PromptComposer(globalThis.db);
    const settings = pc.updateConversationSettings(cid, req.body || {});
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Context ───

// GET /api/ai/conversations/:id/context — get composed context info
r.get('/conversations/:id/context', async (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const cm = new ContextManager(globalThis.db);
    const context = await cm.composeContext(cid);
    res.json({
      metadata: context.metadata,
      systemPreview: context.system.slice(0, 500),
      messageCount: context.messages.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/conversations/:id/context/compact — force compact context
r.post('/conversations/:id/context/compact', async (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const cm = new ContextManager(globalThis.db);
    const result = await cm.compactContext(cid);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pinned Messages ───

// POST /api/ai/conversations/:id/pin/:messageId
r.post('/conversations/:id/pin/:messageId', (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const mid = parseInt(req.params.messageId, 10);
    globalThis.db.pinMessage.run(cid, mid, Date.now());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/conversations/:id/pin/:messageId
r.delete('/conversations/:id/pin/:messageId', (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const mid = parseInt(req.params.messageId, 10);
    globalThis.db.unpinMessage.run(cid, mid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/conversations/:id/pinned
r.get('/conversations/:id/pinned', (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const pinned = globalThis.db.getPinnedMessages.all(cid);
    res.json({ pinned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default r;
