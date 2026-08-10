import WAWebJS from 'whatsapp-web.js';
import fs from 'node:fs';
import path from 'node:path';
import { getClient, getConnectionStatus } from './connection.js';

// whatsapp-web.js default export is a wrapper object; MessageMedia lives on its
// namespace (WAWebJS.default), not directly on the default export. Importing it
// the wrong way made `new MessageMedia(...)` throw "MessageMedia is not a constructor",
// which silently broke all media sends to WhatsApp (text sends were unaffected).
const { MessageMedia } = WAWebJS.default || WAWebJS;

// A single WA media send must never hang the whole combined send (and leave the
// Telegram/Channel/Status progress pills stuck on "sending" forever). If the WA
// Web client is disconnected/stuck, `client.sendMessage` can hang instead of
// throwing, so race it against a hard timeout and surface a clear error.
const WA_SEND_TIMEOUT_MS = 60000;
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (WA tidak merespons)`)), WA_SEND_TIMEOUT_MS)
    ),
  ]);
}

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.hevc': 'video/hevc',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
};

// Build a MessageMedia from a local file ONCE (read + base64 encode single pass).
// Reuse the returned object for both channel and status sends so the (potentially
// large) file is not read/encoded twice per combined send.
export function buildMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const base64 = fs.readFileSync(filePath).toString('base64');
  const filename = path.basename(filePath);
  return new MessageMedia(mimeType, base64, filename);
}

export async function sendMediaToChat(jid, filePath) {
  const client = getClient();
  if (!client) throw new Error('WhatsApp client not available');
  if (!jid) throw new Error('Target JID is required');

  const media = buildMedia(filePath);
  await client.sendMessage(jid, media);
}

export async function sendMediaToChannel(filePath) {
  return sendMediaToChat('120363428745244070@newsletter', filePath);
}

// Send the SAME encoded media to channel then status, sequentially (never in
// parallel — both go through the shared WA Web client, parallel risks a double
// send / client clash). Returns per-target outcome so the caller can record
// partial failures instead of swallowing one behind the other.
export async function sendMediaToChannelAndStatus(filePath) {
  const client = getClient();
  if (!client) throw new Error('WhatsApp client not available');

  const media = buildMedia(filePath);
  const results = { channel: null, status: null };

  try {
    await withTimeout(client.sendMessage('120363428745244070@newsletter', media), 'Channel');
    results.channel = 'sent';
  } catch (err) {
    results.channel = 'err: ' + normalizeWaError(err).message;
  }

  try {
    await waitForPupPage(client);
    const sent = await withTimeout(client.sendMessage('status@broadcast', media), 'Status');
    if (!sent) throw new Error('Status not sent (media type unsupported or chat unavailable)');
    results.status = 'sent';
  } catch (err) {
    results.status = 'err: ' + normalizeWaError(err).message;
  }

  return results;
}

// WhatsApp media-send failures from the headless bundle can surface as a nearly
// empty / cryptic error (e.g. err.message === "t") when the underlying
// prepRawMedia / processMediaData step can't handle the codec (HEVC, webm, etc.).
// Replace those with a human-readable hint so the queue/UI don't just show "t".
const CRYPTIC_WA_RE = /^(t|undefined|null)?$/;
export function normalizeWaError(err) {
  if (!err) return err;
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  if (CRYPTIC_WA_RE.test(msg.trim()) || msg.trim().length <= 2) {
    return new Error('Media gagal diproses WA (kemungkinan codec HEVC/webm tidak didukung — pakai H.264 mp4)');
  }
  return err;
}

// Send the SAME encoded media to the selected WA targets (channel and/or status)
// sequentially, building the media only ONCE (encode-once, no double-read). Used
// both for the combined 'whatsapp'/'all' path and for the separate 'channel' /
// 'status' buttons. Per-target outcome is returned so the caller can record
// partial failures (e.g. lone status error) instead of swallowing one behind the
// other.
export async function sendMediaToTargets(filePath, { channel = false, status = false, caption = '' } = {}) {
  const client = getClient();
  if (!client) throw new Error('WhatsApp client not available');
  // Fail fast with a clear message when the WA client isn't actually connected
  // (e.g. stuck reconnecting) instead of hanging on the env-readiness wait.
  if (!getConnectionStatus().connected) {
    throw new Error('WhatsApp tidak terhubung — scan ulang QR di menu Bot');
  }

  const media = buildMedia(filePath);
  const results = { channel: null, status: null };

  if (channel) {
    try {
      const opts = caption ? { caption } : undefined;
      const sent = await withTimeout(client.sendMessage('120363428745244070@newsletter', media, opts), 'Channel');
      // Hardened success contract: whatsapp-web.js returns a Message (with .id) on
      // success and throws on failure. A falsy / id-less return is anomalous — NEVER
      // treat it as success. The scheduler depends only on this normalized result.
      const confirmed = sent && (sent.id || typeof sent !== 'object');
      if (!confirmed) throw new Error('Message not confirmed sent (no return id)');
      results.channel = 'sent';
    } catch (err) {
      results.channel = 'err: ' + normalizeWaError(err).message;
    }
  }

  if (status) {
    try {
      const sent = await sendStatusWithRetry(client, media, caption);
      results.status = sent ? 'sent' : 'err: Status not sent (media unsupported / chat unavailable)';
    } catch (err) {
      results.status = 'err: ' + normalizeWaError(err).message;
    }
  }

  return results;
}

// Status sends fail with "Cannot read properties of undefined (reading
// 'getChat')" when the injected WA Web environment (window.WWebJS) hasn't
// finished loading into the page yet, even though the client reports "ready"
// and pupPage exists. Wait for that environment to be present, then retry a
// couple of times so a momentarily-not-ready page doesn't surface as a failure.
async function sendStatusWithRetry(client, media, caption = '', attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await waitForWWebEnv(client);
      const opts = caption ? { caption } : undefined;
      const sent = await withTimeout(client.sendMessage('status@broadcast', media, opts), 'Status');
      if (sent) return sent;
      throw new Error('Status not sent (media type unsupported or chat unavailable)');
    } catch (err) {
      lastErr = err;
      // Transient "environment not ready" errors — wait briefly and retry.
      if (/getChat|WWebJS|not available|not ready/i.test(err.message) && i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function sendMediaToStatus(filePath) {
  const client = getClient();
  if (!client) throw new Error('WhatsApp client not available');
  if (!getConnectionStatus().connected) {
    throw new Error('WhatsApp tidak terhubung — scan ulang QR di menu Bot');
  }

  const media = buildMedia(filePath);
  const sent = await sendStatusWithRetry(client, media);
  return sent;
}

export async function sendTextToStatus(text, { backgroundColor, fontStyle } = {}) {
  const client = getClient();
  if (!client) throw new Error('WhatsApp client not available');
  if (!getConnectionStatus().connected) {
    throw new Error('WhatsApp tidak terhubung — scan ulang QR di menu Bot');
  }
  await waitForWWebEnv(client);

  const sent = await client.sendMessage('status@broadcast', text, {
    extra: {
      backgroundColor: backgroundColor || '#25D366',
      fontStyle: typeof fontStyle === 'number' ? fontStyle : 0,
    },
  });
  if (!sent) throw new Error('Text status not sent (chat unavailable)');
  return sent;
}

export async function waitForPupPage(client, timeoutMs = 10000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (client.pupPage) return client.pupPage;
    if (Date.now() - start > timeoutMs) {
      throw new Error('WhatsApp pupPage not available (client not ready)');
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

// The status send path (window.WWebJS.getChat(...)) needs the injected WA Web
// environment to be present in the page — not just pupPage. When the client has
// just connected, pupPage exists but window.WWebJS may still be undefined, which
// surfaces as "Cannot read properties of undefined (reading 'getChat')". Wait
// for both before attempting a status send.
export async function waitForWWebEnv(client, timeoutMs = 20000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (client.pupPage) {
      try {
        const ready = await Promise.race([
          client.pupPage.evaluate(() => !!(window.WWebJS && window.WWebJS.getChat)),
          new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
        ]);
        if (ready) return true;
      } catch {
        // page not ready yet — fall through to the wait/retry below
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('WhatsApp WA Web environment not ready (status send unavailable)');
    }
    await new Promise(r => setTimeout(r, 500));
  }
}
