import TelegramBotApi from 'node-telegram-bot-api';
import { getFileWithRelPath } from './fileResolver.js';
import path from 'node:path';
import db from '../db.js';
import { extractUrls, createBulkTasks, onTaskFinished } from '../downloader/manager.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1002821903652';
const SUMMARY_TTL_MS = 5 * 60 * 1000;

const DEFAULT_ALLOWED = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '1399809913')
  .split(',').map(s => s.trim()).filter(Boolean);

let bot = null;

function createBot() {
  if (bot) return bot;
  if (!BOT_TOKEN) return null;
  bot = new TelegramBotApi(BOT_TOKEN, { polling: true });
  bot.on('polling_error', (err) => {
    console.error('[tg polling]', err.message);
    const msg = (err && err.message) || String(err);
    const shouldRestart = /EFATAL|ECONNRESET|409 Conflict|ETELEGRAM: 409/i.test(msg);
    if (shouldRestart) {
      bot.stopPolling().then(() => {
        setTimeout(() => {
          bot = null;
          createBot();
        }, 5000);
      }).catch(() => {});
    }
  });
  return bot;
}

export function getBot() {
  if (bot) return bot;
  if (!BOT_TOKEN) return null;
  bot = new TelegramBotApi(BOT_TOKEN, { polling: false });
  return bot;
}

export async function sendFileToTelegram(fileId, captionPrefix = '') {
  const b = getBot();
  if (!b) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const file = getFileWithRelPath(fileId);
  if (!file) throw new Error('File not found');

  const caption = captionPrefix || '';

  // Kirim sebagai dokumen untuk SEMUA tipe → byte-for-byte 1:1 (tidak dikompres
  // Telegram seperti sendPhoto/sendVideo/sendAudio). Trade-off: preview di Telegram
  // tidak sekaya foto/video inline, tapi kualitas asli terjaga (sesuai keputusan user).
  await b.sendDocument(CHAT_ID, file.fullPath, { caption });
}

// ── DB helpers ──
function dbGetTaskLink(taskId) {
  return db.prepare('SELECT user_msg_id FROM telegram_task_link WHERE task_id = ?').get(taskId);
}
function dbGetBotTask(userMsgId) {
  return db.prepare('SELECT * FROM telegram_bot_tasks WHERE user_msg_id = ?').get(userMsgId);
}
function dbSetCleaned(userMsgId) {
  db.prepare('UPDATE telegram_bot_tasks SET cleaned = 1 WHERE user_msg_id = ?').run(userMsgId);
}
function dbIncFinished(userMsgId) {
  db.prepare('UPDATE telegram_bot_tasks SET finished = finished + 1 WHERE user_msg_id = ?').run(userMsgId);
}
function dbGetFinished(userMsgId) {
  return db.prepare('SELECT finished, total FROM telegram_bot_tasks WHERE user_msg_id = ?').get(userMsgId);
}
function dbDeleteBotTask(userMsgId) {
  db.prepare('DELETE FROM telegram_bot_tasks WHERE user_msg_id = ?').run(userMsgId);
  db.prepare('DELETE FROM telegram_task_link WHERE user_msg_id = ?').run(userMsgId);
}
function dbInsertLink(taskId, userMsgId) {
  db.prepare('INSERT OR REPLACE INTO telegram_task_link (task_id, user_msg_id) VALUES (?, ?)').run(taskId, userMsgId);
}
function dbInsertBotTask(userMsgId, chatId, queuedMsgId, taskIds, total) {
  db.prepare('INSERT OR REPLACE INTO telegram_bot_tasks (user_msg_id, chat_id, queued_msg_id, task_ids, total, finished, cleaned) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(userMsgId, String(chatId), queuedMsgId || null, JSON.stringify(taskIds), total);
}
function dbIsProcessed(msgId) {
  return !!db.prepare('SELECT msg_id FROM telegram_processed WHERE msg_id = ?').get(msgId);
}
function dbMarkProcessed(msgId) {
  db.prepare('INSERT OR IGNORE INTO telegram_processed (msg_id, ts) VALUES (?, ?)').run(msgId, Date.now());
}
function dbInsertEphemeral(msgId, chatId, deleteAt) {
  db.prepare('INSERT OR REPLACE INTO telegram_ephemeral (msg_id, chat_id, delete_at) VALUES (?, ?, ?)').run(msgId, String(chatId), deleteAt);
}

function isAuthorized(chatId) {
  const id = String(chatId);
  if (DEFAULT_ALLOWED.includes(id)) return true;
  const row = db.prepare('SELECT chat_id FROM telegram_allowed_chats WHERE chat_id = ?').get(id);
  return !!row;
}

function authorizeChat(chatId) {
  db.prepare('INSERT OR IGNORE INTO telegram_allowed_chats (chat_id, created_at) VALUES (?, ?)')
    .run(String(chatId), Date.now());
}

async function tryDelete(chatId, msgId) {
  if (!msgId) return;
  try { await bot.deleteMessage(chatId, msgId); }
  catch (e) { console.warn('[tg delete]', e.message); }
}

function buildSummary(task) {
  const ext = task.filename ? path.extname(task.filename) : '';
  const type = ext ? `${ext.replace('.', '').toUpperCase()} file` : (task.category || 'media');
  const statusLine = task.status === 'completed' ? '✅ Download selesai' : '❌ Download gagal';
  let s = `${statusLine}\n`;
  s += `📄 ${task.filename || '-'}\n`;
  s += `📦 ${task.totalSize || '-'}\n`;
  s += `🏷️ ${type}\n`;
  s += `🕒 ${task.completedAt || '-'}\n`;
  s += `📂 ${task.filePath || '-'}\n`;
  s += `📌 status: ${task.status}`;
  if (task.status !== 'completed' && task.error) s += `\n⚠️ ${task.error}`;
  return s;
}

let finishedHookRegistered = false;

function handleTaskFinished(task) {
  if (!task.viaBot) return;
  const link = dbGetTaskLink(task.id);
  if (!link) return;
  const userMsgId = link.user_msg_id;
  const entry = dbGetBotTask(userMsgId);
  if (!entry) return;

  if (!entry.cleaned) {
    dbSetCleaned(userMsgId);
    tryDelete(entry.chat_id, userMsgId);
    tryDelete(entry.chat_id, entry.queued_msg_id);
  }

  try {
    bot.sendMessage(entry.chat_id, buildSummary(task)).then(sent => {
      if (sent && sent.message_id) {
        const deleteAt = Date.now() + SUMMARY_TTL_MS;
        dbInsertEphemeral(sent.message_id, entry.chat_id, deleteAt);
      }
    }).catch(() => {});
  } catch {}

  dbIncFinished(userMsgId);
  const f = dbGetFinished(userMsgId);
  if (f && f.finished >= f.total) dbDeleteBotTask(userMsgId);
}

async function onMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;
  const text = (msg.text || '').trim();

  if (text.startsWith('/start') || text.startsWith('/allow')) {
    if (msg.chat.type === 'private') {
      authorizeChat(chatId);
      await bot.sendMessage(chatId, '✅ Bot diotorisasi untuk chat ini.\nKirim link YouTube / Instagram / Twitter untuk auto-download.').catch(() => {});
    }
    return;
  }

  if (msg.chat.type !== 'private') return;
  if (!isAuthorized(chatId)) return;

  const urls = extractUrls(text);
  if (urls.length === 0) {
    await bot.sendMessage(chatId, 'Kirim link YouTube / Instagram / Twitter, bot akan download otomatis. Ketik /start untuk otorisasi.').catch(() => {});
    return;
  }

  if (dbIsProcessed(msg.message_id)) return;
  dbMarkProcessed(msg.message_id);

  try {
    const results = createBulkTasks(urls, { botMode: true });
    const ok = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);

    if (ok.length === 0) {
      const reply = `⚠️ ${failed.length} gagal: ${failed[0].error}`;
      await bot.sendMessage(chatId, reply).catch(() => {});
      return;
    }

    const taskIds = ok.map(r => r.id);
    const reply = `📥 ${ok.length} link diantrekan untuk download...`;
    const sent = await bot.sendMessage(chatId, reply).catch(() => null);
    const queuedMsgId = sent?.message_id || null;

    dbInsertBotTask(msg.message_id, chatId, queuedMsgId, taskIds, ok.length);
    for (const r of ok) dbInsertLink(r.id, msg.message_id);

    if (failed.length > 0) {
      await bot.sendMessage(chatId, `⚠️ ${failed.length} link dilewati: ${failed[0].error}`).catch(() => {});
    }
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Gagal: ${err.message}`).catch(() => {});
  }
}

let cleanerStarted = false;
function startEphemeralCleaner() {
  if (cleanerStarted) return;
  cleanerStarted = true;
  setInterval(() => {
    try {
      const now = Date.now();
      const rows = db.prepare('SELECT msg_id, chat_id FROM telegram_ephemeral WHERE delete_at <= ?').all(now);
      for (const row of rows) {
        tryDelete(row.chat_id, row.msg_id);
        db.prepare('DELETE FROM telegram_ephemeral WHERE msg_id = ?').run(row.msg_id);
      }
      db.prepare('DELETE FROM telegram_processed WHERE ts < ?').run(now - 24 * 60 * 60 * 1000);
    } catch {}
  }, 60 * 1000);
}

export function initTelegramInbound() {
  if (!BOT_TOKEN) return;
  createBot();
  if (!bot) return;
  bot.on('message', onMessage);
  if (!finishedHookRegistered) {
    finishedHookRegistered = true;
    onTaskFinished(handleTaskFinished);
  }
  startEphemeralCleaner();
}
