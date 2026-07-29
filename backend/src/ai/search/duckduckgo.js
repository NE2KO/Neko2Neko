export default class DuckDuckGoSearch {
  constructor(config = {}) {
    this.type = 'duckduckgo';
    this.disabled = !!config.disabled;
  }

  async search(query, opts = {}) {
    const max = opts.maxResults || 8;
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query);
    url.searchParams.set('kl', opts.region || 'us-en');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Tool/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const results = [];
    const regex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gs;

    let m;
    const links = [];
    while ((m = regex.exec(html)) && links.length < max) {
      links.push({ url: m[1], title: this._stripHtml(m[2]) });
    }

    let si = 0;
    for (const link of links) {
      const sm = snippetRegex.exec(html);
      link.snippet = sm ? this._stripHtml(sm[1]) : '';
      if (link.title) results.push(link);
    }

    return { provider: 'duckduckgo', query, results };
  }

  _stripHtml(html) {
    return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  }

  validateConfig() { return { valid: !this.disabled }; }
}
