#!/usr/bin/env node
// Benchmark harness for cover & video search engines
// Tests 10 messy titles before final threshold decision

import { searchCoverAllSources } from '../backend/src/utils/coverSources.js';
import { searchVideo } from '../backend/src/utils/videoCache.js';

const cases = [
  { name: 'metadata lengkap', artist: 'HOYO-MiX', album: 'Genshin Impact OST', track: 'La Vaguelette', q: '' },
  { name: 'hanya title', artist: '', album: '', track: 'La Vaguelette', q: '' },
  { name: 'filename Artist - Track', artist: 'HOYO-MiX', album: '', track: 'La Vaguelette', q: '' }, // parsed
  { name: 'title dengan (Official Video)', artist: 'HOYO-MiX', album: '', track: 'La Vaguelette (Official Video)', q: '' },
  { name: 'feat.', artist: 'HOYO-MiX feat. Hanser', album: '', track: 'La Vaguelette', q: '' },
  { name: 'remix', artist: 'HOYO-MiX', album: '', track: 'La Vaguelette Remix', q: '' },
  { name: 'OST/game soundtrack', artist: 'HOYO-MiX', album: 'Genshin Impact', track: 'La Vaguelette OST', q: '' },
  { name: 'banyak cover', artist: 'Weeekly', album: '', track: 'After School', q: '' },
  { name: 'banyak video mirip', artist: '', album: '', track: '', q: 'La Vaguelette Piano Cover' },
  { name: 'tidak ada bagus', artist: 'Random', album: '', track: 'Genshin MV Unknown XYZ123', q: '' },
];

console.log('=== COVER SEARCH BENCHMARK ===');
for (const c of cases) {
  console.log(`\n--- ${c.name}: artist="${c.artist}" album="${c.album}" track="${c.track}" q="${c.q}" ---`);
  try {
    const results = await searchCoverAllSources(c.artist, c.album, c.track, c.q);
    if (!results.length) {
      console.log('  No results');
      continue;
    }
    for (const r of results.slice(0, 4)) {
      console.log(`  ${(r.score||0).toString().padStart(3)} | ${r.source?.padEnd(10)} | ${r.title?.slice(0,40).padEnd(40)} | ${r.artist?.slice(0,20).padEnd(20)} | ${r.image?.slice(0,50)}`);
    }
    // Stats
    const scores = results.map(r=>r.score||0);
    console.log(`  Stats: max ${Math.max(...scores)} min ${Math.min(...scores)} avg ${(scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1)} count ${scores.length}`);
  } catch (e) {
    console.log('  Error:', e.message);
  }
}

console.log('\n=== VIDEO SEARCH BENCHMARK (videoCache raw) ===');
for (const c of cases.slice(0,5)) {
  const q = c.q || `${c.artist} ${c.track}`.trim() || c.track;
  if (!q) continue;
  console.log(`\n--- Video: "${q}" ---`);
  try {
    const results = await searchVideo(q, 5);
    if (!results.length) {
      console.log('  No results');
      continue;
    }
    for (const r of results.slice(0, 3)) {
      console.log(`  ${r.title.slice(0,50).padEnd(50)} | ${r.channel.slice(0,20).padEnd(20)} | ${r.duration}s`);
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
}

console.log('\nBenchmark done. Check correct vs false-positive gap for threshold 0.75/0.80');
