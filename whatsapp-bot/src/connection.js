import WAWebJS from 'whatsapp-web.js';
import { log } from './utils.js';
import config from '../config.js';
import EventEmitter from 'node:events';
import { startListener } from './listener.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, '..', '.wwebjs_auth');

const { Client, LocalAuth } = WAWebJS;
let eventCount = 0;
let connected = false;
let startTime = null;
let lastQr = null;
let reconnecting = false;
let stopped = false;
let initializing = false;
let wasConnected = false;
let attemptedOnce = false;
let reconnectTimer = null;
let client = null;
let initAbort = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 300000; // 5 min cap

export const botEvents = new EventEmitter();
botEvents.setMaxListeners(20);

function killOrphanedBrowsers() {
  try {
    const pid = client?.puppeteer?.browser?.process()?.pid;
    if (pid) {
      process.kill(pid, 9);
      log('info', `Killed bot browser PID ${pid}`);
    }
  } catch {}
  // Kill any stray chromium still holding the session userDataDir lock
  // (e.g. from a previous run that crashed without cleanup).
  try {
    execSync('pkill -9 -f "session-whatsapp-bot-session" || true', { timeout: 5000 });
  } catch {}
}

function createClient() {
  const c = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-bot-session', dataPath: AUTH_DIR }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  c.on('qr', (qr) => {
    lastQr = qr;
    connected = false;
    // QR is rendered inline in the web Bot menu (frontend), not in this terminal.
    log('debug', 'QR code generated — scan it in the Bot menu');
    botEvents.emit('qr', qr);
  });

  c.on('ready', () => {
    connected = true;
    wasConnected = true;
    attemptedOnce = true;
    startTime = Date.now();
    reconnecting = false;
    reconnectAttempts = 0;
    initAbort = false;
    log('info', '✅ WA: connected');
    botEvents.emit('ready');
  });

  c.on('disconnected', (reason) => {
    connected = false;
    startTime = null;
    log('info', `❌ WA: disconnected — ${reason}`);
    botEvents.emit('disconnected', reason);
    if (!stopped) scheduleReconnect();
  });

  c.on('auth_failure', (msg) => {
    connected = false;
    initAbort = false;
    log('error', `Auth failure: ${msg}`);
    botEvents.emit('auth_failure', msg);
    if (!stopped) scheduleReconnect();
  });

  const knownEvents = [
    'qr', 'ready', 'disconnected', 'auth_failure', 'message', 'message_create',
    'group_join', 'group_leave', 'group_update', 'contact_update',
    'chat_update', 'chat_delete'
  ];

  const importantEvents = ['qr', 'ready', 'disconnected', 'auth_failure'];

  knownEvents.forEach(ev => {
    c.on(ev, (...args) => {
      eventCount++;
      if (importantEvents.includes(ev)) {
        const summary = ev + '#' + eventCount + ' args=' + args.map(a => {
          try {
            if (a && typeof a === 'object' && a.from) return String(a.from).slice(0, 20) + (a.body ? ' body=' + String(a.body).slice(0,30) : '');
            return String(a).slice(0, 40);
          } catch { return '?'; }
        }).join(' | ');
        log('info', `[EVENT] ${summary}`);
      }
      botEvents.emit('event', { event: ev, count: eventCount });
    });
  });

  log('info', `Event handlers registered for ${knownEvents.length} events`);
  return c;
}

function scheduleReconnect() {
  if (stopped || initializing || reconnecting || reconnectTimer) return;
  reconnecting = true;
  const delay = Math.min(10000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  if (reconnectAttempts <= 3) {
    log('info', `🔄 Auto-reconnect in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
  }
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnecting = false;
    if (stopped) return;
    try {
      await resetClient();
      reconnectAttempts = 0;
      log('info', '✅ Auto-reconnect successful');
    } catch (err) {
      if (reconnectAttempts <= 5) {
        log('error', `❌ Auto-reconnect failed (${reconnectAttempts}/${5}): ${err.message}`);
      }
      scheduleReconnect();
    }
  }, delay);
}

client = createClient();

setInterval(() => {
  if (connected) log('info', `[HEARTBEAT] alive eventCount=${eventCount} connected=true`);
}, 30000);

setInterval(() => {
  if (!connected && !stopped && !initializing && !reconnecting && attemptedOnce && client) {
    scheduleReconnect();
  }
}, 60000);

export async function connect() {
  initAbort = false;
  stopped = false;
  initializing = true;
  attemptedOnce = true;
  log('info', 'Initializing WhatsApp client...');
  try {
    const initPromise = client.initialize();
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        initAbort = true;
        reject(new Error('Initialize timeout (30s) — browser may have failed to start'));
      }, 30000);
      client.once('qr', () => clearTimeout(timer));
      client.once('ready', () => clearTimeout(timer));
    });
    await Promise.race([initPromise, timeoutPromise]);
    if (!initAbort) {
      log('info', `WhatsApp client initialized, connected=${connected}`);
    }
    return client;
  } finally {
    if (!initAbort) initializing = false;
  }
}

export async function disconnect() {
  stopped = true;
  initAbort = true;
  initializing = false;
  wasConnected = false;
  attemptedOnce = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnecting = false;
  try {
    try { await client.destroy(); } catch {}
    try {
      const browser = client?.puppeteer?.browser;
      if (browser) await browser.close();
    } catch {}
    connected = false;
    startTime = null;
    lastQr = null;
    log('info', 'Bot stopped');
  } catch (e) {
    log('error', `Disconnect error: ${e.message}`);
  }
}

export async function resetClient() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnecting = false;
  stopped = false;
  initAbort = false;
  initializing = true;
  attemptedOnce = true;
  killOrphanedBrowsers();
  await new Promise(r => setTimeout(r, 2000));
  try { await client.destroy(); } catch {}
  try {
    const browser = client?.puppeteer?.browser;
    if (browser) await browser.close();
  } catch {}
  connected = false;
  startTime = null;
  lastQr = null;
  eventCount = 0;
  client = createClient();
  startListener(client);
  try {
    const initPromise = client.initialize();
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        initAbort = true;
        reject(new Error('Reset timeout (30s)'));
      }, 30000);
      client.once('qr', () => clearTimeout(timer));
      client.once('ready', () => clearTimeout(timer));
    });
    await Promise.race([initPromise, timeoutPromise]);
    return client;
  } finally {
    if (!initAbort) initializing = false;
  }
}

export function getClient() { return client; }

export async function logout() {
  stopped = true;
  initAbort = true;
  initializing = false;
  wasConnected = false;
  attemptedOnce = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnecting = false;
  killOrphanedBrowsers();
  await new Promise(r => setTimeout(r, 1500));
  try { await client.destroy(); } catch {}
  try {
    const browser = client?.puppeteer?.browser;
    if (browser) await browser.close();
  } catch {}
  // Clear the LocalAuth session so the singleton lock + cached auth are removed,
  // preventing "browser is already running for <session>" on the next start.
  try {
    rmSync(join(AUTH_DIR, 'session-whatsapp-bot-session'), { recursive: true, force: true });
    log('info', 'Cleared WhatsApp session directory');
  } catch (e) {
    log('warn', `Could not clear session dir: ${e.message}`);
  }
  connected = false;
  startTime = null;
  lastQr = null;
  log('info', 'Bot logged out (session cleared)');
}

let qrGenerationPromise = null;

export function generateQr() {
  if (qrGenerationPromise) return qrGenerationPromise;
  qrGenerationPromise = (async () => {
    await logout();
    client = createClient();
    startListener(client);
    initializing = true;
    stopped = false;
    initAbort = false;
    attemptedOnce = true;
    log('info', 'Generating new QR code...');
    try {
      return await new Promise((resolve) => {
        const timer = setTimeout(() => { initAbort = true; resolve(client); }, 30000);
        client.once('qr', () => { clearTimeout(timer); resolve(client); });
        client.once('ready', () => { clearTimeout(timer); resolve(client); });
        client.initialize().catch(() => { clearTimeout(timer); resolve(client); });
      });
    } finally {
      qrGenerationPromise = null;
    }
  })();
  return qrGenerationPromise;
}

export function getConnectionStatus() {
  return {
    connected,
    stopped,
    initializing,
    uptime: startTime ? Date.now() - startTime : null,
    eventCount,
    lastQr,
    targetChannel: config.targetChatJid,
    allowedGroups: config.allowedGroups,
    triggerKeywords: config.triggerKeywords,
    triggerHashtags: config.triggerHashtags,
    reconnecting,
    attemptedOnce,
    authDir: AUTH_DIR,
  };
}
