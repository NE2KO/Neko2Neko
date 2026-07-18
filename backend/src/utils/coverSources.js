import { searchCoverArt as searchMusicBrainz } from './musicbrainz.js';
import { searchYouTube } from './youtube.js';

const DEEZER_BASE = 'https://api.deezer.com';
const ITUNES_BASE = 'https://itunes.apple.com';
const USER_AGENT = 'MediaVault/1.0 (media-server)';

// === Relevance scoring for cover art results ===
function tokenize(str) {
  return str.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(t => t.length >= 1);
}

// Loose artist-relationship check: true when two artist strings likely refer
// to the same act (handles K-pop romanization variance like Weeekly/WEEEKLY).
function artistsRelated(a, b) {
  const na = (a || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const nb = (b || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!na || !nb) return true; // can't tell — don't penalize
  if (na.includes(nb) || nb.includes(na)) return true;
  for (let len = Math.min(na.length, nb.length); len >= 4; len--) {
    for (let i = 0; i + len <= na.length; i++) {
      if (nb.includes(na.substr(i, len))) return true;
    }
  }
  return false;
}

function scoreResult(result, artist, album, track) {
  const resultArtist = (result.release?.artist || '').toLowerCase();
  const resultTitle = (result.release?.title || '').toLowerCase();
  const queryParts = [track, artist, album].filter(Boolean).join(' ').toLowerCase();
  const qTokens = tokenize(queryParts);
  if (qTokens.length === 0) return 50;

  let score = 0;

  // Artist match (40% weight)
  if (resultArtist) {
    const aTokens = tokenize(resultArtist);
    const matched = qTokens.filter(qt => aTokens.some(at => at.includes(qt) || qt.includes(at))).length;
    score += (matched / qTokens.length) * 40;
  }

  // Title/album match (40% weight)
  if (resultTitle) {
    const tTokens = tokenize(resultTitle);
    const matched = qTokens.filter(qt => tTokens.some(tt => tt.includes(qt) || qt.includes(tt))).length;
    score += (matched / qTokens.length) * 40;
  }

  // Exact artist bonus (20%)
  if (artist && resultArtist) {
    const aNorm = artist.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const rNorm = resultArtist.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (aNorm === rNorm || rNorm.includes(aNorm) || aNorm.includes(rNorm)) {
      score += 20;
    }
  }

  // Penalize results whose artist clearly isn't the reference artist (e.g. a
  // different group's "After School" EP showing up for Weeekly's "After School").
  if (artist && resultArtist && !artistsRelated(artist, resultArtist)) {
    score = score * 0.3;
  }

  return Math.min(100, Math.round(score));
}

function scoreAndSort(results, artist, album, track) {
  return results
    .map(r => ({ ...r, score: scoreResult(r, artist, album, track) }))
    .sort((a, b) => b.score - a.score);
}

// === Deezer: structured search ===
async function deezerSearch(artist, album, track) {
  try {
    const parts = [];
    if (track) parts.push(`track:"${track}"`);
    if (artist) parts.push(`artist:"${artist}"`);
    if (album) parts.push(`album:"${album}"`);
    if (parts.length === 0) return [];
    const query = parts.join(' ');
    return deezerFetch(query);
  } catch { return []; }
}

// === Deezer: free-text query search ===
async function deezerSearchQuery(query) {
  try {
    if (!query) return [];
    return deezerFetch(query);
  } catch { return []; }
}

async function deezerFetch(query) {
  const url = `${DEEZER_BASE}/search?q=${encodeURIComponent(query)}&limit=15&order=RANKING`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data?.data) return [];
  const seen = new Set();
  return data.data.filter(d => {
    if (!d.album?.cover) return false;
    const key = d.album.cover;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(d => ({
    source: 'Deezer',
    release: {
      id: String(d.album.id),
      title: d.album.title,
      artist: d.artist?.name || '',
    },
    cover: {
      id: String(d.id),
      image: d.album.cover_xl || d.album.cover_big || d.album.cover_medium || d.album.cover,
      thumbnails: {
        '250': d.album.cover_small,
        '500': d.album.cover_medium,
        '1200': d.album.cover_xl || d.album.cover_big,
      },
    },
  }));
}

// === iTunes: structured search ===
async function itunesSearch(artist, album, track) {
  try {
    const terms = [track, artist, album].filter(Boolean).join(' ');
    if (!terms) return [];
    return itunesFetch(terms);
  } catch { return []; }
}

// === iTunes: free-text query search ===
async function itunesSearchQuery(query) {
  try {
    if (!query) return [];
    return itunesFetch(query);
  } catch { return []; }
}

async function itunesFetch(term) {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(term)}&limit=25&entity=song`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data?.results) return [];
  const seen = new Set();
  return data.results.filter(r => {
    if (!r.artworkUrl100) return false;
    const key = r.artworkUrl100.replace(/\/\d+x\d+bb\.jpg$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => {
    const base = r.artworkUrl100.replace(/100x100bb/, '1200x1200bb');
    return {
      source: 'iTunes',
      release: {
        id: String(r.trackId),
        title: r.collectionName || r.trackName,
        artist: r.artistName,
      },
      cover: {
        id: String(r.trackId),
        image: base,
        thumbnails: {
          '100': r.artworkUrl100,
          '1200': base,
        },
      },
    };
  });
}

// === MusicBrainz: free-text query search ===
async function musicbrainzSearchQuery(query) {
  try {
    if (!query) return [];
    const results = await searchMusicBrainz('', '', query);
    return results.map(r => ({ ...r, source: 'MusicBrainz' }));
  } catch { return []; }
}

// === Query variation generator ===
function cleanQuery(query) {
  return query
    .replace(/\([\s\S]*?\)/g, ' ')       // remove (parentheses)
    .replace(/[[\]「」『』⧸]/g, ' ')      // remove brackets
    .replace(/[_\-–—|/]/g, ' ')          // remove underscores / dashes / separators
    .replace(/\bfeat\.?\s*.*/i, '')       // remove feat. and everything after
    .replace(/\bft\.?\s*.*/i, '')         // remove ft. and everything after
    .replace(/\bremix\b/gi, '')           // remove remix
    .replace(/\bversion\b/gi, '')         // remove version
    .replace(/\blive\b/gi, '')            // remove live
    .replace(/\bacoustic\b/gi, '')        // remove acoustic
    .replace(/\bkaraoke\b/gi, '')         // remove karaoke
    .replace(/\bcover\b/gi, '')           // remove cover
    .replace(/\s+/g, ' ')
    .trim();
}

function generateQueryVariations(query) {
  const cleaned = cleanQuery(query);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const variations = [cleaned];

  // Add "OST" suffix for game/anime music
  if (!/ost/i.test(cleaned)) {
    variations.push(cleaned + ' OST');
  }

  // Try artist+track and track+artist combos
  if (words.length >= 4) {
    variations.push(words.slice(-3).join(' '));
    variations.push(words.slice(0, 3).join(' '));
    variations.push(words.slice(-2).join(' '));
  } else if (words.length === 3) {
    variations.push(words.slice(-2).join(' '));
    variations.push(words.slice(0, 2).join(' '));
  }

  // Try just the last significant word (often the track name)
  if (words.length >= 2) {
    const last = words[words.length - 1];
    if (last.length > 2) variations.push(last);
  }

  // Remove duplicates
  return [...new Set(variations)];
}

// === Search cover by free-text query (with variations) ===
async function searchCoverByQuery(query) {
  if (!query || !query.trim()) return [];

  const variations = generateQueryVariations(query);
  const allResults = [];
  const seenUrls = new Set();

  function pushResults(results) {
    for (const r of results) {
      const url = r.cover?.image;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allResults.push(r);
      }
    }
  }

  for (const v of variations) {
    const dz = await deezerSearchQuery(v);
    pushResults(dz);
    if (allResults.length >= 12) break;

    const it = await itunesSearchQuery(v);
    pushResults(it);
    if (allResults.length >= 12) break;
  }

  // Always try YouTube — user needs crop button for YT thumbnails
  try {
    const yt = await searchYouTube(variations[0]);
    pushResults(yt);
  } catch { /* skip */ }

  // If still need more results, try MusicBrainz with first variation only
  if (allResults.length < 8) {
    const mb = await musicbrainzSearchQuery(variations[0]);
    pushResults(mb);
  }

  return scoreAndSort(allResults, '', '', variations[0]);
}

// === Combined search: merge structured metadata search + free-text query ===
export async function searchCoverAllSources(artist, album, track, query) {
  // Clean the structured terms so Deezer/iTunes/MusicBrainz match correctly
  // (e.g. "Weeekly(위클리)" -> "Weeekly", "Weeekly _ After School" -> "Weeekly After School").
  const cleanA = cleanQuery(artist || '');
  const cleanT = cleanQuery(track || '');
  const cleanAl = cleanQuery(album || '');
  const hasMeta = cleanA || cleanT || cleanAl;
  const hasQuery = query && query.trim();

  const results = [];
  const seenUrls = new Set();
  const pushResults = (arr) => {
    for (const r of (arr || [])) {
      const url = r.cover?.image;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        results.push(r);
      }
    }
  };

  // Structured metadata search (most accurate when artist/track are known).
  if (hasMeta) {
    try {
      const mbResults = await searchMusicBrainz(cleanA, cleanAl, cleanT);
      pushResults(mbResults.map(r => ({ ...r, source: 'MusicBrainz' })));
    } catch { /* skip */ }

    pushResults(await deezerSearch(cleanA, cleanAl, cleanT));
    pushResults(await itunesSearch(cleanA, cleanAl, cleanT));

    // If still few results, try a cleaned track name (strip feat/remix/etc).
    if (results.length < 5 && cleanT) {
      const cleanedTrack = cleanT
        .replace(/\bfeat\.?\s*.*/i, '')
        .replace(/\bft\.?\s*.*/i, '')
        .replace(/\bremix\b/gi, '')
        .replace(/\bversion\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedTrack && cleanedTrack !== cleanT) {
        pushResults(await deezerSearch(cleanA, '', cleanedTrack));
        pushResults(await itunesSearch(cleanA, '', cleanedTrack));
      }
    }
  }

  // Free-text query search (broad: Deezer + iTunes + YouTube + MusicBrainz).
  if (hasQuery) {
    pushResults(await searchCoverByQuery(query));
  }

  if (results.length > 0) {
    const scoreTrack = cleanT || (hasQuery ? cleanQuery(query) : '');
    return scoreAndSort(results.slice(0, 30), cleanA, cleanAl, scoreTrack);
  }

  // Last resort: YouTube with whatever we have.
  const lastResort = cleanT || cleanAl || cleanA || (hasQuery ? query : '');
  if (lastResort) {
    try {
      const ytResults = await searchYouTube(lastResort);
      return scoreAndSort(ytResults, cleanA, cleanAl, cleanT);
    } catch {
      return [];
    }
  }

  return [];
}
