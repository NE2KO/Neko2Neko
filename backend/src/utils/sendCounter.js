import db from '../db.js';

const SEPARATOR_INTERVAL = 3;

function makeLock() {
  let release;
  let prev = Promise.resolve();
  return {
    acquire: () => {
      const cur = prev;
      prev = new Promise(r => { release = r; });
      return cur.then(() => release);
    },
  };
}

const tgLock = makeLock();
const waLock = makeLock();

export function getTelegramCount() {
  return db.prepare('SELECT telegram_count FROM send_counters WHERE id = 1').pluck().get() || 0;
}

export function getWhatsAppCount() {
  return db.prepare('SELECT whatsapp_count FROM send_counters WHERE id = 1').pluck().get() || 0;
}

export function setTelegramCount(count) {
  db.prepare('UPDATE send_counters SET telegram_count = ? WHERE id = 1').run(count);
}

export function setWhatsAppCount(count) {
  db.prepare('UPDATE send_counters SET whatsapp_count = ? WHERE id = 1').run(count);
}

export async function incrementTelegramCount() {
  const release = await tgLock.acquire();
  try {
    const next = getTelegramCount() + 1;
    setTelegramCount(next);
    return next;
  } finally {
    release();
  }
}

export async function incrementWhatsAppCount() {
  const release = await waLock.acquire();
  try {
    const next = getWhatsAppCount() + 1;
    setWhatsAppCount(next);
    return next;
  } finally {
    release();
  }
}

export function isSeparatorNeeded(count) {
  return count > 0 && count % SEPARATOR_INTERVAL === 0;
}
