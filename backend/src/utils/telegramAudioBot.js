import TelegramBotApi from 'node-telegram-bot-api';
import path from 'node:path';
import db from '../db.js';
import { extractUrls, createBulkTasks, onTaskFinished, getTaskList } from '../downloader/manager.js';

const BOT_TOKEN = process.env.TELEGRAM_AUDIO_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_AUDIO_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '-1002821903652';
const DEFAULT_ALLOWED = (process.env.TELEGRAM_AUDIO_ALLOWED_CHAT_IDS || process.env.TELEGRAM_ALLOWED_CHAT_IDS || '1399809913')
  .split(',').map(s => s.trim()).filter(Boolean);
const SUMMARY_TTL_MS = 5 * 60 * 1000;
const DUPLICATE_TTL_MS = 8 * 1000;

let bot = null;
let messageHandler = null;
let lastPollingErrorLog = 0;
const POLLING_ERROR_LOG_INTERVAL = 10000;

function createBot() {
  if (bot) return bot;
  if (!BOT_TOKEN) return null;
  bot = new TelegramBotApi(BOT_TOKEN, { polling: true });
  bot.on('polling_error', (err) => {
    const msg = (err && err.message) || String(err);
    const shouldRestart = /EFATAL|ECONNRESET|409 Conflict|ETELEGRAM: 409/i.test(msg);
    if (shouldRestart) {
      bot.stopPolling().then(() => {
        setTimeout(() => {
          bot = null;
          const newBot = createBot();
          if (newBot && messageHandler) {
            newBot.on('message', messageHandler);
            console.log('[tg audio] message handler re-registered after restart');
          }
        }, 5000);
      }).catch(() => {});
    }
    const now = Date.now();
    if (now - lastPollingErrorLog > POLLING_ERROR_LOG_INTERVAL) {
      lastPollingErrorLog = now;
      console.error('[tg audio polling]', msg);
    }
  });
  return bot;
}

export function getBot() {
  if (bot) return bot;
  if (!BOT_TOKEN) return null;
  const sendBot = new TelegramBotApi(BOT_TOKEN, { polling: false });
  return sendBot;
}

export async function sendAudioToTelegram(fileId, captionPrefix = '') {
  const b = getBot();
  if (!b) throw new Error('TELEGRAM_AUDIO_BOT_TOKEN not configured');
  const engine = globalThis.mediaEngine;
  if (!engine) throw new Error('Media engine not ready');
  const file = await engine.resolve(fileId);
  if (!file || file.blocked) throw new Error('File not found');
  await b.sendAudio(CHAT_ID, file.fullPath, { caption: captionPrefix || '' });
}

// ── DB helpers ──
function dbGetBotTask(userMsgId) {
  return db.prepare('SELECT * FROM telegram_audio_bot_tasks WHERE user_msg_id = ?').get(userMsgId);
}
function dbSetCleaned(userMsgId) {
  db.prepare('UPDATE telegram_audio_bot_tasks SET cleaned = 1 WHERE user_msg_id = ?').run(userMsgId);
}
function dbIncFinished(userMsgId) {
  db.prepare('UPDATE telegram_audio_bot_tasks SET finished = finished + 1 WHERE user_msg_id = ?').run(userMsgId);
}
function dbGetFinished(userMsgId) {
  return db.prepare('SELECT finished, total FROM telegram_audio_bot_tasks WHERE user_msg_id = ?').get(userMsgId);
}
function dbDeleteBotTask(userMsgId) {
  db.prepare('DELETE FROM telegram_audio_bot_tasks WHERE user_msg_id = ?').run(userMsgId);
  db.prepare('DELETE FROM telegram_audio_task_link WHERE user_msg_id = ?').run(userMsgId);
}
function dbInsertLink(taskId, userMsgId) {
  db.prepare('INSERT OR REPLACE INTO telegram_audio_task_link (task_id, user_msg_id) VALUES (?, ?)').run(taskId, userMsgId);
}
function dbInsertBotTask(userMsgId, chatId, queuedMsgId, taskIds, total) {
  db.prepare('INSERT OR REPLACE INTO telegram_audio_bot_tasks (user_msg_id, chat_id, queued_msg_id, task_ids, total, finished, cleaned) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(userMsgId, String(chatId), queuedMsgId || null, JSON.stringify(taskIds), total);
}
function dbIsProcessed(msgId) {
  return !!db.prepare('SELECT msg_id FROM telegram_audio_processed WHERE msg_id = ?').get(msgId);
}
function dbMarkProcessed(msgId) {
  db.prepare('INSERT OR IGNORE INTO telegram_audio_processed (msg_id, ts) VALUES (?, ?)').run(msgId, Date.now());
}
function dbInsertEphemeral(msgId, chatId, deleteAt) {
  db.prepare('INSERT OR REPLACE INTO telegram_audio_ephemeral (msg_id, chat_id, delete_at) VALUES (?, ?, ?)').run(msgId, String(chatId), deleteAt);
}

function isAuthorized(chatId) {
  const id = String(chatId);
  if (DEFAULT_ALLOWED.includes(id)) return true;
  return false;
}

function isUrlDuplicate(url) {
  const activeStatuses = ['queued', 'downloading'];
  const allTasks = getTaskList();
  return allTasks.some(t => t.viaBot && activeStatuses.includes(t.status) && t.url === url);
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
const pendingAudioSends = new Map();

function handleTaskFinished(task) {
  if (!task.viaBot) return;
  const pending = pendingAudioSends.get(task.id);
  if (!pending) return;
  pendingAudioSends.delete(task.id);

  const { chatId, userMsgId, queuedMsgId } = pending;

  if (task.status === 'completed' && task.filePath && task.filename) {
    sendAudioToTelegram(task.filePath, task.filename)
      .then((audioMsg) => {
        if (audioMsg && audioMsg.message_id) {
          const deleteAt = Date.now() + SUMMARY_TTL_MS;
          dbInsertEphemeral(audioMsg.message_id, chatId, deleteAt);
        }
        return sendSummary(chatId, userMsgId, queuedMsgId, task);
      })
      .catch(async (err) => {
        console.error('[tg audio send]', err.message);
        await sendSummary(chatId, userMsgId, queuedMsgId, task);
      });
  } else {
    sendSummary(chatId, userMsgId, queuedMsgId, task).catch(() => {});
  }
}

async function sendSummary(chatId, userMsgId, queuedMsgId, task) {
  try {
    const sent = await bot.sendMessage(chatId, buildSummary(task)).catch(() => null);
    if (sent && sent.message_id) {
      const deleteAt = Date.now() + SUMMARY_TTL_MS;
      dbInsertEphemeral(sent.message_id, chatId, deleteAt);
    }
  } catch {}

  if (userMsgId) {
    try { await bot.deleteMessage(chatId, userMsgId).catch(() => {}); } catch {}
  }
  if (queuedMsgId) {
    try { await bot.deleteMessage(chatId, queuedMsgId).catch(() => {}); } catch {}
  }
}

async function onMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;
  const text = (msg.text || '').trim();

  console.log(`[tg audio msg] chat=${chatId} type=${msg.chat.type} text="${text.substring(0, 80)}"`);

  if (text.startsWith('/start') || text.startsWith('/allow')) {
    if (msg.chat.type === 'private') {
      const reply = await bot.sendMessage(chatId, '✅ Audio bot diotorisasi.\nKirim link YouTube, bot akan download audio + cover otomatis.').catch(() => null);
      if (reply && reply.message_id) {
        dbInsertEphemeral(reply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
      }
    }
    return;
  }

  if (msg.chat.type !== 'private') {
    console.log(`[tg audio msg] skipped: not private chat`);
    return;
  }
  if (!isAuthorized(chatId)) {
    console.log(`[tg audio msg] skipped: not authorized (chatId=${chatId})`);
    return;
  }

  const urls = extractUrls(text);
  if (urls.length === 0) {
    const reply = await bot.sendMessage(chatId, 'Kirim link YouTube, bot akan download audio + cover otomatis.').catch(() => null);
    if (reply && reply.message_id) {
      dbInsertEphemeral(reply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
    }
    return;
  }

  const ytUrls = urls.filter(u => /youtube\.com|youtu\.be/i.test(u));
  if (ytUrls.length === 0) {
    const reply = await bot.sendMessage(chatId, 'Hanya link YouTube yang didukung di bot ini.').catch(() => null);
    if (reply && reply.message_id) {
      dbInsertEphemeral(reply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
    }
    return;
  }

  const duplicateUrls = ytUrls.filter(u => isUrlDuplicate(u));
  if (duplicateUrls.length > 0) {
    const reply = await bot.sendMessage(chatId, `⏳ Link ini sedang didownload: ${duplicateUrls[0].substring(0, 60)}\nTunggu selesai atau cancel dulu.`).catch(() => null);
    if (reply && reply.message_id) {
      dbInsertEphemeral(reply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
    }
    try { await bot.deleteMessage(chatId, msg.message_id).catch(() => {}); } catch {}
    return;
  }

  if (dbIsProcessed(msg.message_id)) {
    console.log(`[tg audio msg] skipped: already processed (msgId=${msg.message_id})`);
    return;
  }
  dbMarkProcessed(msg.message_id);

  try {
    const results = createBulkTasks(ytUrls, {
      botMode: true,
      category: 'youtube',
      audioExtract: true,
      audioBitrate: 'best',
      embedCover: true,
    });
    const ok = results.filter(r => !r.error && r.id != null);
    const failed = results.filter(r => r.error);
    const skipped = results.filter(r => r.skipped || r.cached);

    console.log(`[tg audio msg] urls=${ytUrls.length} ok=${ok.length} failed=${failed.length} skipped=${skipped.length}`);

    if (ok.length === 0) {
      const errOrSkip = [...failed, ...skipped];
      const detail = errOrSkip.length > 0
        ? (errOrSkip[0].error || errOrSkip[0].reason || 'unknown')
        : 'no valid tasks';
      const reply = `⚠️ ${results.length} link gagal: ${detail}`;
      const sent = await bot.sendMessage(chatId, reply).catch(() => null);
      if (sent && sent.message_id) {
        dbInsertEphemeral(sent.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
      }
      return;
    }

    const reply = `🎵 ${ok.length} audio diantrekan untuk download...`;
    const sent = await bot.sendMessage(chatId, reply).catch(() => null);
    const queuedMsgId = sent?.message_id || null;

    dbInsertBotTask(msg.message_id, chatId, queuedMsgId, ok.map(r => r.id), ok.length);
    for (const r of ok) dbInsertLink(r.id, msg.message_id);

    if (queuedMsgId) {
      const deleteAt = Date.now() + SUMMARY_TTL_MS;
      dbInsertEphemeral(queuedMsgId, chatId, deleteAt);
    }

    if (failed.length > 0) {
      const errReply = await bot.sendMessage(chatId, `⚠️ ${failed.length} link dilewati: ${failed[0].error}`).catch(() => null);
      if (errReply && errReply.message_id) {
        dbInsertEphemeral(errReply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
      }
    }
    if (skipped.length > 0) {
      const skipReply = await bot.sendMessage(chatId, `ℹ️ ${skipped.length} link sudah didownload sebelumnya`).catch(() => null);
      if (skipReply && skipReply.message_id) {
        dbInsertEphemeral(skipReply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
      }
    }
  } catch (err) {
    console.error('[tg audio msg] error:', err);
    const reply = await bot.sendMessage(chatId, `❌ Gagal: ${err.message}`).catch(() => null);
    if (reply && reply.message_id) {
      dbInsertEphemeral(reply.message_id, chatId, Date.now() + DUPLICATE_TTL_MS);
    }
  }
}

let cleanerStarted = false;
function startEphemeralCleaner() {
  if (cleanerStarted) return;
  cleanerStarted = true;
  setInterval(() => {
    try {
      const now = Date.now();
      const rows = db.prepare('SELECT msg_id, chat_id FROM telegram_audio_ephemeral WHERE delete_at <= ?').all(now);
      for (const row of rows) {
        try { bot.deleteMessage(row.chat_id, row.msg_id).catch(() => {}); } catch {}
        db.prepare('DELETE FROM telegram_audio_ephemeral WHERE msg_id = ?').run(row.msg_id);
      }
      db.prepare('DELETE FROM telegram_audio_processed WHERE ts < ?').run(now - 24 * 60 * 60 * 1000);
    } catch {}
  }, 60 * 1000);
}

export function initTelegramAudioBot() {
  if (!BOT_TOKEN) {
    console.log('[tg audio] TELEGRAM_AUDIO_BOT_TOKEN not configured, skipping');
    return;
  }
  createBot();
  if (!bot) return;
  messageHandler = onMessage;
  bot.on('message', onMessage);
  console.log('[tg audio] inbound initialized, polling active');
  if (!finishedHookRegistered) {
    finishedHookRegistered = true;
    onTaskFinished(handleTaskFinished);
  }
  startEphemeralCleaner();
}
