export default class SearXNGSearch {
  constructor(config = {}) {
    this.type = 'searxng';
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    this.disabled = !!config.disabled;
  }

  async search(query, opts = {}) {
    if (!this.baseUrl) throw new Error('SearXNG instance URL is not configured');
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('engines', opts.engines || 'google,bing,duckduckgo');
    url.searchParams.set('pageno', '1');
    url.searchParams.set('safesearch', opts.safe || '0');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = (data.results || []).slice(0, opts.maxResults || 8).map(r => ({ url: r.url, title: r.title, snippet: r.content || r.description }));
    return { provider: 'searxng', query, results };
  }

  validateConfig() {
    if (!this.baseUrl) return { valid: false, error: 'Instance URL is required' };
    try { new URL(this.baseUrl); } catch { return { valid: false, error: 'Invalid URL' }; }
    return { valid: true };
  }
}
