import ContextManager from './context-manager.js';
import MemoryManager from './memory-manager.js';

export default class PromptComposer {
  constructor(db) {
    this.db = db;
    this.contextManager = new ContextManager(db);
    this.memoryManager = new MemoryManager(db);
  }

  async compose(conversationId, userMessage, options = {}) {
    const {
      tools = [],
      images = [],
      enableVision = false,
      modelOverride = null,
      temperatureOverride = null,
      maxTokensOverride = null,
    } = options;

    const context = await this.contextManager.composeContext(conversationId);
    const convSettings = context.convSettings;

    const messages = [
      { role: 'system', content: context.system },
      ...context.messages,
    ];

    if (images.length > 0 && enableVision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMessage },
          ...images.map(img => ({ type: 'image_url', image_url: { url: img } })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    return {
      messages,
      tools,
      temperature: temperatureOverride ?? convSettings?.temperature ?? parseFloat(this.getSetting('ai.temperature', '0.7')),
      maxTokens: maxTokensOverride ?? convSettings?.maxTokens ?? parseInt(this.getSetting('ai.maxOutputTokens', '4096'), 10),
      model: modelOverride || convSettings?.model || null,
      metadata: context.metadata,
    };
  }

  getSetting(key, fallback) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key);
      return row !== undefined ? row : fallback;
    } catch { return fallback; }
  }

  async getConversationSettings(conversationId) {
    return this.contextManager.getConversationSettings(conversationId);
  }

  async updateConversationSettings(conversationId, settings) {
    const existing = this.db.getConversationSettings.get(conversationId);
    const now = Date.now();

    this.db.upsertConversationSettings.run(
      conversationId,
      settings.model ?? existing?.model ?? null,
      settings.temperature ?? existing?.temperature ?? null,
      settings.max_tokens ?? existing?.max_tokens ?? null,
      settings.system_prompt ?? existing?.system_prompt ?? null,
      settings.web_search !== undefined ? (settings.web_search ? 1 : 0) : (existing?.web_search ?? 0),
      settings.vision !== undefined ? (settings.vision ? 1 : 0) : (existing?.vision ?? 0),
    );

    return this.db.getConversationSettings.get(conversationId);
  }
}
