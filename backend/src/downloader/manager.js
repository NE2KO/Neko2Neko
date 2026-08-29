import { spawn, spawnSync, execSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VIDEO_EXTS, AUDIO_EXTS, IMAGE_EXTS } from '@homelab/media-engine';
// Downloader-specific: .webm is treated as video for routing (yt-dlp downloads webm as video)
const DL_VIDEO_EXTS = new Set([...VIDEO_EXTS, '.webm']);
import { YTDLP_RESILIENT_ARGS, YTDLP_USER_AGENT } from '../utils/ytdlp.js';
import { get } from '../utils/runtimeSettings.js';
import { embedCover } from '../utils/metadataWriter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = path.join(__dirname, '../../data/download-tasks.json');
const CONFIG_FILE = path.join(__dirname, '../../data/downloader-config.json');
const COUNTER_FILE = '/home/CATIAA/homelab/download-counter.json';
const CACHE_FILE = path.join(__dirname, '../../data/download-cache.json');
const DOWNLOADER_LOG_FILE = '/home/CATIAA/homelab/downloader.log';
const INSTAGRAM_WORKSPACE_ROOT = '/home/CATIAA/homelab/DUMMY';
let maxConcurrent = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '3', 10);

const INSTAGRAM_CONCURRENT = 1;
const INSTAGRAM_DELAY_MS = 12000;
let lastInstagramTaskAt = 0;

const SOURCE_ROUTES = {
  youtube: { label: 'YouTube', video: '/home/CATIAA/Videos/YouTube', audio: '/home/CATIAA/homelab/Music/YouTube' },
  tiktok: { label: 'TikTok', video: '/home/CATIAA/Videos/TikTok', image: '/home/CATIAA/Pictures/TikTok' },
  twitter: { label: 'Twitter', video: '/home/CATIAA/Videos/Twitter', image: '/home/CATIAA/Pictures/Twitter' },
  instagram: { label: 'Instagram', video: '/home/CATIAA/Videos/Instander', image: '/home/CATIAA/Pictures/Instander' },
  torrent: { label: 'Torrent', any: '/home/CATIAA/homelab' },
};

for (const route of Object.values(SOURCE_ROUTES)) {
  for (const key of Object.keys(route)) {
    if (key === 'label') continue;
    try { fs.mkdirSync(route[key], { recursive: true }); } catch {}
  }
}

const MEDIA_EXT_RE = /\.(jpg|jpeg|png|gif|webp|mp4|mkv|webm|mov|mp3|m4a|flac|opus|wav|aac)$/i;
const INSTAGRAM_MEDIA_TYPES = new Set(['p', 'reel', 'reels', 'tv']);
const ACTIVE_TASK_STATUSES = new Set(['queued', 'downloading']);

const NETWORK_ERRORS = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  'network', 'timed out', 'connection refused', 'connection reset', 'connection aborted',
  'request error', 'temporary failure', 'http error 403', 'http error 416', 'unable to rename file'];
const CONTENT_ERRORS = ['private', 'age-restricted', 'Video unavailable', 'This content is not available',
  'Sign in to confirm', 'cookies', 'format not available', 'No format'];

function isNetworkError(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return NETWORK_ERRORS.some(e => lower.includes(e.toLowerCase()));
}

function isContentError(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return CONTENT_ERRORS.some(e => lower.includes(e.toLowerCase()));
}

const tasks = new Map();
let nextId = 1;
let running = 0;
let managerEnabled = true;

const VALID_CATEGORIES = Object.keys(SOURCE_ROUTES);
const QUALITY_MAP = {
  youtube: ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p', 'audio'],
  tiktok: ['best', 'audio'],
  instagram: ['best', 'audio'],
  twitter: ['best', 'audio'],
  torrent: ['standard'],
};
const AUDIO_EXTRACT_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac'];
const AUDIO_BITRATE_MAP = { best: '0', '320k': '320K', '256k': '256K', '192k': '192K', '128k': '128K', '64k': '64K' };

const FORMAT_MAP = {
  best: 'bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]',
  '2160p': 'bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]',
  '1440p': 'bestvideo[height<=1440]+bestaudio[ext=m4a]/bestvideo[height<=1440]+bestaudio/best[height<=1440]',
  '1080p': 'bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720p': 'bestvideo[height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480p': 'bestvideo[height<=480]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]',
  '360p': 'bestvideo[height<=360]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]',
};

const INSTAGRAM_FORMAT_SELECTOR = 'bestvideo[height>=1080][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[height>=1080][ext=mp4][vcodec^=hvc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[height>=1080][ext=mp4][vcodec^=hev1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[height>=1080][ext=mp4]+bestaudio/bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[ext=mp4][vcodec^=hvc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[ext=mp4][vcodec^=hev1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080][ext=mp4]';

const SOURCE_FORMAT_PREFERENCE = {
  tiktok: 'bestvideo[vcodec^=hev1]+bestaudio/bestvideo[vcodec^=avc1]+bestaudio/best',
};

const BOT_CONCURRENT = 1;
// Telegram video bot: use yt-dlp best format.
// High-quality source is preferred, but we do not force a codec family
// anymore; if YouTube blocks a high-res stream, yt-dlp will fall back
// automatically instead of being forced into 360p/720p.
const BOT_H264_FORMAT = 'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best';

const MAX_AUTO_RETRIES = 3;
const RETRY_BASE_DELAY = 5000;

// ── Download Counter (Instagram naming) ──

function loadCounter() {
  try {
    const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8'));
    if (!data._counters) data._counters = {};
    if (!data._dedup) data._dedup = {};
    if (!data._sha256) data._sha256 = {};
    return data;
  } catch { return { _counters: {}, _dedup: {}, _sha256: {} }; }
}

function saveCounter(data) {
  try {
    const dir = path.dirname(COUNTER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${COUNTER_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, COUNTER_FILE);
  } catch {}
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function logDownloaderEvent(task, level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  addLog(task, line);
  try {
    fs.mkdirSync(path.dirname(DOWNLOADER_LOG_FILE), { recursive: true });
    fs.appendFileSync(DOWNLOADER_LOG_FILE, `${line}\n`, 'utf-8');
  } catch {}
}

// ── Shortcode Cache ──

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return data || {};
  } catch { return {}; }
}

function saveCache(data) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

function extractShortcode(url) {
  const m = (url || '').match(/instagram\.com\/(?:p|reel|reels|tv|stories\/[^/]+)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function getCacheEntry(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) return null;
  const cache = loadCache();
  const entry = cache[shortcode];
  if (!entry || !entry.files || entry.files.length === 0) return null;
  const allExist = entry.files.every(f => {
    try { return fs.existsSync(f); } catch { return false; }
  });
  if (!allExist) {
    delete cache[shortcode];
    saveCache(cache);
    return null;
  }
  return entry;
}

function setCacheEntry(url, filePaths) {
  const shortcode = extractShortcode(url);
  if (!shortcode) return;
  const cache = loadCache();
  cache[shortcode] = {
    files: Array.isArray(filePaths) ? filePaths : [filePaths],
    timestamp: Date.now(),
  };
  saveCache(cache);
}

function getLocalDateParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return {
    yyyy: d.getFullYear(),
    mm: String(d.getMonth() + 1).padStart(2, '0'),
    dd: String(d.getDate()).padStart(2, '0'),
  };
}

function getCounterDateKey(date = new Date()) {
  const { dd, mm, yyyy } = getLocalDateParts(date);
  return `${dd}${mm}${yyyy}`;
}

function getDedupDateKey(date = new Date()) {
  const { yyyy, mm, dd } = getLocalDateParts(date);
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeUrl(url) {
  const raw = (url || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname.replace(/\/+$/, '');

    if (host.endsWith('instagram.com')) {
      host = 'instagram.com';
      const parts = pathname.split('/').filter(Boolean);
      const mediaIndex = parts.findIndex(part => INSTAGRAM_MEDIA_TYPES.has(part));

      if (mediaIndex >= 0 && parts[mediaIndex + 1]) {
        const mediaType = parts[mediaIndex] === 'reels' ? 'reel' : parts[mediaIndex];
        pathname = `/${mediaType}/${parts[mediaIndex + 1]}`;
      } else if (parts[0] === 'stories' && parts[1] && parts[2]) {
        pathname = `/stories/${parts[1]}/${parts[2]}`;
      }
    }

    return `https://${host}${pathname}`;
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/+$/, '');
  }
}

function getDedupKey(url, date = new Date()) {
  return `${getDedupDateKey(date)}|${normalizeUrl(url)}`;
}

function isDuplicateToday(url) {
  const counter = loadCounter();
  const filename = counter._dedup[getDedupKey(url)];
  if (!filename) return null;
  const videoDir = getOutputDir('instagram');
  const imageDir = getImageDir('instagram');
  if (fs.existsSync(path.join(videoDir, filename)) ||
      fs.existsSync(path.join(imageDir, filename))) return filename;
  delete counter._dedup[getDedupKey(url)];
  saveCounter(counter);
  return null;
}

function registerDownload(url, filename, timestamp = new Date()) {
  const counter = loadCounter();
  counter._dedup[getDedupKey(url, timestamp)] = filename;
  saveCounter(counter);
}

function sanitizeArchiveName(value) {
  return (value || 'unknown')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function getNextSequenceCandidate(account, outputDir, ext, timestamp = new Date()) {
  const safeAccount = sanitizeArchiveName(account);
  const dateKey = getCounterDateKey(timestamp);
  const normalizedExt = ext || '';
  const key = `${safeAccount}-${dateKey}`;
  const counter = loadCounter();

  let seq = (counter._counters[key] || 0) + 1;
  const maxAttempts = 9999;

  for (let i = 0; i < maxAttempts; i++) {
    const filenameBase = `${key}-${String(seq).padStart(4, '0')}`;
    const filename = ext ? `${filenameBase}${ext}` : filenameBase;
    const filePath = outputDir ? path.join(outputDir, filename) : null;

    if (!filePath || !fs.existsSync(filePath)) {
      counter._counters[key] = seq;
      return { dateKey: key, counterKey: key, seq: String(seq).padStart(4, '0'), filename: filenameBase, filePath };
    }

    seq++;
  }

  // Fallback: use timestamp-based suffix
  const fallbackName = `${key}-${Date.now()}`;
  return { dateKey: key, counterKey: key, seq: String(seq).padStart(4, '0'), filename: fallbackName, filePath: outputDir ? path.join(outputDir, fallbackName + (ext || '')) : null };
}

function commitSequence(counterKey, seq) {
  const counter = loadCounter();
  counter._counters[counterKey] = Math.max(counter._counters[counterKey] || 0, seq);
  saveCounter(counter);
}

function extractInstagramAccount(url) {
  if (!url) return 'unknown';
  const m = url.match(/instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|reels|tv|stories)/);
  if (m) return m[1];
  const m2 = url.match(/instagram\.com\/([A-Za-z0-9._]+)$/);
  if (m2) return m2[1];
  return 'unknown';
}

function preserveTimestamps(filePath, timestamp) {
  try {
    const t = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(t.getTime())) return false;
    fs.utimesSync(filePath, t, t);
    return true;
  } catch { return false; }
}

function getFileArrivalTimestamp(filePath) {
  const stat = fs.statSync(filePath);
  const candidates = [stat.birthtime, stat.ctime, stat.mtime];
  for (const candidate of candidates) {
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime()) && candidate.getTime() > 0) {
      return candidate;
    }
  }
  return stat.mtime;
}

function moveFileNoOverwrite(sourcePath, targetPath) {
  if (fs.existsSync(targetPath)) {
    const err = new Error(`Target already exists: ${targetPath}`);
    err.code = 'EEXIST';
    throw err;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch (renameErr) {
    if (renameErr.code !== 'EXDEV') throw renameErr;
  }

  try {
    fs.linkSync(sourcePath, targetPath);
    try { fs.unlinkSync(sourcePath); } catch {}
    return;
  } catch (linkErr) {
    if (linkErr.code === 'EEXIST') throw linkErr;
  }

  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  try { fs.unlinkSync(sourcePath); } catch {}
}

function createInstagramWorkspace(task) {
  const account = sanitizeArchiveName(task._igUsername || extractInstagramAccount(task.url));
  const workspace = path.join(INSTAGRAM_WORKSPACE_ROOT, account);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function createDownloadWorkDir(finalDir, task = null) {
  if (task?.category === 'instagram') return createInstagramWorkspace(task);
  const isImageDir = finalDir.includes('/Pictures/');
  const root = path.join(INSTAGRAM_WORKSPACE_ROOT, isImageDir ? 'Photo' : 'Video');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'task-'));
}

function cleanupDownloadWorkDir(task) {
  if (!task._downloadDir) return;
  try {
    if (task._downloadDir.startsWith('/home/CATIAA/homelab/DUMMY/')) {
      fs.rmSync(task._downloadDir, { recursive: true, force: true });
    }
  } catch {}
  task._downloadDir = '';
}

function filterCoverArt(paths) {
  if (paths.length <= 1) return paths;
  let maxSize = 0;
  for (const p of paths) {
    try { const s = fs.statSync(p).size; if (s > maxSize) maxSize = s; } catch {}
  }
  if (maxSize < 10240) return paths;
  return paths.filter(p => {
    try { return fs.statSync(p).size >= maxSize * 0.15; } catch { return false; }
  });
}

function parseGalleryOutputPath(line, baseDir) {
  const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
  if (!clean) return null;

  let candidate = clean.startsWith('# ') ? clean.slice(2).trim() : clean;
  candidate = candidate.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  if (!MEDIA_EXT_RE.test(candidate)) return null;
  if (!path.isAbsolute(candidate)) candidate = path.join(baseDir, candidate);
  return candidate;
}

function scanDownloadDir(dir, exts = null, recursive = false) {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    const queue = [dir];
    const files = [];

    while (queue.length > 0) {
      const currentDir = queue.shift();
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const filePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (recursive) queue.push(filePath);
          continue;
        }

        try {
          const stat = fs.statSync(filePath);
          const ext = path.extname(entry.name).toLowerCase();
          if (exts && !exts.has(ext)) continue;
          if (!MEDIA_EXT_RE.test(entry.name)) continue;
          files.push({ path: filePath, mtime: stat.mtimeMs });
        } catch {}
      }
    }

    return files.sort((a, b) => a.mtime - b.mtime).map(file => file.path);
  } catch { return []; }
}

function uniqueExistingPaths(paths) {
  const seen = new Set();
  const result = [];
  for (const filePath of paths || []) {
    if (!filePath || seen.has(filePath) || !fs.existsSync(filePath)) continue;
    seen.add(filePath);
    result.push(filePath);
  }
  return result;
}

function resolveDownloadedPaths(task) {
  const exactPaths = [];
  if (Array.isArray(task._filePaths)) exactPaths.push(...task._filePaths);
  if (task.filePath) exactPaths.push(task.filePath);

  const existing = uniqueExistingPaths(exactPaths);
  if (existing.length > 0) return existing;

  if (task._downloadDir) {
    const exts = task.category === 'instagram' ? new Set([...IMAGE_EXTS, ...DL_VIDEO_EXTS]) : null;
    return scanDownloadDir(task._downloadDir, exts, task.category === 'instagram');
  }

  if (task.category === 'instagram') return [];

  if (task.outputDir && !task._requireExactPath) {
    const scanExts = new Set([...VIDEO_EXTS, ...AUDIO_EXTS]);
    return scanDownloadDir(task.outputDir, scanExts).sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    }).slice(0, 1);
  }

  return [];
}

function getInstagramFinalDir(task, ext) {
  const normalizedExt = ext.toLowerCase();
  if (DL_VIDEO_EXTS.has(normalizedExt)) return SOURCE_ROUTES[task.category]?.video || task.outputDir;
  if (IMAGE_EXTS.has(normalizedExt)) return task.imageDir || getImageDir(task.category) || task.outputDir;
  return task.outputDir;
}

function probeVideoFile(filePath) {
  try {
    const result = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,codec_tag_string,width,height',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf-8', timeout: 15000 });
    if (result.status !== 0) return null;
    const data = JSON.parse(result.stdout || '{}');
    const stream = data.streams?.[0] || {};
    return {
      codec: (stream.codec_name || '').toLowerCase(),
      codecTag: (stream.codec_tag_string || '').toLowerCase(),
      width: stream.width || 0,
      height: stream.height || 0,
    };
  } catch {
    return null;
  }
}

function isInstagramVideoCodecCompatible(probe) {
  if (!probe || !probe.codec) return true;
  const codec = `${probe.codec} ${probe.codecTag}`.toLowerCase();
  return /(^|\s)(avc1|h264|hev1|hvc1|hevc)(\s|$)/.test(codec);
}

function transcodeInstagramVideoToH264(task, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const outputDir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const outputPath = path.join(outputDir, `${base}.h264.mp4`);
  if (fs.existsSync(outputPath)) return outputPath;

  addLog(task, `Transcoding ${path.basename(filePath)} to H.264/AAC MP4 (avoid VP9/AV1)`);
  const args = [
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8', timeout: 0 });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const stderr = (result.stderr || '').slice(-500).trim();
    throw new Error(`H.264 transcode failed${stderr ? `: ${stderr}` : ''}`);
  }
  return outputPath;
}

function ensureInstagramVideoCompatible(task, filePath) {
  if (!DL_VIDEO_EXTS.has(path.extname(filePath).toLowerCase())) return filePath;
  const probe = probeVideoFile(filePath);
  if (isInstagramVideoCodecCompatible(probe)) return filePath;
  const codec = probe ? `${probe.codec} ${probe.codecTag}`.trim() : 'unknown';
  addLog(task, `Instagram video codec not browser-compatible (${codec}); transcoding...`);
  return transcodeInstagramVideoToH264(task, filePath);
}

function filterInstagramFallbackPaths(paths) {
  const images = paths.filter(p => IMAGE_EXTS.has(path.extname(p).toLowerCase()));
  const videos = paths.filter(p => DL_VIDEO_EXTS.has(path.extname(p).toLowerCase()));
  return [...filterCoverArt(images), ...videos];
}

async function finalizeInstagramFiles(task, downloadedPaths) {
  const account = sanitizeArchiveName(task._igUsername || extractInstagramAccount(task.url));
  const normalizedPaths = [];

  for (const sourcePath of downloadedPaths) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file missing: ${path.basename(sourcePath)}`);
    }

    const originalHash = await sha256File(sourcePath);
    const counter = loadCounter();
    if (counter._sha256[originalHash]) {
      addLog(task, `[SKIP] Duplicate SHA256: ${path.basename(sourcePath)}`);
      logDownloaderEvent(task, 'SKIP', `Duplicate SHA256: ${path.basename(sourcePath)}`);
      try { fs.unlinkSync(sourcePath); } catch {}
      continue;
    }

    const compatiblePath = ensureInstagramVideoCompatible(task, sourcePath);
    if (compatiblePath !== sourcePath) {
      try { fs.unlinkSync(sourcePath); } catch {}
    }

    const finalHash = await sha256File(compatiblePath);
    const counterAfterTranscode = loadCounter();
    if (counterAfterTranscode._sha256[finalHash]) {
      addLog(task, `[SKIP] Duplicate SHA256 after processing: ${path.basename(compatiblePath)}`);
      logDownloaderEvent(task, 'SKIP', `Duplicate SHA256 after processing: ${path.basename(compatiblePath)}`);
      try { fs.unlinkSync(compatiblePath); } catch {}
      continue;
    }

    normalizedPaths.push({ sourcePath: compatiblePath, sha256: finalHash });
  }

  const plan = [];
  const usedSeqs = new Set();
  for (const item of normalizedPaths) {
    const { sourcePath } = item;
    const ext = path.extname(sourcePath).toLowerCase();
    const finalDir = getInstagramFinalDir(task, ext);
    const fileTimestamp = getFileArrivalTimestamp(sourcePath);
    let candidate = null;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const c = getNextSequenceCandidate(account, finalDir, ext, fileTimestamp);
      const seqKey = `${c.seq}`;
      if (!usedSeqs.has(seqKey)) {
        usedSeqs.add(seqKey);
        candidate = c;
        break;
      }
    }
    if (!candidate) throw new Error(`Could not allocate safe filename for ${path.basename(sourcePath)}`);
    plan.push({ ...item, candidate, fileTimestamp });
  }

  const moved = [];
  try {
    for (const { sourcePath, candidate, fileTimestamp, sha256 } of plan) {
      moveFileNoOverwrite(sourcePath, candidate.filePath);
      if (!preserveTimestamps(candidate.filePath, fileTimestamp)) {
        throw new Error(`Failed to restore timestamp: ${candidate.filePath}`);
      }
      const counter = loadCounter();
      counter._sha256[sha256] = {
        path: path.join(path.basename(path.dirname(candidate.filePath)), path.basename(candidate.filePath)),
        date: new Date().toISOString(),
      };
      saveCounter(counter);
      commitSequence(candidate.counterKey, candidate.seq);
      moved.push(candidate.filePath);
      addLog(task, `Renamed → ${candidate.filename}`);
      logDownloaderEvent(task, 'INFO', `Saved as ${candidate.filename}`);
    }
  } catch (err) {
    for (const filePath of moved) {
      try {
        const stagingDir = task._downloadDir;
        if (stagingDir) {
          const restoredPath = path.join(stagingDir, path.basename(filePath));
          fs.renameSync(filePath, restoredPath);
        }
      } catch {}
    }
    throw err;
  }

  const firstTimestamp = plan.length > 0 ? plan[0].fileTimestamp : null;
  if (firstTimestamp) task.downloadTimestamp = firstTimestamp.toISOString();
  task._filePaths = moved;
  task.filePath = moved[0] || '';
  task.filename = task.filePath ? path.basename(task.filePath) : '';

  try {
    if (!fs.readdirSync(task._downloadDir).length) {
      fs.rmdirSync(task._downloadDir);
    }
  } catch {}

  return moved;
}

// ── Persistence ──

function loadPersistentTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      if (t.status === 'downloading' || t.status === 'queued') {
        t.status = 'queued';
        t.progress = 0;
        t.speed = '';
        t.eta = '';
        t.statusText = 'Resuming after restart...';
        t.retryCount = 0;
        t.logs = t.logs || [];
        t.logs.push(`[${new Date().toISOString()}] Server restarted, auto-resuming...`);
      }
      t.process = null;
      t.pid = null;
      tasks.set(t.id, t);
      if (t.id >= nextId) nextId = t.id + 1;
    }
  } catch {}
}

function savePersistentTasks() {
  try {
    const arr = Array.from(tasks.values()).map(t => ({
      id: t.id, url: t.url, category: t.category,
      quality: t.quality, formatId: t.formatId,
      audioExtract: t.audioExtract, audioFormat: t.audioFormat, audioBitrate: t.audioBitrate,
      twitterMode: t.twitterMode, twitterAccount: t.twitterAccount, imageMode: t.imageMode,
  twitterCookiesPath: t.twitterCookiesPath || '',
  customOutput: !!t.customOutput, embedCover: !!t.embedCover,
  type: t.type, status: t.status, progress: t.progress, speed: t.speed,
      eta: t.eta, statusText: t.statusText || '', logs: t.logs || [],
      filename: t.filename, filePath: t.filePath || '',
      totalSize: t.totalSize, downloaded: t.downloaded,
      error: t.error, createdAt: t.createdAt, completedAt: t.completedAt,
      downloadTimestamp: t.downloadTimestamp || null,
      outputDir: t.outputDir, imageDir: t.imageDir,
      retryCount: t.retryCount || 0, maxRetries: t.maxRetries || MAX_AUTO_RETRIES,
      lastError: t.lastError || null, retryHistory: t.retryHistory || [],
    }));
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TASKS_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch {}
}

function loadDownloaderConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const cfg = JSON.parse(raw);
    const n = parseInt(cfg && cfg.maxConcurrent, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) maxConcurrent = n;
  } catch {}
}

loadPersistentTasks();
loadDownloaderConfig();

// ── Anti-Double Download Archive ──
// Records canonical video keys of every completed download so the same video
// (even with a different ?si= / youtu.be URL) is never downloaded again,
// including videos downloaded long ago via this app.
const DOWNLOADED_ARCHIVE_FILE = path.join(__dirname, '../../data/downloaded-archive.json');
const downloadedArchive = new Set();

function canonicalVideoKey(url, category) {
  if (!url) return null;
  try {
    const u = url.trim();
    const parsed = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/')[1];
      if (id) return `yt:${id}`;
    } else if (host.endsWith('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return `yt:${v}`;
      const m = parsed.pathname.match(/\/(?:shorts|embed|v|live)\/([^/?#]+)/);
      if (m) return `yt:${m[1]}`;
    } else if (host.endsWith('tiktok.com')) {
      const m = parsed.pathname.match(/\/video\/(\d+)/);
      if (m) return `tt:${m[1]}`;
    }
  } catch {}
  return `${category || 'unknown'}:${url.trim().toLowerCase()}`;
}

function loadDownloadedArchive() {
  try {
    const raw = fs.readFileSync(DOWNLOADED_ARCHIVE_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const k of arr) downloadedArchive.add(k);
  } catch {}
  // Seed from past completed tasks so videos downloaded long ago are also skipped.
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const t of arr) {
        if (t.status === 'completed') {
          const k = canonicalVideoKey(t.url, t.category);
          if (k) downloadedArchive.add(k);
        }
      }
    }
  } catch {}
  saveDownloadedArchive();
}

function saveDownloadedArchive() {
  try {
    const dir = path.dirname(DOWNLOADED_ARCHIVE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DOWNLOADED_ARCHIVE_FILE, JSON.stringify(Array.from(downloadedArchive)), 'utf-8');
  } catch {}
}

function isAlreadyDownloaded(url, category) {
  const k = canonicalVideoKey(url, category);
  if (!k || !downloadedArchive.has(k)) return false;
  const n = category === 'instagram' ? normalizeUrl(url) : url.trim().toLowerCase();
  for (const t of tasks.values()) {
    if (t.status !== 'completed') continue;
    if (t.category !== category) continue;
    const existing = category === 'instagram' ? normalizeUrl(t.url) : t.url.trim().toLowerCase();
    if (existing === n) return true;
  }
  // Stale entry: task yang mencatat URL ini sudah dihapus dari daftar,
  // jadi izinkan re-download dan bersihkan dari archive.
  downloadedArchive.delete(k);
  saveDownloadedArchive();
  return false;
}

function recordDownloaded(url, category) {
  const k = canonicalVideoKey(url, category);
  if (!k || downloadedArchive.has(k)) return;
  downloadedArchive.add(k);
  saveDownloadedArchive();
}

loadDownloadedArchive();

// ── Utilities ──

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function getTaskList() {
  return Array.from(tasks.values()).map(t => sanitize(t));
}

export function getTask(id) {
  const t = tasks.get(id);
  return t ? sanitize(t) : null;
}

export { enableManager, disableManager, isManagerEnabled, getManagerStatus };
export function getMaxConcurrent() { return maxConcurrent; }
export function setMaxConcurrent(n) { maxConcurrent = Math.max(1, Math.min(10, n)); try { fs.writeFileSync(CONFIG_FILE, JSON.stringify({ maxConcurrent }), 'utf-8'); } catch {} }
export { buildExpectedFilename, sanitizeForFs, extractYoutubeId };

function sanitize(t) {
  return {
    id: t.id, url: t.url, category: t.category,
    quality: t.quality, formatId: t.formatId,
    audioExtract: t.audioExtract, audioFormat: t.audioFormat, audioBitrate: t.audioBitrate,
    twitterMode: t.twitterMode, twitterAccount: t.twitterAccount, imageMode: t.imageMode,
  twitterCookiesPath: t.twitterCookiesPath || '',
  customOutput: !!t.customOutput, embedCover: !!t.embedCover,
  type: t.type, status: t.status, progress: t.progress, speed: t.speed,
    eta: t.eta, statusText: t.statusText || '', logs: t.logs || [],
    filename: t.filename, filePath: t.filePath || '',
    totalSize: t.totalSize, downloaded: t.downloaded,
    error: t.error, createdAt: t.createdAt, completedAt: t.completedAt,
    downloadTimestamp: t.downloadTimestamp || null,
    outputDir: t.outputDir, imageDir: t.imageDir,
    retryCount: t.retryCount || 0, maxRetries: t.maxRetries || MAX_AUTO_RETRIES,
    lastError: t.lastError || null, retryHistory: t.retryHistory || [],
    viaBot: !!t.viaBot,
  };
}

function isDuplicate(url, category) {
  const n = category === 'instagram' ? normalizeUrl(url) : url.trim().toLowerCase();
  for (const t of tasks.values()) {
    if (!ACTIVE_TASK_STATUSES.has(t.status)) continue;
    if (t.category !== category) continue;
    const existing = category === 'instagram' ? normalizeUrl(t.url) : t.url.trim().toLowerCase();
    if (existing === n) return true;
  }
  return false;
}

function checkDiskSpace(dir) {
  try {
    const stat = fs.statfsSync(dir);
    return (stat.bfree * stat.bsize) / (1024 * 1024 * 1024);
  } catch { return null; }
}

function getOutputDir(category, quality, audioExtract, imageMode) {
  const r = SOURCE_ROUTES[category];
  if (!r) return '/home/CATIAA/homelab';
  if (imageMode && r.image) return r.image;
  if (audioExtract && r.audio) return r.audio;
  if (quality === 'audio' && r.audio) return r.audio;
  if (r.video) return r.video;
  if (r.image) return r.image;
  return r.any || '/home/CATIAA/homelab';
}

function getImageDir(category) {
  return SOURCE_ROUTES[category]?.image || null;
}

// ── Task Creation ──

export function createTask(url, options = {}) {
  const category = (options.category || 'youtube').toLowerCase();
  const quality = options.quality || 'best';
  let formatId = options.formatId || '';
  const audioExtract = !!options.audioExtract;
  const audioFormat = options.audioFormat ? options.audioFormat.toLowerCase() : '';
  const audioBitrate = options.audioBitrate || 'best';
  const twitterMode = options.twitterMode || 'single';
  const twitterAccount = (options.twitterAccount || '').replace(/^@/, '').trim();
  const twitterCookiesPath = options.twitterCookiesPath || '';
  const youtubeCookiesPath = options.youtubeCookiesPath || '';
  const imageMode = !!options.imageMode;
  const customOutput = !!options.customOutput;
  const customTitle = (options.customTitle || '').trim();
  const embedCover = !!options.embedCover;
  const viaBot = !!options.botMode;

  if (!VALID_CATEGORIES.includes(category)) return { error: `Kategori "${category}" tidak dikenal` };

  const validQ = QUALITY_MAP[category];
  if (viaBot && !audioExtract && !formatId) formatId = BOT_H264_FORMAT;
  if (!formatId && !validQ.includes(quality)) return { error: `Kualitas "${quality}" tidak valid` };
  if (audioExtract && audioFormat && !AUDIO_EXTRACT_FORMATS.includes(audioFormat)) return { error: `Format audio "${audioFormat}" tidak valid` };
  if (audioExtract && embedCover && audioFormat && !['mp3', 'm4a', 'opus', 'ogg', 'flac'].includes(audioFormat)) return { error: `Embed cover tidak didukung untuk format audio ${audioFormat}. Gunakan mp3, m4a, opus, ogg, atau flac.` };

  let trimmed = (url || '').trim();

  if (category === 'twitter' && twitterMode === 'account' && twitterAccount) {
    trimmed = `https://x.com/${twitterAccount}/media`;
  }
  if (!trimmed) return { error: 'URL diperlukan' };
  if (!managerEnabled) return { error: 'Download manager sedang dimatikan' };
  if (isDuplicate(trimmed, category)) return { error: 'URL sudah ada di antrian' };
  if (isAlreadyDownloaded(trimmed, category)) return { skipped: true, reason: 'Sudah di-download sebelumnya (anti-double)', url: trimmed };

  if (category === 'instagram') {
    const cached = getCacheEntry(trimmed);
    if (cached) {
      return { cached: true, files: cached.files, message: `Cache hit: ${path.basename(cached.files[0])}` };
    }
  }

  const freeGB = checkDiskSpace('/home/CATIAA');
  if (freeGB !== null && freeGB < 0.5) return { error: `Ruangan disk tidak cukup (${freeGB.toFixed(1)}GB tersisa)` };

  let outputDir = getOutputDir(category, quality, audioExtract, imageMode);
  let imageDir = getImageDir(category);

  if (category === 'twitter' && customOutput) {
    const account = twitterMode === 'account' ? twitterAccount : (trimmed.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^\/?#]+)/) || [,'unknown'])[1];
    const base = `/home/CATIAA/homelab/Y/${account}/`;
    outputDir = base;
    imageDir = base;
  }

  const task = {
    id: nextId++, url: trimmed, category, quality, formatId,
    audioExtract, audioFormat, audioBitrate,
    twitterMode, twitterAccount, imageMode, twitterCookiesPath, youtubeCookiesPath, customOutput, customTitle, embedCover,
    type: category === 'torrent' ? 'torrent' : category === 'twitter' ? 'gallery' : 'ytdlp',
    status: 'queued', progress: 0, speed: '', eta: '', statusText: '', logs: [],
    filename: '', filePath: '', totalSize: '', downloaded: '',
    error: null, createdAt: new Date().toISOString(), completedAt: null,
    process: null, pid: null, outputDir, imageDir,
    retryCount: 0, maxRetries: MAX_AUTO_RETRIES,
    lastError: null, retryHistory: [],
    viaBot: !!options.viaBot,
  };
  tasks.set(task.id, task);
  if (task.viaBot) addLog(task, 'Auto-download dipicu dari Telegram bot');
  savePersistentTasks();
  processQueue();
  return { id: task.id };
}

export function extractUrls(input) {
  if (Array.isArray(input)) {
    return input.map(u => (u || '').trim()).filter(Boolean);
  }
  const text = typeof input === 'string' ? input : '';
  const re = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(youtu\.be\/[^\s]+)/gi;
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    let url = m[0];
    url = url.replace(/[.,);\]]+$/, '').trim();
    if (/^www\./i.test(url)) url = `https://${url}`;
    else if (/^youtu\.be\//i.test(url)) url = `https://${url}`;
    found.push(url);
  }
  const seen = new Set();
  const out = [];
  for (const u of found) {
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export function detectCategory(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('.youtube.com') || host === 'youtube.com') return 'youtube';
    if (host.endsWith('.tiktok.com') || host === 'tiktok.com') return 'tiktok';
    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com') || host === 't.co') return 'twitter';
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  } catch {}
  return null;
}

export function createBulkTasks(urls, options = {}) {
  const results = [];
  const urlList = extractUrls(urls);
  for (const u of urlList) {
    const cat = detectCategory(u) || options.category || 'youtube';
    if (!VALID_CATEGORIES.includes(cat)) {
      results.push({ error: `Kategori "${cat}" tidak dikenal untuk ${u}` });
      continue;
    }
    const taskOptions = { ...options, category: cat };
    if (options.botMode) {
      taskOptions.viaBot = true;
      // Force H.264 for every bot VIDEO download (YouTube, Twitter/X, TikTok, …),
      // not just YouTube — the non-YT categories used to fall back to the
      // unconstrained FORMAT_MAP default and could download AV1/HEVC.
      if (!options.audioExtract) taskOptions.formatId = BOT_H264_FORMAT;
    }
    results.push(createTask(u, taskOptions));
  }
  return results;
}

// ── Task Lifecycle ──

export function cancelTask(id) {
  const t = tasks.get(id);
  if (!t) return { error: 'Task tidak ditemukan' };
  if (t.status === 'completed' || t.status === 'cancelled') return { error: `Task sudah ${t.status}` };
  if (t.process) { try { t.process.kill('SIGTERM'); } catch {} t.process = null; }
  cleanupDownloadWorkDir(t);
  t.status = 'cancelled'; t.completedAt = new Date().toISOString(); t.pid = null;
  t.retryCount = 0;
  savePersistentTasks(); processQueue();
  return { success: true };
}

export function removeTask(id) {
  const t = tasks.get(id);
  if (!t) return { error: 'Task tidak ditemukan' };
  if (t.process) { try { t.process.kill('SIGTERM'); } catch {} t.process = null; }
  cleanupDownloadWorkDir(t);
  if (t.url) {
    const k = canonicalVideoKey(t.url, t.category);
    if (k) { downloadedArchive.delete(k); saveDownloadedArchive(); }
  }
  tasks.delete(id); savePersistentTasks(); processQueue();
  return { success: true };
}

export function retryTask(id, overrides = {}) {
  const t = tasks.get(id);
  if (!t) return { error: 'Task tidak ditemukan' };
  if (t.status !== 'failed' && t.status !== 'cancelled' && t.status !== 'completed')
    return { error: 'Hanya task failed/cancelled/completed yang bisa di-retry' };
  t.status = 'queued'; t.progress = 0; t.speed = ''; t.eta = ''; t.filename = '';
  t.filePath = ''; t.totalSize = ''; t.downloaded = ''; t.error = null;
  t.completedAt = null; t.process = null; t.pid = null;
  t.statusText = 'Queued for retry...';
  t.retryCount = 0;
  t.lastError = null;
  t.logs = [];
  t._filePaths = [];
  t._downloadDir = '';
  t._requireExactPath = false;
  t._igUsername = '';
  if (overrides.twitterCookiesPath !== undefined) {
    t.twitterCookiesPath = overrides.twitterCookiesPath;
  }
  if (overrides.youtubeCookiesPath !== undefined) {
    t.youtubeCookiesPath = overrides.youtubeCookiesPath;
  }
  savePersistentTasks(); processQueue();
  return { success: true };
}

function getYoutubeFormatLabel(format) {
  const height = Number(format.height || 0);
  if (height >= 2100) return '2160p';
  if (height >= 1400) return '1440p';
  if (height >= 1000) return '1080p';
  if (height >= 700) return '720p';
  if (height >= 450) return '480p';
  if (height >= 300) return '360p';
  const note = (format.format_note || '').match(/(\d+p)/i);
  return note ? note[1].toLowerCase() : `${height || 0}p`;
}

function getYoutubeFormatSelector(format) {
  const height = Number(format.height || 0);
  const hasAudio = format.acodec && format.acodec !== 'none';
  if (hasAudio) return format.format_id;
  if (height) {
    return `bestvideo[height<=${height}]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
  }
  return `${format.format_id}+bestaudio[ext=m4a]/bestaudio[ext=m4a]/best`;
}

// ── Format Detection ──

const SUPPORTED_DOMAINS = /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|magnet:/i;

function validateUrl(url) {
  try { new URL(url); } catch { return 'URL tidak valid'; }
  if (!SUPPORTED_DOMAINS.test(url)) return 'Situs ini belum didukung';
  return null;
}

function mapYtdlpError(stderr) {
  if (!stderr) return 'Unknown error';
  const raw = stderr instanceof Error ? stderr.message : stderr;
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('video unavailable') || s.includes('video not available')) return 'Video tidak tersedia atau sudah dihapus';
  if (s.includes('private video')) return 'Video ini bersifat private';
  if (s.includes('confirm you') || s.includes('not a bot') || s.includes('sign in') || s.includes('login'))
    return 'YouTube minta verifikasi bot. Tambahkan cookies (YouTube Cookies Path) yang valid di pengaturan.';
  if (s.includes('http error 429') || s.includes('too many requests')) return 'Terlalu banyak request, coba lagi nanti';
  if (s.includes('timed out') || s.includes('timeout')) return 'Request timeout, periksa koneksi internet';
  if (s.includes('network') || s.includes('connection')) return 'Error jaringan, periksa koneksi internet';
  if (s.includes('geo') || s.includes('not available in your country')) return 'Video tidak tersedia di region ini';
  if (s.includes('live')) return 'Video adalah live stream, tidak bisa didownload';
  if (s.includes('ffmpeg')) return 'ffmpeg tidak ditemukan atau error';
  const short = String(raw ?? '').substring(0, 120);
  return short;
}

function resolveCookiesForTask(task) {
  if (task.twitterCookiesPath) return task.twitterCookiesPath;
  if (task.youtubeCookiesPath) return task.youtubeCookiesPath;
  if (task.category === 'youtube' || task.category === 'instagram')
    return get('downloader.youtubeCookiesPath', '') || '';
  return '';
}

export function getAvailableFormats(url, category = 'youtube', options = {}) {
  if (category !== 'youtube') return null;
  const validationError = validateUrl(url);
  if (validationError) return { error: validationError };
  try {
    const ytCookies = options.cookiesPath || get('downloader.youtubeCookiesPath', '') || '';
    const args = [
      '--dump-json', '--no-warnings', '--no-playlist',
      '--retries', '5', '--extractor-retries', '3', '--socket-timeout', '30',
      '--user-agent', YTDLP_USER_AGENT,
    ];
    if (ytCookies) args.push('--cookies', ytCookies);
    args.push(url);
    const out = execFileSync('/usr/bin/yt-dlp', args, {
      timeout: 30000, maxBuffer: 5 * 1024 * 1024, encoding: 'utf-8',
    });
    const info = JSON.parse(out);
    const video = {};
    const audio = [];

    for (const f of info.formats || []) {
      if (!f.format_id || f.format_id.startsWith('sb')) continue;

      const isAudioOnly = !f.vcodec || f.vcodec === 'none';
      const isVideo = f.width && f.height && !isAudioOnly;

      if (isVideo) {
        const hasAudio = !!(f.acodec && f.acodec !== 'none');
        const note = (f.format_note || '').toLowerCase();
        const isOriginal = note.includes('original') || note.includes('default');
        const isMultiLang = f.format_id.includes('-');

        if (isMultiLang && !isOriginal) continue;

        const label = getYoutubeFormatLabel(f);
        if (!video[label]) video[label] = [];
        video[label].push({
          id: f.format_id, ext: f.ext,
          selector: getYoutubeFormatSelector(f),
          vcodec: f.vcodec || '', acodec: f.acodec || '',
          hasAudio,
          filesize: formatBytes(f.filesize || f.filesize_approx), tbr: f.tbr ? `${f.tbr}k` : '',
          fps: f.fps || '', hdr: note.includes('hdr'),
          width: f.width, height: f.height,
        });
      }

      if (isAudioOnly && f.acodec && f.acodec !== 'none') {
        const note = (f.format_note || '').toLowerCase();
        const isOriginal = note.includes('original') || note.includes('default');
        const isMultiLang = f.format_id.includes('-');

        if (isMultiLang && !isOriginal) continue;

        audio.push({
          id: f.format_id, ext: f.ext,
          acodec: f.acodec, abitrate: f.abr ? `${f.abr}k` : '',
          filesize: formatBytes(f.filesize || f.filesize_approx),
          tbr: f.tbr ? `${f.tbr}k` : '',
        });
      }
    }

    const order = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
    const sortedVideo = {};
    let overallBest = null;
    for (const key of order) {
      if (video[key]) {
        sortedVideo[key] = video[key].sort((a, b) => {
          const c = (b.tbr ? parseInt(b.tbr) : 0) - (a.tbr ? parseInt(a.tbr) : 0);
          if (c !== 0) return c;
          if (b.hdr && !a.hdr) return 1;
          if (a.hdr && !b.hdr) return -1;
          return 0;
        });
        sortedVideo[key][0].best = true;
        if (!overallBest) overallBest = sortedVideo[key][0];
      }
    }

    audio.sort((a, b) => parseInt(b.abitrate || '0') - parseInt(a.abitrate || '0'));
    if (audio.length > 0) audio[0].best = true;

    return {
      title: info.title, duration: info.duration || 0,
      thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || null,
      channel: info.channel || info.uploader || '',
      uploader: info.uploader || info.channel || '',
      uploadDate: info.upload_date || null,
      viewCount: info.view_count || null,
      likeCount: info.like_count || null,
      description: (info.description || '').substring(0, 200),
      video: sortedVideo, audio, overallBest,
    };
  } catch (e) {
    const msg = mapYtdlpError(e.stderr || e.message || '');
    return { error: msg };
  }
}

export function getPlaylistInfo(url, cookiesPath = '') {
  return new Promise((resolve) => {
    const validationError = validateUrl(url);
    if (validationError) return resolve({ error: validationError });

    const args = [
      '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
      '--retries', '5', '--extractor-retries', '3', '--socket-timeout', '30',
      '--user-agent', YTDLP_USER_AGENT,
    ];
    if (cookiesPath) args.push('--cookies', cookiesPath);
    args.push(url);

    let errOut = '';
    let killed = false;
    const MAX_ITEMS = 200;
    const timeoutMs = 120000;
    const timeoutId = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGTERM'); } catch {}
      resolve({ error: 'Request timeout — periksa koneksi internet atau playlist terlalu besar' });
    }, timeoutMs);

    const items = [];
    let playlistTitle = '';
    let buffer = '';

    let proc;
    try {
      proc = spawn('/usr/bin/yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      clearTimeout(timeoutId);
      return resolve({ error: `Gagal menjalankan yt-dlp: ${e.message}` });
    }

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0 && items.length < MAX_ITEMS) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          if (!entry.url && !entry.webpage_url) continue;
          if (!playlistTitle && entry.title) playlistTitle = entry.title;
          const thumb = entry.thumbnail
            || (entry.thumbnails && entry.thumbnails.length > 0 ? entry.thumbnails[entry.thumbnails.length - 1].url : null)
            || null;
          items.push({
            url: entry.url || entry.webpage_url || '',
            title: entry.title || `Video ${items.length + 1}`,
            thumbnail: thumb,
            duration: entry.duration || 0,
            index: entry.playlist_index || items.length + 1,
          });
        } catch {}
      }
      if (items.length >= MAX_ITEMS) {
        try { proc.kill('SIGTERM'); } catch {}
      }
    });

    proc.stderr.on('data', (data) => { errOut += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (killed) return;
      if (code !== 0 && items.length === 0) {
        const msg = errOut.slice(-300).trim();
        if (code === 127 || /not found/i.test(msg)) return resolve({ error: 'yt-dlp binary tidak ditemukan' });
        if (/JSON/i.test(msg)) return resolve({ error: 'Format data tidak valid, kemungkinan playlist private. Coba cek cookies.' });
        return resolve({ error: mapYtdlpError(msg) });
      }
      if (items.length === 0) return resolve({ error: 'Tidak ada video yang ditemukan di playlist ini' });
      const result = { title: playlistTitle || 'Playlist', items };
      if (items.length >= MAX_ITEMS) result.truncated = true;
      resolve(result);
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      if (!killed && items.length === 0) resolve({ error: `Gagal menjalankan yt-dlp: ${err.message}` });
    });
  });
}

export function getTwitterInfo(url, options = {}) {
  return new Promise((resolve) => {
    const cookiesPath = options.cookiesPath || '';
    const args = ['--dump-json', '--no-download', '--range', '1-3'];
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }
    args.push(url);

    let out = '';
    let errOut = '';
    let proc;

    try {
      proc = spawn('gallery-dl', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
      });
    } catch (e) {
      resolve({ error: `Gagal spawn gallery-dl: ${e.message}` });
      return;
    }

    const timeoutId = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      resolve({ error: 'Koneksi timeout, coba lagi nanti' });
    }, 65000);

    proc.stdout.on('data', (data) => { out += data.toString(); });
    proc.stderr.on('data', (data) => { errOut += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        const msg = errOut.slice(-300);
        if (code === 127 || msg.includes('not found'))
          resolve({ error: 'gallery-dl binary tidak ditemukan' });
        else if (msg.includes('JSON'))
          resolve({ error: `Format data tidak valid, kemungkinan media private/age-restricted. Coba cek path cookies: ${options.cookiesPath || 'tidak ada'}` });
        else if (msg.includes('HTTP Error') || msg.includes('Unavailable'))
          resolve({ error: 'Media tidak ditemukan, mungkin private/age-restricted tanpa cookies yang valid' });
        else
          resolve({ error: `Gagal memproses: ${msg.substring(0, 200)}` });
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch (parseErr) {
        const parseMsg = out.slice(-200).replace(/\s+/g, ' ');
        resolve({ error: `Gagal parsing respon gallery-dl: ${parseMsg || parseErr.message}` });
        return;
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        resolve({ error: 'No media found' });
        return;
      }

      const mediaItems = [];
      let tweetMetadata = null;
      for (const entry of parsed) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const second = entry[1];
        const third = entry[2];
        if (typeof second === 'string' && third && typeof third === 'object') {
          mediaItems.push({ ...third, _url: second });
        } else if (typeof second === 'object' && second !== null && !tweetMetadata) {
          tweetMetadata = second;
        }
      }

      if (mediaItems.length === 0) {
        resolve({ error: 'No media found' });
        return;
      }

      const author = (tweetMetadata?.author || mediaItems[0]?.author || {});
      const samples = mediaItems.map(item => {
        let dateStr = '';
        if (item.date) {
          if (typeof item.date === 'number') {
            dateStr = new Date(item.date * 1000).toISOString().split('T')[0];
          } else if (typeof item.date === 'string') {
            dateStr = item.date.split(' ')[0];
          }
        }
        return {
          title: (item.filename || '').substring(0, 120),
          ext: item.extension || '',
          date: dateStr,
          url: item._url || '',
        };
      });

      resolve({
        valid: true,
        username: author.name || '',
        displayName: author.nick || '',
        itemsFound: String(mediaItems.length),
        itemsLimited: options.mode === 'account' && mediaItems.length >= 3,
        samples,
        mode: options.mode || 'single',
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({ error: err.message });
    });
  });
}

// ── Queue & Scheduling ──

function processQueue() {
  if (!managerEnabled) return;
  const queued = Array.from(tasks.values()).filter(t => t.status === 'queued');

  for (const task of queued) {
    if (running >= maxConcurrent) break;

    if (task.viaBot) {
      const botRunning = Array.from(tasks.values()).filter(
        t => t.status === 'downloading' && t.viaBot
      ).length;
      if (botRunning >= BOT_CONCURRENT) {
        addLog(task, `Antrean bot: menunggu download bot lain selesai (maks ${BOT_CONCURRENT})`);
        continue;
      }
    }

    if (task.category === 'instagram') {
      const igRunning = Array.from(tasks.values()).filter(
        t => t.status === 'downloading' && t.category === 'instagram'
      ).length;
      if (igRunning >= INSTAGRAM_CONCURRENT) continue;

      const elapsed = Date.now() - lastInstagramTaskAt;
      if (lastInstagramTaskAt > 0 && elapsed < INSTAGRAM_DELAY_MS) {
        const wait = INSTAGRAM_DELAY_MS - elapsed;
        addLog(task, `Instagram rate limit: waiting ${(wait / 1000).toFixed(1)}s`);
        task.statusText = `Rate limit: waiting ${(wait / 1000).toFixed(1)}s...`;
        savePersistentTasks();
        setTimeout(() => processQueue(), wait + 200);
        continue;
      }
    }

    startTask(task);
    if (task.category === 'instagram') lastInstagramTaskAt = Date.now();
  }
}

function enableManager() {
  managerEnabled = true;
  processQueue();
  console.log('[downloader] Manager enabled');
}

function disableManager() {
  managerEnabled = false;
  console.log('[downloader] Manager disabled');
}

function isManagerEnabled() {
  return managerEnabled;
}

function getManagerStatus() {
  const all = Array.from(tasks.values());
  return {
    enabled: managerEnabled,
    maxConcurrent,
    active: all.filter(t => t.status === 'downloading').length,
    queued: all.filter(t => t.status === 'queued').length,
    completed: all.filter(t => t.status === 'completed').length,
    failed: all.filter(t => t.status === 'failed').length,
    total: all.length,
  };
}

function startTask(task) {
  running++;
  task.status = 'downloading';
  task.pid = null;
  task.statusText = 'Starting download...';
  savePersistentTasks();
  if (task.type === 'ytdlp') spawnYtdlp(task);
  else if (task.type === 'torrent') spawnAria2c(task);
  else if (task.type === 'gallery') spawnGalleryDl(task);
}

function addLog(task, msg) {
  task.logs.push(msg);
  task.statusText = msg;
  if (task.logs.length > 500) task.logs.splice(0, task.logs.length - 500);
}

// ── Auto-Retry Logic ──

function handleFailedTask(task, errorMsg) {
  task.lastError = errorMsg;
  task.retryHistory.push({
    attempt: (task.retryCount || 0) + 1,
    error: errorMsg,
    timestamp: new Date().toISOString(),
  });

  if (isContentError(errorMsg)) {
    task.error = errorMsg;
    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    addLog(task, `Failed (content error): ${errorMsg}`);
    running = Math.max(0, running - 1);
    savePersistentTasks();
    processQueue();
    return;
  }

  if (isNetworkError(errorMsg) && (task.retryCount || 0) < (task.maxRetries || MAX_AUTO_RETRIES)) {
    task.retryCount = (task.retryCount || 0) + 1;
    const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, task.retryCount - 1), 30000);
    addLog(task, `Network error detected. Auto-retry ${task.retryCount}/${task.maxRetries || MAX_AUTO_RETRIES} in ${delay / 1000}s...`);
    task.progress = 0;
    task.speed = '';
    task.eta = '';
    task.process = null;
    task.pid = null;
    task.status = 'queued';
    running = Math.max(0, running - 1);
    savePersistentTasks();
    setTimeout(() => {
      const t = tasks.get(task.id);
      if (t && t.status === 'queued') {
        t.error = null;
        t.statusText = 'Retrying...';
        savePersistentTasks();
        processQueue();
      }
    }, delay);
    return;
  }

  task.error = errorMsg;
  task.status = 'failed';
  task.completedAt = new Date().toISOString();
  if ((task.retryCount || 0) >= (task.maxRetries || MAX_AUTO_RETRIES)) {
    task.statusText = `Failed after ${task.retryCount} retries`;
    addLog(task, `Failed after ${task.retryCount} auto-retries: ${errorMsg}`);
  } else {
    addLog(task, `Failed: ${errorMsg}`);
  }
  running = Math.max(0, running - 1);
  savePersistentTasks();
  processQueue();
}

const taskFinishedCallbacks = [];
export function onTaskFinished(cb) {
  if (typeof cb === 'function') taskFinishedCallbacks.push(cb);
}
function notifyTaskFinished(task) {
  for (const cb of taskFinishedCallbacks) {
    try { cb(task); } catch (e) { console.error('[onTaskFinished]', e.message); }
  }
}

async function finishTask(task, status, errorMsg) {
  task.process = null; task.pid = null;
  task.status = status;
  if (errorMsg) task.error = errorMsg;
  task.completedAt = new Date().toISOString();
  if (status === 'completed') {
    task.progress = 100;
    task.retryCount = 0;
    task.lastError = null;

    const downloadedPaths = resolveDownloadedPaths(task);

    if (task.category === 'instagram') {
      if (downloadedPaths.length === 0) {
        task.status = 'failed';
        task.error = 'Download completed, but no exact output file was found';
        addLog(task, task.error);
        cleanupDownloadWorkDir(task);
        running = Math.max(0, running - 1);
        savePersistentTasks();
        processQueue();
        notifyTaskFinished(task);
        return;
      }

      try {
        const finalizedPaths = await finalizeInstagramFiles(task, downloadedPaths);
        let totalBytes = 0;
        for (const filePath of finalizedPaths) {
          try { totalBytes += fs.statSync(filePath).size; } catch {}
        }
        task.totalSize = formatBytes(totalBytes);
        task.downloaded = formatBytes(totalBytes);
        registerDownload(task.url, task.filename, new Date(task.downloadTimestamp));
        setCacheEntry(task.url, finalizedPaths);
      } catch (e) {
        task.status = 'failed';
        task.error = `Post-process failed: ${e.message}`;
        addLog(task, task.error);
        if (task.category !== 'instagram') cleanupDownloadWorkDir(task);
        running = Math.max(0, running - 1);
        savePersistentTasks();
        processQueue();
        notifyTaskFinished(task);
        return;
      }
    } else if (downloadedPaths.length > 0) {
      let primary = downloadedPaths[0];
      if (task.audioExtract) {
        const audioPath = downloadedPaths.find(p => AUDIO_EXTS.has(path.extname(p).toLowerCase()) && fs.existsSync(p));
        if (audioPath) primary = audioPath;
      }
      // Preserve original title (with " / "), sanitize only filesystem: " / " -> " - " if yt-dlp created subfolder due to slash
      try {
        const dir = path.dirname(primary);
        const base = path.basename(primary);
        // If file is in subfolder due to title slash (e.g. downloadDir/Tetoris/Kasane Teto SV.mp3 -> Tetoris / Kasane Teto SV)
        if (dir !== task.outputDir && dir.startsWith(task.outputDir) && base) {
          const subfolder = path.basename(dir);
          const baseNameNoExt = base.replace(/\.[^/.]+$/, '');
          // Reconstruct original title with " / " and sanitize to " - " for FS
          const reconstructed = `${subfolder} / ${baseNameNoExt}`;
          const sanitizedBase = sanitizeForFs(reconstructed) + path.extname(base);
          const newPath = path.join(task.outputDir, sanitizedBase);
          if (!fs.existsSync(newPath) && fs.existsSync(primary)) {
            fs.mkdirSync(path.dirname(newPath), { recursive: true });
            fs.renameSync(primary, newPath);
            try { fs.rmdirSync(dir); } catch {}
            primary = newPath;
            addLog(task, `Sanitized slash filename: ${subfolder}/${base} -> ${sanitizedBase} (original title preserved)`);
            // Preserve original title for DB (with " / ") - will be picked up via ffprobe or via task.originalTitle
            if (!task.originalTitle || task.originalTitle === baseNameNoExt) {
              task.originalTitle = reconstructed;
            }
          }
        } else if (/[\/\\:*?"<>|]/.test(base)) {
          const sanitizedBase = sanitizeForFs(base.replace(/\.[^/.]+$/, '')) + path.extname(base);
          if (sanitizedBase !== base) {
            const newPath = path.join(dir, sanitizedBase);
            if (!fs.existsSync(newPath)) {
              fs.renameSync(primary, newPath);
              primary = newPath;
              addLog(task, `Sanitized filename: ${base} -> ${sanitizedBase}`);
            }
          }
        }
      } catch (e) {
        addLog(task, `Sanitize check failed: ${e.message}`);
      }
      // Build expected filename from YouTube title + ID to prevent truncation
      const ytId = extractYoutubeId(task.url);
      if (ytId && primary) {
        const fullTitle = task.originalTitle || path.basename(primary, path.extname(primary));
        const expectedBase = buildExpectedFilename(fullTitle, ytId, path.extname(primary));
        const expectedPath = path.join(task.outputDir, expectedBase);
        if (expectedPath !== primary && fs.existsSync(primary)) {
          try {
            if (!fs.existsSync(expectedPath)) {
              fs.renameSync(primary, expectedPath);
              primary = expectedPath;
              addLog(task, `Expected filename: ${expectedBase}`);
            } else {
              addLog(task, `Expected filename already exists: ${expectedBase}`);
            }
          } catch (e) {
            addLog(task, `Rename to expected filename failed: ${e.message}`);
          }
        }
      }
      task.filePath = primary;
      task.filename = path.basename(task.filePath);
      try {
        const fileStat = fs.statSync(task.filePath);
        task.totalSize = formatBytes(fileStat.size);
        task.downloaded = formatBytes(fileStat.size);
        task.downloadTimestamp = getFileArrivalTimestamp(task.filePath).toISOString();
      } catch {}
      if (task.audioExtract && task.embedCover) {
        const merged = await embedCoverForAudioTask(task);
        if (!merged) {
          const errMsg = task.error || `Embed cover gagal untuk ${task.filename}`;
          task.error = errMsg;
          task.status = 'failed';
          task.completedAt = new Date().toISOString();
          addLog(task, `Embed cover gagal: ${errMsg}`);
          cleanupDownloadWorkDir(task);
          running = Math.max(0, running - 1);
          savePersistentTasks();
          processQueue();
          notifyTaskFinished(task);
          return;
        }
      }
    }

    recordDownloaded(task.url, task.category);
    postProcessTask(task);
    cleanupDownloadWorkDir(task);
    if (globalThis.mediaScanner) globalThis.mediaScanner.scan().catch(() => {});
  } else if (status === 'failed') {
    cleanupDownloadWorkDir(task);
    handleFailedTask(task, errorMsg);
    notifyTaskFinished(task);
    return;
  }
  running = Math.max(0, running - 1);
  savePersistentTasks();
  processQueue();
  notifyTaskFinished(task);
}

// ── Post-Processing ──

const COVER_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

async function embedCoverForAudioTask(task) {
  const audioPath = task.filePath;
  if (!audioPath || !fs.existsSync(audioPath)) return false;
  const dir = path.dirname(audioPath);
  const base = path.basename(audioPath).replace(/\.[^.]+$/, '');

  let coverPath = null;
  let candidates = [];
  try { candidates = fs.readdirSync(dir); } catch {}
  for (const name of candidates) {
    const full = path.join(dir, name);
    try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    if (path.basename(name, ext) === base) { coverPath = full; break; }
    if (!coverPath) coverPath = full;
  }
  if (!coverPath) {
    task.error = `Cover tidak ditemukan untuk ${path.basename(audioPath)}, embed cover tidak dapat diproses`;
    addLog(task, task.error);
    return false;
  }

  const mime = COVER_MIME_BY_EXT[path.extname(coverPath).toLowerCase()] || 'image/jpeg';
  try {
    const imageBuffer = fs.readFileSync(coverPath);
    await embedCover(audioPath, imageBuffer, mime);
    addLog(task, `Cover ter-embed ke ${path.basename(audioPath)}`);
    try { fs.unlinkSync(coverPath); } catch {}
    return true;
  } catch (err) {
    task.error = `Embed cover gagal untuk ${path.basename(audioPath)}: ${(err.message || '').slice(0, 200)}`;
    addLog(task, task.error);
    return false;
  }
}

function postProcessFile(task, filePath) {
  if (!filePath) return filePath;
  try {
    if (!fs.existsSync(filePath)) return filePath;
    const ext = path.extname(filePath).toLowerCase();
    const cat = task.category;

    if (AUDIO_EXTS.has(ext) && !task.audioExtract) {
      const r = SOURCE_ROUTES[cat];
      const audioDir = r?.audio;
      if (audioDir && !filePath.startsWith(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
        const dest = path.join(audioDir, path.basename(filePath));
        if (!fs.existsSync(dest)) {
          moveFileNoOverwrite(filePath, dest);
          if (task.downloadTimestamp) preserveTimestamps(dest, new Date(task.downloadTimestamp));
          return dest;
        }
        return filePath;
      }
    }

    if (IMAGE_EXTS.has(ext)) {
      const imgDir = task.imageDir || getImageDir(cat);
      if (imgDir && !filePath.startsWith(imgDir)) {
        fs.mkdirSync(imgDir, { recursive: true });
        const dest = path.join(imgDir, path.basename(filePath));
        if (!fs.existsSync(dest)) {
          moveFileNoOverwrite(filePath, dest);
          if (task.downloadTimestamp) preserveTimestamps(dest, new Date(task.downloadTimestamp));
          return dest;
        }
      }
    }
  } catch {}
  return filePath;
}

function postProcessTask(task) {
  if (task._filePaths && task._filePaths.length > 0) {
    const processedPaths = [];
    for (const fp of task._filePaths) {
      const processedPath = postProcessFile(task, fp);
      if (processedPath) processedPaths.push(processedPath);
    }
    task._filePaths = processedPaths;
    task.filePath = task._filePaths[0] || '';
    task.filename = task.filePath ? path.basename(task.filePath) : '';
  } else if (task.filePath) {
    task.filePath = postProcessFile(task, task.filePath);
    task.filename = task.filePath ? path.basename(task.filePath) : task.filename;
  }
}

// ── Instagram gallery-dl fallback ──

function triggerGalleryDlFallback(task, reason) {
  task._imageRetry = true;
  addLog(task, `Triggering Instagram fallback (reason: ${reason})`);

  const imgDir = task.imageDir || getImageDir(task.category) || SOURCE_ROUTES[task.category]?.image || task.outputDir;

  // Step 1: get username via --print
  let igUsername = 'unknown';
  try {
    const printArgs = ['--print', '{account}', '--no-download'];
    if (task.twitterCookiesPath) printArgs.push('--cookies', task.twitterCookiesPath);
    printArgs.push(task.url);
    const printOut = spawnSync('gallery-dl', printArgs, { timeout: 15000 });
    const out = (printOut.stdout || '').toString().trim();
    if (out) igUsername = out.split('\n')[0].trim();
  } catch {}
  task._igUsername = igUsername;
  addLog(task, `Instagram account: ${igUsername}`);

  cleanupDownloadWorkDir(task);
  const imgDownloadDir = createDownloadWorkDir(imgDir, task);
  task._downloadDir = imgDownloadDir;
  task._requireExactPath = true;
  task.imageDir = imgDir;

  // Step 2: download. gallery-dl is kept as a last-resort fallback; manager sorts by real extension.
  const imgArgs = ['--directory', imgDownloadDir, '--no-mtime', '--Print', 'after:{_path}', '--download-archive', '/dev/null'];
  if (task.twitterCookiesPath) imgArgs.push('--cookies', task.twitterCookiesPath);
  imgArgs.push(task.url);

  let imgProc;
  try { imgProc = spawn('gallery-dl', imgArgs, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { finishTask(task, 'failed', `Image fallback failed: ${e.message}`); return; }

  task.process = imgProc; task.pid = imgProc.pid;
  let imgStderr = '';
  let imgStdoutBuffer = '';
  const imgDownloadedPaths = [];

  imgProc.stdout.on('data', d => {
    imgStdoutBuffer += d.toString();
    const lines = imgStdoutBuffer.replace(/\r/g, '\n').split('\n');
    imgStdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const filePath = parseGalleryOutputPath(line, imgDownloadDir);
      if (filePath) imgDownloadedPaths.push(filePath);
    }
  });

  imgProc.stderr.on('data', d => { imgStderr += d.toString(); });

  imgProc.on('close', (imgCode) => {
    if (task.status === 'cancelled') { task.process = null; task.pid = null; running = Math.max(0, running - 1); return; }
    if (imgCode === 0) {
      task._igUsername = igUsername;
      if (imgStdoutBuffer) {
        const filePath = parseGalleryOutputPath(imgStdoutBuffer, imgDownloadDir);
        if (filePath) imgDownloadedPaths.push(filePath);
      }
      const exactPaths = uniqueExistingPaths(imgDownloadedPaths);
      const rawPaths = exactPaths.length > 0 ? exactPaths : scanDownloadDir(imgDownloadDir, new Set([...IMAGE_EXTS, ...DL_VIDEO_EXTS]), true);
      const fallbackPaths = filterInstagramFallbackPaths(rawPaths);

      addLog(task, `Instagram fallback completed, files found: ${fallbackPaths.length}`);

      if (fallbackPaths.length === 0) {
        finishTask(task, 'failed', 'Instagram fallback completed but no image/video output file found');
        return;
      }

      task._filePaths = fallbackPaths;
      task.filePath = fallbackPaths[0];
      task.filename = path.basename(fallbackPaths[0]);
      finishTask(task, 'completed');
    } else {
      finishTask(task, 'failed', `Instagram fallback failed: ${imgStderr.slice(-200).trim() || 'unknown error'}`);
    }
  });

  imgProc.on('error', (e) => {
    if (task.status !== 'cancelled') finishTask(task, 'failed', e.message);
    else { task.process = null; task.pid = null; running = Math.max(0, running - 1); }
  });
}

// ── Spawners ──

const PROGRESS_RE = /(\d+\.?\d*)%/;
const SPEED_RE = /at\s+([\d.]+)\s*(\w+\/s)/i;
const ETA_RE = /ETA\s+(\S+)/i;
const SIZE_RE = /of\s+~?([\d.]+)\s*(\w+)/i;

function sanitizeForFs(name) {
  // Keep original title " / " in DB (with slash), only sanitize filesystem: "/" -> "／" fullwidth (looks like "/" but safe), forbidden -> "_"
  return String(name || '').trim()
    .replace(/\//g, '／')
    .replace(/[\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'untitled';
}

function extractYoutubeId(url) {
  try {
    const u = (url || '').trim();
    const parsed = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts[0] || null;
    }
    if (host.endsWith('youtube.com') || host === 'youtube.com') {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const m = parsed.pathname.match(/\/(?:shorts|embed|v|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function buildExpectedFilename(title, youtubeId, ext) {
  const safeTitle = sanitizeForFs(title || '');
  const extension = (ext || '').startsWith('.') ? ext : `.${ext || ''}`;
  return `${safeTitle}${extension}`;
}

function spawnYtdlp(task) {
  const args = ['--newline', '--no-warnings', '--no-playlist', '--concurrent-fragments', '4'];
  args.push(...YTDLP_RESILIENT_ARGS);
  args.push('--replace-in-metadata', 'title', '[#]', '');
  // Keep original title for DB (with " / "), filesystem sanitized via Node (customTitle) and via post-download move for %(title)s
  if (!task.originalTitle) task.originalTitle = task.customTitle || '';
  const downloadDir = task.category === 'instagram' ? createDownloadWorkDir(task.outputDir, task) : task.outputDir;

  if (task.category === 'instagram') {
    task._downloadDir = downloadDir;
    task._requireExactPath = true;
    args.push('--no-mtime');
    args.push('--print', 'before_dl:__IG_USERNAME__%(channel)s');
    args.push('--print', 'after_move:__DOWNLOADED_FILE__%(filepath)s');
  }

  // For YouTube we need the live logged-in Chromium session (--cookies-from-browser)
  // so the web_safari client can serve full 1080p HLS formats (SABR/PoToken gating).
  // The static cookie file alone is capped at 360p.
  if (task.category === 'youtube') {
    args.push('--cookies-from-browser', 'chromium:Default');
    const staticCookies = resolveCookiesForTask(task);
    if (staticCookies) {
      args.push('--cookies', staticCookies);
    }
    args.push('--print', 'before_dl:__YT_TITLE__%(title)s');
  } else {
    const cookies = resolveCookiesForTask(task);
    if (cookies) {
      args.push('--cookies', cookies);
    }
  }

  if (task.formatId) {
    args.push('-f', task.formatId);
    args.push('--merge-output-format', 'mp4');
    args.push('-S', 'lang:original');
  } else if (task.audioExtract) {
    const bitrate = AUDIO_BITRATE_MAP[task.audioBitrate] || '0';
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
    args.push('-S', 'lang:original');
    args.push('--extract-audio', '--audio-quality', bitrate);
    if (task.audioFormat) args.push('--audio-format', task.audioFormat);
} else if (task.quality === 'audio') {
  args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
  args.push('-S', 'lang:original');
  args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
} else if (task.category === 'instagram') {
    args.push('-f', INSTAGRAM_FORMAT_SELECTOR);
    args.push('--merge-output-format', 'mp4');
    addLog(task, `Instagram format policy: ${INSTAGRAM_FORMAT_SELECTOR}`);
  } else {
    const srcPref = SOURCE_FORMAT_PREFERENCE[task.category];
    args.push('-f', srcPref || FORMAT_MAP[task.quality] || 'bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]');
    args.push('--merge-output-format', 'mp4');
    args.push('-S', 'lang:original');
}

if (task.embedCover) {
  if (task.audioExtract) {
    addLog(task, 'Embed cover untuk audio extract akan diproses setelah download');
    args.push('--write-thumbnail');
  } else {
    args.push('--embed-thumbnail');
  }
}

  // Sanitize customTitle for FS only, keep originalTitle for DB title
  const fsSafeTitle = task.customTitle ? sanitizeForFs(task.customTitle) : null;
  const outputTemplate = fsSafeTitle
    ? path.join(downloadDir, `${fsSafeTitle}.%(ext)s`)
    : path.join(downloadDir, '%(title)s.%(ext)s');
  args.push('-o', outputTemplate);
  args.push(task.url);

  task.filename = '';
  task.filePath = '';

  let proc;
  try { proc = spawn('/usr/bin/yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { finishTask(task, 'failed', `Gagal spawn yt-dlp: ${err.message}`); return; }
  task.process = proc;
  task.pid = proc.pid;

  let outBuffer = '';
  let errBuffer = '';

  const parse = (chunk) => {
    outBuffer += chunk.toString();
    const lines = outBuffer.replace(/\r/g, '\n').split('\n');
    outBuffer = lines.pop() || '';

    for (const line of lines) {
      const c = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (!c) continue;

      if (c.startsWith('__IG_USERNAME__')) {
        const username = sanitizeArchiveName(c.replace('__IG_USERNAME__', ''));
        if (username && username !== 'NA') task._igUsername = username;
        continue;
      }

      if (c.startsWith('__YT_TITLE__')) {
        const title = c.replace('__YT_TITLE__', '').trim();
        if (title && title !== 'NA') task.originalTitle = title;
        continue;
      }

      if (c.startsWith('__DOWNLOADED_FILE__')) {
        const filePath = c.replace('__DOWNLOADED_FILE__', '').trim();
        if (filePath && filePath !== 'NA') {
          task.filePath = filePath;
          task.filename = path.basename(filePath);
          task._filePaths = [filePath];
        }
        continue;
      }

      let m = c.match(/\[Merger\]\s+Merging\s+formats\s+into\s+"(.+?)"/i);
      if (m) { task.filePath = m[1].trim(); task.filename = path.basename(task.filePath); continue; }
      m = c.match(/\[ExtractAudio\]\s+Destination:\s+(.+)/i);
      if (m) { task.filePath = m[1].trim(); task.filename = path.basename(task.filePath); continue; }
      m = c.match(/\[download\]\s+Destination:\s+(.+)/i);
      if (m) {
        const dest = m[1].trim();
        if (!task.filePath || /\.(f\w+|sd|hd|ultra)-[\w-]+(?=\.\w+$)/i.test(task.filePath)) {
          task.filePath = dest;
          task.filename = path.basename(dest).replace(/\.(f\w+|sd|hd|ultra)-[\w-]+(?=\.\w+$)/i, '');
        }
        continue;
      }

      const p = PROGRESS_RE.exec(c); if (p) task.progress = parseFloat(p[1]);
      const sp = SPEED_RE.exec(c); if (sp) task.speed = `${sp[1]} ${sp[2]}`;
      const et = ETA_RE.exec(c); task.eta = (et && et[1] !== '--') ? et[1] : '';
      const sz = SIZE_RE.exec(c); if (sz) task.totalSize = `${sz[1]} ${sz[2]}`;
      if (c.includes('[info]') && c.includes('Destination:')) {
        addLog(task, `yt-dlp format: ${c.trim()}`);
      }
    }
  };

  proc.stdout.on('data', parse);
  if (proc.stderr) proc.stderr.on('data', (chunk) => { errBuffer += chunk.toString(); parse(chunk); });

  const onClose = (code) => {
    if (code === 0) {
      if (task.category === 'instagram' && !task._imageRetry) {
        const checkPaths = resolveDownloadedPaths(task);
        addLog(task, `yt-dlp exit code 0, files found: ${checkPaths.length}`);
        if (checkPaths.length === 0) {
          triggerGalleryDlFallback(task, 'yt-dlp returned success but no files found');
          return;
        }
      }
      finishTask(task, 'completed');
    } else if (task.status !== 'cancelled') {
      let errMsg = errBuffer.slice(-500).trim();
      if (!errMsg && code === 1) {
        if (task.twitterCookiesPath) {
          if (!fs.existsSync(task.twitterCookiesPath)) {
            errMsg = 'Cookies file/directory not found: ' + task.twitterCookiesPath;
          } else {
            errMsg = 'Download failed. Check cookies validity or media may be private/age-restricted.';
          }
        } else {
          errMsg = 'Download failed. Try with cookies for age-restricted content.';
        }
      }
      // Instagram image fallback: try gallery-dl when no video formats found
      if (task.category === 'instagram' && (errMsg.includes('No video formats found') || errMsg.includes('format not available')) && !task._imageRetry) {
        triggerGalleryDlFallback(task, errMsg.includes('No video formats found') ? 'No video formats found' : 'format not available');
        return;
      }
      finishTask(task, 'failed',
        code === 127 ? 'yt-dlp binary tidak ditemukan' : `yt-dlp exited with code ${code}${errMsg ? ': ' + errMsg : ''}`);
    } else { task.process = null; task.pid = null; running = Math.max(0, running - 1); }
  };
  const onErr = (err) => {
    if (task.status !== 'cancelled') finishTask(task, 'failed', err.message);
    else { task.process = null; task.pid = null; running = Math.max(0, running - 1); }
  };

  proc.on('close', onClose);
  proc.on('error', onErr);
}

function spawnAria2c(task) {
  const args = ['--enable-dht', '--summary-interval=1', '--dir', task.outputDir, task.url];
  let proc;
  try { proc = spawn('aria2c', args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { finishTask(task, 'failed', `Gagal spawn aria2c: ${err.message}`); return; }
  task.process = proc;
  task.pid = proc.pid;

  let buf = '';
  const parse = (chunk) => {
    buf += chunk.toString();
    const lines = buf.replace(/\r/g, '\n').split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const c = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (!c) continue;
      const p = c.match(/\((\d+)%\)/); if (p) task.progress = parseInt(p[1], 10);
      const dl = c.match(/DL:([\d.]+\s*\w+)/i); if (dl) task.speed = dl[1].trim();
      if (!task.filename) { const f = c.match(/FILE:\s*(.+)/i); if (f) task.filename = f[1].trim(); }
    }
  };
  proc.stdout.on('data', parse);
  if (proc.stderr) proc.stderr.on('data', parse);
  proc.on('close', (code) => {
    if (code === 0) { task.totalSize = task.downloaded; finishTask(task, 'completed'); }
    else if (task.status !== 'cancelled')
      finishTask(task, 'failed', code === 127 ? 'aria2c binary tidak ditemukan' : `aria2c exited with code ${code}`);
    else { task.process = null; task.pid = null; running = Math.max(0, running - 1); }
  });
  proc.on('error', (err) => {
    if (task.status !== 'cancelled') finishTask(task, 'failed', err.message);
    else { task.process = null; task.pid = null; running = Math.max(0, running - 1); }
  });
}

function clearGalleryTimers(task) {
  if (task._countdownInterval) {
    clearInterval(task._countdownInterval);
    task._countdownInterval = null;
  }
}

function spawnGalleryDl(task) {
  let args = ['--verbose'];

  if (task.twitterMode !== 'account') {
    args.push('--range', '1-50');
  }

  if (task.twitterCookiesPath) {
    if (!fs.existsSync(task.twitterCookiesPath)) {
      finishTask(task, 'failed', `Cookies file/directory not found: ${task.twitterCookiesPath}`);
      return;
    }
    args.push('--cookies', task.twitterCookiesPath);
  }

  const outputDir = task.outputDir;

  args.push('--directory', outputDir);
  args.push(task.url);

  addLog(task, 'Menghubungi X...');

  let proc;
  try { proc = spawn('gallery-dl', args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { finishTask(task, 'failed', `Gagal spawn gallery-dl: ${err.message}`); return; }
  task.process = proc;
  task.pid = proc.pid;

  let stdout = '';
  let stderrBuf = '';
  let fileCount = 0;

  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  proc.stderr.on('data', (chunk) => {
    const str = chunk.toString();
    stderrBuf += str;
    const lines = str.replace(/\r/g, '\n').split('\n');
    for (const line of lines) {
      const c = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (!c) continue;

      if (c.includes('Sleeping')) {
        const s = c.match(/([\d.]+)\s*seconds?/);
        const secs = s ? Math.round(parseFloat(s[1])) : 0;
        if (secs > 0 && !task._countdownInterval) {
          addLog(task, `Sleep ${secs}s — menunggu rate limit...`);
          task._sleepRemaining = secs;
          task._countdownInterval = setInterval(() => {
            if (task._sleepRemaining > 0) {
              task._sleepRemaining--;
              if (task._sleepRemaining > 0) {
                task.statusText = `Menunggu rate limit (${task._sleepRemaining}s)...`;
              }
            }
            if (task._sleepRemaining <= 0) {
              clearGalleryTimers(task);
              task.statusText = 'Melanjutkan...';
            }
          }, 1000);
        }
        task.statusText = `Menunggu rate limit (${secs}s)...`;
        continue;
      }
      if (c.includes('Starting DownloadJob') || c.includes('Starting DataJob')) {
        addLog(task, 'Menyambung ke X...');
        continue;
      }
      if (c.includes('Starting extraction')) {
        addLog(task, 'Mengambil data media...');
        continue;
      }
      if (c.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mkv|mov|mp3|m4a|flac|opus|wav|aac)/i)) {
        const fileMatch = c.match(/([^\/\\]+\.\w+)(\?|$)/i);
        const fname = fileMatch ? fileMatch[1] : '';
        const extMatch = c.match(/\.(\w+)(\?|$)/);
        const ext = extMatch ? extMatch[1].toUpperCase() : '';
        if (fname) {
          fileCount++;
          addLog(task, `${fname} (${ext || 'file'} #${fileCount}) → ${outputDir}`);
          continue;
        }
      }
    }
  });

  const finishCleanup = () => {
    clearGalleryTimers(task);
  };

  proc.on('close', (code) => {
    if (code === 0) {
      const filePaths = [];
      const lines = stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        if (line.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mkv|mov|mp3|m4a|flac|opus|wav|aac)$/i)) {
          let fp = line.trim();
          if (!path.isAbsolute(fp)) {
            fp = path.join(outputDir, fp);
          }
          if (fs.existsSync(fp)) {
            filePaths.push(fp);
          }
        }
      }
      task._filePaths = filePaths;
      finishCleanup();
      if (filePaths.length > 0) {
        task.filePath = filePaths[0];
        task.filename = path.basename(filePaths[0]);
      }
      finishTask(task, 'completed');
    } else if (task.status !== 'cancelled') {
      finishCleanup();
      let errMsg = stderrBuf.slice(-500).trim();
      if (!errMsg) {
        errMsg = 'gallery-dl exited with unknown error';
      }
      finishTask(task, 'failed', code === 127 ? 'gallery-dl binary tidak ditemukan' : `gallery-dl exited with code ${code}: ${errMsg}`);
    } else {
      finishCleanup();
      task.process = null;
      task.pid = null;
      running = Math.max(0, running - 1);
    }
  });

  proc.on('error', (err) => {
    finishCleanup();
    if (task.status !== 'cancelled') finishTask(task, 'failed', err.message);
    else { task.process = null; task.pid = null; running = Math.max(0, running - 1); }
  });
}

// Auto-resume queued tasks after server restart
setTimeout(() => processQueue(), 2000);
