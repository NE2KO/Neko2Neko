import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { getFileWithRelPath } from './fileResolver.js';

// Canonical codec vocabulary — kept in sync with backend/src/utils/fileScanner.js.
// The WhatsApp contract is whole-media: H.264 video AND (when present) AAC audio.
const VIDEO_CANON = {
  h264: 'h264', avc1: 'h264', avc3: 'h264',
  hevc: 'hevc', h265: 'hevc', hev1: 'hevc', hvc1: 'hevc',
  av1: 'av1', av01: 'av1',
  vp9: 'vp9', vp09: 'vp9', vp8: 'vp8',
  mpeg4: 'mpeg4', mpeg2video: 'mpeg2', mjpeg: 'mjpeg',
};
const AUDIO_CANON = {
  aac: 'aac', mp4a: 'aac',
  opus: 'opus',
  mp3: 'mp3', mp3float: 'mp3',
  ac3: 'ac3', eac3: 'eac3', 'ac-3': 'ac3',
  vorbis: 'vorbis', flac: 'flac',
  pcm_s16le: 'pcm', pcm_s24le: 'pcm', pcm_s32le: 'pcm', pcm_f32le: 'pcm',
  alac: 'alac', amr_nb: 'amr', amr_wb: 'amr',
};
const WA_VIDEO_OK = new Set(['h264', 'avc1', 'avc3']);

function normalizeVideoCodec(name) {
  return VIDEO_CANON[(name || '').toLowerCase()] || (name || '').toLowerCase() || 'unknown';
}
function normalizeAudioCodec(name) {
  return AUDIO_CANON[(name || '').toLowerCase()] || (name || '').toLowerCase() || '';
}
function isWaAudioOk(audioCodec) {
  return !audioCodec || audioCodec === 'aac' || audioCodec === 'mp4a';
}

// ── iGPU / VAAPI detection ──
// WhatsApp-targeted transcodes MUST use the Intel iGPU (VAAPI) for the video
// re-encode. If no render node / VAAPI is available we cannot fix non-H.264
// video, so those items are reported as permanently unfixable.
let _vaapiDevice = null;
let _vaapiChecked = false;
function detectVaapiDevice() {
  if (_vaapiChecked) return _vaapiDevice;
  _vaapiChecked = true;
  try {
    const dir = '/dev/dri';
    if (existsSync(dir)) {
      const nodes = readdirSync(dir)
        .filter((n) => /^renderD\d+$/.test(n))
        .sort();
      for (const n of nodes) {
        const dev = join(dir, n);
        const r = spawnSync('ffmpeg', ['-hide_banner', '-init_hw_device', `vaapi=va:${dev}`], {
          stdio: 'ignore',
          timeout: 5000,
        });
        if (r.status === 0) {
          _vaapiDevice = dev;
          break;
        }
      }
    }
  } catch {
    _vaapiDevice = null;
  }
  return _vaapiDevice;
}
export function isVaapiAvailable() {
  return detectVaapiDevice() !== null;
}

// ── ffprobe ──
function probeStreams(filePath) {
  try {
    const r = spawnSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_entries', 'stream=codec_type,codec_name', filePath],
      { encoding: 'utf-8', timeout: 20000 }
    );
    if (r.status !== 0) return null;
    const data = JSON.parse(r.stdout || '{}');
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    return {
      videoCodec: normalizeVideoCodec(video?.codec_name || ''),
      audioCodec: normalizeAudioCodec(audio?.codec_name || ''),
    };
  } catch {
    return null;
  }
}

function refreshCodecInfo(fileId, filePath) {
  const probe = probeStreams(filePath);
  if (!probe) return null;
  db.prepare('UPDATE files SET codec_info = ? WHERE id = ?').run(JSON.stringify(probe), fileId);
  return probe;
}

function getCacheDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', '..', 'data', 'wa_cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    ff.on('error', (e) => reject(e));
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))
    );
  });
}

// Returns the path to send to WhatsApp.
//   { path, transcoded:false }                          → original already compatible
//   { path, transcoded:true, cached?:true }             → iGPU/audio-fixed copy
// Throws with a "Media gagal diproses WA:" message for permanently unfixable media
// (matched by isPermanentMediaError so it is NOT retried forever).
export async function getWaSendPath(fileId) {
  const file = getFileWithRelPath(fileId);
  if (!file || !file.fullPath) throw new Error('File not found');
  const src = file.fullPath;
  if (!existsSync(src)) throw new Error(`File tidak ditemukan di disk: ${src}`);

  // Ensure we have codec info; re-probe unprobed rows lazily.
  let ci = null;
  try {
    const row = db.prepare('SELECT codec_info FROM files WHERE id = ?').get(fileId);
    if (row && row.codec_info) ci = JSON.parse(row.codec_info);
  } catch {}
  if (!ci || !ci.videoCodec) ci = refreshCodecInfo(fileId, src);
  if (!ci) throw new Error('Media gagal diproses WA: tidak dapat membaca codec');

  const videoCodec = (ci.videoCodec || '').toLowerCase();
  const audioCodec = (ci.audioCodec || '').toLowerCase();

  // No video stream (image/audio) → WhatsApp handles it directly.
  if (!videoCodec) return { path: src, transcoded: false };

  const videoNeeds = !WA_VIDEO_OK.has(videoCodec);
  const audioNeeds = !!audioCodec && !isWaAudioOk(audioCodec);

  if (!videoNeeds && !audioNeeds) return { path: src, transcoded: false };

  if (videoNeeds && !isVaapiAvailable()) {
    throw new Error(
      `Media gagal diproses WA: video ${videoCodec} butuh transcode tapi iGPU/VAAPI tidak tersedia`
    );
  }

  const outPath = join(getCacheDir(), `${fileId}.mp4`);

  // Reuse a cached, still-valid transcode.
  try {
    if (existsSync(outPath) && statSync(outPath).mtimeMs >= statSync(src).mtimeMs) {
      const v = probeStreams(outPath);
      if (v && v.videoCodec === 'h264' && (!v.audioCodec || isWaAudioOk(v.audioCodec))) {
        return { path: outPath, transcoded: true, cached: true };
      }
    }
  } catch {}

  const args = ['-i', src];
  if (videoNeeds) {
    // Non-H.264 video → re-encode on the iGPU with a low QP (high quality,
    // size close to source). Audio re-encoded to AAC alongside it.
    args.push('-vaapi_device', detectVaapiDevice(), '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', '18');
  } else {
    // H.264 video with incompatible audio (e.g. Opus) → COPY video (zero quality
    // loss, no size bloat) and only re-encode the audio track to AAC.
    args.push('-c:v', 'copy');
  }
  args.push('-c:a', 'aac', '-b:a', '192k', outPath);

  try {
    await runFfmpeg(args);
  } catch (err) {
    throw new Error(`Transcode gagal: ${err.message || err}`);
  }

  const v = probeStreams(outPath);
  if (!v || v.videoCodec !== 'h264' || (v.audioCodec && !isWaAudioOk(v.audioCodec))) {
    throw new Error(
      `Media gagal diproses WA: hasil transcode masih tidak kompatibel (${v ? `${v.videoCodec}/${v.audioCodec}` : 'unknown'})`
    );
  }

  // Stamp mtime so the cache-reuse check stays valid on the next send.
  try {
    const s = statSync(src);
    utimesSync(outPath, s.atimeMs, s.mtimeMs);
  } catch {}
  return { path: outPath, transcoded: true };
}
