export default class TavilySearch {
  constructor(config = {}) {
    this.type = 'tavily';
    this.baseUrl = (config.baseUrl || 'https://api.tavily.com').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.disabled = !!config.disabled;
  }

  async search(query, opts = {}) {
    if (!this.apiKey) throw new Error('Tavily API key is missing');
    const body = {
      api_key: this.apiKey,
      query,
      max_results: opts.maxResults || 8,
      search_depth: opts.depth || 'basic',
      include_answer: false,
    };
    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = (data.results || []).map(r => ({ url: r.url, title: r.title, snippet: r.content }));
    return { provider: 'tavily', query, results };
  }

  validateConfig() {
    if (!this.apiKey) return { valid: false, error: 'API key is required' };
    return { valid: true };
  }
}
