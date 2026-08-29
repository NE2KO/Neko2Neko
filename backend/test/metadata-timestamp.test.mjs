import { statSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = '/tmp/metadata-cover-test';
const PYTHON = 'python3';
const EMBED_SCRIPT = join(__dirname, '..', 'src', 'utils', 'embed_cover.py');

function ensureDir() {
  try { execSync(`mkdir -p "${SAMPLE_DIR}"`); } catch {}
}

function makeSample(name, ffmpegArgs) {
  const out = join(SAMPLE_DIR, name);
  try { execSync(`ffmpeg -f lavfi -i "sine=frequency=440:duration=1" ${ffmpegArgs} "${out}" -y`, { stdio: 'pipe', timeout: 30000 }); } catch {}
  return out;
}

function snapshot(path) {
  const s = statSync(path);
  return {
    ino: s.ino,
    size: s.size,
    birth: s.birthtimeMs,
    mtime: s.mtimeMs,
    atime: s.atimeMs,
  };
}

function embedViaScript(filePath, imagePath, mimeType) {
  execSync(`"${PYTHON}" "${EMBED_SCRIPT}" "${filePath}" "${imagePath}" "${mimeType}"`, { stdio: 'pipe', timeout: 120000 });
}

async function embedViaJS(filePath, imageBuffer, mimeType) {
  const { embedCover } = await import('../src/utils/metadataWriter.js');
  return embedCover(filePath, imageBuffer, mimeType);
}

async function run() {
  ensureDir();

  const imagePath = join(SAMPLE_DIR, 'cover.jpg');
  try {
    execSync(`python3 -c "from PIL import Image; Image.new('RGB',(64,64),'red').save('${imagePath}')"`, { stdio: 'pipe', timeout: 10000 });
  } catch {
    execSync(`convert -size 64x64 xc:red "${imagePath}"`, { stdio: 'pipe', timeout: 10000 });
  }

  const cases = [
    { name: 'sample.mp3',  ffmpeg: '-c:a libmp3lame -q:a 9',  via: 'py' },
    { name: 'sample.m4a',  ffmpeg: '-c:a aac -b:a 64k',      via: 'py' },
    { name: 'sample.flac', ffmpeg: '-c:a flac',               via: 'py' },
    { name: 'sample.opus', ffmpeg: '-c:a libopus -b:a 64k',   via: 'py' },
    { name: 'sample.ogg',  ffmpeg: '-c:a libvorbis -q:a 3',  via: 'py' },
    { name: 'sample.webm', ffmpeg: '-c:a libopus -b:a 64k -f webm', via: 'js' },
  ];

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const filePath = makeSample(c.name, c.ffmpeg);
    const before = snapshot(filePath);
    const imageBuffer = readFileSync(imagePath);

    try {
      if (c.via === 'py') {
        embedViaScript(filePath, imagePath, 'image/jpeg');
      } else if (c.via === 'js') {
        await embedViaJS(filePath, imageBuffer, 'image/jpeg');
      }
    } catch (e) {
      console.error(`\n❌ ${c.name}: embed failed: ${e.message}`);
      failed++;
      continue;
    }

    const after = snapshot(filePath);

    // Mutagen-based formats: inode, birth, and mtime must be preserved.
    // WebM uses ffmpeg + renameSync, which creates a new inode. On Linux,
    // birth time cannot be restored after inode replacement via utimesSync.
    // The only invariant we can enforce for WebM is mtime restoration.
    const isWebM = c.name.toLowerCase().endsWith('.webm');
    const inodeOk = isWebM ? before.ino !== after.ino : before.ino === after.ino;
    const birthOk = isWebM ? before.birth !== after.birth : before.birth === after.birth;
    const mtimeOk = Math.abs(before.mtime - after.mtime) < 1000;
    const sizeOk = after.size > 0;

    const expected = isWebM
      ? 'inode_changed birth_changed mtime_restored'
      : 'inode_same birth_same mtime_same';

    if (inodeOk && birthOk && mtimeOk && sizeOk) {
      console.log(`✅ ${c.name} [${expected}]: inode=${inodeOk} birth=${birthOk} mtime=${mtimeOk} size=${sizeOk}`);
      passed++;
    } else {
      console.log(`❌ ${c.name} [${expected}]: inode=${inodeOk} birth=${birthOk} mtime=${mtimeOk} size=${sizeOk}`);
      console.log(`   before: ino=${before.ino} birth=${before.birth} mtime=${before.mtime}`);
      console.log(`   after:  ino=${after.ino} birth=${after.birth} mtime=${after.mtime}`);
      failed++;
    }

    try { unlinkSync(filePath); } catch {}
  }

  try { unlinkSync(imagePath); } catch {}
  try { execSync(`rmdir "${SAMPLE_DIR}" 2>/dev/null`); } catch {}

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
