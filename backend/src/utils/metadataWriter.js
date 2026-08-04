import { parseFile, selectCover } from 'music-metadata';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readMetadata(filePath) {
  try {
    const metadata = await parseFile(filePath, { duration: true });
    const common = metadata.common || {};
    const format = metadata.format || {};
    
    return {
      title: common.title || null,
      artist: common.artist || null,
      album: common.album || null,
      genre: common.genre?.[0] || null,
      year: common.year || null,
      track: common.track?.no || null,
      disk: common.disk?.no || null,
      duration: format.duration || null,
      bitrate: format.bitrate || null,
      codec: format.codec || null,
      hasCover: !!(common.picture && common.picture.length > 0),
      cover: common.picture?.[0] || null,
    };
  } catch (err) {
    console.error('[metadataWriter] readMetadata error:', err.message);
    return null;
  }
}

export async function extractCover(filePath) {
  try {
    const metadata = await parseFile(filePath);
    const pic = selectCover(metadata.common.picture);
    if (!pic) return null;
    return {
      format: pic.format,
      data: pic.data,
    };
  } catch (err) {
    console.error('[metadataWriter] extractCover error:', err.message);
    return null;
  }
}

export async function writeMetadata(filePath, updates) {
  // For now, we use a read-modify-write approach with music-metadata
  // This works for most formats but may not preserve all tags
  // A production version would use a format-specific writer
  
  const ext = extname(filePath).toLowerCase();
  const isFLAC = ext === '.flac';
  const isMP3 = ext === '.mp3';
  const isOGG = ext === '.ogg' || ext === '.opus';
  
  // Read current metadata
  const current = await readMetadata(filePath);
  if (!current) throw new Error('Failed to read current metadata');
  
  // Merge updates
  const merged = { ...current, ...updates };
  
  // We'll store the metadata in DB and use ffmpeg for embedding when needed
  // For now, return the merged data for DB storage
  return {
    title: merged.title,
    artist: merged.artist,
    album: merged.album,
    genre: merged.genre,
  };
}

export async function embedCover(filePath, imageBuffer, mimeType) {
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');

  const ext = extname(filePath).toLowerCase();
  const mimeExt = (mimeType || '').split('/').pop()?.split(';')[0]?.trim() || 'bin';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(mimeExt) ? mimeExt : 'bin';
  const tmpFile = join(tmpdir(), `cover_${Date.now()}.${safeExt}`);

  try {
    writeFileSync(tmpFile, imageBuffer);

    if (ext === '.flac') {
      const pyScript = join(dirname(fileURLToPath(import.meta.url)), 'embed_cover.py');
      execSync(`python3 "${pyScript}" "${filePath}" "${tmpFile}" "${mimeType}"`, { stdio: 'pipe', timeout: 120000 });
    } else if (ext === '.mp3') {
      const outTmp = `${filePath}.tmp.mp3`;
      const ffmpegArgs = `-i "${filePath}" -i "${tmpFile}" -map 0:a -map 1:0 -c copy -id3v2_version 3 -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "${outTmp}"`;
      execSync(`ffmpeg -y ${ffmpegArgs}`, { stdio: 'pipe', timeout: 120000 });
      const { renameSync } = await import('node:fs');
      renameSync(outTmp, filePath);
    } else if (ext === '.ogg' || ext === '.opus') {
      const pyScript = join(dirname(fileURLToPath(import.meta.url)), 'embed_cover.py');
      execSync(`python3 "${pyScript}" "${filePath}" "${tmpFile}" "${mimeType}"`, { stdio: 'pipe', timeout: 120000 });
    } else if (ext === '.m4a') {
      const outTmp = `${filePath}.tmp.m4a`;
      const ffmpegArgs = `-i "${filePath}" -i "${tmpFile}" -map 0:a -map 1:0 -c:a copy -c:v mjpeg -q:v 2 -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" -disposition:v:0 attached_pic "${outTmp}"`;
      execSync(`ffmpeg -y ${ffmpegArgs}`, { stdio: 'pipe', timeout: 120000 });
      const { renameSync } = await import('node:fs');
      renameSync(outTmp, filePath);
    } else if (ext === '.webm') {
      const outTmp = `${filePath}.tmp`;
      const ffmpegArgs = `-i "${filePath}" -i "${tmpFile}" -map 0:a -map 1:0 -c:a copy -c:v libvpx-vp9 -deadline realtime -cpu-used 5 -f webm "${outTmp}"`;
      execSync(`ffmpeg -y ${ffmpegArgs}`, { stdio: 'pipe', timeout: 120000 });
      const { renameSync } = await import('node:fs');
      renameSync(outTmp, filePath);
    } else {
      throw new Error(`Unsupported format for cover embedding: ${ext}`);
    }

    return true;
  } catch (err) {
    console.error('[metadataWriter] embedCover error:', err.message);
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(`${filePath}.tmp`); } catch {}
    try { unlinkSync(`${filePath}.tmp.mp3`); } catch {}
    throw err;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}
