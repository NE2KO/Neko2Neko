export default class GoogleAdapter {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.type = config.type;
    this.baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
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
    return { 'Content-Type': 'application/json', ...this.customHeaders };
  }

  async listModels() {
    if (this.models.length > 0) return this.models;
    try {
      const res = await fetch(`${this.baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.models || []).map(m => m.name.split('/').pop()).filter(Boolean);
    } catch {
      return ['gemini-2.5-pro', 'gemini-2.5-flash'];
    }
  }

  async chat({ messages, tools, temperature, maxTokens, stream }) {
    const systemInstruction = messages.find(m => m.role === 'system');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }],
    }));
    
    const geminiTools = tools?.length ? [{
      function_declarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
      })),
    }] : undefined;
    
    const model = this.selectedModel.startsWith('models/') ? this.selectedModel : `models/${this.selectedModel}`;
    const url = `${this.baseUrl}/v1beta/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    
    const body = {
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction.content }] } : undefined,
      generationConfig: {
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxTokens ?? 4096,
      },
      ...(geminiTools ? { tools: geminiTools } : {}),
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
      
      const data = await res.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.filter(p => p.text).map(p => p.text).join('') || '';
      const fc = candidate?.content?.parts?.find(p => p.functionCall);
      const toolCalls = fc ? [{ id: '' + Date.now(), name: fc.functionCall.name, arguments: JSON.stringify(fc.functionCall.args || {}) }] : [];
      return { text, toolCalls, finishReason: candidate?.finishReason || 'stop' };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}
