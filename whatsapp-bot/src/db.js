import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const STATE_PATH = new URL('../sessions/media_state.json', import.meta.url);
const STATE_DIR = new URL('../sessions/', import.meta.url);

export function isDuplicate(messageId) {
  const state = readState();
  if ((state.history || []).includes(messageId)) return true;
  state.history = state.history || [];
  state.history.push(messageId);
  writeState(state);
  return false;
}

export function markUploaded() {
  const state = readState();
  const day = new Date().toISOString().slice(0, 10);
  state.stats = state.stats || {};
  state.stats[day] = state.stats[day] || { saves: 0, uploads: 0 };
  state.stats[day].uploads += 1;
  writeState(state);
}

export function getStats() {
  const day = new Date().toISOString().slice(0, 10);
  const state = readState();
  return state.stats?.[day] ?? { saves: 0, uploads: 0 };
}

export function getUploadCounter() {
  return readState().uploadCounter || 0;
}

export function setUploadCounter(n) {
  const state = readState();
  state.uploadCounter = n;
  writeState(state);
}

function readState() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  try { writeFileSync(STATE_PATH, JSON.stringify(state)); } catch {}
}
