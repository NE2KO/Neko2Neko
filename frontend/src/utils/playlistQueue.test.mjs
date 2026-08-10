import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayableQueue, resolveClickedIndex } from './playlistQueue.js';

// Fixture: a displayed playlist where the 2nd track (by display order) is
// missing its file (exists=false) and therefore is NOT playable. The playable
// subset is [track0, track2, track3]. Grid order is [0,1,2,3].
const makeTracks = () => [
  { id: 't0', file_id: 'f0', display_name: 'A', exists: true, resolved_path: '/a.mp3' },
  { id: 't1', file_id: 'f1', display_name: 'B', exists: false }, // missing file
  { id: 't2', file_id: 'f2', display_name: 'C', exists: true, resolved_path: '/c.mp3' },
  { id: 't3', file_id: 'f3', display_name: 'D', exists: true, resolved_path: '/d.mp3' },
];

test('buildPlayableQueue drops unplayable tracks but preserves display order', () => {
  const queue = buildPlayableQueue(makeTracks());
  assert.equal(queue.length, 3);
  assert.deepEqual(queue.map((q) => q.file_id), ['f0', 'f2', 'f3']);
  // track_index reflects position *within the playable queue*
  assert.deepEqual(queue.map((q) => q.track_index), [0, 1, 2]);
});

test('clicking the 3rd displayed track resolves to its index in the playable queue (not 0)', () => {
  const displayTracks = makeTracks();
  const queue = buildPlayableQueue(displayTracks); // [f0, f2, f3]
  // The 3rd displayed track is index 2 -> file_id f2 -> playable index 1.
  const clicked = displayTracks[2];
  const idx = resolveClickedIndex(clicked, queue);
  assert.equal(idx, 1);
  assert.equal(queue[idx].file_id, 'f2');
  assert.notEqual(idx, 0); // would have been the old bug
});

test('clicking an unresolvable (missing) track does NOT resolve to 0', () => {
  const displayTracks = makeTracks();
  const queue = buildPlayableQueue(displayTracks);
  const missing = displayTracks[1]; // exists=false, not in queue
  const idx = resolveClickedIndex(missing, queue);
  assert.equal(idx, -1);
});

test('resolveClickedIndex matches on stable id even when file_id is absent', () => {
  const queue = buildPlayableQueue(makeTracks());
  const clicked = { id: 't3' }; // no file_id, only id
  const idx = resolveClickedIndex(clicked, queue);
  assert.equal(idx, 2);
  assert.equal(queue[idx].file_id, 'f3');
});

test('empty / non-array input is safe', () => {
  assert.equal(buildPlayableQueue([]).length, 0);
  assert.equal(buildPlayableQueue(null).length, 0);
  assert.equal(resolveClickedIndex(null, []), -1);
  assert.equal(resolveClickedIndex({ id: 'x' }, null), -1);
});
