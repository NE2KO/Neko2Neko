import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import transactionEngine, { TX_STATUS } from './adbTransaction.js';
import {
  adbStat,
  ensureRemoteDir,
  applyMetadata,
  verifyFile,
  removeRemoteFile,
  ERROR_TYPES,
} from './adbMetadata.js';

const STALL_TIMEOUT_MS = 120000;
const PUSH_PROGRESS_INTERVAL = 500;

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function parseAdbPushProgress(stderrLine) {
  const pctMatch = stderrLine.match(/\[\s*(\d+)%\]/);
  const speedMatch = stderrLine.match(/([\d.]+)\s*MB\/s/);
  if (pctMatch) {
    return {
      percent: parseInt(pctMatch[1], 10),
      speed: speedMatch ? Math.round(parseFloat(speedMatch[1]) * 1024 * 1024) : 0,
    };
  }
  return null;
}

export function runAdbPush(deviceId, localPath, remotePath, onProgress, registerProcess) {
  return new Promise((resolve, reject) => {
    const proc = spawn('adb', ['-s', deviceId, 'push', localPath, remotePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    registerProcess?.(proc);

    let stderr = '';
    let lastProgress = Date.now();
    let lastReport = 0;

    const stallTimer = setInterval(() => {
      if (Date.now() - lastProgress > STALL_TIMEOUT_MS) {
        clearInterval(stallTimer);
        try { proc.kill('SIGTERM'); } catch {}
        reject(Object.assign(new Error('Transfer stalled (timeout)'), { type: ERROR_TYPES.TIMEOUT }));
      }
    }, 10000);

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      lastProgress = Date.now();

      const now = Date.now();
      if (onProgress && now - lastReport >= PUSH_PROGRESS_INTERVAL) {
        lastReport = now;
        const lines = text.split('\n');
        for (const line of lines) {
          const parsed = parseAdbPushProgress(line);
          if (parsed) onProgress(parsed);
        }
      }
    });

    proc.stdout.on('data', () => { lastProgress = Date.now(); });

    proc.on('close', (code) => {
      clearInterval(stallTimer);
      registerProcess?.(null);
      if (code === 0) {
        resolve({ stdout: '', stderr });
      } else {
        reject(Object.assign(new Error(stderr.trim() || `adb push failed (code ${code})`), { type: ERROR_TYPES.ADB_FAIL }));
      }
    });

    proc.on('error', (err) => {
      clearInterval(stallTimer);
      registerProcess?.(null);
      reject(Object.assign(err, { type: ERROR_TYPES.ADB_FAIL }));
    });
  });
}

export class AdbWorkerPool {
  constructor(maxWorkers = 3) {
    this.maxWorkers = maxWorkers;
  }

  async processJob(job, callbacks) {
    const pending = transactionEngine.getPendingTransactions(job.id);
    const results = [];
    let cursor = 0;
    let stopped = false;

    const shouldStop = () =>
      stopped || job.status === 'cancelled' || job.status === 'paused';

    const processOne = async (tx) => {
      if (shouldStop()) return null;
      try {
        const result = await this._processTransaction(tx, job, callbacks);
        results.push(result);
        return result;
      } catch (err) {
        transactionEngine.incrementAttempt(tx.id);
        if (job.status === 'cancelled') {
          transactionEngine.updateStatus(tx.id, TX_STATUS.CANCELLED, 'cancelled', ERROR_TYPES.ADB_FAIL);
          callbacks.onProgress?.(job);
          return { action: 'cancelled', tx };
        }
        const attempts = transactionEngine.getTransaction(tx.id)?.attempts || 0;
        const maxAttempts = tx.maxAttempts || 3;
        if (attempts < maxAttempts && err.type !== ERROR_TYPES.SIZE_MISMATCH) {
          removeRemoteFile(job.device, tx.dst).catch(() => {});
          transactionEngine.updateStatus(tx.id, TX_STATUS.PENDING);
          pending.push(transactionEngine.getTransaction(tx.id));
        } else {
          transactionEngine.updateStatus(tx.id, TX_STATUS.FAILED, err.message, err.type || ERROR_TYPES.ADB_FAIL);
        }
        callbacks.onProgress?.(job);
        return { action: 'failed', tx, error: err.message };
      }
    };

    const worker = async () => {
      while (!shouldStop()) {
        if (cursor >= pending.length) {
          await new Promise(r => setTimeout(r, 100));
          if (cursor >= pending.length) break;
          continue;
        }
        const tx = pending[cursor++];
        if (!tx || tx.status !== TX_STATUS.PENDING) continue;

        const result = await processOne(tx);
        if (result?.action === 'deferred') {
          pending.push(transactionEngine.getTransaction(tx.id) || tx);
        }

        if (job.status === 'waiting_conflict') {
          while (job.status === 'waiting_conflict' && !shouldStop()) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    };

    const workerCount = Math.min(this.maxWorkers, Math.max(pending.length, 1));
    await Promise.all([
      ...Array.from({ length: workerCount }, () => worker()),
      this._prepAhead(job, pending, () => cursor, shouldStop),
    ]);

    while (!shouldStop() && cursor < pending.length) {
      const tx = pending[cursor++];
      if (tx?.status === TX_STATUS.PENDING) {
        await processOne(tx);
      }
    }

    return { results, stopped: shouldStop() };
  }

  async _prepAhead(job, pending, getCursor, shouldStop) {
    const ahead = 6;
    const deviceId = job.device;

    while (!shouldStop()) {
      const cursor = getCursor();

      let workDone = true;
      for (let i = cursor; i < pending.length; i++) {
        if (pending[i]?.status === TX_STATUS.PENDING) {
          workDone = false;
          break;
        }
      }
      if (workDone) break;

      let anyPrepped = false;
      for (let i = cursor; i < Math.min(cursor + ahead, pending.length); i++) {
        const tx = pending[i];
        if (!tx || tx._prepped || tx.status !== TX_STATUS.PENDING) continue;

        const remoteStat = await adbStat(deviceId, tx.dst);
        anyPrepped = true;

        if (remoteStat && !tx.overwrite) {
          if (job.jobState?.applyAll && job.jobState?.decision) {
            const dec = job.jobState.decision;
            console.log(`[adb:prep] APPLY-ALL: ${dec} silent for ${tx.name}`);
            if (dec === 'skip') {
              transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
              continue;
            }
            if (dec === 'overwrite') {
              transactionEngine.setOverwrite(tx.id, true);
            }
            if (dec === 'rename') {
              const suffix = tx.name.replace(/\.[^.]+$/, '');
              const ext = tx.name.match(/\.[^.]+$/)?.[0] || '';
              let newName = `${suffix} (copy)${ext}`;
              let newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
              let counter = 1;
              while (await adbStat(deviceId, newDst)) {
                newName = `${suffix} (${++counter})${ext}`;
                newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
              }
              transactionEngine.setDestination(tx.id, newDst);
              tx.dst = newDst;
            }
          } else if (job.conflictStrategy === 'skip') {
            console.log(`[adb:prep] SKIP (strategy=skip): ${tx.name}`);
            transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
            continue;
          } else if (job.conflictStrategy === 'overwrite') {
            console.log(`[adb:prep] OVERWRITE (strategy=overwrite): ${tx.name}`);
            transactionEngine.setOverwrite(tx.id, true);
          } else {
            continue;
          }
        }

        await ensureRemoteDir(deviceId, dirname(tx.dst));
        tx._prepped = true;
        console.log(`[adb:prep] prepped: ${tx.name}`);
      }

      if (!anyPrepped) await new Promise((r) => setTimeout(r, 50));
    }
  }

  async _processTransaction(tx, job, callbacks) {
    const deviceId = job.device;

    if (tx._prepped) {
      tx._prepped = false;
    } else {
      transactionEngine.updateStatus(tx.id, TX_STATUS.CONFLICT_CHECK);

      const remoteStat = await adbStat(deviceId, tx.dst);
      console.log(`[adb:tx:${tx.id}] conflict check: ${tx.dst} exists=${!!remoteStat} size=${remoteStat?.size || 'N/A'}`);

      if (remoteStat && !tx.overwrite) {
        if (job.jobState?.applyAll && job.jobState?.decision) {
          const dec = job.jobState.decision;
          console.log(`[adb:tx:${tx.id}] APPLY-ALL: ${dec} (silent)`);
          if (dec === 'skip') {
            transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
            return { action: 'skipped', tx };
          }
          if (dec === 'overwrite') {
            transactionEngine.setOverwrite(tx.id, true);
            tx.overwrite = true;
          }
          if (dec === 'rename') {
            const suffix = tx.name.replace(/\.[^.]+$/, '');
            const ext = tx.name.match(/\.[^.]+$/)?.[0] || '';
            let newName = `${suffix} (copy)${ext}`;
            let newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
            let counter = 1;
            while (await adbStat(deviceId, newDst)) {
              newName = `${suffix} (${++counter})${ext}`;
              newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
            }
            transactionEngine.setDestination(tx.id, newDst);
            tx.dst = newDst;
          }
        } else {
          const strategy = job.conflictStrategy || 'ask';

          if (strategy === 'skip') {
            console.log(`[adb:tx:${tx.id}] SKIP (strategy=skip, file exists)`);
            transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
            return { action: 'skipped', tx };
          }

          if (strategy === 'overwrite') {
            console.log(`[adb:tx:${tx.id}] OVERWRITE (strategy=overwrite)`);
            transactionEngine.setOverwrite(tx.id, true);
            tx.overwrite = true;
          } else {
            while (job.conflictLock) {
              await new Promise((r) => setTimeout(r, 50));
              if (job.status === 'cancelled' || job.status === 'paused') {
                return { action: 'deferred', tx };
              }
            }

            if (job.jobState?.applyAll && job.jobState?.decision) {
              const globalDec = job.jobState.decision;
              console.log(`[adb:tx:${tx.id}] APPLY-ALL: ${globalDec} (post-lock)`);
              if (globalDec === 'skip') {
                transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
                return { action: 'skipped', tx };
              }
              if (globalDec === 'overwrite') {
                transactionEngine.setOverwrite(tx.id, true);
                tx.overwrite = true;
              }
              if (globalDec === 'rename') {
                const suffix = tx.name.replace(/\.[^.]+$/, '');
                const ext = tx.name.match(/\.[^.]+$/)?.[0] || '';
                let newName = `${suffix} (copy)${ext}`;
                let newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
                let counter = 1;
                while (await adbStat(deviceId, newDst)) {
                  newName = `${suffix} (${++counter})${ext}`;
                  newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
                }
                transactionEngine.setDestination(tx.id, newDst);
                tx.dst = newDst;
              }
            } else {
              job.conflictLock = true;
              transactionEngine.updateStatus(tx.id, TX_STATUS.CONFLICT);
              job.status = 'waiting_conflict';
              transactionEngine.updateJobDbStatus(job);
              job.conflict = {
                txId: tx.id,
                name: tx.name,
                src: tx.src,
                dst: tx.dst,
                devicePath: tx.dst,
                existingSize: remoteStat.size,
                size: remoteStat.size,
              };
              callbacks.onProgress?.(job);
              callbacks.onConflict?.(job, tx);

              const decision = await callbacks.waitForConflictDecision?.(job, tx);
              job.conflictLock = false;

              if (job.jobState?.applyAll && job.jobState?.decision) {
                const globalDec = job.jobState.decision;
                job.status = 'running';
                job.conflict = null;
                transactionEngine.updateJobDbStatus(job);

                if (globalDec === 'skip') {
                  transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
                  return { action: 'skipped', tx };
                }
                if (globalDec === 'overwrite') {
                  transactionEngine.setOverwrite(tx.id, true);
                  tx.overwrite = true;
                }
                if (globalDec === 'rename') {
                  const suffix = tx.name.replace(/\.[^.]+$/, '');
                  const ext = tx.name.match(/\.[^.]+$/)?.[0] || '';
                  let newName = `${suffix} (copy)${ext}`;
                  let newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
                  let counter = 1;
                  while (await adbStat(deviceId, newDst)) {
                    newName = `${suffix} (${++counter})${ext}`;
                    newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${newName}`;
                  }
                  transactionEngine.setDestination(tx.id, newDst);
                  tx.dst = newDst;
                }
              } else {
                if (!decision || decision.action === 'cancel') {
                  job.status = 'cancelled';
                  transactionEngine.updateStatus(tx.id, TX_STATUS.CANCELLED);
                  transactionEngine.updateJobDbStatus(job);
                  return { action: 'cancelled', tx };
                }
                if (decision.action === 'skip') {
                  transactionEngine.updateStatus(tx.id, TX_STATUS.SKIPPED);
                  job.status = 'running';
                  job.conflict = null;
                  transactionEngine.updateJobDbStatus(job);
                  return { action: 'skipped', tx };
                }
                if (decision.action === 'rename' && decision.newDst) {
                  transactionEngine.setDestination(tx.id, decision.newDst);
                  tx.dst = decision.newDst;
                } else if (decision.action === 'overwrite') {
                  transactionEngine.setOverwrite(tx.id, true);
                  tx.overwrite = true;
                }
                job.status = 'running';
                job.conflict = null;
                transactionEngine.updateJobDbStatus(job);
              }
            }
          }
        }
      }
    }

    await ensureRemoteDir(deviceId, dirname(tx.dst));

    transactionEngine.updateStatus(tx.id, TX_STATUS.TRANSFERRING);
    callbacks.onProgress?.(job);

    const pushStart = Date.now();
    console.log(`[adb:tx:${tx.id}] PUSH: ${tx.src} -> ${tx.dst} (${formatSize(tx.size)})`);
    await runAdbPush(
      deviceId,
      tx.src,
      tx.dst,
      (parsed) => {
        const transferred = Math.round((parsed.percent / 100) * tx.size);
        transactionEngine.updateProgress(tx.id, transferred, parsed.speed);
        callbacks.onProgress?.(job);
      },
      (proc) => { job.activePushProcess = proc; }
    );
    job.activePushProcess = null;

    transactionEngine.updateStatus(tx.id, TX_STATUS.VERIFYING);
    let verify = await verifyFile(deviceId, tx.dst, tx.size);
    if (!verify.ok) {
      console.error(`[adb] VERIFY FAILED for ${tx.dst}: expected=${tx.size}, reason=${verify.reason}`);
      const err = new Error(`Verification failed: ${verify.reason}`);
      err.type = verify.reason === 'size_mismatch' ? ERROR_TYPES.SIZE_MISMATCH : ERROR_TYPES.FILE_MISSING;
      throw err;
    }

    transactionEngine.updateStatus(tx.id, TX_STATUS.METADATA);
    let metadataOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await applyMetadata(deviceId, tx.dst, tx.mtime, tx.mode);
        metadataOk = true;
        break;
      } catch (err) {
        if (attempt === 2) console.warn(`[adb] metadata failed for ${tx.dst}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    transactionEngine.updateStatus(tx.id, TX_STATUS.VERIFYING);
    verify = await verifyFile(deviceId, tx.dst, tx.size, metadataOk ? tx.mtime : null);
    if (!verify.ok && verify.reason === 'size_mismatch') {
      const err = new Error('Post-metadata size mismatch');
      err.type = ERROR_TYPES.SIZE_MISMATCH;
      throw err;
    }

    transactionEngine.updateStatus(tx.id, TX_STATUS.COMMITTED);
    transactionEngine.updateProgress(tx.id, tx.size, tx.size / Math.max(1, (Date.now() - pushStart) / 1000));
    callbacks.onProgress?.(job);
    console.log(`[adb:tx:${tx.id}] COMMITTED: ${tx.dst}`);

    return { action: 'committed', tx };
  }
}

export default AdbWorkerPool;
