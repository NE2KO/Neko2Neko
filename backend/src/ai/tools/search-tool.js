import { knownSearchProviders, createSearchClient } from '../search/registry.js';

export function buildSearchTool(searchConfig) {
  const client = createSearchClient(searchConfig);
  if (!client) return null;
  return {
    type: 'function',
    name: 'web_search',
    description: 'Search the web using the configured search provider. Use this when the user asks about current events, real-time data, or anything not in your knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: { type: 'number', description: 'Max number of results (1-20)' },
      },
      required: ['query'],
    },
    async call({ query, maxResults = 8 }) {
      const result = await client.search(query, { maxResults });
      return JSON.stringify(result);
    },
  };
}

export function getSearchToolDefinition(searchConfig) {
  return buildSearchTool(searchConfig);
}
