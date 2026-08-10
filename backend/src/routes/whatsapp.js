import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { getClient, getConnectionStatus, connect, disconnect, resetClient, logout, generateQr } from '../../../whatsapp-bot/src/connection.js';
import { startListener, sendDotAndReset } from '../../../whatsapp-bot/src/listener.js';
import { getTelegramCount, getWhatsAppCount, setTelegramCount, setWhatsAppCount } from '../utils/sendCounter.js';
import { setLogSink } from '../../../whatsapp-bot/src/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = join(__dirname, '..', '..', '..', 'whatsapp-bot');
const CONFIG_PATH = join(BOT_DIR, 'config.js');
const STATE_PATH = join(BOT_DIR, 'sessions', 'media_state.json');

const logBuffer = [];
const MAX_LOG_BUFFER = 300;
let sseClients = [];
let listenerStarted = false;

function pushLog(level, message) {
  // Dump every bot log (incl. [HEARTBEAT] alive) into the Bot Activity terminal.
  const entry = { time: Date.now(), level, message };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
  const data = JSON.stringify(entry);
  for (const c of sseClients) {
    try { c.write(`data: ${data}\n\n`); } catch {}
  }
}

export { pushLog };

// Forward the WhatsApp bot's logs into the SSE buffer the Bot menu terminal
// subscribes to. Heartbeat spam is filtered out centrally in pushLog().
setLogSink((level, message) => pushLog(level, message));

export function markListenerStarted() {
  listenerStarted = true;
}

export function setupWhatsAppRoutes(app) {
  app.get('/api/whatsapp/status', (req, res) => {
    try {
      const status = getConnectionStatus();
      res.json({ ...status, telegramCount: getTelegramCount(), whatsappCount: getWhatsAppCount() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/qr', (req, res) => {
    try {
      const status = getConnectionStatus();
      res.json({ qr: status.lastQr, connected: status.connected, initializing: status.initializing });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/qr-image', (req, res) => {
    try {
      const status = getConnectionStatus();
      if (!status.lastQr) return res.status(404).json({ error: 'No QR code available' });
      QRCode.toBuffer(status.lastQr, {
        width: 400,
        margin: 2,
        color: { dark: '#000000ff', light: '#ffffffff' },
      }, (err, buf) => {
        if (err) return res.status(500).json({ error: err.message });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        res.send(buf);
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/start', async (req, res) => {
    try {
      if (getConnectionStatus().connected) {
        return res.json({ ok: true, message: 'Already connected' });
      }
      const client = await connect();
      startListener(client);
      listenerStarted = true;
      res.json({ ok: true, message: 'Bot started' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/stop', async (req, res) => {
    try {
      await disconnect();
      res.json({ ok: true, message: 'Bot stopped' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/restart', async (req, res) => {
    try {
      await disconnect();
      await resetClient();
      res.json({ ok: true, message: 'Bot restarted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    try {
      await logout();
      res.json({ ok: true, message: 'Logged out (session cleared)' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/generate-qr', (req, res) => {
    generateQr().catch((err) => {
      pushLog('error', `QR generation error: ${err.message}`);
    });
    res.json({ ok: true, message: 'QR generation started — scan when ready' });
  });

  app.get('/api/whatsapp/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({ logs: logBuffer.slice(-limit) });
  });

  app.get('/api/whatsapp/logs/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseClients.push(res);
    // Send the history snapshot asynchronously so the connection is already
    // streaming before data is written — avoids the first chunk being
    // coalesced/buffered and dropped by clients/proxies.
    setImmediate(() => {
      for (const entry of logBuffer.slice(-50)) {
        try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { break; }
      }
    });
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
  });

  app.get('/api/whatsapp/stats', (req, res) => {
    try {
      let state = {};
      try { state = JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch {}
      res.json({
        uploadCounter: state.uploadCounter || 0,
        historyCount: (state.history || []).length,
        stats: state.stats || {},
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/whatsapp/counter', (req, res) => {
    try {
      const { value, type } = req.body;
      if (typeof value !== 'number' || value < 0) {
        return res.status(400).json({ error: 'Invalid counter value' });
      }
      if (type === 'telegram') {
        setTelegramCount(value);
      } else {
        setWhatsAppCount(value);
      }
      res.json({ ok: true, type: type || 'whatsapp', counter: value });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/counter/reset', async (req, res) => {
    try {
      const { type } = req.body || {};
      if (type === 'telegram') {
        setTelegramCount(0);
        res.json({ ok: true, type: 'telegram', counter: 0 });
      } else {
        const client = getClient();
        await sendDotAndReset(client);
        res.json({ ok: true, type: 'whatsapp', counter: 0, sent: true });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/config', (req, res) => {
    try {
      const content = readFileSync(CONFIG_PATH, 'utf8');
      const targetMatch = content.match(/targetChatJid:\s*(?:process\.env\.TARGET_CHAT_JID\s*\|\|\s*)?['"]([^'"]+)['"]/);
      const keywordsMatch = content.match(/triggerKeywords:\s*\[(.*?)\]/s);
      const hashtagsMatch = content.match(/triggerHashtags:\s*\[(.*?)\]/s);
      res.json({
        targetChatJid: targetMatch ? targetMatch[1] : '',
        triggerKeywords: keywordsMatch
          ? keywordsMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || []
          : [],
        triggerHashtags: hashtagsMatch
          ? hashtagsMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || []
          : [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/whatsapp/config', (req, res) => {
    try {
      const { targetChatJid, triggerKeywords, triggerHashtags } = req.body;
      let content = readFileSync(CONFIG_PATH, 'utf8');

      if (targetChatJid !== undefined) {
        content = content.replace(
          /(targetChatJid:\s*(?:process\.env\.TARGET_CHAT_JID\s*\|\|\s*)?['"])[^'"]+(['"])/,
          `$1${targetChatJid}$2`
        );
      }
      if (triggerKeywords !== undefined) {
        const arrStr = triggerKeywords.map(s => `'${s}'`).join(', ');
        content = content.replace(/triggerKeywords:\s*\[[^\]]*\]/, `triggerKeywords: [${arrStr}]`);
      }
      if (triggerHashtags !== undefined) {
        const arrStr = triggerHashtags.map(s => `'${s}'`).join(', ');
        content = content.replace(/triggerHashtags:\s*\[[^\]]*\]/, `triggerHashtags: [${arrStr}]`);
      }

      writeFileSync(CONFIG_PATH, content);
      res.json({ ok: true, message: 'Config updated. Restart bot to apply.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Diagnostic: post a WhatsApp Status. Body: { text } for a text status, or
  // { fileId } for a media status. Used to verify status actually RENDERS on the
  // phone (LID-era WA Web accepts media/text but only renders when built with a
  // messageSecret). Kept because it's a handy manual smoke test.
  app.post('/api/whatsapp/test-status', async (req, res) => {
    try {
      const { text, fileId } = req.body || {};
      const { sendTextToStatus, sendMediaToStatus } = await import('../../../whatsapp-bot/src/sender.js');
      if (text != null && String(text).length > 0) {
        const out = await sendTextToStatus(String(text));
        return res.json({ ok: true, kind: 'text', result: out });
      }
      if (fileId) {
        const { getFileWithRelPath } = await import('../utils/fileResolver.js');
        const file = getFileWithRelPath(fileId);
        if (!file) return res.status(404).json({ error: 'File not found' });
        const out = await sendMediaToStatus(file.fullPath);
        return res.json({ ok: true, kind: 'media', result: out });
      }
      if (req.body && req.body.path) {
        const out = await sendMediaToStatus(String(req.body.path));
        return res.json({ ok: true, kind: 'media', result: out });
      }
      return res.status(400).json({ error: 'text or fileId required' });
    } catch (err) {
      console.error('[whatsapp/test-status] error:', err && err.stack ? err.stack : err);
      res.status(500).json({ error: err.message, stack: err && err.stack });
    }
  });

  app.post('/api/whatsapp/debug-lid', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupPage) return res.status(503).json({ error: 'no page' });
      const diag = await client.pupPage.evaluate(() => {
        const out = {};
        try { out.require = typeof window.require; } catch (e) { out.requireErr = e.message; }
        try {
          const MeUser = window.require('WAWebUserPrefsMeUser');
          const W = window.require('WAWebWidFactory');
          out.getMeDeviceLidOrThrow = String(MeUser.getMeDeviceLidOrThrow?.() ?? 'null');
          out.getMaybeMeLidUser = String(MeUser.getMaybeMeLidUser?.() ?? 'null');
          out.getMaybeMePnUser = String(MeUser.getMaybeMePnUser?.() ?? 'null');
        } catch (e) { out.meErr = e.message; }
        try {
          const Store = window.require('WAWebStore');
          out.storeUserMe = String(Store?.User?.me?.toString?.() ?? 'null');
          out.storeUserGetMe = String(Store?.User?.getMe?.()?.toString?.() ?? 'null');
        } catch (e) { out.storeErr = e.message; }
        return out;
      });
      res.json(diag);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/debug-statuscoll', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupPage) return res.status(503).json({ error: 'no page' });
      const diag = await client.pupPage.evaluate(() => {
        const out = { errors: {} };
        // Discover status-store modules.
        try {
          const dbg = window.require('__debug');
          const map = dbg && (dbg.modulesMap || dbg.modules);
          const keys = map ? Object.keys(map) : [];
          out.storeCandidates = keys.filter((k) => /(mystatus|statusv3|statuscollection|statusstore|status.*store|store.*status)/i.test(k)).slice(0, 40);
        } catch (e) { out.errors.enum = e.message; }

        const safeMsg = (m) => {
          try {
            return {
              id: m.id && m.id._serialized,
              type: m.type,
              ack: m.ack,
              t: m.t,
              isStatusV3: m.isStatusV3,
              hasMediaData: !!m.mediaData,
              mediaStage: m.mediaData && m.mediaData.mediaStage,
              body: (m.body || '').slice(0, 30),
              from: m.from && m.from._serialized,
            };
          } catch (e) { return { err: e.message }; }
        };

        // Try known "my status" access paths.
        const tryPath = (label, fn) => {
          try {
            const r = fn();
            if (r == null) { out[label] = null; return; }
            if (Array.isArray(r)) { out[label] = { count: r.length, recent: r.slice(-5).map(safeMsg) }; return; }
            if (r.models) { out[label] = { count: r.models.length, recent: r.models.slice(-5).map(safeMsg) }; return; }
            if (r.msgs && r.msgs.models) { out[label] = { count: r.msgs.models.length, recent: r.msgs.models.slice(-5).map(safeMsg) }; return; }
            out[label] = safeMsg(r);
          } catch (e) { out.errors[label] = e.message; }
        };

        tryPath('myStatusV3', () => {
          const S = window.require('WAWebStatusV3Store');
          const store = S.default || S;
          if (store.getMyStatus) return store.getMyStatus();
          if (store.getStatus) return store.getStatus();
          return store;
        });
        tryPath('statusCollectionModule', () => {
          const S = window.require('WAWebStatusCollection');
          return (S.default || S);
        });
        tryPath('meStatus', () => {
          const Me = window.require('WAWebUserPrefsMeUser');
          const meWid = Me.getMaybeMePnUser ? Me.getMaybeMePnUser() : null;
          const Coll = window.require('WAWebCollections');
          const st = Coll.Status || Coll.StatusV3;
          if (st && meWid) { const m = st.get(meWid._serialized); return m; }
          return null;
        });

        out.lastStatusPresent = !!window.__lastStatus;
        try {
          const ls = window.__lastStatus;
          if (ls) {
            out.lastStatus = {
              collBefore: ls.collBefore,
              collAfter: ls.collAfter,
              retType: typeof ls.ret,
              messageSendResult: ls.ret && (ls.ret.messageSendResult || (ls.ret.t && 'has-t')),
              retKeys: ls.ret && typeof ls.ret === 'object' ? Object.keys(ls.ret).slice(0, 20) : null,
              msgAck: ls.ret && ls.ret.msg && ls.ret.msg.ack,
              msgId: ls.ret && ls.ret.msg && ls.ret.msg.id && ls.ret.msg.id._serialized,
            };
          }
        } catch (e) { out.errors.lastStatus = e.message; }
        return out;
      });
      res.json(diag);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // TEMP: list my own current WhatsApp statuses via the status broadcast chat
  // (lifecycle test verification). Uses the public client API, not internals.
  app.post('/api/whatsapp/_mylist', async (req, res) => {
    try {
      const client = getClient();
      if (!client) return res.status(503).json({ error: 'no client' });
      const chat = await client.getChatById('status@broadcast');
      const msgs = await chat.fetchMessages({ count: 30 });
      const norm = (m) => ({ id: m.id._serialized, shortId: m.id.id, body: (m.body || '').slice(0, 40), t: m.timestamp, ack: m.ack, fromMe: m.fromMe });
      res.json({ count: msgs.length, items: msgs.map(norm) });
    } catch (err) { res.status(500).json({ error: err.message, stack: err && err.stack }); }
  });

  // TEMP: delete one of my own statuses (lifecycle test). Status messages are NOT
  // in WAWebCollections.Msg, so client.getMessageById() can never resolve them.
  // They live in WAWebCollections.Status (per-contact threads, keyed by jid); each
  // thread has a msgs[] of raw message models. We locate the model by its
  // serialized id, then call Cmd.sendRevokeMsgs on the status@broadcast chat to
  // revoke (delete for everyone) — mirroring Message.delete() in the library.
  app.post('/api/whatsapp/_delstatus', async (req, res) => {
    try {
      const { id, shortId } = req.body || {};
      if (!id && !shortId) return res.status(400).json({ error: 'id or shortId required' });
      const client = getClient();
      if (!client) return res.status(503).json({ error: 'no client' });
      const result = await client.pupPage.evaluate(async (serializedId, shortIdArg) => {
        const Collections = window.require('WAWebCollections');
        const all = Collections.Status.getModelsArray();
        // Status MsgKey objects have no _serialized; the short id lives in the
        // MIDDLE of the serialized form (true_status@broadcast_<shortId>_<self>),
        // so match on the short id, extracted from either arg.
        const sShort = serializedId
          ? (serializedId.split('_').length >= 3 ? serializedId.split('_')[2] : serializedId)
          : null;
        let found = null;
        for (const s of all) {
          const msgs = (s.msgs && s.msgs.getModelsArray ? s.msgs.getModelsArray() : (s.msgs || [])) || [];
          for (const m of msgs) {
            const mid = m.id && m.id.id;
            if ((shortIdArg && mid === shortIdArg) ||
                (sShort && mid === sShort) ||
                (serializedId && mid && serializedId.indexOf(mid) !== -1)) {
              found = m; break;
            }
          }
          if (found) break;
        }
        if (!found) return { found: false, scanned: all.length };
        const remote = found.id.remote || 'status@broadcast';
        const chat = Collections.Chat.get(remote) ||
          (Collections.Chat.find ? await Collections.Chat.find(remote) : null);
        if (!chat) return { found: true, chatFound: false };
        const { Cmd } = window.require('WAWebCmd');
        let revoked = false, err;
        try {
          if (window.WWebJS.compareWwebVersions(window.Debug.VERSION, '>=', '2.3000.0')) {
            await Cmd.sendRevokeMsgs(chat, { list: [found], type: 'message' }, { clearMedia: false });
          } else {
            await Cmd.sendRevokeMsgs(chat, [found], { clearMedia: true, type: found.id.fromMe ? 'Sender' : 'Admin' });
          }
          revoked = true;
        } catch (e) { err = e.message; }
        if (!revoked && err) {
          try { await Cmd.sendDeleteMsgs(chat, { list: [found], type: 'message' }, false); revoked = true; err = null; }
          catch (e2) { err = e2.message; }
        }
        return { found: true, chatFound: true, revoked, error: err, shortId: found.id.id };
      }, id || null, shortId || null);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message, stack: err && err.stack }); }
  });


  // TEMP: bulk-revoke ALL of my own (fromMe) WhatsApp statuses. Used to clean up
  // after the full-queue send test. Enumerates via WWebJS.getAllStatuses (like
  // _statusdiag) and revokes each fromMe message model via Cmd.sendRevokeMsgs.
  app.post('/api/whatsapp/_delallmystatus', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupPage) return res.status(503).json({ error: 'no page' });
      const result = await client.pupPage.evaluate(async () => {
        const Collections = window.require('WAWebCollections');
        const { Cmd } = window.require('WAWebCmd');
        const all = (window.WWebJS.getAllStatuses ? window.WWebJS.getAllStatuses() : []);
        const targets = [];
        for (const s of all) {
          const msgsArr = (s.msgs && s.msgs.getModelsArray) ? s.msgs.getModelsArray() : (s.msgs || []);
          for (const m of msgsArr) {
            if (m && m.id && m.id.fromMe === true) targets.push(m);
          }
        }
        let revoked = 0, failed = 0;
        const errors = [];
        for (const m of targets) {
          try {
            const remote = m.id.remote || 'status@broadcast';
            const chat = Collections.Chat.get(remote) ||
              (Collections.Chat.find ? await Collections.Chat.find(remote) : null);
            if (!chat) { failed++; continue; }
            if (window.WWebJS.compareWwebVersions(window.Debug.VERSION, '>=', '2.3000.0')) {
              await Cmd.sendRevokeMsgs(chat, { list: [m], type: 'message' }, { clearMedia: false });
            } else {
              await Cmd.sendRevokeMsgs(chat, [m], { clearMedia: true, type: m.id.fromMe ? 'Sender' : 'Admin' });
            }
            revoked++;
          } catch (e) { failed++; if (errors.length < 5) errors.push(e.message); }
          await new Promise(r => setTimeout(r, 250));
        }
        return { total: targets.length, revoked, failed, errors };
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message, stack: err && err.stack }); }
  });

  // TEMP diagnostic: dump my own statuses from StatusCollection to learn the model
  app.post('/api/whatsapp/_statusdiag', async (req, res) => {
    try {
      const client = getClient();
      if (!client) return res.status(503).json({ error: 'no client' });
      const out = await client.pupPage.evaluate(() => {
        const all = (window.WWebJS.getAllStatuses ? window.WWebJS.getAllStatuses() : []);
        const mine = all.filter((s) => {
          const m = s.msg || (s.msgs && s.msgs[0]) || null;
          return m && m.id && m.id.fromMe === true;
        });
        const describe = (x) => x == null ? 'null' : (Array.isArray(x) ? 'array['+x.length+']' : (typeof x === 'object' && x.getModelsArray ? 'collection['+x.getModelsArray().length+']' : typeof x));
        return {
          total: all.length,
          mineCount: mine.length,
          mine: mine.map((s) => {
            const msgsArr = (s.msgs && s.msgs.getModelsArray) ? s.msgs.getModelsArray() : (s.msgs || []);
            const statusArr = (s.statusMsgs && s.statusMsgs.getModelsArray) ? s.statusMsgs.getModelsArray() : (s.statusMsgs || []);
            return {
              jid: s.id ? (s.id._serialized || s.id.id || String(s.id)) : undefined,
              msgsType: describe(s.msgs),
              statusMsgsType: describe(s.statusMsgs),
              msgsIds: msgsArr.map(m => m.id && m.id.id),
              statusMsgsIds: statusArr.map(m => m.id && m.id.id),
              t: s.t,
            };
          }),
        };
      });
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message, stack: err && err.stack }); }
  });

  // TEMP read-only diagnostic: read the account's Status Privacy setting as the
  // WA Web session currently sees it. No sends, no writes. Confirms whether a
  // bot-posted status will honor "Only share with / Except" audience.
  app.post('/api/whatsapp/debug-statusprivacy', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupPage) return res.status(503).json({ error: 'no page' });
      const diag = await client.pupPage.evaluate(async () => {
        const out = { errors: {} };
        try {
          const en = window.require('WAWebWamEnumStatusPrivacyType');
          out.enum = en && (en.STATUS_PRIVACY_TYPE || en.default || en);
        } catch (e) { out.errors.enum = e.message; }
        try {
          const action = window.require('WAWebStatusPrivacySettingAction');
          const setting = await action.getStatusPrivacySetting();
          // Normalize whatever shape it returns into a readable snapshot.
          const norm = (v) => {
            if (v == null) return v;
            if (Array.isArray(v)) return { length: v.length, sample: v.slice(0, 5).map((x) => (x && x._serialized) || String(x)) };
            if (typeof v === 'object') {
              const o = {};
              for (const k of Object.keys(v)) {
                const val = v[k];
                o[k] = Array.isArray(val)
                  ? { length: val.length, sample: val.slice(0, 5).map((x) => (x && x._serialized) || String(x)) }
                  : (val && val._serialized) || (typeof val === 'object' ? JSON.stringify(val).slice(0, 200) : val);
              }
              return o;
            }
            return v;
          };
          out.currentSetting = norm(setting);
          // RAW allow-list entries: show the actual Wid shape (PN vs LID, server, isLid).
          const rawWid = (w) => {
            if (!w) return null;
            const o = {};
            try { o.serialized = w._serialized; } catch {}
            try { o.str = w.toString(); } catch {}
            try { o.user = w.user; } catch {}
            try { o.server = w.server; } catch {}
            try { o.isLid = typeof w.isLid === 'function' ? w.isLid() : w.isLid; } catch {}
            try { o.userJid = w.userJid; } catch {}
            return o;
          };
          const allow = setting && setting.allowList;
          out.rawAllowList = Array.isArray(allow) ? allow.slice(0, 8).map(rawWid) : null;
          // Cross-check: how is this number represented in the Contact Store?
          try {
            const Store = window.Store || {};
            out.storeOwnKeys = Object.getOwnPropertyNames(Store).filter((k) => /contact|wid|chat|msg/i.test(k)).slice(0, 30);
            const wkeys = Object.getOwnPropertyNames(window).filter((k) => /store|contact|wid|chat|conn|wap/i.test(k)).slice(0, 40);
            out.windowCandidates = wkeys;
            out.hasContact = !!(Store && (Store.Contact || Store.ContactStore));
            const Contact = Store.Contact || Store.ContactStore || null;
            const models = Contact && (Contact.models || (typeof Contact.getModels === 'function' ? Contact.getModels() : null) || []);
            if (models && models.length) {
              out.contactSample = models.slice(0, 6).map((c) => {
                const id = c.id;
                return {
                  id: id && (id._serialized || (id.toString && id.toString())),
                  isLid: id ? (typeof id.isLid === 'function' ? id.isLid() : id.isLid) : null,
                  name: c.name, formattedName: c.formattedName, notify: c.notify,
                };
              });
              const targets = new Set(['6285805271829@c.us', '85805271829@c.us', '85285805271829@c.us']);
              const found = models.find((c) => c.id && targets.has(c.id._serialized));
              out.contactForTarget = found ? {
                id: found.id._serialized,
                isLid: typeof found.id.isLid === 'function' ? found.id.isLid() : found.id.isLid,
                name: found.name, formattedName: found.formattedName, notify: found.notify,
              } : 'no saved contact matches the tested JIDs';
            } else { out.errors.contactModels = 'no Contact models found'; }
          } catch (e) { out.errors.contactLookup = e.message; }
        } catch (e) { out.errors.getSetting = e.message; }
        // Introspect setter signatures so we can call them safely.
        try {
          const a = window.require('WAWebStatusPrivacySettingAction');
          out.setters = {};
          for (const fn of Object.keys(a || {})) {
            if (typeof a[fn] === 'function') out.setters[fn] = String(a[fn]).slice(0, 260);
          }
        } catch (e) { out.errors.setters = e.message; }
        try {
          const s = window.require('WAWebStatusSetAndSyncPrivacy');
          out.setAndSync = {};
          for (const fn of Object.keys(s || {})) {
            if (typeof s[fn] === 'function') out.setAndSync[fn] = String(s[fn]).slice(0, 400);
          }
        } catch (e) { out.errors.setAndSync = e.message; }
        return out;
      });
      res.json(diag);
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err && err.stack });
    }
  });

  // TEMP: set status privacy audience. body: { mode: 'all' } for ALL_CONTACTS,
  // or { mode: 'allowlist', numbers: ['628...@c.us'] } to restore an allow-list.
  app.post('/api/whatsapp/_setprivacy', async (req, res) => {
    try {
      const { mode, numbers } = req.body || {};
      const client = getClient();
      if (!client || !client.pupPage) return res.status(503).json({ error: 'no page' });
      const out = await client.pupPage.evaluate(async (mode, numbers) => {
        const log = { attempts: [] };
        const action = window.require('WAWebStatusPrivacySettingAction');
        const setSync = window.require('WAWebStatusSetAndSyncPrivacy');
        const WidFactory = window.require('WAWebWidFactory');
        const en = window.require('WAWebWamEnumStatusPrivacyType');
        const T = en.STATUS_PRIVACY_TYPE || en.default || en;
        const read = async () => {
          try {
            const s = await action.getStatusPrivacySetting();
            return {
              setting: s && s.setting,
              allowList: s && s.allowList ? s.allowList.map((x) => (x && x._serialized) || String(x)) : null,
              denyListLen: s && s.denyList ? s.denyList.length : null,
            };
          } catch (e) { return { readErr: e.message }; }
        };
        if (mode === 'all') {
          for (const attempt of [
            () => setSync.setAndSyncStatusPrivacy({ setting: 'contacts' }),
            () => action.setStatusPrivacyContact(T.ALL_CONTACTS),
            () => setSync.setAndSyncStatusPrivacy({ setting: 'contacts', allowList: [], denyList: [] }),
          ]) {
            try {
              await attempt();
              const now = await read();
              log.attempts.push({ ok: true, now });
              if (now.setting && /contact/i.test(now.setting) && now.setting !== 'allow-list' && now.setting !== 'deny-list') break;
            } catch (e) { log.attempts.push({ ok: false, err: e.message }); }
          }
        } else if (mode === 'allowlist') {
          try {
            const wids = (numbers || []).map((n) => WidFactory.createWid(n)).filter(Boolean);
            await action.setStatusPrivacyAllowList(wids);
            log.attempts.push({ ok: true, now: await read() });
          } catch (e) { log.attempts.push({ ok: false, err: e.message }); }
        }
        log.final = await read();
        return log;
      }, mode, numbers);
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err && err.stack });
    }
  });

  // TEMP read-only diagnostic: look up a sent message by its _serialized id and
  // report ack / status-render fields. ack>=1 means the server acknowledged it.
  // For media: mediaData.mediaStage tells us if the upload/encode completed.
  app.post('/api/whatsapp/debug-msg', async (req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const client = getClient();
      if (!client || !client.pupPage) return res.status(503).json({ error: 'no page' });
      const diag = await client.pupPage.evaluate((serialized) => {
        const out = { found: false };
        try {
          const Coll = window.require('WAWebCollections');
          const m = Coll.Msg.get(serialized);
          if (!m) { out.note = 'not in Msg collection'; return out; }
          out.found = true;
          out.ack = m.ack;
          out.type = m.type;
          out.isStatusV3 = m.isStatusV3;
          out.isStatus = m.isStatus;
          out.hasError = !!m.error;
          out.error = m.error ? String(m.error) : null;
          try {
            const md = m.mediaData;
            if (md) {
              out.media = {
                mediaStage: md.mediaStage,
                type: md.type,
                filehash: md.filehash ? 'set' : null,
                directPath: md.directPath ? 'set' : null,
                fullHeight: md.fullHeight,
                fullWidth: md.fullWidth,
              };
            }
          } catch (e) { out.mediaErr = e.message; }
        } catch (e) { out.err = e.message; }
        return out;
      }, id);
      res.json(diag);
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err && err.stack });
    }
  });
}
