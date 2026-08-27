#!/usr/bin/env node
/**
 * Smoke test for @homelab/media-engine integration.
 * Does NOT modify the server — runs MediaScanner in isolation against the
 * existing DB, compares results with baseline, reports mismatches.
 */
import db, { stmts, syncFTSIndex, updateAllRecursiveCounts } from '../src/db.js';
import { SqliteMediaRepository } from '../src/repository/sqliteMediaRepository.js';
import { MediaScanner } from '@homelab/media-engine';
import { addFile, existingThumbs, buildThumbCache } from '../src/utils/thumbnailQueue.js';
import { get } from '../src/utils/runtimeSettings.js';
import { recordMemoryUsage } from '../src/utils/resourceManager.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MEDIA_ROOTS = (process.env.MEDIA_ROOT || '/home/CATIAA/homelab').split(':').filter(Boolean);

console.log('=== MEDIA-ENGINE SMOKE TEST ===\n');

// 1. BASELINE: capture DB state before scan
console.log('--- Phase 1: Baseline ---');
const baseFilesByType = stmts.countFilesByType.all();
const baseTotal = baseFilesByType.reduce((s, r) => s + r.count, 0);
const baseFolders = db.prepare('SELECT COUNT(*) as cnt FROM folders').get();
const baseRecursiveCounts = db.prepare('SELECT COUNT(*) as cnt FROM folders WHERE recursive_file_count IS NOT NULL').get();
console.log(`  Files: ${baseTotal} (${baseFilesByType.map(r => `${r.type}=${r.count}`).join(', ')})`);
console.log(`  Folders: ${baseFolders.cnt}`);
console.log(`  Folders with recursive counts: ${baseRecursiveCounts.cnt}`);

const baseTsFile = join(process.cwd(), 'data', '.last-scan-time');
const baseTsBefore = existsSync(baseTsFile) ? readFileSync(baseTsFile, 'utf8').trim() : 'none';
console.log(`  Last scan timestamp: ${baseTsBefore}`);

// 2. INSTANTIATE: MediaScanner with repository
console.log('\n--- Phase 2: Instantiation ---');
const repository = new SqliteMediaRepository(db, stmts);

let newFileCount = 0;
let deletedFileCount = 0;
let thumbRebuildCalled = false;
let ftsSyncCalled = false;
let recursiveCountCalled = false;

const scanner = new MediaScanner({
  repository,
  mediaRoots: MEDIA_ROOTS,
  callbacks: {
    onNewFile: (fullPath, type) => {
      newFileCount++;
      addFile(fullPath, type);
    },
    onFileDeleted: (id) => {
      deletedFileCount++;
    },
    onFileUpdated: () => {
      thumbRebuildCalled = true;
      try { buildThumbCache(); } catch {}
    },
    getBatchSize: () => get('scan.workers', 4) * 250,
    shouldCompareByHash: () => get('scan.compareByHash', false),
    recordMemoryUsage,
  },
  config: {
    workers: get('scan.workers', 4),
    compareByHash: get('scan.compareByHash', false),
  },
});

console.log(`  MediaScanner created`);
console.log(`  Status: ${JSON.stringify(scanner.getStatus())}`);
console.log(`  Has events: ${typeof scanner.events.emit === 'function'}`);
console.log(`  Has pause/resume: ${typeof scanner.pause === 'function'}/${typeof scanner.resume === 'function'}`);

// 3. SCAN: run incremental sync
console.log('\n--- Phase 3: Scan ---');
const scanStart = Date.now();
let scanResult;
try {
  scanResult = await scanner.scan();
} catch (err) {
  console.error('  SCAN FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
}
const scanElapsed = Date.now() - scanStart;

console.log(`  Result: ${JSON.stringify(scanResult)}`);
console.log(`  Wall time: ${scanElapsed}ms`);
console.log(`  New files reported: ${newFileCount}`);
console.log(`  Deleted files reported: ${deletedFileCount}`);
console.log(`  Thumb rebuild called: ${thumbRebuildCalled}`);

// 4. POST-SCAN: capture DB state
console.log('\n--- Phase 4: Post-Scan ---');
const postFilesByType = stmts.countFilesByType.all();
const postTotal = postFilesByType.reduce((s, r) => s + r.count, 0);
const postFolders = db.prepare('SELECT COUNT(*) as cnt FROM folders').get();
const postRecursiveCounts = db.prepare('SELECT COUNT(*) as cnt FROM folders WHERE recursive_file_count IS NOT NULL').get();
const postTsAfter = existsSync(baseTsFile) ? readFileSync(baseTsFile, 'utf8').trim() : 'none';

console.log(`  Files: ${postTotal} (${postFilesByType.map(r => `${r.type}=${r.count}`).join(', ')})`);
console.log(`  Folders: ${postFolders.cnt}`);
console.log(`  Folders with recursive counts: ${postRecursiveCounts.cnt}`);
console.log(`  Last scan timestamp updated: ${postTsAfter !== baseTsBefore}`);

// 5. COMPARE
console.log('\n--- Phase 5: Comparison ---');
let mismatches = 0;

function check(label, expected, actual, strict = false) {
  const eq = strict ? expected === actual : expected == actual;
  const mark = eq ? '✓' : '✗ MISMATCH';
  console.log(`  ${mark}: ${label} — expected=${expected}, got=${actual}`);
  if (!eq) mismatches++;
  return eq;
}

check('File count (total)', baseTotal, postTotal);
for (const r of baseFilesByType) {
  const post = postFilesByType.find(p => p.type === r.type);
  check(`File count (${r.type})`, r.count, post?.count || 0);
}

check('Folder count', baseFolders.cnt, postFolders.cnt);
check('Recursive counts populated', baseRecursiveCounts.cnt, postRecursiveCounts.cnt);

check('Scan inserted', 0, scanResult?.inserted);
check('Scan deleted', 0, scanResult?.deleted);
check('Scan changed', false, scanResult?.changed);
check('Timestamp updated', true, postTsAfter !== baseTsBefore);

// 6. ADAPTIVE CONTROLLER: test pause/resume
console.log('\n--- Phase 6: Pause/Resume ---');
scanner.pause();
const pausedStatus = scanner.getStatus();
check('Paused state', true, pausedStatus.isPaused);

scanner.resume();
const resumedStatus = scanner.getStatus();
check('Resumed state', false, resumedStatus.isPaused);

// 7. EVENT BUS: test events
console.log('\n--- Phase 7: Events ---');
let eventFired = false;
scanner.events.on('test.event', () => { eventFired = true; });
scanner.events.emit('test.event', {});
check('EventBus fires', true, eventFired);

// 8. VERIFY: a few specific files still exist in DB
console.log('\n--- Phase 8: Spot Check ---');
const sampleIds = db.prepare('SELECT id, name, type FROM files LIMIT 5').all();
for (const s of sampleIds) {
  const file = repository.getFileById(s.id);
  check(`File exists: ${s.name}`, true, !!file);
}

// 9. VERIFY: recursive counts are non-zero for populated folders
console.log('\n--- Phase 9: Recursive Counts ---');
const populatedFolders = db.prepare(`
  SELECT f.id, f.path, f.file_count, f.recursive_file_count
  FROM folders f
  WHERE f.file_count > 0 AND f.id > 1
  LIMIT 5
`).all();
for (const f of populatedFolders) {
  const rc = f.recursive_file_count;
  const ok = rc !== null && rc >= f.file_count;
  const mark = ok ? '✓' : '✗ MISMATCH';
  console.log(`  ${mark}: Folder "${f.path}" direct=${f.file_count} recursive=${rc}`);
  if (!ok) mismatches++;
}

// SUMMARY
console.log('\n=== SUMMARY ===');
console.log(`  Mismatches: ${mismatches}`);
if (mismatches === 0) {
  console.log('  ✓ All checks passed. Safe to proceed with wiring.');
} else {
  console.log('  ✗ Mismatches found. Fix before proceeding.');
}

process.exit(mismatches > 0 ? 1 : 0);
