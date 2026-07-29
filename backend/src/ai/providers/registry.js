import OpenAICompat from './openai-compat.js';
import AnthropicAdapter from './anthropic.js';
import GoogleAdapter from './google.js';
import OllamaAdapter from './ollama.js';

const adapters = {
  openai: OpenAICompat,
  anthropic: AnthropicAdapter,
  google: GoogleAdapter,
  ollama: OllamaAdapter,
  openrouter: OpenAICompat,
  groq: OpenAICompat,
  deepseek: OpenAICompat,
  custom: OpenAICompat,
};

export function createAdapter(provider) {
  const cls = adapters[provider.type];
  if (!cls) throw new Error(`Unknown AI provider type: ${provider.type}`);
  return new cls(provider);
}

export function knownProviderTypes() {
  return Object.keys(adapters);
}
