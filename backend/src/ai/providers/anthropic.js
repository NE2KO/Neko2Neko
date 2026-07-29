export default class AnthropicAdapter {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.type = config.type;
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.models = config.models || [];
    this.customHeaders = config.customHeaders || {};
    this.timeoutMs = config.timeoutMs || 120000;
    this.disabled = !!config.disabled;
  }

  validateConfig() {
    if (!this.apiKey) return { valid: false, error: 'API key is required' };
    return { valid: true };
  }

  selectModel(modelId) {
    this.selectedModel = modelId;
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      ...this.customHeaders,
    };
  }

  async listModels() {
    if (this.models.length > 0) return this.models;
    return ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];
  }

  async chat({ messages, tools, toolChoice, temperature, maxTokens, stream }) {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters || { type: 'object', properties: {} },
    }));
    
    const body = {
      model: this.selectedModel,
      max_tokens: maxTokens || 4096,
      system: systemMessage?.content || undefined,
      messages: chatMessages,
      temperature: temperature ?? 0.7,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
      ...(toolChoice && anthropicTools?.length ? { tool_choice: { type: toolChoice } } : {}),
      stream: !!stream,
    };
    
    const url = `${this.baseUrl}/v1/messages`;
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
        let buffer = '';
        return { stream: this._streamSSE(reader, decoder, buffer), provider: this.id };
      }
      
      const data = await res.json();
      const text = data.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '';
      const toolCalls = data.content?.filter(c => c.type === 'tool_use').map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.input || {}),
      })) || [];
      return { text, toolCalls, finishReason: data.stop_reason || 'stop' };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  async *_streamSSE(reader, decoder, buffer) {
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
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        try {
          const event = JSON.parse(payload);
          const type = event.type;
          
          if (type === 'content_block_delta') {
            const delta = event.delta;
            if (delta.type === 'text_delta') yield { type: 'text_delta', text: delta.text };
            if (delta.type === 'input_json_delta') yield { type: 'tool_call_delta', arguments: delta.partial_json || '' };
          }
          
          if (type === 'content_block_start') {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              yield { type: 'tool_call_start', id: block.id, name: block.name };
            }
          }
          
          if (type === 'message_stop') {
            yield { type: 'done', finishReason: 'stop' };
          }
        } catch {
          // skip
        }
      }
    }
  }
}
