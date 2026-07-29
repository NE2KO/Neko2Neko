export default class ContextManager {
  constructor(db) {
    this.db = db;
  }

  getSetting(key, fallback) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key);
      return row !== undefined ? row : fallback;
    } catch { return fallback; }
  }

  parseJson(val, fallback) {
    try { return JSON.parse(val); } catch { return fallback; }
  }

  estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  estimateMessagesTokens(messages) {
    return messages.reduce((sum, m) => sum + this.estimateTokens(m.content) + 4, 0);
  }

  async getRelevantMemories(conversationId, limit = 20) {
    try {
      const memories = this.db.getMemories.all(limit);
      return memories;
    } catch { return []; }
  }

  async getSummary(conversationId) {
    try {
      return this.db.getLatestSummary.get(conversationId) || null;
    } catch { return null; }
  }

  async getPinnedMessages(conversationId) {
    try {
      return this.db.getPinnedMessages.all(conversationId);
    } catch { return []; }
  }

  async getRecentMessages(conversationId, maxMessages = 50) {
    try {
      const maxCtx = parseInt(this.getSetting('ai.maxContextMessages', '50'), 10) || 50;
      const limit = Math.min(maxMessages, maxCtx);
      return this.db.getMessages.all(conversationId).slice(-limit);
    } catch { return []; }
  }

  async getConversationSettings(conversationId) {
    try {
      return this.db.getConversationSettings.get(conversationId) || null;
    } catch { return null; }
  }

  getDefaultSystemPrompt() {
    return this.getSetting('ai.defaultSystemPrompt', '') || '';
  }

  buildSystemPrompt(basePrompt, memories, convSettings) {
    const parts = [];

    if (basePrompt) parts.push(basePrompt);
    if (convSettings?.system_prompt) parts.push(convSettings.system_prompt);

    if (memories && memories.length > 0) {
      const memoryBlock = memories.map(m => `- ${m.content}`).join('\n');
      parts.push(`## Known Information\nThe following information has been learned from previous conversations:\n${memoryBlock}`);
    }

    return parts.join('\n\n') || 'You are a helpful AI assistant.';
  }

  buildMessages(summary, pinned, recent) {
    const messages = [];

    if (summary) {
      messages.push({
        role: 'system',
        content: `Previous conversation summary:\n${summary.summary}`
      });
    }

    const pinnedIds = new Set(pinned.map(m => m.id));
    const pinnedNotInRecent = pinned.filter(m => !recent.some(r => r.id === m.id));

    for (const m of pinnedNotInRecent) {
      messages.push({ role: m.role, content: m.content });
    }

    for (const m of recent) {
      messages.push({ role: m.role, content: m.content });
    }

    return messages;
  }

  async composeContext(conversationId, options = {}) {
    const {
      includeMemories = true,
      includeSummary = true,
      includePinned = true,
      systemPromptOverride = null,
    } = options;

    const convSettings = await this.getConversationSettings(conversationId);
    const basePrompt = systemPromptOverride || this.getDefaultSystemPrompt();
    const memories = includeMemories ? await this.getRelevantMemories(conversationId) : [];
    const summary = includeSummary ? await this.getSummary(conversationId) : null;
    const pinned = includePinned ? await this.getPinnedMessages(conversationId) : [];
    const recent = await this.getRecentMessages(conversationId);

    const system = this.buildSystemPrompt(basePrompt, memories, convSettings);
    const contextMessages = this.buildMessages(summary, pinned, recent);

    return {
      system,
      messages: contextMessages,
      metadata: {
        memoryCount: memories.length,
        hasSummary: !!summary,
        pinnedCount: pinned.length,
        recentCount: recent.length,
        estimatedTokens: this.estimateTokens(system) + this.estimateMessagesTokens(contextMessages),
      },
      convSettings,
    };
  }

  async shouldCompact(conversationId) {
    const autoCompact = this.getSetting('ai.context.autoCompact', 'true') === 'true';
    if (!autoCompact) return false;

    const threshold = parseFloat(this.getSetting('ai.context.compactThreshold', '0.8'));
    const maxTokens = parseInt(this.getSetting('ai.context.maxTokens', '8000'), 10);

    const context = await this.composeContext(conversationId);
    return context.metadata.estimatedTokens > maxTokens * threshold;
  }

  async compactContext(conversationId) {
    const messages = this.db.getMessages.all(conversationId);
    if (messages.length < 6) return null;

    const maxTokens = parseInt(this.getSetting('ai.context.maxTokens', '8000'), 10);
    const targetTokens = Math.floor(maxTokens * 0.5);

    const halfTokens = targetTokens / 2;
    let splitIndex = messages.length;
    let runningTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      runningTokens += this.estimateTokens(messages[i].content) + 4;
      if (runningTokens >= halfTokens) {
        splitIndex = i;
        break;
      }
    }

    if (splitIndex < 3) return null;

    const oldMessages = messages.slice(0, splitIndex);
    const recentMessages = messages.slice(splitIndex);

    const oldText = oldMessages.map(m => `${m.role}: ${m.content}`).join('\n');
    const summaryText = `Conversation so far (${oldMessages.length} messages):\n${oldText.slice(0, 4000)}${oldText.length > 4000 ? '...' : ''}`;

    const now = Date.now();
    this.db.insertSummary.run(
      conversationId,
      summaryText,
      oldMessages[0]?.id,
      oldMessages[oldMessages.length - 1]?.id,
      now
    );

    return {
      summary: summaryText,
      removedCount: oldMessages.length,
      keptCount: recentMessages.length,
    };
  }
}
