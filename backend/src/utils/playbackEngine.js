import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync, writeFileSync, accessSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PATHS, SETTINGS } from '../config/paths.js';
import { createLogger, logDecision, logRemux, logCleanup, logIntegrity, logError } from './logger.js';
import { avDriftStore } from './avSync.js';
import { get } from './runtimeSettings.js';
import { stmts } from '../db.js';

const log = createLogger('playback');

const activeJobs = new Map();
let shutdownRequested = false;

const H264_RE = /(^|\s)(avc1|h264)(\s|$)/;
const HEVC_RE = /(^|\s)(hev1|hvc1|hevc)(\s|$)/;
const OPUS_RE = /\bopus\b/;
const BROWSER_CONTAINERS = ['.mp4', '.m4v', '.mov'];
const ISO_BMFF_EXT = new Set(['.mp4', '.m4v', '.mov']);
const FASTSTART_HEAD_BYTES = 256 * 1024;
const FASTSTART_TAIL_BYTES = 256 * 1024;

const MIME_MAP = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.mov': 'video/mp4', '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv', '.hevc': 'application/octet-stream',
  '.h265': 'application/octet-stream', '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac', '.opus': 'audio/opus', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
};

const stats = {
  cacheHits: 0,
  cacheMisses: 0,
  integrityFails: 0,
  totalRemuxes: 0,
  totalTranscodes: 0,
  totalRemuxMs: 0,
  totalTranscodeMs: 0,
  totalProbeMs: 0,
  probeCount: 0,
  totalRequests: 0,
  totalErrors: 0,
  fastestStartupMs: Infinity,
  slowestStartupMs: 0,
  requestsByAction: { direct: 0, remux: 0, transcode: 0, faststart: 0 },
  totalFaststarts: 0,
  totalFaststartMs: 0,
  recentStartupMs: [],
  lastCleanup: null,
  nextCleanup: null,
  totalBytesCached: 0,
  totalFilesCached: 0,
  evictions: 0,
  cleanupCount: 0,
  oldestCacheEntry: null,
  newestCacheEntry: null,
  largestCachedFile: 0,
  smallestCachedFile: 0,
  avgCachedFileSize: 0,
  startTime: Date.now(),
};

let lruMap = new Map();

// FFmpeg concurrency limiter — prevent OOM from transcoding storms
const MAX_FFMPEG_CONCURRENT = 2;
const MAX_LRU_ENTRIES = 10000;
let ffmpegActive = 0;
const ffmpegQueue = [];

function acquireFfmpegSlot() {
  return new Promise((resolve) => {
    if (ffmpegActive < MAX_FFMPEG_CONCURRENT) {
      ffmpegActive++;
      resolve();
    } else {
      ffmpegQueue.push(resolve);
    }
  });
}

function releaseFfmpegSlot() {
  if (ffmpegQueue.length > 0) {
    const next = ffmpegQueue.shift();
    next();
  } else {
    ffmpegActive--;
  }
}

function loadLRU() {
  try {
    if (existsSync(PATHS.playbackLru)) {
      const data = JSON.parse(readFileSync(PATHS.playbackLru, 'utf-8'));
      lruMap = new Map(Object.entries(data));
    }
  } catch {
    lruMap = new Map();
  }
}

function persistLRU() {
  try {
    const obj = Object.fromEntries(lruMap);
    writeFileSync(PATHS.playbackLru, JSON.stringify(obj));
  } catch {}
}

function touchLRU(filePath, size) {
  if (!SETTINGS.lruEnabled) return;
  if (lruMap.size >= MAX_LRU_ENTRIES) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, val] of lruMap) {
      if (val.lastUsed < oldestTime) { oldestTime = val.lastUsed; oldestKey = key; }
    }
    if (oldestKey) lruMap.delete(oldestKey);
  }
  lruMap.set(filePath, { lastUsed: Date.now(), size, createdAt: lruMap.get(filePath)?.createdAt || Date.now() });
}

function removeLRU(filePath) {
  lruMap.delete(filePath);
}

function init() {
  mkdirSync(PATHS.playbackRemux, { recursive: true });
  mkdirSync(PATHS.playbackTranscode, { recursive: true });
  mkdirSync(PATHS.playbackFaststart, { recursive: true });
  loadLRU();
}

init();

export function requestShutdown() {
  shutdownRequested = true;
  log.info({ msg: 'Graceful shutdown requested — no new jobs accepted' });
}

export async function waitForDrain(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (activeJobs.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }
  log.info({ msg: 'Drain complete', remainingJobs: activeJobs.size });
}

function computeCacheHash(filePath, size, mtime) {
  return createHash('md5').update(`${filePath}:${size}:${mtime}`).digest('hex').slice(0, 16);
}

function verifyIntegrity(filePath, label) {
  try {
    if (!existsSync(filePath)) return false;
    const st = statSync(filePath);
    if (st.size === 0) { logIntegrity(log, filePath, 'empty_file'); stats.integrityFails++; return false; }
    accessSync(filePath, 4);
    return true;
  } catch {
    logIntegrity(log, filePath, `${label}_read_error`);
    stats.integrityFails++;
    return false;
  }
}

function probeVideoFile(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,codec_tag_string,width,height',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf-8', timeout: SETTINGS.probeTimeoutMs });
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const data = JSON.parse(stdout || '{}');
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video') || {};
        const audioStream = (data.streams || []).find(s => s.codec_type === 'audio') || {};
        resolve({
          video_codec: (videoStream.codec_name || '').toLowerCase(),
          video_codec_tag: (videoStream.codec_tag_string || '').toLowerCase(),
          audio_codec: (audioStream.codec_name || '').toLowerCase(),
          audio_codec_tag: (audioStream.codec_tag_string || '').toLowerCase(),
          width: videoStream.width || 0,
          height: videoStream.height || 0,
        });
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

function parseCodecInfo(file) {
  if (file.codec_info) {
    try { return JSON.parse(file.codec_info); } catch {}
  }
  return null;
}

function readChunkAt(filePath, start, length) {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, length));
    let remaining = length;
    let pos = start;
    let offset = 0;
    while (remaining > 0) {
      const n = readSync(fd, buf, offset, remaining, pos);
      if (n <= 0) break;
      offset += n;
      pos += n;
      remaining -= n;
    }
    return buf.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

// Walk top-level ISO-BMFF boxes in `buf` (which begins at absolute offset
// `baseOffset` in the file) and report the first absolute offsets of `moov`
// and `mdat`. Returns null for a box type we never saw in this window.
function scanBoxOrder(buf, baseOffset, fileSize) {
  let pos = 0;
  let moov = null;
  let mdat = null;
  const len = buf.length;
  while (pos + 8 <= len) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > len) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      // Box extends to EOF — treat as spanning the rest of the file.
      size = fileSize - baseOffset - pos;
    }
    if (size < 8 || size > fileSize) break; // malformed / can't continue
    const absPos = baseOffset + pos;
    if (type === 'moov' && moov === null) moov = absPos;
    else if (type === 'mdat' && mdat === null) mdat = absPos;
    if (moov !== null && mdat !== null) break;
    pos += size;
  }
  return { moov, mdat };
}

// Defensive, bounded-I/O faststart detector. No ffmpeg / ffprobe.
// Returns true (moov before mdat → progressive) or false (non-faststart →
// will be copy-remuxed once into cache). Conservative fallback to false:
// worst case is one extra copy-only ffmpeg, never a misclassified hang.
function isFaststart(filePath, fileSize) {
  if (fileSize < 12) return false;
  const head = readChunkAt(filePath, 0, Math.min(FASTSTART_HEAD_BYTES, fileSize));
  const h = scanBoxOrder(head, 0, fileSize);
  if (h.moov !== null && h.mdat !== null) return h.moov < h.mdat;
  if (h.moov !== null && h.mdat === null) return true; // moov early, no mdat seen yet

  const tailStart = Math.max(0, fileSize - Math.min(FASTSTART_TAIL_BYTES, fileSize));
  const tail = readChunkAt(filePath, tailStart, fileSize - tailStart);
  const t = scanBoxOrder(tail, tailStart, fileSize);

  if (h.moov !== null && t.mdat !== null) return true;  // moov early, mdat at end
  if (h.mdat !== null && t.moov !== null) return false; // mdat early, moov at end
  if (h.moov === null && h.mdat === null && t.moov !== null) return false; // moov only in tail
  return false; // uncertain → conservative non-faststart
}

// Lazily inspect faststart_state, persisting the result. Returns
// 1 (faststart), 0 (non-faststart), or -1 (not a managed ISO-BMFF container).
async function resolveFaststartState(file, ext) {
  const current = file.faststart_state;
  if (current !== null && current !== undefined) return current;
  let val;
  if (!ISO_BMFF_EXT.has(ext)) {
    val = -1;
  } else {
    try {
      const size = typeof file.size === 'number' ? file.size : statSync(file.fullPath).size;
      val = isFaststart(file.fullPath, size) ? 1 : 0;
    } catch {
      val = 0;
    }
  }
  try { stmts.updateFaststartState.run(val, file.id); } catch {}
  return val;
}

function faststartCopy(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', '-y', outputPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`faststart failed: ${stderr.slice(-300)}`));
    });
    ff.on('error', reject);
  });
}

function cacheAgeSecondsOf(cachePath) {
  try { return Math.max(0, Math.floor((Date.now() - statSync(cachePath).mtimeMs) / 1000)); }
  catch { return null; }
}

function remuxToMkv(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', inputPath, '-c', 'copy', '-f', 'matroska', '-y', outputPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`remux failed: ${stderr.slice(-300)}`));
    });
    ff.on('error', reject);
  });
}

function transcodeToH264Mp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-fflags', '+genpts',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-fps_mode', 'cfr',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-af', 'aresample=async=1:first_pts=0',
      '-movflags', '+faststart',
      '-f', 'mp4', '-y', outputPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`transcode failed: ${stderr.slice(-300)}`));
    });
    ff.on('error', reject);
  });
}

function trackStartup(totalMs) {
  stats.totalRequests++;
  if (totalMs < stats.fastestStartupMs) stats.fastestStartupMs = totalMs;
  if (totalMs > stats.slowestStartupMs) stats.slowestStartupMs = totalMs;
  stats.recentStartupMs.push(totalMs);
  if (stats.recentStartupMs.length > 100) stats.recentStartupMs.shift();
}

export async function getPlaybackDecision(file) {
  const t0 = Date.now();
  const ext = file.ext?.toLowerCase();
  const allowTranscode = get('serve.transcode', false);

  const cachedProbe = parseCodecInfo(file);
  const liveProbe = cachedProbe ? null : await probeVideoFile(file.fullPath);
  const probe = cachedProbe || liveProbe;

  const probeMs = Date.now() - t0;
  stats.totalProbeMs += probeMs;
  stats.probeCount++;

  if (!probe) {
    // Probe failed — fall back to raw direct unless transcoding is enabled.
    const decision = allowTranscode
      ? {
          action: 'transcode', path: file.fullPath,
          contentType: MIME_MAP[ext] || 'video/mp4', reason: 'probe_failed',
          probe: null, probeMs, cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
        }
      : {
          action: 'direct', path: file.fullPath,
          contentType: MIME_MAP[ext] || 'application/octet-stream', reason: 'transcode_disabled_raw',
          probe: null, probeMs, cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
        };
    stats.cacheMisses++;
    stats.requestsByAction[decision.action]++;
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  }

  const codec = `${probe.video_codec || ''} ${probe.video_codec_tag || ''}`.toLowerCase();
  const audioCodec = `${probe.audio_codec || ''} ${probe.audio_codec_tag || ''}`.toLowerCase();
  const isBrowserContainer = BROWSER_CONTAINERS.includes(ext);
  const isH264 = H264_RE.test(codec);
  const isHevc = HEVC_RE.test(codec);
  const hasOpus = OPUS_RE.test(audioCodec);
  const videoCompatible = isBrowserContainer && (isH264 || isHevc);

  if (videoCompatible && !hasOpus) {
    const faststartState = await resolveFaststartState(file, ext);
    file.faststart_state = faststartState;

    if (faststartState === 1) {
      const decision = {
        action: 'direct', path: file.fullPath,
        contentType: MIME_MAP[ext] || 'video/mp4', reason: 'browser_compatible_faststart',
        probe, probeMs, cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
        faststart: true, cacheAgeSeconds: null,
      };
      stats.cacheMisses++;
      stats.requestsByAction.direct++;
      trackStartup(decision.totalMs);
      logDecision(log, file, decision);
      return decision;
    }

    if (faststartState === 0) {
      return await handleFaststart(file, probe, t0, probeMs);
    }

    // faststartState === -1 (not a managed container): fall through to the
    // original direct/transcode path below.
    const decision = {
      action: 'direct', path: file.fullPath,
      contentType: MIME_MAP[ext] || 'video/mp4', reason: 'browser_compatible',
      probe, probeMs, cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
      faststart: false, cacheAgeSeconds: null,
    };
    stats.cacheMisses++;
    stats.requestsByAction.direct++;
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  }

  if (videoCompatible && hasOpus) {
    return await handleRemux(file, probe, t0, probeMs);
  }

  if (allowTranscode) {
    return await handleTranscode(file, probe, t0, probeMs);
  }

  // Transcoding disabled — serve the original file directly (raw).
  const decision = {
    action: 'direct', path: file.fullPath,
    contentType: MIME_MAP[ext] || 'application/octet-stream', reason: 'transcode_disabled_raw',
    probe, probeMs, cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
  };
  stats.cacheMisses++;
  stats.requestsByAction.direct++;
  trackStartup(decision.totalMs);
  logDecision(log, file, decision);
  return decision;
}

async function handleRemux(file, probe, t0, probeMs) {
  const hash = computeCacheHash(file.fullPath, file.size, file.mtime);
  const cachedPath = join(PATHS.playbackRemux, `${hash}.mkv`);

  if (existsSync(cachedPath) && verifyIntegrity(cachedPath, 'remux')) {
    touchLRU(cachedPath, file.size);
    stats.cacheHits++;
    stats.requestsByAction.remux++;
    const decision = {
      action: 'remux', path: cachedPath, contentType: 'video/x-matroska',
      reason: 'opus_in_mp4_remux_cached', probe, probeMs,
      cacheHit: true, totalMs: Date.now() - t0, _t0: t0,
    };
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  }

  removeLRU(cachedPath);
  if (existsSync(cachedPath)) try { unlinkSync(cachedPath); } catch {}

  const jobKey = `remux:${hash}`;
  if (activeJobs.has(jobKey)) {
    const path = await activeJobs.get(jobKey);
    if (path && verifyIntegrity(path, 'remux_dedup')) {
      touchLRU(path, file.size);
      stats.cacheHits++;
      stats.requestsByAction.remux++;
      const decision = {
        action: 'remux', path, contentType: 'video/x-matroska',
        reason: 'opus_in_mp4_remux_dedup', probe, probeMs,
        cacheHit: true, totalMs: Date.now() - t0, _t0: t0,
      };
      trackStartup(decision.totalMs);
      logDecision(log, file, decision);
      return decision;
    }
  }

  const jobPromise = (async () => {
    if (shutdownRequested) throw new Error('shutdown requested — job rejected');
    const t1 = Date.now();
    const tmpPath = join(PATHS.playbackRemux, `${hash}.tmp.mkv`);
    await acquireFfmpegSlot();
    try {
      await remuxToMkv(file.fullPath, tmpPath);
      if (!verifyIntegrity(tmpPath, 'remux_tmp')) {
        try { unlinkSync(tmpPath); } catch {}
        throw new Error('remux output integrity check failed');
      }
      try { unlinkSync(cachedPath); } catch {}
      const { renameSync } = await import('node:fs');
      renameSync(tmpPath, cachedPath);
      const duration = Date.now() - t1;
      stats.totalRemuxes++;
      stats.totalRemuxMs += duration;
      logRemux(log, file, duration, false);
      return cachedPath;
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      stats.totalErrors++;
      logError(log, 'remux', err);
      throw err;
    } finally {
      releaseFfmpegSlot();
    }
  })();

  activeJobs.set(jobKey, jobPromise);
  try {
    const path = await jobPromise;
    touchLRU(path, file.size);
    stats.cacheMisses++;
    stats.requestsByAction.remux++;
    const decision = {
      action: 'remux', path, contentType: 'video/x-matroska',
      reason: 'opus_in_mp4_remux', probe, probeMs,
      cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
    };
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  } finally {
    activeJobs.delete(jobKey);
  }
}

async function handleTranscode(file, probe, t0, probeMs) {
  const hash = computeCacheHash(file.fullPath, file.size, file.mtime);
  const cachedPath = join(PATHS.playbackTranscode, `${hash}.mp4`);

  if (existsSync(cachedPath) && verifyIntegrity(cachedPath, 'transcode')) {
    touchLRU(cachedPath, file.size);
    stats.cacheHits++;
    stats.requestsByAction.transcode++;
    const decision = {
      action: 'transcode', path: cachedPath, contentType: 'video/mp4',
      reason: 'transcode_cached', probe, probeMs,
      cacheHit: true, totalMs: Date.now() - t0, _t0: t0,
    };
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  }

  removeLRU(cachedPath);
  if (existsSync(cachedPath)) try { unlinkSync(cachedPath); } catch {}

  const jobKey = `transcode:${hash}`;
  if (activeJobs.has(jobKey)) {
    const path = await activeJobs.get(jobKey);
    if (path && verifyIntegrity(path, 'transcode_dedup')) {
      touchLRU(path, file.size);
      stats.cacheHits++;
      stats.requestsByAction.transcode++;
      const decision = {
        action: 'transcode', path, contentType: 'video/mp4',
        reason: 'transcode_dedup', probe, probeMs,
        cacheHit: true, totalMs: Date.now() - t0, _t0: t0,
      };
      trackStartup(decision.totalMs);
      logDecision(log, file, decision);
      return decision;
    }
  }

const jobPromise = (async () => {
  if (shutdownRequested) throw new Error('shutdown requested — job rejected');
  const t1 = Date.now();
  const tmpPath = join(PATHS.playbackTranscode, `${hash}.tmp.mp4`);
    await acquireFfmpegSlot();
    try {
      await transcodeToH264Mp4(file.fullPath, tmpPath);
      if (!verifyIntegrity(tmpPath, 'transcode_tmp')) {
        try { unlinkSync(tmpPath); } catch {}
        throw new Error('transcode output integrity check failed');
      }
      try { unlinkSync(cachedPath); } catch {}
      const { renameSync } = await import('node:fs');
      renameSync(tmpPath, cachedPath);
      const duration = Date.now() - t1;
      stats.totalTranscodes++;
      stats.totalTranscodeMs += duration;
      return cachedPath;
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      stats.totalErrors++;
      logError(log, 'transcode', err);
      throw err;
    } finally {
      releaseFfmpegSlot();
    }
  })();

  activeJobs.set(jobKey, jobPromise);
  try {
    const path = await jobPromise;
    touchLRU(path, file.size);
    stats.cacheMisses++;
    stats.requestsByAction.transcode++;
    const decision = {
      action: 'transcode', path, contentType: 'video/mp4',
      reason: 'transcode_unsupported', probe, probeMs,
      cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
    };
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  } finally {
    activeJobs.delete(jobKey);
  }
}

async function handleFaststart(file, probe, t0, probeMs) {
  const hash = computeCacheHash(file.fullPath, file.size, file.mtime);
  const cachedPath = join(PATHS.playbackFaststart, `${hash}.mp4`);

  if (existsSync(cachedPath) && verifyIntegrity(cachedPath, 'faststart')) {
    touchLRU(cachedPath, file.size);
    stats.cacheHits++;
    stats.requestsByAction.faststart++;
    const decision = {
      action: 'faststart', path: cachedPath, contentType: 'video/mp4',
      reason: 'faststart_cached', probe, probeMs,
      cacheHit: true, totalMs: Date.now() - t0, _t0: t0,
      faststart: false, cacheAgeSeconds: cacheAgeSecondsOf(cachedPath),
    };
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  }

  removeLRU(cachedPath);
  if (existsSync(cachedPath)) try { unlinkSync(cachedPath); } catch {}

  const jobKey = `faststart:${hash}`;
  if (activeJobs.has(jobKey)) {
    const path = await activeJobs.get(jobKey);
    if (path && verifyIntegrity(path, 'faststart_dedup')) {
      touchLRU(path, file.size);
      stats.cacheHits++;
      stats.requestsByAction.faststart++;
      const decision = {
        action: 'faststart', path, contentType: 'video/mp4',
        reason: 'faststart_dedup', probe, probeMs,
        cacheHit: true, totalMs: Date.now() - t0, _t0: t0,
        faststart: false, cacheAgeSeconds: cacheAgeSecondsOf(path),
      };
      trackStartup(decision.totalMs);
      logDecision(log, file, decision);
      return decision;
    }
  }

  const jobPromise = (async () => {
    if (shutdownRequested) throw new Error('shutdown requested — job rejected');
    const t1 = Date.now();
    const tmpPath = join(PATHS.playbackFaststart, `${hash}.tmp.mp4`);
    await acquireFfmpegSlot();
    try {
      await faststartCopy(file.fullPath, tmpPath);
      if (!verifyIntegrity(tmpPath, 'faststart_tmp')) {
        try { unlinkSync(tmpPath); } catch {}
        throw new Error('faststart output integrity check failed');
      }
      try { unlinkSync(cachedPath); } catch {}
      const { renameSync } = await import('node:fs');
      renameSync(tmpPath, cachedPath);
      const duration = Date.now() - t1;
      stats.totalFaststarts++;
      stats.totalFaststartMs += duration;
      return cachedPath;
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      stats.totalErrors++;
      logError(log, 'faststart', err);
      throw err;
    } finally {
      releaseFfmpegSlot();
    }
  })();

  activeJobs.set(jobKey, jobPromise);
  try {
    const path = await jobPromise;
    touchLRU(path, file.size);
    stats.cacheMisses++;
    stats.requestsByAction.faststart++;
    const decision = {
      action: 'faststart', path, contentType: 'video/mp4',
      reason: 'faststart_remux', probe, probeMs,
      cacheHit: false, totalMs: Date.now() - t0, _t0: t0,
      faststart: false, cacheAgeSeconds: cacheAgeSecondsOf(path),
    };
    trackStartup(decision.totalMs);
    logDecision(log, file, decision);
    return decision;
  } finally {
    activeJobs.delete(jobKey);
  }
}

export function getHlsDecision(probe) {
  if (!probe) return { hlsAvailable: false, reason: 'no_probe' };
  const audioCodec = `${probe.audio_codec || ''}`.toLowerCase();
  if (audioCodec === 'opus' && !SETTINGS.audioSync) return { hlsAvailable: false, reason: 'opus_audio' };
  return { hlsAvailable: true, reason: 'compatible' };
}

export function cleanupCache() {
  const t0 = Date.now();
  const now = Date.now();
  let removedFiles = 0;
  let freedBytes = 0;
  let errors = 0;

  for (const dir of [PATHS.playbackRemux, PATHS.playbackTranscode, PATHS.playbackFaststart]) {
    let entries;
    try { entries = readdirSync(dir).map(f => join(dir, f)); } catch { continue; }

    for (const filePath of entries) {
      try {
        const st = statSync(filePath);
        const age = now - st.mtimeMs;
        if (age > SETTINGS.maxCacheAgeMs) {
          unlinkSync(filePath);
          removeLRU(filePath);
          removedFiles++;
          freedBytes += st.size;
        }
      } catch { errors++; }
    }
  }

  let totalSize = 0;
  const allFiles = [];
  for (const dir of [PATHS.playbackRemux, PATHS.playbackTranscode, PATHS.playbackFaststart]) {
    try {
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f);
        try {
          const st = statSync(fp);
          allFiles.push({ path: fp, size: st.size, mtime: st.mtimeMs });
        } catch {}
      }
    } catch {}
  }

  if (SETTINGS.lruEnabled) {
    allFiles.sort((a, b) => {
      const aLRU = lruMap.get(a.path)?.lastUsed || a.mtime;
      const bLRU = lruMap.get(b.path)?.lastUsed || b.mtime;
      return aLRU - bLRU;
    });
  } else {
    allFiles.sort((a, b) => a.mtime - b.mtime);
  }

  for (const entry of allFiles) {
    totalSize += entry.size;
    if (totalSize > SETTINGS.maxCacheSizeBytes) {
      try {
        unlinkSync(entry.path);
        removeLRU(entry.path);
        removedFiles++;
        freedBytes += entry.size;
      } catch { errors++; }
    }
  }

  stats.lastCleanup = Date.now();
  stats.nextCleanup = Date.now() + SETTINGS.cleanupIntervalMs;
  stats.evictions += removedFiles;
  stats.cleanupCount++;

  persistLRU();
  computeCacheTotals();

  const durationMs = Date.now() - t0;
  const result = { removedFiles, freedBytes, durationMs, errors };
  if (removedFiles > 0) {
    logCleanup(log, result);
  }
  return result;
}

function computeCacheTotals() {
  let count = 0, size = 0;
  let oldestMtime = Infinity;
  let newestMtime = 0;
  let largest = 0;
  let smallest = Infinity;
  for (const dir of [PATHS.playbackRemux, PATHS.playbackTranscode, PATHS.playbackFaststart]) {
    try {
      for (const f of readdirSync(dir)) {
        try {
          const st = statSync(join(dir, f));
          count++;
          size += st.size;
          if (st.mtimeMs < oldestMtime) oldestMtime = st.mtimeMs;
          if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs;
          if (st.size > largest) largest = st.size;
          if (st.size < smallest) smallest = st.size;
        } catch {}
      }
    } catch {}
  }
  stats.totalFilesCached = count;
  stats.totalBytesCached = size;
  stats.oldestCacheEntry = count > 0 ? oldestMtime : null;
  stats.newestCacheEntry = count > 0 ? newestMtime : null;
  stats.largestCachedFile = count > 0 ? largest : 0;
  stats.smallestCachedFile = count > 0 && smallest < Infinity ? smallest : 0;
  stats.avgCachedFileSize = count > 0 ? +(size / count).toFixed(0) : 0;
}

export function getCacheStats() {
  let remuxCount = 0, remuxSize = 0;
  let transcodeCount = 0, transcodeSize = 0;
  let faststartCount = 0, faststartSize = 0;

  try {
    for (const f of readdirSync(PATHS.playbackRemux)) {
      try { const st = statSync(join(PATHS.playbackRemux, f)); remuxCount++; remuxSize += st.size; } catch {}
    }
  } catch {}
  try {
    for (const f of readdirSync(PATHS.playbackTranscode)) {
      try { const st = statSync(join(PATHS.playbackTranscode, f)); transcodeCount++; transcodeSize += st.size; } catch {}
    }
  } catch {}
  try {
    for (const f of readdirSync(PATHS.playbackFaststart)) {
      try { const st = statSync(join(PATHS.playbackFaststart, f)); faststartCount++; faststartSize += st.size; } catch {}
    }
  } catch {}

  return {
    remux: { count: remuxCount, sizeBytes: remuxSize, sizeMB: +(remuxSize / 1024 / 1024).toFixed(1) },
    transcode: { count: transcodeCount, sizeBytes: transcodeSize, sizeMB: +(transcodeSize / 1024 / 1024).toFixed(1) },
    faststart: { count: faststartCount, sizeBytes: faststartSize, sizeMB: +(faststartSize / 1024 / 1024).toFixed(1) },
    activeJobs: activeJobs.size,
  };
}

function percentiles(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

export function getPlaybackStats() {
  computeCacheTotals();
  const cache = getCacheStats();
  const startupArr = stats.recentStartupMs;
  return {
    cache,
    hits: stats.cacheHits,
    misses: stats.cacheMisses,
    hitRate: stats.cacheHits + stats.cacheMisses > 0
    ? +(stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100).toFixed(1)
    : 0,
    evictions: stats.evictions,
    cleanupCount: stats.cleanupCount,
    oldestCacheEntry: stats.oldestCacheEntry,
    newestCacheEntry: stats.newestCacheEntry,
    largestCachedFile: stats.largestCachedFile,
    smallestCachedFile: stats.smallestCachedFile,
    avgCachedFileSize: stats.avgCachedFileSize,
    integrityFails: stats.integrityFails,
    totalRemuxes: stats.totalRemuxes,
    totalTranscodes: stats.totalTranscodes,
    totalFaststarts: stats.totalFaststarts,
    totalRequests: stats.totalRequests,
    totalErrors: stats.totalErrors,
    avgRemuxMs: stats.totalRemuxes > 0 ? +(stats.totalRemuxMs / stats.totalRemuxes).toFixed(0) : 0,
    avgTranscodeMs: stats.totalTranscodes > 0 ? +(stats.totalTranscodeMs / stats.totalTranscodes).toFixed(0) : 0,
    avgFaststartMs: stats.totalFaststarts > 0 ? +(stats.totalFaststartMs / stats.totalFaststarts).toFixed(0) : 0,
    avgProbeMs: stats.probeCount > 0 ? +(stats.totalProbeMs / stats.probeCount).toFixed(0) : 0,
    fastestStartupMs: stats.fastestStartupMs === Infinity ? 0 : stats.fastestStartupMs,
    slowestStartupMs: stats.slowestStartupMs,
    p50StartupMs: percentiles(startupArr, 50),
    p95StartupMs: percentiles(startupArr, 95),
    p99StartupMs: percentiles(startupArr, 99),
    requestsByAction: { ...stats.requestsByAction },
    lastCleanup: stats.lastCleanup,
    nextCleanup: stats.nextCleanup,
    maxAvDriftMs: avDriftStore.maxAvDriftMs,
    avDriftLastMeasuredAt: avDriftStore.lastMeasuredAt,
    avDriftLastFileId: avDriftStore.lastFileId,
    audioSync: SETTINGS.audioSync,
    uptime: Date.now() - stats.startTime,
  };
}

export function getPlaybackConfig() {
  return {
    cacheRoot: PATHS.cacheRoot,
    remuxDir: PATHS.playbackRemux,
    transcodeDir: PATHS.playbackTranscode,
    faststartDir: PATHS.playbackFaststart,
    hlsCacheDir: PATHS.hls,
    logDir: PATHS.logsPlayback,
    maxCacheSizeGB: +(SETTINGS.maxCacheSizeBytes / 1024 / 1024 / 1024).toFixed(1),
    maxCacheAgeDays: +(SETTINGS.maxCacheAgeMs / (24 * 60 * 60 * 1000)).toFixed(0),
    cleanupIntervalHours: +(SETTINGS.cleanupIntervalMs / (60 * 60 * 1000)).toFixed(0),
    probeTimeoutMs: SETTINGS.probeTimeoutMs,
    lruEnabled: SETTINGS.lruEnabled,
    logLevel: SETTINGS.logLevel,
  };
}

export function getActiveJobs() {
  return { remux: activeJobs.size };
}

export function shutdown() {
  persistLRU();
}
