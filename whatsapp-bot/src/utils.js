import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG_PATH = fileURLToPath(new URL('../logs/app.log', import.meta.url));
mkdirSync(dirname(LOG_PATH), { recursive: true });

const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' };

let logSink = null;

export function setLogSink(fn) {
  logSink = fn;
}

export function log(level, ...args) {
  const tag = LEVELS[level] || 'INFO';
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${tag}] ${args.map(String).join(' ')}\n`;
  appendFileSync(LOG_PATH, line);
  try { logSink?.(level, line.trim()); } catch {}
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / k ** i).toFixed(2)) + ' ' + sizes[i];
}
