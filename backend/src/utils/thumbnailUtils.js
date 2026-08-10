import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config/paths.js';

const VAAPI_DEVICE = existsSync('/dev/dri/renderD128') ? '/dev/dri/renderD128' : null;
const HWACCEL = VAAPI_DEVICE ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE] : [];
export const VAAPI_AVAILABLE = !!VAAPI_DEVICE;

export async function hasEmbeddedCover(inputPath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      inputPath,
    ];

    let stdout = '';
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk) => { stdout += chunk; });

    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const data = JSON.parse(stdout);
        const coverStream = data.streams?.find((s) =>
          s.codec_type === 'video' &&
          (s.disposition?.attached_pic === 1 || s.codec_name === 'mjpeg' || s.codec_name === 'png')
        );
        resolve(coverStream || null);
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

export async function extractEmbeddedThumbnail(inputPath, outputPath) {
  return new Promise((resolve) => {
    const args = [
      '-i', inputPath,
      '-map', '0:v:0',
      '-c', 'copy',
      '-frames:v', '1',
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stderr.on('data', () => {});

    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function extractFrameThumbnail(inputPath, outputPath, quality = 12) {
  return new Promise((resolve) => {
    // VAAPI: hardware decode + software scale/encode (reliable)
    // Non-VAAPI: skip_frame nokey for faster keyframe extraction
    const baseArgs = VAAPI_DEVICE
      ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE]
      : ['-skip_frame', 'nokey'];

    const args = [
      ...baseArgs,
      '-ss', '1.0',
      '-i', inputPath,
      '-vframes', '1',
      '-vf', 'scale=200:-1:flags=fast_bilinear',
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-q:v', String(quality),
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else if (VAAPI_DEVICE) {
        // VAAPI failed, fallback to pure software
        const fallback = spawn('ffmpeg', [
          '-ss', '1.0',
          '-i', inputPath,
          '-vframes', '1',
          '-vf', 'scale=200:-1:flags=fast_bilinear',
          '-f', 'image2',
          '-c:v', 'mjpeg',
          '-q:v', String(quality),
          '-y',
          outputPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        fallback.on('close', (c) => resolve(c === 0));
        fallback.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    });

    proc.on('error', () => resolve(false));
  });
}

export async function generateImageThumbnail(inputPath, outputPath, quality = 10) {
  return new Promise((resolve) => {
    const args = [
      '-i', inputPath,
      '-vf', 'scale=200:-1:flags=fast_bilinear',
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-q:v', String(quality),
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stderr.on('data', () => {});

    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function generateAudioPlaceholder(outPath) {
  return new Promise((resolve) => {
    const args = [
      '-f', 'lavfi',
      '-i', 'color=c=#2a1a3a:s=300x300:d=1',
      '-vf', 'drawtext=text=♪:fontcolor=#a78bfa:fontsize=80:x=(w-text_w)/2:y=(h-text_h)/2',
      '-frames:v', '1',
      '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '6', '-y', outPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export const THUMBNAIL_DIR = PATHS.thumbnails;

export function getThumbPath(id) {
  if (!id || id.length < 6) {
    return join(THUMBNAIL_DIR, id + '.jpg');
  }
  return join(THUMBNAIL_DIR, id.slice(0, 2), id.slice(2, 4), id.slice(4, 6), id + '.jpg');
}
