import { Router } from 'express';
import {
  createTask, createBulkTasks, cancelTask, removeTask, retryTask,
  getTaskList, getTask, getAvailableFormats, getTwitterInfo, getPlaylistInfo,
  getMaxConcurrent, setMaxConcurrent,
} from '../downloader/manager.js';

const router = Router();

const sseClients = new Set();
let sseInterval = null;

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function ensureSseLoop() {
  if (sseInterval) return;
  sseInterval = setInterval(() => {
    const payload = { tasks: getTaskList() };
    for (const res of sseClients) {
      try { sseSend(res, 'tasks', payload); } catch {}
    }
  }, 1000);
}

function maybeStopSseLoop() {
  if (sseClients.size > 0) return;
  if (sseInterval) {
    clearInterval(sseInterval);
    sseInterval = null;
  }
}

router.get('/stream', (req, res) => {
  sseInit(res);
  sseClients.add(res);
  ensureSseLoop();
  try { sseSend(res, 'tasks', { tasks: getTaskList() }); } catch {}

  req.on('close', () => {
    try { sseClients.delete(res); } catch {}
    maybeStopSseLoop();
  });
});

router.get('/config', (req, res) => {
  res.json({ maxConcurrent: getMaxConcurrent() });
});

router.post('/config', (req, res) => {
  const { maxConcurrent: mc } = req.body;
  if (typeof mc === 'number' && mc >= 1 && mc <= 10) {
    setMaxConcurrent(mc);
    return res.json({ success: true, maxConcurrent: getMaxConcurrent() });
  }
  res.status(400).json({ error: 'maxConcurrent harus 1-10' });
});

router.post('/start', (req, res) => {
  const { url, category, quality, formatId, audioExtract, audioFormat, audioBitrate, twitterMode, twitterAccount, imageMode, twitterCookiesPath, youtubeCookiesPath, customOutput, customTitle, embedCover } = req.body;
  const result = createTask(url, { category, quality, formatId, audioExtract, audioFormat, audioBitrate, twitterMode, twitterAccount, imageMode, twitterCookiesPath, youtubeCookiesPath, customOutput, customTitle, embedCover });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post('/bulk', (req, res) => {
  const { urls, category, quality, formatId, audioExtract, audioFormat, audioBitrate, twitterMode, twitterAccount, imageMode, twitterCookiesPath, youtubeCookiesPath, customOutput, embedCover } = req.body;
  if (!urls || (!Array.isArray(urls) && typeof urls !== 'string'))
    return res.status(400).json({ error: 'urls harus array atau string (satu URL per baris)' });
  const results = createBulkTasks(urls, { category, quality, formatId, audioExtract, audioFormat, audioBitrate, twitterMode, twitterAccount, imageMode, twitterCookiesPath, youtubeCookiesPath, customOutput, embedCover });
  res.json({ results });
});

router.post('/formats', (req, res) => {
  const { url, category, youtubeCookiesPath } = req.body;
  if (!url || typeof url !== 'string' || !url.trim())
    return res.status(400).json({ error: 'URL diperlukan' });
  const result = getAvailableFormats(url.trim(), category || 'youtube', { cookiesPath: youtubeCookiesPath || '' });
  if (!result) return res.status(400).json({ error: 'Format detection supported only for YouTube.' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/playlist', async (req, res) => {
  const { url, youtubeCookiesPath } = req.body;
  if (!url || typeof url !== 'string' || !url.trim())
    return res.status(400).json({ error: 'URL playlist diperlukan' });
  try {
    const result = await getPlaylistInfo(url.trim(), youtubeCookiesPath || '');
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Gagal memuat playlist' });
  }
});

router.post('/twitter-info', async (req, res) => {
  const { url, twitterMode, twitterCookiesPath } = req.body;
  if (!url || typeof url !== 'string' || !url.trim())
    return res.status(400).json({ error: 'URL diperlukan' });
  const result = await getTwitterInfo(url.trim(), {
    mode: twitterMode || 'single',
    cookiesPath: twitterCookiesPath || '',
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.get('/list', (req, res) => res.json({ tasks: getTaskList() }));

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });
  const task = getTask(id);
  if (!task) return res.status(404).json({ error: 'Task tidak ditemukan' });
  res.json(task);
});

router.post('/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });
  res.json(cancelTask(id));
});

router.post('/:id/remove', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });
  res.json(removeTask(id));
});

router.post('/:id/retry', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });
  const { twitterCookiesPath } = req.body;
  res.json(retryTask(id, { twitterCookiesPath }));
});

export default router;
