import { getLyrics, searchLyrics } from './lrclib.js';
import { searchLrcmux, searchLrcmuxByQuery } from './lrcmux.js';
import { searchGenius } from './genius.js';
import { searchNetEase, searchNetEaseByQuery } from './netease.js';
import { hasJapanese, generateRomajiLyrics } from './romaji.js';
import { searchPyjlyric } from './pyjlyric.js';

function dedup(results, seen) {
  return results.filter(r => {
    const key = `${r.trackName}|${r.artistName}|${r.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// === Search by structured metadata ===
export async function searchLyricsAllSources(trackName, artistName, albumName, duration) {
  const seen = new Set();
  const allResults = [];

  // 1. LRCLIB exact match with full metadata (most reliable)
  try {
    const exact = await getLyrics(trackName, artistName, albumName, duration);
    if (exact) {
      allResults.push(exact);
    }
  } catch (err) {
    console.error('[lyrics] LRCLIB exact match error:', err.message);
  }

  // 2. LRCLIB search with artist + track
  try {
    const query = [trackName, artistName].filter(Boolean).join(' ');
    const results = await searchLyrics(query);
    allResults.push(...dedup(results, seen));
  } catch (err) {
    console.error('[lyrics] LRCLIB search error:', err.message);
  }

  // 3. Try lrcmux (aggregator) - may be unreliable
  try {
    const result = await searchLrcmux(artistName, trackName, albumName, duration);
    if (result && (result.plainLyrics || result.syncedLyrics)) {
      allResults.push(result);
    }
  } catch (err) {
    console.error('[lyrics] Lrcmux error:', err.message);
  }

  // 4. Try pyjlyric (Japanese lyrics from 14+ sites)
  try {
    const query = [trackName, artistName].filter(Boolean).join(' ');
    const pyjlyricResults = await searchPyjlyric(query);
    allResults.push(...dedup(pyjlyricResults, seen));
  } catch (err) {
    console.error('[lyrics] pyjlyric error:', err.message);
  }

  // 5. Try Genius as fallback
  try {
    const result = await searchGenius(artistName, trackName);
    if (result && result.plainLyrics) {
      allResults.push(result);
    }
  } catch (err) {
    console.error('[lyrics] Genius error:', err.message);
  }

  // 5. Try NetEase (great for Japanese/Asian music)
  try {
    const neteaseResults = await searchNetEase(artistName, trackName, albumName, duration);
    allResults.push(...dedup(neteaseResults, seen));
  } catch (err) {
    console.error('[lyrics] NetEase error:', err.message);
  }

  // 6. Try cleaned track name on LRCLIB
  const cleanedTrack = trackName
    .replace(/\bfeat\.?\s*.*/i, '')
    .replace(/\bft\.?\s*.*/i, '')
    .replace(/\bremix\b/gi, '')
    .replace(/\bversion\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanedTrack && cleanedTrack !== trackName) {
    try {
      const results = await searchLyrics(cleanedTrack);
      allResults.push(...dedup(results, seen));
    } catch (err) {
      console.error('[lyrics] LRCLIB cleaned error:', err.message);
    }

    try {
      const result = await searchLrcmux(artistName, cleanedTrack, albumName, duration);
      if (result && (result.plainLyrics || result.syncedLyrics)) {
        allResults.push(result);
      }
    } catch (err) {
      console.error('[lyrics] Lrcmux cleaned error:', err.message);
    }
  }

  // 7. Try artist-only search
  if (artistName) {
    try {
      const results = await searchLyrics(artistName);
      allResults.push(...dedup(results, seen));
    } catch (err) {
      console.error('[lyrics] LRCLIB artist-only error:', err.message);
    }
  }

  // Generate romaji for Japanese lyrics
  return Promise.all(allResults.map(async r => {
    const text = r.plainLyrics || r.syncedLyrics || '';
    if (hasJapanese(text)) {
      return { ...r, romajiLyrics: await generateRomajiLyrics(r.plainLyrics, r.syncedLyrics) };
    }
    return r;
  }));
}

// === Search by free-text query ===
export async function searchLyricsByQuery(query) {
  if (!query || !query.trim()) return [];

  const seen = new Set();
  let q = query.trim();
  const allResults = [];

  // 1. Try raw query on LRCLIB first (most reliable)
  try {
    const results = await searchLyrics(q);
    if (results.length > 0) {
      allResults.push(...dedup(results, seen));
    }
  } catch (err) {
    console.error('[lyrics] LRCLIB raw query error:', err.message);
  }

  // 2. Try lrcmux with raw query
  try {
    const result = await searchLrcmuxByQuery(q);
    if (result && (result.plainLyrics || result.syncedLyrics)) {
      allResults.push(result);
    }
  } catch (err) {
    console.error('[lyrics] Lrcmux raw query error:', err.message);
  }

  // 3. Try pyjlyric (Japanese lyrics from 14+ sites)
  try {
    const pyjlyricResults = await searchPyjlyric(q);
    allResults.push(...dedup(pyjlyricResults, seen));
  } catch (err) {
    console.error('[lyrics] pyjlyric error:', err.message);
  }

  // 4. Try NetEase (great for Japanese/Asian music)
  try {
    const neteaseResults = await searchNetEaseByQuery(q);
    allResults.push(...dedup(neteaseResults, seen));
  } catch (err) {
    console.error('[lyrics] NetEase raw query error:', err.message);
  }

  // 4. Clean query: remove cover markers, special brackets, feat., remix, etc.
  let cleaned = q
    .replace(/^【[^】]*】\s*/g, '')
    .replace(/[⧸【】\[\]「」『』]/g, ' ')
    .replace(/\bfeat\.?\s*.*/i, '')
    .replace(/\bft\.?\s*.*/i, '')
    .replace(/\bremix\b/gi, '')
    .replace(/\bversion\b/gi, '')
    .replace(/\blive\b/gi, '')
    .replace(/\bacoustic\b/gi, '')
    .replace(/\bkaraoke\b/gi, '')
    .replace(/\bcover\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If cleaned is different from raw, try LRCLIB + lrcmux + Genius
  if (cleaned && cleaned !== q) {
    try {
      const results = await searchLyrics(cleaned);
      allResults.push(...dedup(results, seen));
    } catch (err) {
      console.error('[lyrics] LRCLIB cleaned error:', err.message);
    }

    try {
      const result = await searchLrcmuxByQuery(cleaned);
      if (result && (result.plainLyrics || result.syncedLyrics)) {
        allResults.push(result);
      }
    } catch (err) {
      console.error('[lyrics] Lrcmux cleaned error:', err.message);
    }

    // Try Genius with cleaned query
    try {
      const result = await searchGenius('', cleaned);
      if (result && result.plainLyrics) {
        allResults.push(result);
      }
    } catch (err) {
      console.error('[lyrics] Genius cleaned error:', err.message);
    }
  }

  // 5. Try to parse as "Artist Track" (split at midpoint)
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2);
    const artistGuess = words.slice(0, mid).join(' ');
    const trackGuess = words.slice(mid).join(' ');

    try {
      const exact = await getLyrics(trackGuess, artistGuess, '', null);
      if (exact) allResults.push(exact);
    } catch (err) {
      console.error('[lyrics] LRCLIB split error:', err.message);
    }

    try {
      const results = await searchLyrics(`${trackGuess} ${artistGuess}`);
      allResults.push(...dedup(results, seen));
    } catch (err) {
      console.error('[lyrics] LRCLIB split search error:', err.message);
    }

    // Try Genius with split
    try {
      const result = await searchGenius(artistGuess, trackGuess);
      if (result && result.plainLyrics) {
        allResults.push(result);
      }
    } catch (err) {
      console.error('[lyrics] Genius split error:', err.message);
    }

    // Try reverse split
    const revArtist = words.slice(mid).join(' ');
    const revTrack = words.slice(0, mid).join(' ');
    try {
      const exact = await getLyrics(revTrack, revArtist, '', null);
      if (exact) allResults.push(exact);
    } catch (err) {
      console.error('[lyrics] LRCLIB reverse split error:', err.message);
    }

    // Try track-only with last 2 words
    if (words.length >= 3) {
      const lastTwo = words.slice(-2).join(' ');
      try {
        const results = await searchLyrics(lastTwo);
        allResults.push(...dedup(results, seen));
      } catch (err) {
        console.error('[lyrics] LRCLIB last two error:', err.message);
      }
    }

    // Try track-only with last word
    const lastWord = words[words.length - 1];
    if (lastWord.length > 2) {
      try {
        const results = await searchLyrics(lastWord);
        allResults.push(...dedup(results, seen));
      } catch (err) {
        console.error('[lyrics] LRCLIB last word error:', err.message);
      }
    }
  }

  // Generate romaji for Japanese lyrics
  return Promise.all(allResults.map(async r => {
    const text = r.plainLyrics || r.syncedLyrics || '';
    if (hasJapanese(text)) {
      return { ...r, romajiLyrics: await generateRomajiLyrics(r.plainLyrics, r.syncedLyrics) };
    }
    return r;
  }));
}

// === Combined: prefer free-text query when available, fallback to metadata ===
export async function searchLyricsCombined(trackName, artistName, albumName, duration, query) {
  // Phase 1: free-text query (most specific when user typed something)
  if (query && query.trim()) {
    const queryResults = await searchLyricsByQuery(query);
    if (queryResults.length > 0) return queryResults;
  }

  // Phase 2: metadata
  if (trackName) {
    const metaResults = await searchLyricsAllSources(trackName, artistName, albumName, duration);
    if (metaResults.length > 0) return metaResults;
  }

  return [];
}
