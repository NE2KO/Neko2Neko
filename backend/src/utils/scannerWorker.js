import db, { stmts, updateAllRecursiveCounts, syncFTSIndex } from '../db.js';
import { incrementalSync, buildThumbCache, getScannerStatus } from './fileScanner.js';
import { THUMBNAIL_DIR } from './thumbnailUtils.js';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_TIMESTAMP_FILE = join(process.cwd(), 'data', '.last-scan-time');

let currentScan = null;
const newFiles = [];

function send(message) {
  if (typeof parentPort !== 'undefined' && !parentPort.closed) {
    parentPort.postMessage(message);
  }
}

async function runScan(source) {
  if (currentScan) {
    return { type: 'scan_error', source, error: 'Scan already in progress', timestamp: Date.now() };
  }

  currentScan = { source, startTime: Date.now() };
  newFiles.length = 0;

  try {
    send({ type: 'scan_started', source, timestamp: Date.now() });
    send({ type: 'scan_progress', source, phase: 'scanning', timestamp: Date.now() });

    const result = await incrementalSync((fullPath, fileType) => {
      newFiles.push({ fullPath, type: fileType });
    }, true);

    send({ type: 'scan_progress', source, phase: 'reconciling', timestamp: Date.now() });
    const remainingFolders = db.prepare('SELECT id FROM folders').all();
    for (const folder of remainingFolders) {
      stmts.reconcileFolder.run(folder.id);
    }

    send({ type: 'scan_progress', source, phase: 'recursive_counts', timestamp: Date.now() });
    const updatedFolders = updateAllRecursiveCounts();

    send({ type: 'scan_progress', source, phase: 'fts_sync', timestamp: Date.now() });
    await syncFTSIndex();

    try { writeFileSync(SCAN_TIMESTAMP_FILE, String(Date.now())); } catch {}

    const elapsed = Date.now() - currentScan.startTime;
    const scanResult = {
      type: 'scan_finished',
      source,
      stats: result,
      updatedFolders,
      newFiles: newFiles.map(f => ({ fullPath: f.fullPath, type: f.type })),
      elapsed,
      timestamp: Date.now()
    };

    currentScan = null;
    newFiles.length = 0;
    return scanResult;
  } catch (error) {
    currentScan = null;
    newFiles.length = 0;
    return {
      type: 'scan_error',
      source,
      error: error.message,
      timestamp: Date.now()
    };
  }
}

if (typeof parentPort !== 'undefined') {
  parentPort.on('message', async (message) => {
    switch (message.type) {
      case 'scan': {
        const result = await runScan(message.source);
        send(result);
        break;
      }
      case 'status': {
        send({
          type: 'status',
          isScanning: currentScan !== null,
          currentSource: currentScan?.source || null,
          timestamp: Date.now()
        });
        break;
      }
    }
  });
}

send({ type: 'worker_ready', timestamp: Date.now() });
