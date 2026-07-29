import DuckDuckGoSearch from './duckduckgo.js';
import TavilySearch from './tavily.js';
import SerperSearch from './serper.js';
import SearXNGSearch from './searxng.js';

const clients = {
  duckduckgo: DuckDuckGoSearch,
  tavily: TavilySearch,
  serper: SerperSearch,
  searxng: SearXNGSearch,
};

export function createSearchClient(config) {
  if (!config || !config.type) return null;
  const cls = clients[config.type];
  if (!cls) return null;
  const instance = new cls(config);
  const v = instance.validateConfig();
  if (!v.valid) return null;
  return instance;
}

export function knownSearchProviders() {
  return Object.keys(clients);
}
