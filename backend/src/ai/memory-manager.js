export default class MemoryManager {
  constructor(db) {
    this.db = db;
  }

  getSetting(key, fallback) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key);
      return row !== undefined ? row : fallback;
    } catch { return fallback; }
  }

  async create(content, options = {}) {
    const { conversationId = null, confidence = 1.0, tags = [] } = options;
    const now = Date.now();
    const result = this.db.insertMemory.run(
      conversationId, content, confidence, 0, 1, JSON.stringify(tags), now, now
    );
    return this.db.getMemory.get(result.lastInsertRowid);
  }

  async update(id, updates = {}) {
    const existing = this.db.getMemory.get(id);
    if (!existing) throw new Error('Memory not found');

    const now = Date.now();
    this.db.updateMemory.run(
      updates.content ?? existing.content,
      existing.confidence,
      updates.pinned !== undefined ? (updates.pinned ? 1 : 0) : existing.pinned,
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled,
      JSON.stringify(updates.tags ?? this.parseTags(existing.tags)),
      now,
      id
    );
    return this.db.getMemory.get(id);
  }

  parseTags(tags) {
    if (Array.isArray(tags)) return tags;
    try { return JSON.parse(tags); } catch { return []; }
  }

  async delete(id) {
    this.db.deleteMemory.run(id);
    return { ok: true };
  }

  async list(options = {}) {
    const { limit = 100, search = null, includeDisabled = false } = options;

    if (search) {
      return this.db.searchMemories.all(`%${search}%`, limit);
    }

    if (includeDisabled) {
      return this.db.getAllMemories.all(limit);
    }

    return this.db.getMemories.all(limit);
  }

  async count() {
    try {
      return this.db.countMemories.get().cnt;
    } catch { return 0; }
  }

  async getRelevantMemories(conversationId, query = null, limit = 20) {
    const all = await this.list({ limit: limit * 2, includeDisabled: false });

    if (query) {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      if (keywords.length === 0) return all.slice(0, limit);

      return all
        .map(m => ({
          ...m,
          score: keywords.filter(k => m.content.toLowerCase().includes(k)).length / keywords.length,
        }))
        .filter(m => m.score > 0 || m.pinned)
        .sort((a, b) => (b.pinned * 10 + b.score * b.confidence) - (a.pinned * 10 + a.score * a.confidence))
        .slice(0, limit);
    }

    return all.slice(0, limit);
  }

  async extractMemories(conversationId) {
    const messages = this.db.getMessages.all(conversationId);
    if (messages.length < 4) return [];

    const memoryEnabled = this.getSetting('ai.memory.enabled', 'true') === 'true';
    if (!memoryEnabled) return [];

    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 8000);

    const prompt = `Analyze this conversation and extract key facts, preferences, or decisions that should be remembered for future conversations. Return ONLY a JSON array with objects containing "content" (string, clear and concise) and "confidence" (number 0-1). Only include genuinely useful information that would help in future conversations. Do NOT include trivial details.\n\nConversation:\n${conversationText}`;

    try {
      const { createAdapter } = await import('./providers/registry.js');
      const aiSettings = this.getAiSettings();
      const provider = aiSettings.providers.find(p => p.id === aiSettings.defaultProvider && !p.disabled)
        || aiSettings.providers.find(p => !p.disabled);

      if (!provider) return [];

      const adapter = createAdapter(provider);
      adapter.selectModel(aiSettings.defaultModel);

      const response = await adapter.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 1000,
        stream: false,
      });

      const extracted = JSON.parse(response.text);
      if (!Array.isArray(extracted)) return [];

      const confidenceThreshold = parseFloat(this.getSetting('ai.memory.confidenceThreshold', '0.3'));
      const now = Date.now();
      const memories = [];

      for (const item of extracted) {
        if (item.content && typeof item.content === 'string' && (item.confidence || 0) >= confidenceThreshold) {
          const result = this.db.insertMemory.run(
            conversationId, item.content.trim(), item.confidence || 0.5, 0, 1, '[]', now, now
          );
          memories.push(this.db.getMemory.get(result.lastInsertRowid));
        }
      }

      return memories;
    } catch (err) {
      console.warn('[memory] Extraction failed:', err.message);
      return [];
    }
  }

  getAiSettings() {
    const parseJson = (val, fb) => { try { return JSON.parse(val); } catch { return fb; } };
    return {
      providers: parseJson(this.getSetting('ai.providers', '[]'), []),
      defaultProvider: this.getSetting('ai.defaultProvider', 'openai'),
      defaultModel: this.getSetting('ai.defaultModel', 'gpt-4o-mini'),
    };
  }

  async shouldExtract(conversationId) {
    const autoExtract = this.getSetting('ai.memory.autoExtract', 'true') === 'true';
    if (!autoExtract) return false;

    const frequency = parseInt(this.getSetting('ai.memory.extractionFrequency', '10'), 10) || 10;
    const messageCount = this.db.getMessageCount.get(conversationId)?.cnt || 0;

    return messageCount > 0 && messageCount % frequency === 0;
  }
}
