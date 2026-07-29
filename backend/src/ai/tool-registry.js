import ToolRegistry from './registry.js';

export function createToolRegistry(db, stmts, aiSettings = {}) {
  const registry = new ToolRegistry(db, aiSettings);
  registry._context = { db, stmts, aiSettings };
  return registry;
}
