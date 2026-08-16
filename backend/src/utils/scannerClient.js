import { Worker } from 'node:worker_threads';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let worker = null;
const listeners = new Map();
const scanQueue = [];
let scanInProgress = false;

export function initScannerWorker() {
  if (worker) return;

  worker = new Worker(new URL('./scannerWorker.js', import.meta.url), {
    execArgv: process.execArgv
  });

  worker.on('message', (message) => {
    for (const [event, callback] of listeners) {
      if (message.type === event || event === '*') {
        try { callback(message); } catch {}
      }
    }

    if (message.type === 'scan_finished' || message.type === 'scan_error') {
      const { resolve, reject } = scanQueue.shift() || {};
      if (resolve) resolve(message);
      if (reject) reject(new Error(message.error || 'Scan failed'));
      processNextScan();
    }
  });

  worker.on('error', (error) => {
    console.error('[scanner] Worker error:', error);
    for (const [, callback] of listeners) {
      try { callback({ type: 'worker_error', error: error.message, timestamp: Date.now() }); } catch {}
    }
    const { reject } = scanQueue.shift() || {};
    if (reject) reject(error);
    scanInProgress = false;
    processNextScan();
  });

  worker.on('exit', (code) => {
    console.log(`[scanner] Worker exited with code ${code}`);
    for (const [, callback] of listeners) {
      try { callback({ type: 'worker_exit', code, timestamp: Date.now() }); } catch {}
    }
    worker = null;
    scanInProgress = false;
    processNextScan();
  });
}

function processNextScan() {
  if (scanInProgress || !worker || scanQueue.length === 0) return;
  scanInProgress = true;
  const { source } = scanQueue[0];
  worker.postMessage({ type: 'scan', source });
}

export function onScannerEvent(event, callback) {
  listeners.set(event, callback);
  return () => listeners.delete(event);
}

export async function startScan(source) {
  if (!worker) {
    throw new Error('Scanner worker not initialized');
  }

  return new Promise((resolve, reject) => {
    scanQueue.push({ source, resolve, reject });
    processNextScan();
  });
}

export function getScannerWorkerStatus() {
  if (!worker) return { initialized: false };
  return { initialized: true };
}
