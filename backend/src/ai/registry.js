export default class ToolRegistry {
  constructor(db, aiSettings = {}) {
    this.db = db;
    this.aiSettings = aiSettings;
    this.tools = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    this.register('web_search', {
      type: 'builtin',
      definition: null,
      enabledByDefault: true,
      buildDefinition: async (cfg) => {
        const { buildSearchToolDefinition } = await import('./search-tool.js');
        return buildSearchToolDefinition(cfg.search);
      },
    });
    this.register('vault_media_search', {
      type: 'builtin',
      file: () => import('./vault-search.js'),
      enabledByDefault: false,
    });
    this.register('vault_media_folder', {
      type: 'builtin',
      file: () => import('./vault-folder.js'),
      enabledByDefault: false,
    });
    this.register('vault_media_meta', {
      type: 'builtin',
      file: () => import('./vault-meta.js'),
      enabledByDefault: false,
    });
    this.register('vault_media_filter', {
      type: 'builtin',
      file: () => import('./vault-filter.js'),
      enabledByDefault: false,
    });
    this.register('vault_playlists', {
      type: 'builtin',
      file: () => import('./vault-playlists.js'),
      enabledByDefault: false,
    });
    this.register('system_stats', {
      type: 'builtin',
      file: () => import('./system-stats.js'),
      enabledByDefault: false,
    });
  }

  register(id, cfg) {
    this.tools.set(id, cfg);
  }

  async getDefinitions(searchConfig) {
    const enabled = this._enabled();
    const defs = [];
    for (const [id, cfg] of this.tools) {
      if (!enabled.has(id)) continue;
      let def = cfg.definition;
      if (!def && cfg.buildDefinition) {
        def = await cfg.buildDefinition(this.aiSettings);
      }
      if (def) defs.push(def);
    }
    return defs;
  }

  async callTool(name, args, ctx = {}) {
    const cfg = this.tools.get(name);
    if (!cfg) throw new Error(`Unknown tool: ${name}`);
    const enabled = this._enabled();
    if (!enabled.has(name)) throw new Error(`Tool disabled: ${name}`);

    if (cfg.definition?.call) return cfg.definition.call(ctx, args);
    if (cfg.file) {
      const mod = await cfg.file();
      if (typeof mod.default?.call === 'function') return mod.default.call(ctx, args);
      if (typeof mod.call === 'function') return mod.call(ctx, args);
    }
    throw new Error(`Tool ${name} has no handler`);
  }

  available() {
    return this._enabled();
  }

  _enabled() {
    const raw = this.aiSettings.tools?.enabled;
    if (Array.isArray(raw) && raw.length > 0) return new Set(raw);
    const defaults = new Set();
    for (const [id, cfg] of this.tools) {
      if (cfg.enabledByDefault) defaults.add(id);
    }
    return defaults;
  }

  static knownTools() {
    return ['web_search', 'vault_media_search', 'vault_media_folder', 'vault_media_meta', 'vault_media_filter', 'vault_playlists', 'system_stats'];
  }
}
