import db from '../db.js';

const cache = new Map();
let loaded = false;

function castValue(value, type) {
  switch (type) {
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? 0 : n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      return Boolean(value);
    }
    case 'json':
    case 'array':
      try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; }
    default:
      return String(value);
  }
}

function load() {
  cache.clear();
  try {
    const rows = db.prepare('SELECT key, value, type FROM settings').all();
    for (const row of rows) {
      cache.set(row.key, castValue(row.value, row.type));
    }
    loaded = true;
  } catch {
    loaded = false;
  }
}

export function get(key, defaultValue = null) {
  if (!loaded) load();
  return cache.has(key) ? cache.get(key) : defaultValue;
}

export function reload() {
  loaded = false;
  load();
}

load();
