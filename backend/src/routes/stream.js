import { Router } from 'express';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getFileWithRelPath } from '../utils/fileResolver.js';
import { getHLSLatestPlaylist, startHLSGeneration, getSegment, getHLSSegmentCount, isHLSReady } from '../utils/hlsGenerator.js';
import { getPlaybackDecision, getHlsDecision, getCacheStats } from '../utils/playbackEngine.js';
import { get } from '../utils/runtimeSettings.js';
import { PATHS } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('stream');

const router = Router();

const MIME_CACHE = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.hevc': 'application/octet-stream',
  '.h265': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
};

router.get('/video/:id/playback-info', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') return res.status(404).json({ error: 'Video not found' });

    const decision = await getPlaybackDecision(file);
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

    res.json({
      action: decision.action,
      reason: decision.reason,
      contentType: decision.contentType,
      probe: decision.probe,
      probeMs: decision.probeMs,
      cacheHit: decision.cacheHit,
      totalMs: decision.totalMs,
      sizeMB: file.size / (1024 * 1024),
      isMobile,
      extension: file.ext,
    });
} catch (err) {
  log.error({ msg: 'playback-info failed', error: err.message });
  res.status(500).json({ error: 'Playback info failed' });
  }
});

router.get('/video/:id', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') {
      return res.status(404).json({ error: 'Video not found' });
    }

    const decision = await getPlaybackDecision(file);
    res.set({
      'Content-Type': decision.contentType,
      'Accept-Ranges': 'bytes',
      'X-Playback-Action': decision.action,
      'X-Playback-Reason': decision.reason,
    });

  res.sendFile(decision.path, {
    acceptRanges: true,
    cacheControl: false,
    headers: {
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      'X-Playback-Action': decision.action,
      'X-Playback-Reason': decision.reason,
    },
  });
} catch (err) {
  log.error({ msg: 'video stream error', error: err.message });
  if (!res.headersSent) res.status(500).end();
}
});

router.get('/audio/:id', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'audio') return res.status(404).json({ error: 'Audio not found' });

    res.set('Content-Type', MIME_CACHE[file.ext] || 'audio/mpeg');

  res.sendFile(file.fullPath, {
    acceptRanges: true,
    cacheControl: false,
    headers: {
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
    },
  });
} catch (err) {
  log.error({ msg: 'audio stream error', error: err.message });
  if (!res.headersSent) res.status(500).end();
}
});

router.get('/video/:id/hls/playlist.m3u8', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') return res.status(404).json({ error: 'Video not found' });

    // HLS requires re-encoding for incompatible codecs — only offer it when
    // transcoding is enabled, otherwise fall back to the raw direct stream.
    if (!get('serve.transcode', false)) {
      return res.status(404).json({
        error: 'HLS disabled (transcoding off)',
        reason: 'transcode_disabled',
        fallback: `/stream/video/${file.id}`,
      });
    }

    const probe = (await getPlaybackDecision(file)).probe;
    const hlsCheck = getHlsDecision(probe);

    if (!hlsCheck.hlsAvailable) {
      return res.status(404).json({
        error: 'HLS not available',
        reason: hlsCheck.reason,
        fallback: `/stream/video/${file.id}`,
      });
    }

    startHLSGeneration(file.id, file.fullPath, file.mtime);

    for (let i = 0; i < 50; i++) {
      if (getHLSSegmentCount(file.id) >= 3) break;
      if (isHLSReady(file.id, file.mtime)) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const playlist = getHLSLatestPlaylist(file.id, file.mtime);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
  res.send(playlist);
} catch (err) {
  log.error({ msg: 'HLS playlist failed', error: err.message });
  if (!res.headersSent) res.status(500).end();
}
});

router.get('/video/:id/hls/segment-:segment(\\d+).ts', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') return res.status(404).json({ error: 'Video not found' });

    const segmentIdx = parseInt(req.params.segment, 10);
    const segPath = await getSegment(file.id, file.fullPath, file.mtime, segmentIdx);

    res.set({
      'Content-Type': 'video/MP2T',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });
  res.sendFile(segPath);
} catch (err) {
  log.error({ msg: 'HLS segment failed', error: err.message });
  if (!res.headersSent) res.status(500).end();
}
});

router.get('/video/:id/compatibility', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') return res.status(404).json({ error: 'Video not found' });

    const decision = await getPlaybackDecision(file);
    const ext = file.ext?.toLowerCase();
    const sizeMB = file.size / (1024 * 1024);
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isFirefox = /Firefox/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isChrome = /Chrome/.test(userAgent);

    const notes = [];
    if (decision.action === 'direct') notes.push('Direct browser playback');
    else if (decision.action === 'remux') notes.push('Remuxed to MKV (Opus audio in MP4, no re-encode)');
    else if (decision.action === 'transcode') notes.push(`Transcoded to H.264/AAC (${decision.reason})`);
    notes.push(`Probe completed in ${decision.probeMs}ms`);
    if (decision.cacheHit) notes.push('Served from cache');

    if (isFirefox && sizeMB > 2000) notes.push(`Firefox has issues with MP4 files >2GB (${sizeMB.toFixed(0)}MB detected)`);
    if (sizeMB > 4000) notes.push(`Large file (${sizeMB.toFixed(0)}MB) may cause browser memory issues`);

    const probe = decision.probe;
    res.json({
      action: decision.action,
      compatible: decision.action === 'direct',
      cached: decision.cacheHit,
      heuristic: !file.codec_info,
      size_mb: sizeMB,
      extension: ext,
      codec: probe?.video_codec || '',
      codec_tag: probe?.video_codec_tag || '',
      width: probe?.width || 0,
      height: probe?.height || 0,
      device: isMobile ? 'mobile' : 'desktop',
      browser: isFirefox ? 'firefox' : isChrome ? 'chrome' : isSafari ? 'safari' : 'other',
      cache: getCacheStats(),
      notes,
    });
} catch (err) {
  log.error({ msg: 'compatibility check failed', error: err?.message || err });
  res.status(500).json({ error: 'Compatibility check failed' });
}
});

const WEBM_CACHE = new Map();

router.get('/video/:id/webm', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') {
      return res.status(404).json({ error: 'Video not found' });
    }
    const sizeMB = file.size / (1024 * 1024);
    const isFirefox = /Firefox/.test(req.headers['user-agent'] || '');
    if (!isFirefox && sizeMB <= 2000) {
       return res.status(400).json({ error: 'WebM transcoding only needed for Firefox or large files' });
    }
    const cacheKey = `${file.id}-${file.mtime}`;
    const cachedPath = WEBM_CACHE.get(cacheKey);
    if (cachedPath) {
      const st = await stat(cachedPath).catch(() => null);
      if (st) {
        res.set('Content-Type', 'video/webm');
        return res.sendFile(cachedPath, {
          acceptRanges: true,
          cacheControl: false,
          headers: { 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' },
        });
      }
    }
const outputPath = join(PATHS.playbackTranscode, `${file.id}.webm`);
log.info({ msg: 'Starting WebM transcoding', file: file.name });
await transcodeToWebM(file.fullPath, outputPath);
WEBM_CACHE.set(cacheKey, outputPath);
res.set('Content-Type', 'video/webm');
res.sendFile(outputPath, {
      acceptRanges: true,
      cacheControl: false,
      headers: { 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' },
    });
} catch (err) {
  log.error({ msg: 'WebM transcode failed', error: err.message });
  if (!res.headersSent) res.status(500).json({ error: 'Transcoding failed: ' + err.message });
}
});

const FASTSTART_CACHE = new Map();

router.get('/video/:id/faststart', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file || file.type !== 'video') {
      return res.status(404).json({ error: 'Video not found' });
    }

    const cacheKey = `${file.id}-${file.mtime}-faststart`;
    const cachedPath = FASTSTART_CACHE.get(cacheKey);
    if (cachedPath) {
      const st = await stat(cachedPath).catch(() => null);
      if (st) {
        res.set('Content-Type', 'video/mp4');
        return res.sendFile(cachedPath, {
          acceptRanges: true,
          cacheControl: false,
          headers: { 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' },
        });
      }
    }

const outputPath = join(PATHS.playbackTranscode, `${file.id}-faststart.mp4`);
log.info({ msg: 'Fixing moov atom (faststart)', file: file.name });
    await faststartToMp4(file.fullPath, outputPath);
    FASTSTART_CACHE.set(cacheKey, outputPath);
    res.set('Content-Type', 'video/mp4');
    res.sendFile(outputPath, {
      acceptRanges: true,
      cacheControl: false,
      headers: { 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' },
    });
} catch (err) {
  log.error({ msg: 'faststart failed', error: err.message });
  if (!res.headersSent) res.status(500).json({ error: 'Faststart failed: ' + err.message });
}
});

function faststartToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-f', 'mp4',
      '-y',
      outputPath
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`faststart failed: ${stderr}`));
    });
    ffmpeg.on('error', reject);
  });
}

function transcodeToWebM(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-fflags', '+genpts',
      '-i', inputPath,
      '-c:v', 'libvpx-vp9',
      '-crf', '30',
      '-b:v', '0',
      '-b:a', '128k',
      '-af', 'aresample=async=1:first_pts=0',
      '-f', 'webm',
      outputPath
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg failed: ${stderr}`));
    });
    ffmpeg.on('error', reject);
  });
}

export default router;
