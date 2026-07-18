const Database = require('better-sqlite3');
const db = new Database('/home/CATIAA/homelab-media-server/data/media.db');

// Check what normPath produces for these collision tracks
const MEDIA_ROOT = ['/home/CATIAA/homelab'];
const commonParent = '/home/CATIAA/homelab';

function normPath(p) {
  if (!p) return '';
  if (commonParent && p.startsWith(commonParent + '/')) return p.substring(commonParent.length + 1);
  return p;
}

// Get tracks that have collision filenames
const tracks = db.prepare(`
  SELECT pt.resolved_path, pt.file_exists 
  FROM playlist_tracks pt 
  WHERE pt.playlist_id = 556
`).all();

// Check the 24 collision tracks
let mismatchCount = 0;
for (const t of tracks) {
  if (!t.resolved_path) continue;
  const fname = t.resolved_path.split('/').pop();
  const allFiles = db.prepare('SELECT f.id, f.name, fo.path FROM files f JOIN folders fo ON f.dir_id = fo.id WHERE f.name = ?').all(fname);
  if (allFiles.length <= 1) continue;
  
  const norm = normPath(t.resolved_path);
  const dbPaths = allFiles.map(f => f.path + '/' + f.name);
  const match = dbPaths.includes(norm);
  
  if (!match) {
    mismatchCount++;
    console.log('\nNO MATCH for:', t.resolved_path);
    console.log('  normPath:', norm);
    console.log('  DB paths:', dbPaths);
  }
}

console.log('\nTotal mismatches (normPath fails):', mismatchCount);
console.log('Total collision tracks:', tracks.filter(t => {
  if (!t.resolved_path) return false;
  const fname = t.resolved_path.split('/').pop();
  return db.prepare('SELECT COUNT(*) as cnt FROM files f JOIN folders fo ON f.dir_id = fo.id WHERE f.name = ?').get(fname)?.cnt > 1;
}).length);

db.close();
