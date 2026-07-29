export default class OpenAICompat {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.type = config.type;
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.models = config.models || [];
    this.customHeaders = config.customHeaders || {};
    this.timeoutMs = config.timeoutMs || 120000;
    this.disabled = !!config.disabled;
  }

  selectModel(modelId) {
    this.selectedModel = modelId;
  }

  validateConfig() {
    if (!this.baseUrl) return { valid: false, error: 'Base URL is required' };
    if (!this.apiKey) return { valid: false, error: 'API key is required' };
    try {
      const url = new URL(this.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, error: 'Base URL must be HTTP/HTTPS' };
    } catch {
      return { valid: false, error: 'Base URL is invalid' };
    }
    return { valid: true };
  }

  headers() {
    const h = { 'Content-Type': 'application/json', ...this.customHeaders };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels() {
    if (this.models.length > 0) return this.models;
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const arr = Array.isArray(data.data) ? data.data : [];
      return arr.map(m => m.id).filter(Boolean);
    } catch (err) {
      return this.models;
    }
  }

  async chat({ messages, tools, toolChoice, temperature, maxTokens, stream }) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.selectedModel,
      messages,
      ...(tools && tools.length ? { tools, tool_choice: toolChoice || 'auto' } : {}),
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: !!stream,
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
        return { stream: this._streamSSE(res.body), provider: this.id };
      }
      
      const data = await res.json();
      return {
        text: this._extractText(data),
        toolCalls: this._extractToolCalls(data),
        finishReason: this._finishReason(data),
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  _streamSSE(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const push = async (chunk) => chunk;
    
    return (async function* () {
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
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            yield { type: 'done', finishReason: 'stop' };
            return;
          }
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta || {};
            
            if (delta.content) yield { type: 'text_delta', text: delta.content };
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: 'tool_call_delta',
                  index: tc.index,
                  id: tc.id || undefined,
                  name: tc.function?.name || undefined,
                  arguments: tc.function?.arguments || '',
                };
              }
            }
            if (chunk.choices?.[0]?.finish_reason) {
              yield { type: 'done', finishReason: chunk.choices[0].finish_reason };
            }
          } catch {
            // skip malformed
          }
        }
      }
    })();
  }

  _extractText(data) {
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter(c => c.type === 'text').map(c => c.text).join('');
    return '';
  }

  _extractToolCalls(data) {
    const tcs = data.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(tcs)) return [];
    return tcs.map(tc => ({
      id: tc.id,
      name: tc.function?.name || '',
      arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
    }));
  }

  _finishReason(data) {
    return data.choices?.[0]?.finish_reason || 'stop';
  }
}
