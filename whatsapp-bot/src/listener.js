import { log } from './utils.js';
import { isDuplicate } from './db.js';
import config from '../config.js';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TMP_DIR = join(__dirname, '..', 'media', 'raw');

function ensureDir(dir) {
  try { writeFileSync(join(dir, '.keep'), ''); } catch {}
}
ensureDir(TMP_DIR);

let _clientRef = null;
let dotLock = Promise.resolve();

function acquireLock() {
  let release;
  const prev = dotLock;
  dotLock = new Promise(resolve => { release = resolve; });
  return prev.then(() => release);
}

async function getWaCounter() {
  const { getWhatsAppCount, setWhatsAppCount, incrementWhatsAppCount } = await import('../../backend/src/utils/sendCounter.js');
  return { getWhatsAppCount, setWhatsAppCount, incrementWhatsAppCount };
}

async function sendDotToChannel(client, jid, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      await client.sendMessage(jid, '.');
      return true;
    } catch (e) {
      log('warn', `[dot] attempt ${i+1}/${retries} failed for ${jid}: ${e.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return false;
}

export async function resetCounter() {
  const { setWhatsAppCount } = await getWaCounter();
  setWhatsAppCount(0);
  log('info', '[waCounter] reset to 0');
  return { counter: 0 };
}

export async function sendDotAndReset(client) {
  const c = client || _clientRef;
  if (!c) throw new Error('Bot client not available');
  const release = await acquireLock();
  try {
    await sendDotToChannel(c, config.targetChatJid);
    const { setWhatsAppCount } = await getWaCounter();
    setWhatsAppCount(0);
    log('info', '[waCounter] reset to 0 via sendDotAndReset');
    return { counter: 0, sent: true };
  } finally {
    release();
  }
}

function getChatId(msg) {
  if (!msg.fromMe) return String(msg.from || '');
  const to = String(msg.to || '');
  if (to.endsWith('@g.us') || to.endsWith('@newsletter') || to.endsWith('@broadcast')) return to;
  return String(msg.from || '');
}

export function startListener(client) {
  client.on('message_create', async (msg) => {
    const chatId = getChatId(msg);
    log('info', `>>> MSG chat=${chatId.slice(0,50)} fromMe=${msg.fromMe} type=${msg.type} body=${String(msg.body ?? '').slice(0,60)}`);
    try {
      await handleMessage(client, msg);
    } catch (err) {
      log('error', `Listener error: ${err.message}`);
    }
  });
}

async function handleMessage(client, msg) {
  const chatId = getChatId(msg);
  const from = msg.fromMe ? String(msg.from || '') : String(msg.author || msg.from || '');
  if (!chatId) return;

  log('info', `[1] chat=${chatId.slice(0,50)} from=${from.slice(0,40)} fromMe=${msg.fromMe}`);

  if (!isAllowedChat(chatId)) {
    log('info', `[SKIP] chat ${chatId}`);
    return;
  }

  const msgId = msg._data?.id || msg.id?._serialized || 'unknown';
  log('info', `[2] msgId=${msgId} hasQuoted=${msg.hasQuotedMsg}`);

  let quoted = null;
  if (msg.hasQuotedMsg) {
    try {
      quoted = await msg.getQuotedMessage();
      log('info', `[3] quoted type=${quoted?.type}`);
    } catch (e) {
      log('info', `[3] getQuotedMessage error: ${e.message}`);
    }
  }

  const isQuotedVideo = quoted && isVideo(quoted);
  const text = (msg.body || msg.caption || '').toLowerCase().trim();

  log('info', `[4] text="${text}" isQuotedVideo=${isQuotedVideo} isSelfVideo=${isVideo(msg)}`);

  if (isDuplicate(msgId)) {
    log('info', `[5] duplicate`);
    return;
  }

  const kwMatch = config.triggerKeywords.some(kw => text.includes(kw));
  const tagMatch = config.triggerHashtags.some(tag => text.includes(tag));

  log('info', `[5] kwMatch=${kwMatch} tagMatch=${tagMatch}`);

  const triggered =
    (isQuotedVideo && kwMatch) ||
    (isQuotedVideo && tagMatch) ||
    (isVideo(msg) && tagMatch);

  if (!triggered) {
    log('info', `[NO TRIGGER]`);
    return;
  }

  log('info', `✅ TRIGGER at ${chatId} by ${from}: ${text}`);

  const targetMsg = isQuotedVideo ? quoted : isVideo(msg) ? msg : null;
  if (!targetMsg) {
    log('info', `[NO TARGET] sending error reply...`);
    try {
      await msg.reply('❌ Format salah. Kirim video dengan caption #upload, atau reply video dengan #upload');
    } catch (e) {
      log('info', `[NO TARGET] reply failed: ${e.message}`);
    }
    return;
  }

  let media;
  try {
    media = await targetMsg.downloadMedia();
  } catch (e) {
    log('error', `Download error: ${e.message}`);
    try { await msg.reply('❌ Gagal download media'); } catch {}
    return;
  }
  if (!media) {
    log('info', `[NO MEDIA] sending error reply...`);
    try { await msg.reply('❌ Media tidak ditemukan'); } catch {}
    return;
  }

  const mimetype = String(media.mimetype || 'video/mp4');
  const ext = mimetype.includes('mp4') ? 'mp4' : 'bin';
  const tmpPath = join(TMP_DIR, `${Date.now()}_${String(msgId).replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`);

  try {
    const buffer = Buffer.from(media.data, 'base64');
    writeFileSync(tmpPath, buffer);
    log('info', `[6] saved tmp ${tmpPath} (${buffer.length} bytes)`);

    const caption = config.captionTemplate({
      senderName: from,
      groupName: chatId,
      timestamp: new Date().toLocaleString('id-ID'),
    });

    log('info', `📤 Uploading to ${config.targetChatJid}...`);
    const mediaObj = new MessageMedia(mimetype, media.data, `${Date.now()}.${ext}`);
    await client.sendMessage(config.targetChatJid, mediaObj, {
      caption: (!config.targetChatJid.endsWith('@broadcast') && !config.targetChatJid.endsWith('@newsletter')) ? caption : undefined,
    });
    log('info', `✅ Sent to ${config.targetChatJid}`);

    try {
      await msg.delete(false);
      log('info', `[7] trigger msg deleted`);
    } catch (e) {
      log('info', `[7] trigger msg delete failed: ${e.message}`);
    }

    const { incrementWhatsAppCount, isSeparatorNeeded, setWhatsAppCount } = await import('../../backend/src/utils/sendCounter.js');
    const count = await incrementWhatsAppCount();
    log('info', `[8] whatsappCounter=${count}`);
    if (isSeparatorNeeded(count)) {
      const release = await acquireLock();
      try {
        const ok = await sendDotToChannel(client, config.targetChatJid);
        if (ok) {
          log('info', `[9] sent "." to reset media grouping`);
        } else {
          log('error', `[9] failed to send "." after all retries`);
        }
        setWhatsAppCount(0);
      } finally {
        release();
      }
    }
  } catch (e) {
      log('error', `Upload error: ${e.message}`);
      try { await msg.reply('❌ Gagal upload media'); } catch {}
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

function isAllowedChat(chatId) {
  const c = String(chatId || '');
  if (config.allowedGroups.includes('*')) {
    return c.endsWith('@g.us') || c.endsWith('@newsletter') ||
           c.endsWith('@broadcast') || c.endsWith('@lid') || c.endsWith('@c.us');
  }
  return config.allowedGroups.includes(c);
}

function isVideo(msg) {
  if (!msg) return false;
  return msg.type === 'video' || (msg.type === 'document' && (msg.mimetype || '').includes('video'));
}
