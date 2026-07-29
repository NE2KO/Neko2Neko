export default class SerperSearch {
  constructor(config = {}) {
    this.type = 'serper';
    this.baseUrl = (config.baseUrl || 'https://google.serper.dev').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.disabled = !!config.disabled;
  }

  async search(query, opts = {}) {
    if (!this.apiKey) throw new Error('Serper API key is missing');
    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: opts.maxResults || 8 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = (data.organic || []).map(r => ({ url: r.link, title: r.title, snippet: r.snippet }));
    return { provider: 'serper', query, results };
  }

  validateConfig() {
    if (!this.apiKey) return { valid: false, error: 'API key is required' };
    return { valid: true };
  }
}
