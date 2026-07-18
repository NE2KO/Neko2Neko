import { Router } from 'express';
import mpd from 'mpd2';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const router = Router();

let client = null;

async function getClient() {
  if (!client) {
    client = await mpd.connect({ host: 'localhost', port: 6600 });
    client.on('close', () => { client = null; });
  }
  return client;
}

async function mpdSend(cmd) {
  const c = await getClient();
  return c.sendCommand(cmd);
}

function parseStatus(raw) {
  if (!raw || raw === 'OK') return {};
  const s = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf(': ');
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 2);
    if (k === 'volume') s.volume = parseInt(v) || 0;
    else if (k === 'state') s.state = v;
    else if (k === 'time') {
      const p = v.split(':');
      s.elapsed = parseInt(p[0]) || 0;
      s.totalTime = parseInt(p[1]) || 0;
    }
    else if (k === 'elapsed') s.elapsed = parseFloat(v) || 0;
    else if (k === 'duration') s.duration = parseFloat(v) || 0;
    else if (k === 'bitrate') s.bitrate = parseInt(v) || 0;
    else if (k === 'repeat') s.repeat = v === '1';
    else if (k === 'random') s.random = v === '1';
    else if (k === 'single') s.single = v === '1';
    else if (k === 'consume') s.consume = v === '1';
    else if (k === 'playlistlength') s.playlistLength = parseInt(v) || 0;
    else if (k === 'updating_db') s.updatingDb = parseInt(v) || 0;
    else if (k === 'song') s.song = parseInt(v) || 0;
    else if (k === 'songid') s.songId = parseInt(v) || 0;
  }
  return s;
}

function parseSong(raw) {
  if (!raw || raw === 'OK') return null;
  const s = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf(': ');
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 2);
    if (k === 'file') s.file = v;
    else if (k === 'Title') s.title = v;
    else if (k === 'Artist') s.artist = v;
    else if (k === 'Album') s.album = v;
    else if (k === 'AlbumArtist') s.albumArtist = v;
    else if (k === 'Track') s.track = parseInt(v) || 0;
    else if (k === 'Date') s.date = v;
    else if (k === 'Genre') s.genre = v;
    else if (k === 'Duration') s.duration = parseFloat(v) || 0;
    else if (k === 'time') s.time = parseInt(v) || 0;
    else if (k === 'Pos') s.pos = parseInt(v) || 0;
    else if (k === 'Id') s.id = parseInt(v) || 0;
    else if (k === 'Last-Modified') s.lastModified = v;
    else if (k === 'Format') s.format = v;
    else if (k === 'Composer') s.composer = v;
  }
  
  if (!s.file) return null;
  
  // Add fallback display name from filename if title is missing
  if (!s.title && s.file) {
    const fileName = s.file.split('/').pop() || s.file;
    s.displayName = fileName.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  
  if (s.duration === 0 && s.time) s.duration = s.time;
  return s;
}

function parseSongList(raw) {
  if (!raw || raw === 'OK') return [];
  const songs = [];
  let cur = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith('file: ')) {
      if (cur.file) songs.push(cur);
      cur = {};
    }
    const i = line.indexOf(': ');
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 2);
    if (k === 'file') cur.file = v;
    else if (k === 'Title') cur.title = v;
    else if (k === 'Artist') cur.artist = v;
    else if (k === 'Album') cur.album = v;
    else if (k === 'AlbumArtist') cur.albumArtist = v;
    else if (k === 'Track') cur.track = parseInt(v) || 0;
    else if (k === 'Date') cur.date = v;
    else if (k === 'Genre') cur.genre = v;
    else if (k === 'Duration') cur.duration = parseFloat(v) || 0;
    else if (k === 'time') cur.time = parseInt(v) || 0;
    else if (k === 'Pos') cur.pos = parseInt(v) || 0;
    else if (k === 'Id') cur.id = parseInt(v) || 0;
    else if (k === 'Last-Modified') cur.lastModified = v;
    else if (k === 'Format') cur.format = v;
  }
  if (!cur.title && cur.file) {
  const fn = cur.file.split('/').pop() || cur.file;
  cur.displayName = fn.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (cur.file) songs.push(cur);
 return songs;
}

function parseKeyValueList(raw, key) {
  if (!raw || raw === 'OK') return [];
  const items = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(key + ': ')) items.push(line.slice(key.length + 2));
  }
  return items;
}

// === PLAYBACK ===

router.get('/player/status', async (req, res) => {
  try {
    const [statusRaw, csRaw] = await Promise.all([
      mpdSend('status'),
      mpdSend('currentsong'),
    ]);
    const status = parseStatus(statusRaw);
    const cs = parseSong(csRaw);

    let loopMode = 'off';
    if (status.repeat && status.single) loopMode = 'one';
    else if (status.repeat) loopMode = 'all';

    res.json({
      playing: status.state === 'play',
      paused: status.state === 'paused',
      title: cs?.title || '',
      artist: cs?.artist || '',
      album: cs?.album || '',
      albumArtist: cs?.albumArtist || '',
      url: cs?.file || '',
      artUrl: cs?.file ? `/api/strawberry/cover?file=${encodeURIComponent(cs.file)}` : null,
      trackId: String(cs?.id || ''),
      duration: cs?.duration || status.duration || 0,
      position: status.elapsed || 0,
      volume: status.volume,
      shuffle: status.random,
      loopMode,
      bitrate: status.bitrate,
      track: cs?.track || 0,
      date: cs?.date || '',
      genre: cs?.genre || '',
      format: cs?.format || '',
      playlistLength: status.playlistLength || 0,
      updatingDb: status.updatingDb || 0,
      activePlaylist: null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/player/play', async (req, res) => {
  try { await mpdSend('play'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/pause', async (req, res) => {
  try { await mpdSend('pause 1'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/playPause', async (req, res) => {
  try {
    const raw = await mpdSend('status');
    const s = parseStatus(raw);
    if (s.state === 'playing') {
      await mpdSend('pause 1');
    } else if (s.state === 'paused') {
      await mpdSend('play');
    } else {
      await mpdSend('play');
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/stop', async (req, res) => {
  try { await mpdSend('stop'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/next', async (req, res) => {
  try { await mpdSend('next'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/previous', async (req, res) => {
  try { await mpdSend('previous'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/seek', async (req, res) => {
  try {
    const seconds = Number(req.body?.seconds);
    if (!Number.isFinite(seconds)) return res.status(400).json({ error: 'seconds required' });
    await mpdSend(`seekcur ${seconds >= 0 ? '+' : ''}${seconds}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/position', async (req, res) => {
  try {
    const seconds = Number(req.body?.seconds);
    if (!Number.isFinite(seconds)) return res.status(400).json({ error: 'seconds required' });
    await mpdSend(`seekcur ${Math.max(0, seconds)}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/volume', async (req, res) => {
  try {
    const vol = Number(req.body?.volume);
    if (!Number.isFinite(vol)) return res.status(400).json({ error: 'volume required' });
    await mpdSend(`setvol ${Math.max(0, Math.min(100, vol))}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/shuffle', async (req, res) => {
  try {
    await mpdSend(req.body?.on ? 'random 1' : 'random 0');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/player/loop', async (req, res) => {
  try {
    const mode = String(req.body?.mode || 'off').toLowerCase();
    if (mode === 'one') { await mpdSend('repeat 1'); await mpdSend('single 1'); }
    else if (mode === 'all') { await mpdSend('repeat 1'); await mpdSend('single 0'); }
    else { await mpdSend('repeat 0'); await mpdSend('single 0'); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === PLAYLISTS ===

router.get('/playlists', async (req, res) => {
  try {
    const raw = await mpdSend('listplaylists');
    const playlists = [];
    let cur = {};
    for (const line of raw.split('\n')) {
      if (line.startsWith('playlist: ')) {
        if (cur.name) playlists.push(cur);
        cur = { name: line.slice(10) };
      } else if (line.startsWith('Last-Modified: ')) {
        cur.lastModified = line.slice(15);
      }
    }
    if (cur.name) playlists.push(cur);
    res.json(playlists.map(p => ({ id: p.name, name: p.name })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/playlists/activate', async (req, res) => {
  try {
    const name = String(req.body?.id || req.body?.name || '');
    if (!name) return res.status(400).json({ error: 'name required' });
    await mpdSend('clear');
    await mpdSend(`load "${name}"`);
    await mpdSend('play');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/playlists/create', async (req, res) => {
  try {
    const name = String(req.body?.name || '');
    if (!name) return res.status(400).json({ error: 'name required' });
    await mpdSend(`save "${name}"`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/playlists/rename', async (req, res) => {
  try {
    const oldName = String(req.body?.oldName || '');
    const newName = String(req.body?.newName || '');
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
    await mpdSend(`rename "${oldName}" "${newName}"`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/playlists/delete', async (req, res) => {
  try {
    const name = String(req.body?.name || '');
    if (!name) return res.status(400).json({ error: 'name required' });
    await mpdSend(`rm "${name}"`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/playlists/:name/tracks', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const raw = await mpdSend(`listplaylistinfo "${name}"`);
    res.json(parseSongList(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/playlists/:name/add', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const uri = String(req.body?.uri || '').trim();
    
    if (!uri) return res.status(400).json({ error: 'uri required' });
    if (!name) return res.status(400).json({ error: 'playlist name required' });

    console.log(`Adding URI "${uri}" to playlist "${name}"`);
    
    // Ensure playlist exists
    try {
      await mpdSend(`listplaylist "${name}"`);
      console.log(`Playlist "${name}" exists, adding track`);
    } catch (playlistError) {
      console.log(`Playlist "${name}" doesn't exist, creating it first`);
      await mpdSend(`save "${name}"`);
    }
    
    // Add the track
    await mpdSend(`playlistadd "${name}" "${uri}"`);
    console.log(`Successfully added "${uri}" to playlist "${name}"`);
    
    res.json({ ok: true, message: 'Track added to playlist successfully' });
  } catch (e) { 
    console.error('Error adding to playlist:', e);
    res.status(500).json({ error: e.message, details: 'Failed to add track to playlist' }); 
  }
});

router.post('/playlists/:name/remove', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const pos = Number(req.body?.pos);
    if (!Number.isFinite(pos)) return res.status(400).json({ error: 'pos required' });
    await mpdSend(`playlistdelete "${name}" ${pos}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === QUEUE ===

router.get('/queue', async (req, res) => {
  try {
    const raw = await mpdSend('playlistinfo');
    const tracks = parseSongList(raw);
    res.json({ available: tracks.length > 0, tracks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/add', async (req, res) => {
  try {
    const uri = String(req.body?.uri || '');
    if (!uri) return res.status(400).json({ error: 'uri required' });
    await mpdSend(`add "${uri}"`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/remove', async (req, res) => {
  try {
    const pos = Number(req.body?.pos);
    if (!Number.isFinite(pos)) return res.status(400).json({ error: 'pos required' });
    await mpdSend(`delete ${pos}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/move', async (req, res) => {
  try {
    const from = Number(req.body?.from);
    const to = Number(req.body?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return res.status(400).json({ error: 'from/to required' });
    await mpdSend(`move ${from} ${to}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/clear', async (req, res) => {
  try { await mpdSend('clear'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/shuffle', async (req, res) => {
  try { await mpdSend('shuffle'); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// === LIBRARY ===

router.get('/library/browse', async (req, res) => {
  try {
    const path = String(req.query?.path || '');
    const raw = await mpdSend(`lsinfo "${path}"`);
    const items = [];
    let cur = {};
    for (const line of raw.split('\n')) {
      if (line.startsWith('directory: ')) {
        if (cur.name) items.push(cur);
        cur = { type: 'directory', name: line.slice(11) };
      } else if (line.startsWith('file: ')) {
        if (cur.name) items.push(cur);
        cur = { type: 'file', name: line.slice(6) };
      } else if (line.startsWith('Title: ')) cur.title = line.slice(7);
      else if (line.startsWith('Artist: ')) cur.artist = line.slice(8);
      else if (line.startsWith('Album: ')) cur.album = line.slice(7);
      else if (line.startsWith('Duration: ')) cur.duration = parseFloat(line.slice(10)) || 0;
    }
    if (cur.name) items.push(cur);
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/search', async (req, res) => {
  try {
    const q = String(req.query?.q || '');
    if (!q) return res.json([]);
    const raw = await mpdSend(`search any "${q}"`);
    res.json(parseSongList(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/songs', async (req, res) => {
  try {
    const { artist, album, genre, year, q, sort, order, offset, limit } = req.query;
    let cmd = 'find';
    const filters = [];
    if (artist) filters.push(`artist "${artist}"`);
    if (album) filters.push(`album "${album}"`);
    if (genre) filters.push(`genre "${genre}"`);
    if (year) filters.push(`date "${year}"`);
    if (q) filters.push(`any "${q}"`);
    if (filters.length > 0) cmd += ' ' + filters.join(' ');
    if (sort) {
      cmd += ` sort ${sort}`;
      if (order === 'desc') cmd += ' descend';
    }
    const raw = await mpdSend(cmd);
    let songs = parseSongList(raw);
    const start = parseInt(offset) || 0;
    const count = parseInt(limit) || songs.length;
    if (offset || limit) songs = songs.slice(start, start + count);
    res.json(songs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/all', async (req, res) => {
  try {
    const { sort, order, offset, limit } = req.query;
    let cmd = 'listallinfo ""';
    if (sort) {
      cmd += ` sort ${sort}`;
      if (order === 'desc') cmd += ' descend';
    }
    const raw = await mpdSend(cmd);
    let songs = parseSongList(raw);
    const start = parseInt(offset) || 0;
    const count = parseInt(limit) || songs.length;
    if (offset || limit) songs = songs.slice(start, start + count);
    res.json(songs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/library/update', async (req, res) => {
  try {
    await mpdSend('update');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/artists', async (req, res) => {
  try {
    const raw = await mpdSend('list artist');
    res.json(parseKeyValueList(raw, 'Artist'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/albums', async (req, res) => {
  try {
    const raw = await mpdSend('list album');
    res.json(parseKeyValueList(raw, 'Album'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/genres', async (req, res) => {
  try {
    const raw = await mpdSend('list genre');
    res.json(parseKeyValueList(raw, 'Genre'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/library/years', async (req, res) => {
  try {
    const raw = await mpdSend('list date');
    res.json(parseKeyValueList(raw, 'Date'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === COVER ART ===

router.get('/cover', async (req, res) => {
  try {
    const file = String(req.query?.file || '');
    if (!file) return res.status(400).json({ error: 'file required' });
    let art = null;
    try {
      const { stdout } = await execAsync(`mpc readpicture "${file}"`, { timeout: 5000, encoding: 'buffer' });
      if (stdout && stdout.length > 100) art = stdout;
    } catch {}
    if (!art) {
      try {
        const { stdout } = await execAsync(`mpc albumart "${file}"`, { timeout: 5000, encoding: 'buffer' });
        if (stdout && stdout.length > 100) art = stdout;
      } catch {}
    }
    if (!art) return res.status(404).json({ error: 'Art not found' });
    const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(art);
  } catch (e) { res.status(404).json({ error: 'Art not found' }); }
});

export default router;
