export default class OllamaAdapter {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.type = config.type;
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.models = config.models || [];
    this.customHeaders = config.customHeaders || {};
    this.timeoutMs = config.timeoutMs || 300000;
    this.disabled = !!config.disabled;
  }

  validateConfig() {
    if (!this.baseUrl) return { valid: false, error: 'Base URL is required' };
    try {
      const url = new URL(this.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, error: 'Base URL must be HTTP/HTTPS' };
    } catch {
      return { valid: false, error: 'Base URL is invalid' };
    }
    return { valid: true };
  }

  selectModel(modelId) {
    this.selectedModel = modelId;
  }

  headers() {
    const h = { 'Content-Type': 'application/json', ...this.customHeaders };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels() {
    if (this.models.length > 0) return this.models;
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.models || []).map(m => m.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  async chat({ messages, tools, toolChoice, temperature, maxTokens, stream }) {
    const url = `${this.baseUrl}/api/chat`;
    const ollamaTools = tools?.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } },
    }));
    
    const body = {
      model: this.selectedModel,
      messages,
      stream: !!stream,
      options: {
        temperature: temperature ?? 0.7,
        num_predict: maxTokens ?? 4096,
      },
      ...(ollamaTools?.length ? { tools: ollamaTools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Provider ${this.id} error: ${res.status} ${text}`);
      }
      
      if (stream) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        return { stream: this._streamNDJSON(reader, decoder), provider: this.id };
      }
      
      const data = await res.json();
      const message = data.message || {};
      return {
        text: message.content || '',
        toolCalls: message.tool_calls?.map(tc => ({
          id: tc.function?.name + '_' + Date.now(),
          name: tc.function?.name || '',
          arguments: JSON.stringify(tc.function?.arguments || {}),
        })) || [],
        finishReason: data.done ? 'stop' : 'length',
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  async *_streamNDJSON(reader, decoder) {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield { type: 'done', finishReason: 'stop' };
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed);
          const message = chunk.message || {};
          if (message.content) yield { type: 'text_delta', text: message.content };
          if (message.tool_calls) {
            for (const tc of message.tool_calls) {
              yield {
                type: 'tool_call_delta',
                id: tc.function?.name + '_' + Date.now(),
                name: tc.function?.name || '',
                arguments: JSON.stringify(tc.function?.arguments || {}),
              };
            }
          }
          if (chunk.done) yield { type: 'done', finishReason: 'stop' };
        } catch {
          // skip
        }
      }
    }
  }
}
