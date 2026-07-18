import { spawn } from 'node:child_process';

// Shared, cycle-free store for the most recently measured A/V drift so it can
// be surfaced by getPlaybackStats() without importing hlsGenerator (which
// imports playbackEngine).
export const avDriftStore = {
  maxAvDriftMs: 0,
  lastMeasuredAt: 0,
  lastFileId: null,
};

export function recordAvDrift(fileId, skewMs) {
  avDriftStore.maxAvDriftMs = Math.round(skewMs);
  avDriftStore.lastMeasuredAt = Date.now();
  avDriftStore.lastFileId = fileId;
}

// Measure the audio/video drift of a media file via ffprobe.
// Reports the start-time offset between the first video and first audio
// stream plus the end-of-file skew, so we can confirm A/V sync after a
// transcode/re-encode.
export function measureAvDrift(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,start_time,duration',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf-8', timeout: 15000 });
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('close', () => {
      try {
        const data = JSON.parse(stdout || '{}');
        const streams = data.streams || [];
        const video = streams.find(s => s.codec_type === 'video');
        const audio = streams.find(s => s.codec_type === 'audio');
        if (!video || !audio) {
          resolve({ available: false, reason: 'missing_stream', skewMs: 0 });
          return;
        }
        const vStart = parseFloat(video.start_time || '0') * 1000;
        const aStart = parseFloat(audio.start_time || '0') * 1000;
        const vEnd = (parseFloat(video.start_time || '0') + parseFloat(video.duration || '0')) * 1000;
        const aEnd = (parseFloat(audio.start_time || '0') + parseFloat(audio.duration || '0')) * 1000;
        const startSkewMs = Math.abs(vStart - aStart);
        const endSkewMs = Math.abs(vEnd - aEnd);
        // The A/V *offset* (start skew) is the meaningful sync metric. End skew
        // computed from per-segment durations is noisy (keyframe/segment
        // rounding) and not a real accumulated drift, so it is informational
        // only. Use start skew as the trigger for the strict re-encode.
        const skewMs = startSkewMs;
        resolve({ available: true, startSkewMs, endSkewMs, skewMs });
      } catch {
        resolve({ available: false, reason: 'parse_error', skewMs: 0 });
      }
    });
    proc.on('error', () => resolve({ available: false, reason: 'spawn_error', skewMs: 0 }));
  });
}
