import { execFile, execFileSync } from 'node:child_process';
import db from '../db.js';
import { YTDLP_RESILIENT_ARGS } from './ytdlp.js';
import { mkdir, readFile, writeFile, unlink, stat, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, unlinkSync, accessSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CACHE_DIR = join(PROJECT_ROOT, 'cache', 'videos');

// In-memory progress tracking
const downloadProgress = {};

// In-flight download promises keyed by youtubeId. Reusing one in-flight
// download prevents two concurrent yt-dlp runs from racing on the same
// fragment (.part) files, which causes "Unable to rename file" errors.
const activeDownloads = new Map();

// In-flight optimization promises keyed by youtubeId. Prevents two concurrent
// ffmpeg runs from racing on the same raw file when building the .seek.mp4 copy.
const activeOptimizations = new Map();

// One-time probe for the short-GOP re-encode encoder. Prefer the iGPU (VAAPI /
// AMD) when the render node is present and ffmpeg exposes `h264_vaapi`; fall
// back to CPU `libx264` otherwise. The GPU path keeps the box responsive during
// `optimizeAllCached` and on-demand re-encodes (Task 1).
function detectReencodeCodec() {
  const hasVaapiDevice = (() => {
    try { accessSync('/dev/dri/renderD128'); return true; } catch { return false; }
  })();
  if (hasVaapiDevice) {
    try {
      const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 5000 }).toString();
      if (out.includes('h264_vaapi')) return 'vaapi';
    } catch {}
  }
  return 'cpu';
}
const REENCODE_CODEC = detectReencodeCodec();
const VAAPI_DEVICE = '/dev/dri/renderD128';

// Does any audio file linked to this youtube_id carry a non-zero video offset?
// Only those videos need a short-GOP re-encode so Chromium doesn't show decode
// artifacts when seeking to a non-keyframe position. Offset-0 videos keep the
// cheap copy+faststart path.
function hasNonZeroOffset(youtubeId) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM files WHERE youtube_id = ? AND video_offset > 0').get(youtubeId);
    return !!(row && row.c > 0);
  } catch {
    return false;
  }
}

// Guard against operating on mangled/non-canonical ids (e.g. a filename base
// like "<id>.sgop"). YouTube ids are 11 chars of [A-Za-z0-9_-].
function isValidYoutubeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cleanupPartialFiles(youtubeId) {
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.startsWith(youtubeId));
    for (const f of files) {
      try { unlinkSync(join(CACHE_DIR, f)); } catch {}
    }
  } catch {}
}

export function getCachedVideoPath(youtubeId) {
  const sgop = join(CACHE_DIR, `${youtubeId}.sgop.mp4`);
  const seek = join(CACHE_DIR, `${youtubeId}.seek.mp4`);
  const mp4 = join(CACHE_DIR, `${youtubeId}.mp4`);
  const m4a = join(CACHE_DIR, `${youtubeId}.m4a`);
  // Videos with a non-zero offset are served the short-GOP copy (re-encoded to
  // land seeks near a keyframe); fall back to the copy+faststart file until the
  // upgrade exists. Offset-0 videos use the cheap copy+faststart file.
  const wantSgop = hasNonZeroOffset(youtubeId);
  if (wantSgop) {
    if (existsSync(sgop)) return sgop;
    if (existsSync(seek)) return seek;
  } else {
    if (existsSync(seek)) return seek;
    if (existsSync(sgop)) return sgop;
  }
  if (existsSync(mp4)) return mp4;
  if (existsSync(m4a)) return m4a;
  return null;
}

export function getDownloadProgress(id) {
  return downloadProgress[id];
}

// Remux into a web-seekable copy. By default this is a COPY-ONLY remux
// (`+faststart` moves the `moov` atom to the front so the browser can seek
// immediately; keyframe structure preserved, no re-encode, seconds of CPU).
// When `shortGop` is true we instead RE-ENCODE with a short, strictly-periodic
// GOP for videos that carry a non-zero video_offset (see hasNonZeroOffset) —
// Chromium shows stale/green-frame artifacts seeking to a non-keyframe on
// long-GOP files, and a short GOP makes every seek land near a keyframe.
// Writes to a temp file, then atomically renames.
async function remuxForWeb(inputPath, outputPath, shortGop = false) {
  const tmpPath = `${outputPath}.remux.tmp.mp4`;
  try {
    // `-y` first. The VAAPI device + hwaccel are INPUT options and MUST precede
    // `-i` (ffmpeg rejects them after it); the encoder options go after `-i`.
    const args = ['-y'];
    if (shortGop && REENCODE_CODEC === 'vaapi') {
      args.push(
        '-vaapi_device', VAAPI_DEVICE,
        '-hwaccel', 'vaapi',
        '-hwaccel_output_format', 'vaapi'
      );
    }
    args.push('-i', inputPath);
    if (shortGop) {
      // Short, strictly-periodic GOP (keyframe ~every second) so every Chromium
      // seek lands near a keyframe. Audio copied (no re-encode). Encoder: iGPU
      // VAAPI when available, else CPU libx264 (both keep the same GOP params).
      if (REENCODE_CODEC === 'vaapi') {
        // AMD VAAPI driver supports CQP/CBR/VBR/QVBR but NOT ICQ; CQP (constant
        // QP) is the closest constant-quality analog to libx264 -crf 20.
        args.push(
          '-c:v', 'h264_vaapi',
          '-rc_mode', 'CQP', '-qp', '20',
          '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
          '-c:a', 'copy'
        );
      } else {
        args.push(
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
          '-pix_fmt', 'yuv420p', '-c:a', 'copy'
        );
      }
    } else {
      args.push('-c', 'copy');
    }
    args.push('-movflags', '+faststart', tmpPath);
    await runFfmpeg(args);
    await unlink(outputPath).catch(() => {});
    await rename(tmpPath, outputPath);
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    throw e;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 600000 }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

// Confirm the optimized file is actually playable/seekable (video stream
// present and ffprobe can read it). Non-fatal: caller keeps the raw fallback.
async function verifySeekable(filePath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
      filePath,
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve((stdout || '').split('\n').some(l => l.trim() === 'video'));
    });
  });
}

// Produce (once) the web-seekable `<id>.seek.mp4` for a cached clip via a
// copy-only faststart remux (no re-encode). New downloads call this right
// after yt-dlp; already-cached raw files get it lazily on first stream and
// proactively on startup (optimizeAllCached). After a successful verify, the
// raw `<id>.mp4` is removed so storage stays ~1x (the remuxed copy is canonical).
export async function ensureSeekable(youtubeId) {
  // Defensive: never operate on a mangled id (a bad glob once passed
  // "<id>.sgop" here, which deleted the real short-GOP file).
  if (!isValidYoutubeId(youtubeId)) return null;
  // Offset-0 videos keep the cheap copy+faststart file; offset>0 videos get a
  // short-GOP re-encode so Chromium seeks cleanly. Pick the target up front so
  // we can early-return when the right copy already exists.
  const wantSgop = hasNonZeroOffset(youtubeId);
  const targetPath = join(CACHE_DIR, `${youtubeId}.${wantSgop ? 'sgop' : 'seek'}.mp4`);
  if (existsSync(targetPath)) return targetPath;
  if (activeOptimizations.has(youtubeId)) return activeOptimizations.get(youtubeId);

  const run = async () => {
    const rawPath = join(CACHE_DIR, `${youtubeId}.mp4`);
    // Source: the raw download if still present, else the other cached copy
    // (e.g. re-encode short-GOP from an existing copy+faststart file).
    let srcPath = existsSync(rawPath) ? rawPath : null;
    if (!srcPath) {
      const other = wantSgop
        ? join(CACHE_DIR, `${youtubeId}.seek.mp4`)
        : join(CACHE_DIR, `${youtubeId}.sgop.mp4`);
      srcPath = existsSync(other) ? other : null;
    }
    if (!srcPath) return null; // audio-only (.m4a) or nothing
    try {
      await remuxForWeb(srcPath, targetPath, wantSgop);
      const ok = await verifySeekable(targetPath);
      if (ok) {
        // Keep BOTH variant files: a shared YouTube ID can legitimately need
        // `<id>.seek.mp4` (offset-0 track) AND `<id>.sgop.mp4` (offset>0 track)
        // on disk at the same time. Deleting the sibling variant was the root
        // cause of the "video tiba2 hilang" bug (one track's file vanished when
        // the other track's copy was built). Only drop the raw download (if it
        // still exists) so storage stays ~1x.
        await unlink(rawPath).catch(() => {});
        console.log(`[videoCache] ${youtubeId}: ${wantSgop ? `re-encoded short-GOP (${REENCODE_CODEC}, offset>0)` : 'remuxed copy+faststart'}`);
      } else {
        console.warn(`[videoCache] ${youtubeId}: ${wantSgop ? 'short-GOP' : 'copy'} not seekable, keeping fallback`);
        await unlink(targetPath).catch(() => {});
      }
    } catch (e) {
       console.error(`[videoCache] ${youtubeId}: ${wantSgop ? `short-GOP re-encode (${REENCODE_CODEC})` : 'remux'} failed: ${e.message}`);
      await unlink(targetPath).catch(() => {});
    }
    return existsSync(targetPath) ? targetPath : null;
  };

  const promise = run().finally(() => { activeOptimizations.delete(youtubeId); });
  activeOptimizations.set(youtubeId, promise);
  return promise;
}

// Proactively remux every cached raw `<id>.mp4` that lacks a `<id>.seek.mp4`.
// Fire-and-forget on server startup so every play already serves a faststart
// copy (no green frame, no offset-seek blank wait). Concurrency-limited so the
// startup sweep never saturates the box. Idempotent: files already having a
// `.seek.mp4` are skipped, and `ensureSeekable` guards in-flight duplicates.
// GPU (VAAPI) sessions are cheap; concurrency stays at 2. If GPU contention is
// observed (frames dropping on multiple simultaneous re-encodes), drop to 1.
export async function optimizeAllCached(concurrency = 2) {
  ensureCacheDir();
  let ids;
  try {
    const files = await readdir(CACHE_DIR);
    // An id is "already optimized" if EITHER a `.seek.mp4` or a `.sgop.mp4`
    // copy exists. We must strip both suffixes so a short-GOP file
    // `<id>.sgop.mp4` is never mistaken for a raw `<id>.mp4` download (that bug
    // produced a bogus id "<id>.sgop", then ensureSeekable deleted the real
    // short-GOP file → cache miss → unwanted re-download on the next play).
    const doneIds = new Set();
    for (const f of files) {
      if (f.endsWith('.seek.mp4')) doneIds.add(f.slice(0, -'.seek.mp4'.length));
      else if (f.endsWith('.sgop.mp4')) doneIds.add(f.slice(0, -'.sgop.mp4'.length));
    }
    ids = files
      // Only genuine raw downloads: `<id>.mp4` (NOT `.seek.mp4`/`.sgop.mp4`),
      // never `.m4a`/`.part`/`.tmp` siblings.
      .filter(f => f.endsWith('.mp4') && !f.endsWith('.seek.mp4') && !f.endsWith('.sgop.mp4'))
      .map(f => f.slice(0, -'.mp4'.length))
      .filter(id => !doneIds.has(id) && isValidYoutubeId(id));
  } catch {
    return;
  }
  if (!ids.length) return;

  console.log(`[videoCache] optimizeAllCached: remuxing ${ids.length} cached video(s)...`);
  let index = 0;
  const worker = async () => {
    while (index < ids.length) {
      const id = ids[index++];
      try {
        await ensureSeekable(id);
      } catch (e) {
        console.error(`[videoCache] optimizeAllCached ${id}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  console.log('[videoCache] optimizeAllCached: done');
}

export async function downloadVideo(youtubeId, onProgress, force = false, formatStr = null) {
  ensureCacheDir();
  const outputPath = join(CACHE_DIR, `${youtubeId}.mp4`);

  // If a download for this id is already running, reuse it instead of
  // starting a second concurrent yt-dlp process (which races on the same
  // .part fragment files and fails with "Unable to rename file").
  if (activeDownloads.has(youtubeId)) {
    return activeDownloads.get(youtubeId);
  }

  const run = async () => {
    // Strong redownload guard: if ANY cached copy already exists on disk
    // (`.seek.mp4`, `.sgop.mp4`, raw `.mp4`, or `.m4a`), never re-fetch from
    // YouTube. This is the safety net behind the route's cache check so a
    // stale/edge-case path decision can't trigger an unwanted re-download.
    if (!force) {
      const existing = getCachedVideoPath(youtubeId);
      if (existing) {
        // Make sure the optimized web-seekable copy exists too, then return it.
        const optimized = await ensureSeekable(youtubeId);
        downloadProgress[youtubeId] = 'cached';
        onProgress?.(100);
        return optimized || existing;
      }
    }
    if (existsSync(outputPath) && !force) {
      // Already downloaded; make sure the optimized, web-seekable copy exists too.
      const optimized = await ensureSeekable(youtubeId);
      downloadProgress[youtubeId] = 'cached';
      onProgress?.(100);
      return optimized || outputPath;
    }
    if (force) {
      await unlink(outputPath).catch(() => {});
      await unlink(join(CACHE_DIR, `${youtubeId}.seek.mp4`)).catch(() => {});
    }

    // Cleanup stale partial files from previous failed attempts
    cleanupPartialFiles(youtubeId);
    downloadProgress[youtubeId] = 0;

    // Default format chain when no explicit selector is provided
    const defaultFormatStr = [
      "bestvideo[height<=1080][vcodec~='^avc1']+bestaudio[ext=m4a]",
      "bestvideo[height<=1080][vcodec~='^avc1']+bestaudio",
      "bestvideo[height<=1080]+bestaudio",
      "best[height<=1080]",
      "best"
    ].join('/');
    const chosenFormat = formatStr && formatStr.trim() ? formatStr.trim() : defaultFormatStr;

    let lastErr;
    // Retry once: transient .part rename failures usually succeed on retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          const args = [
            '-f', chosenFormat,
            '--merge-output-format', 'mp4',
            '--no-warnings',
            '--no-playlist',
            '--no-check-certificate',
            '--no-cache-dir',
            ...YTDLP_RESILIENT_ARGS,
            '-o', outputPath,
            `https://youtube.com/watch?v=${youtubeId}`,
          ];

          const proc = execFile('yt-dlp', args, { timeout: 600000 }, async (err) => {
            if (err) {
              reject(new Error(`Download failed: ${err.message}`));
              return;
            }
            try {
              const optimized = await ensureSeekable(youtubeId);
              downloadProgress[youtubeId] = 'cached';
              resolve(optimized || outputPath);
            } catch (e) {
              console.error(`[videoCache] ${youtubeId}: optimize failed, serving raw: ${e.message}`);
              downloadProgress[youtubeId] = 'cached';
              resolve(outputPath);
            }
          });

          proc.stderr?.on('data', (data) => {
            const text = data.toString();
            const match = text.match(/(\d+\.?\d*)%/);
            if (match) {
              const prog = parseFloat(match[1]);
              downloadProgress[youtubeId] = prog;
              onProgress?.(prog);
            }
          });
          proc.stdout?.on('data', () => {});
        });
        return outputPath;
      } catch (e) {
        lastErr = e;
        downloadProgress[youtubeId] = 'error';
        cleanupPartialFiles(youtubeId);
      }
    }
    throw lastErr || new Error('Download failed');
  };

  const promise = run().finally(() => { activeDownloads.delete(youtubeId); });
  activeDownloads.set(youtubeId, promise);
  return promise;
}

export async function searchVideo(query, count = 5) {
  return new Promise((resolve) => {
    const args = [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      `--playlist-end=${count}`,
      `ytsearch${count}:${query}`,
    ];
    execFile('yt-dlp', args, { timeout: 15000 }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const results = stdout.trim().split('\n').filter(Boolean).map(line => {
        try {
          const data = JSON.parse(line);
          return {
            id: data.id,
            title: data.title || '',
            channel: data.channel || data.uploader || '',
            duration: data.duration || 0,
            thumbnail: `https://i.ytimg.com/vi/${data.id}/mqdefault.jpg`,
          };
        } catch { return null; }
      }).filter(Boolean);
      resolve(results);
    });
  });
}

export async function getCacheInfo() {
  ensureCacheDir();
  try {
    const files = await readdir(CACHE_DIR);
    let totalSize = 0;
    const ids = new Set(); // dedupe: a video may have .seek.mp4 AND .sgop.mp4
    for (const f of files) {
      const known = ['.sgop.mp4', '.seek.mp4', '.mp4', '.m4a', '.part'].some(s => f.endsWith(s));
      if (!known) continue;
      let id = f;
      for (const suf of ['.sgop.mp4', '.seek.mp4', '.mp4', '.m4a', '.part']) {
        if (id.endsWith(suf)) { id = id.slice(0, -suf.length); break; }
      }
      ids.add(id);
      try { totalSize += (await stat(join(CACHE_DIR, f))).size; } catch {}
    }
    return { totalFiles: ids.size, totalSize, cacheDir: CACHE_DIR };
  } catch {
    return { totalFiles: 0, totalSize: 0, cacheDir: CACHE_DIR };
  }
}

export async function clearCache() {
  ensureCacheDir();
  try {
    const files = await readdir(CACHE_DIR);
    for (const f of files) {
      if (f.endsWith('.mp4') || f.endsWith('.m4a') || f.endsWith('.part')) {
        await unlink(join(CACHE_DIR, f)).catch(() => {});
      }
    }
    return true;
  } catch { return false; }
}

export async function deleteVideo(youtubeId) {
  ensureCacheDir();
  if (!youtubeId) return false;
  try {
    const files = await readdir(CACHE_DIR);
    let removed = 0;
    for (const f of files) {
      if (f.startsWith(youtubeId)) {
        await unlink(join(CACHE_DIR, f)).catch(() => {});
        removed++;
      }
    }
    downloadProgress[youtubeId] = 'not_cached';
    return removed > 0;
  } catch { return false; }
}
