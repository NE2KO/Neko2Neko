import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getHlsDecision } from './playbackEngine.js';
import { PATHS, SETTINGS } from '../config/paths.js';
import { createLogger } from './logger.js';
import { measureAvDrift, recordAvDrift } from './avSync.js';

const log = createLogger('hls');
const HLS_DIR = PATHS.hls;
mkdirSync(HLS_DIR, { recursive: true });
const runningJobs = new Map();
const SEGMENT_DURATION = 3;

function getWorkDir(fileId) {
  const dir = join(HLS_DIR, fileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function getPlaylistPath(fileId) {
  return join(getWorkDir(fileId), 'playlist.m3u8');
}
function getSegmentPath(fileId, idx) {
  return join(getWorkDir(fileId), `segment-${idx}.ts`);
}
function listSegments(fileId) {
  const dir = getWorkDir(fileId);
  try {
    return readdirSync(dir)
      .filter(f => f.startsWith('segment-') && f.endsWith('.ts'))
      .map(f => parseInt(f.match(/segment-(\d+)/)[1], 10))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}
function buildPlaylist(fileId, totalSegments, done) {
  let pl = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${SEGMENT_DURATION}\n#EXT-X-MEDIA-SEQUENCE:0\n`;
  for (let i = 0; i < totalSegments; i++) {
    pl += `#EXTINF:${SEGMENT_DURATION}.000,\nsegment-${i}.ts\n`;
  }
  if (done) pl += '#EXT-X-ENDLIST\n';
  return pl;
}
function getExistingSegmentCount(fileId) {
  return listSegments(fileId).length;
}

async function remuxFaststart(inputPath) {
  const outputPath = join(PATHS.temp, `faststart-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', '-y', outputPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve(outputPath);
      else {
        try { unlinkSync(outputPath); } catch {}
        reject(new Error(`faststart failed: ${stderr.slice(-200)}`));
      }
    });
    ff.on('error', err => {
      try { unlinkSync(outputPath); } catch {}
      reject(err);
    });
  });
}

function isMoovError(stderr) {
  return stderr.includes('moov atom') || stderr.includes('Invalid data found when processing input');
}

async function probeAudioCodec(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath,
    ], { encoding: 'utf-8', timeout: 10000 });
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('close', () => resolve(stdout.trim().toLowerCase()));
    proc.on('error', () => resolve(''));
  });
}

async function probeVideoCodec(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath,
    ], { encoding: 'utf-8', timeout: 10000 });
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('close', () => resolve(stdout.trim().toLowerCase()));
    proc.on('error', () => resolve(''));
  });
}

function spawnFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.slice(-300)));
    });
    ff.on('error', reject);
  });
}

export function isHLSReady(fileId, mtime) {
  const job = runningJobs.get(`${fileId}-${mtime}`);
  return job ? job.done : false;
}

export function getHLSLatestPlaylist(fileId, mtime) {
  const idx = getExistingSegmentCount(fileId);
  const hasPlaylist = existsSync(getPlaylistPath(fileId));
  if (hasPlaylist) {
    let pl = readFileSync(getPlaylistPath(fileId), 'utf-8');
    const job = mtime ? runningJobs.get(`${fileId}-${mtime}`) : null;
    if (job?.done && !pl.includes('#EXT-X-ENDLIST')) {
      pl += '#EXT-X-ENDLIST\n';
    }
    return pl;
  }
  const job = mtime ? runningJobs.get(`${fileId}-${mtime}`) : null;
  return buildPlaylist(fileId, idx, job?.done || false);
}

function buildHlsArgs(inputPath, workDir, playlistPath, { sync, strict }) {
  if (!sync) {
    return [
      '-i', inputPath, '-c', 'copy', '-f', 'hls',
      '-hls_time', String(SEGMENT_DURATION), '-hls_list_size', '0',
      '-hls_segment_filename', join(workDir, 'segment-%d.ts'),
      playlistPath,
    ];
  }
  return [
    '-fflags', '+genpts',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', strict ? 'medium' : SETTINGS.hlsPreset,
    '-crf', String(SETTINGS.hlsCrf),
    '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-af', strict ? 'aresample=async=1000:first_pts=0' : 'aresample=async=1:first_pts=0',
    '-f', 'hls',
    '-hls_time', String(SEGMENT_DURATION),
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(workDir, 'segment-%d.ts'),
    playlistPath,
  ];
}

async function generateHlsSegments(filePath, workDir, playlistPath, { sync, strict }) {
  const ffmpegArgs = buildHlsArgs(filePath, workDir, playlistPath, { sync, strict });
  try {
    await spawnFfmpeg(ffmpegArgs);
  } catch (err) {
    if (isMoovError(err.message)) {
      log.info({ msg: 'moov atom issue, remuxing with faststart' });
      const remuxed = await remuxFaststart(filePath);
      try {
        ffmpegArgs[ffmpegArgs.indexOf(filePath)] = remuxed;
        await spawnFfmpeg(ffmpegArgs);
      } finally {
        try { unlinkSync(remuxed); } catch {}
      }
    } else {
      throw err;
    }
  }
}

function clearSegments(fileId) {
  for (const idx of listSegments(fileId)) {
    try { unlinkSync(getSegmentPath(fileId, idx)); } catch {}
  }
}

export function startHLSGeneration(fileId, filePath, mtime) {
  const cacheKey = `${fileId}-${mtime}`;

  if (runningJobs.has(cacheKey)) {
    const existing = runningJobs.get(cacheKey);
    if (existing.done || existing.generating) return existing;
  }

  const existingSegments = getExistingSegmentCount(fileId);
  if (existingSegments > 0) {
    const result = { done: true, cacheKey, fileId, filePath, mtime, inputPath: filePath };
    runningJobs.set(cacheKey, result);
    log.info({ msg: 'using cached segments', fileId, count: existingSegments });
    return result;
  }

  const workDir = getWorkDir(fileId);
  const playlistPath = getPlaylistPath(fileId);

  const job = {
    generating: true, done: false, inputPath: filePath,
    abort: () => {},
    promise: (async () => {
      try {
        log.info({ msg: 'starting background generation', fileId });
        const audioCodec = await probeAudioCodec(filePath);
        const hasOpus = audioCodec === 'opus';

        // When sync correction is OFF, keep legacy behavior: skip HLS for
        // Opus audio (the player falls back to the direct stream). With sync
        // ON we re-encode Opus -> AAC so HLS works and stays in sync.
        if (!SETTINGS.audioSync && hasOpus) {
          log.info({ msg: 'Opus audio — HLS sync disabled, skipping', fileId });
          job.done = true;
          job.generating = false;
          runningJobs.set(cacheKey, job);
          return;
        }

        // Only re-encode when actually required for playback or for sync:
        //  - HEVC / VP9 / other codecs the browser can't play in HLS must be
        //    transcoded to H.264.
        //  - Opus audio (with audio-sync ON) must be re-encoded to AAC.
        // H.264/AAC (the common case) is just split with `-c copy`, which is
        // near-instant and avoids re-transcoding every video on every play.
        const videoCodec = await probeVideoCodec(filePath);
        const needsVideoTranscode = !/^(avc1|h264)$/.test(videoCodec || '');
        const doSync = (SETTINGS.audioSync && hasOpus) || needsVideoTranscode;
        const sync = doSync;
        let strict = false;

        const doGenerate = async () => {
          clearSegments(fileId);
          await generateHlsSegments(filePath, workDir, playlistPath, { sync, strict });
        };

        await doGenerate();

        if (SETTINGS.audioSync) {
          const seg0 = getSegmentPath(fileId, 0);
          if (existsSync(seg0)) {
            const drift = await measureAvDrift(seg0);
            if (drift.available) {
              log.info({
                msg: 'av drift measured', fileId,
                maxAvDriftMs: Math.round(drift.skewMs),
                startSkewMs: Math.round(drift.startSkewMs),
                endSkewMs: Math.round(drift.endSkewMs),
              });
              recordAvDrift(fileId, drift.skewMs);
              // Re-encode strictly only when we are already transcoding (Opus or
              // unsupported video codec). A plain H.264 `-c copy` never seeks
              // back to a slow transcode for minor drift — the runtime rate-based
              // watchdog corrects small A/V drift live.
              if (doSync && !strict && drift.skewMs > SETTINGS.maxAvDriftMs) {
                strict = true;
                log.info({
                  msg: 'av drift exceeds threshold, re-encoding strict', fileId,
                  maxAvDriftMs: Math.round(drift.skewMs), threshold: SETTINGS.maxAvDriftMs,
                });
                await doGenerate();
                const seg0b = getSegmentPath(fileId, 0);
                if (existsSync(seg0b)) {
                  const drift2 = await measureAvDrift(seg0b);
                  if (drift2.available) {
                    log.info({
                      msg: 'av drift measured (strict retry)', fileId,
                      maxAvDriftMs: Math.round(drift2.skewMs),
                    });
                  }
                }
              }
            }
          }
        }

        job.done = true;
        runningJobs.set(cacheKey, job);
        log.info({ msg: 'generation complete', fileId, segments: getExistingSegmentCount(fileId) });
      } catch (err) {
        log.error({ msg: 'background job failed', fileId, error: err.message });
        job.generating = false;
      }
    })(),
  };

  job.abort = () => {};
  job.promise.catch(() => {});
  runningJobs.set(cacheKey, job);
  return job;
}

export function getHLSJob(fileId, mtime) {
  return runningJobs.get(`${fileId}-${mtime}`) || null;
}

export async function generateSegmentOnDemand(fileId, inputPath, segmentIdx) {
  const segPath = getSegmentPath(fileId, segmentIdx);
  if (existsSync(segPath)) return segPath;

  const seekTime = segmentIdx * SEGMENT_DURATION;

  const tryGenerate = (input) =>
    spawnFfmpeg([
      '-ss', String(seekTime), '-i', input,
      '-c', 'copy', '-t', String(SEGMENT_DURATION),
      '-avoid_negative_ts', '1', '-f', 'mpegts', '-y', segPath,
    ]);

  try {
    await tryGenerate(inputPath);
    return segPath;
  } catch (err) {
    if (isMoovError(err.message)) {
      log.info({ msg: 'moov atom issue on segment-on-demand, remuxing', fileId });
      const remuxed = await remuxFaststart(inputPath);
      try {
        await tryGenerate(remuxed);
        return segPath;
      } finally {
        try { unlinkSync(remuxed); } catch {}
      }
    }
    throw err;
  }
}

export async function getSegment(fileId, filePath, mtime, segmentIdx) {
  const segPath = getSegmentPath(fileId, segmentIdx);
  if (existsSync(segPath)) return segPath;

  const job = getHLSJob(fileId, mtime);
  const inputPath = job?.inputPath || filePath;

  if (job && (job.generating || job.done)) {
    if (segmentIdx <= getExistingSegmentCount(fileId) + 2) {
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (existsSync(segPath)) return segPath;
        if (segmentIdx <= getExistingSegmentCount(fileId)) return segPath;
      }
    }
  }

  return generateSegmentOnDemand(fileId, inputPath, segmentIdx);
}

export function getHLSSegmentCount(fileId) {
  return getExistingSegmentCount(fileId);
}

export function cleanupHLS(fileId) {
  const dir = getWorkDir(fileId);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
