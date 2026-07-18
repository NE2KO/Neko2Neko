import { statSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import db from '../db.js';

export const TX_STATUS = {
  PENDING: 'pending',
  CONFLICT_CHECK: 'checking',
  TRANSFERRING: 'transferring',
  VERIFYING: 'verifying',
  METADATA: 'metadata',
  COMMITTED: 'committed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
  CONFLICT: 'conflict',
};

const VALID_TRANSITIONS = {
  [TX_STATUS.PENDING]: [TX_STATUS.CONFLICT_CHECK, TX_STATUS.CANCELLED, TX_STATUS.SKIPPED],
  [TX_STATUS.CONFLICT_CHECK]: [TX_STATUS.TRANSFERRING, TX_STATUS.CONFLICT, TX_STATUS.SKIPPED, TX_STATUS.CANCELLED],
  [TX_STATUS.CONFLICT]: [TX_STATUS.PENDING, TX_STATUS.SKIPPED, TX_STATUS.CANCELLED],
  [TX_STATUS.TRANSFERRING]: [TX_STATUS.VERIFYING, TX_STATUS.FAILED, TX_STATUS.CANCELLED],
  [TX_STATUS.VERIFYING]: [TX_STATUS.METADATA, TX_STATUS.FAILED],
  [TX_STATUS.METADATA]: [TX_STATUS.VERIFYING, TX_STATUS.COMMITTED, TX_STATUS.FAILED],
  [TX_STATUS.FAILED]: [TX_STATUS.PENDING],
  [TX_STATUS.COMMITTED]: [],
  [TX_STATUS.SKIPPED]: [],
  [TX_STATUS.CANCELLED]: [],
};

function newTxId() {
  return `tx_${randomBytes(6).toString('hex')}`;
}

function joinRemote(base, ...parts) {
  const cleaned = base.replace(/\/+$/, '');
  const rest = parts.join('/').replace(/^\/+/, '');
  return rest ? `${cleaned}/${rest}` : cleaned;
}

function walkDirectory(localDir, remoteBase, relativePrefix, files) {
  const entries = readdirSync(localDir);
  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const localPath = join(localDir, name);
    const relPath = relativePrefix ? `${relativePrefix}/${name}` : name;
    try {
      const stat = statSync(localPath);
      if (stat.isDirectory()) {
        walkDirectory(localPath, remoteBase, relPath, files);
      } else if (stat.isFile()) {
        files.push({
          src: localPath,
          dst: joinRemote(remoteBase, relPath),
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs / 1000),
          mode: '644',
          name: basename(localPath),
          relativePath: relPath,
        });
      }
    } catch {
      // skip inaccessible entries
    }
  }
}

export function expandSourcesToFiles(sources, destDir) {
  const files = [];
  const normalizedDest = destDir.replace(/\/+$/, '') || '/';

  for (const source of sources) {
    if (!existsSync(source)) continue;
    const stat = statSync(source);
    const sourceName = basename(source);

    if (stat.isFile()) {
      files.push({
        src: source,
        dst: joinRemote(normalizedDest, sourceName),
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs / 1000),
        mode: '644',
        name: sourceName,
        relativePath: sourceName,
      });
    } else if (stat.isDirectory()) {
      walkDirectory(source, joinRemote(normalizedDest, sourceName), '', files);
    }
  }

  return files;
}

// Prepared statements for DB persistence
const stmts = {
  insertTx: db.prepare(`
    INSERT INTO adb_transactions (id, job_id, device, src, dst, size, mtime, mode, name, relative_path, status, attempts, max_attempts, overwrite, error, error_type, transferred_bytes, speed, created_at, started_at, completed_at)
    VALUES (@id, @jobId, @device, @src, @dst, @size, @mtime, @mode, @name, @relativePath, @status, @attempts, @maxAttempts, @overwrite, @error, @errorType, @transferredBytes, @speed, @createdAt, @startedAt, @completedAt)
  `),
  updateTx: db.prepare(`
    UPDATE adb_transactions SET
      status = @status, attempts = @attempts, overwrite = @overwrite,
      error = @error, error_type = @errorType, transferred_bytes = @transferredBytes,
      speed = @speed, started_at = @startedAt, completed_at = @completedAt,
      dst = @dst, name = @name
    WHERE id = @id
  `),
  getTx: db.prepare('SELECT * FROM adb_transactions WHERE id = ?'),
  getTxsByJob: db.prepare('SELECT * FROM adb_transactions WHERE job_id = ? ORDER BY created_at ASC'),
  deleteTxsByJob: db.prepare('DELETE FROM adb_transactions WHERE job_id = ?'),
  getFailedTxs: db.prepare("SELECT * FROM adb_transactions WHERE job_id = ? AND status = 'failed'"),
  getPendingTxs: db.prepare("SELECT * FROM adb_transactions WHERE job_id = ? AND status = 'pending'"),
  getStuckTxs: db.prepare("SELECT * FROM adb_transactions WHERE status IN ('transferring', 'verifying', 'metadata', 'checking', 'conflict')"),
  // Job persistence
  insertJob: db.prepare(`
    INSERT OR REPLACE INTO adb_jobs (id, type, device_id, device_serial, device_ip, sources_json, dest, status, conflict_strategy, apply_all, apply_all_decision, max_workers, engine, progress, speed, current_file, error, created_at, updated_at, completed_at)
    VALUES (@id, @type, @device_id, @device_serial, @device_ip, @sources_json, @dest, @status, @conflict_strategy, @apply_all, @apply_all_decision, @max_workers, @engine, @progress, @speed, @current_file, @error, @created_at, @updated_at, @completed_at)
  `),
  updateJobStatus: db.prepare(`
    UPDATE adb_jobs SET status = @status, progress = @progress, speed = @speed, current_file = @current_file, error = @error, conflict_strategy = @conflict_strategy, apply_all = @apply_all, apply_all_decision = @apply_all_decision, updated_at = @updated_at, completed_at = @completed_at WHERE id = @id
  `),
  getActiveJobs: db.prepare("SELECT * FROM adb_jobs WHERE status IN ('queued','running','paused','waiting_conflict')"),
  getJob: db.prepare('SELECT * FROM adb_jobs WHERE id = ?'),
  deleteJobRow: db.prepare('DELETE FROM adb_jobs WHERE id = ?'),
};

class TransactionEngine {
  constructor() {
    this.transactions = new Map();
    this.jobIndex = new Map();
  }

  // Load stuck transactions from DB on startup (crash recovery)
  recoverStuckTransactions() {
    const stuck = stmts.getStuckTxs.all();
    let recovered = 0;
    for (const row of stuck) {
      const tx = this._rowToTx(row);
      // Reset ALL stuck states back to pending for clean retry
      if ([TX_STATUS.TRANSFERRING, TX_STATUS.CONFLICT_CHECK, TX_STATUS.VERIFYING, TX_STATUS.METADATA, TX_STATUS.CONFLICT].includes(tx.status)) {
        tx.status = TX_STATUS.PENDING;
        tx.error = 'reset after crash';
        this._persistTx(tx);
      }
      this.transactions.set(tx.id, tx);
      if (!this.jobIndex.has(tx.jobId)) this.jobIndex.set(tx.jobId, []);
      this.jobIndex.get(tx.jobId).push(tx.id);
      recovered++;
    }
    if (recovered > 0) {
      console.log(`[adb:tx] Recovered ${recovered} stuck transaction(s) from DB`);
    }
    return recovered;
  }

  // Persist a job to adb_jobs table
  saveJob(job) {
    try {
      stmts.insertJob.run({
        id: job.id,
        type: job.type || 'push',
        device_id: job.device || '',
        device_serial: job.deviceSerial || '',
        device_ip: job.deviceIp || '',
        sources_json: JSON.stringify(job.sources || []),
        dest: job.dest || '',
        status: job.status || 'queued',
        conflict_strategy: job.conflictStrategy || null,
        apply_all: (job.jobState?.applyAll) ? 1 : 0,
        apply_all_decision: job.jobState?.decision || null,
        max_workers: job.maxWorkers || 3,
        engine: job.engine || 'transactional',
        progress: job.progress || 0,
        speed: job.speed || 0,
        current_file: job.currentFile || null,
        error: job.error || null,
        created_at: job.createdAt || Date.now(),
        updated_at: Date.now(),
        completed_at: job.completedAt || null,
      });
    } catch (e) {
      console.error(`[adb:tx] saveJob error for ${job.id}:`, e.message);
    }
  }

  // Update job status in DB (partial update for status transitions)
  updateJobDbStatus(job) {
    try {
      stmts.updateJobStatus.run({
        id: job.id,
        status: job.status || 'queued',
        progress: job.progress || 0,
        speed: job.speed || 0,
        current_file: job.currentFile || null,
        error: job.error || null,
        conflict_strategy: job.conflictStrategy || null,
        apply_all: (job.jobState?.applyAll) ? 1 : 0,
        apply_all_decision: job.jobState?.decision || null,
        updated_at: Date.now(),
        completed_at: job.completedAt || null,
      });
    } catch (e) {
      console.error(`[adb:tx] updateJobDbStatus error for ${job.id}:`, e.message);
    }
  }

  // Load active jobs from DB (crash recovery)
  recoverActiveJobs() {
    try {
      const rows = stmts.getActiveJobs.all();
      if (rows.length > 0) {
        console.log(`[adb:tx] Recovered ${rows.length} active job(s) from DB`);
      }
      return rows;
    } catch (e) {
      console.error('[adb:tx] recoverActiveJobs error:', e.message);
      return [];
    }
  }

  // Delete a job from DB
  deleteJobDb(jobId) {
    try { stmts.deleteJobRow.run(jobId); } catch {}
  }

  _rowToTx(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      device: row.device,
      src: row.src,
      dst: row.dst,
      size: row.size,
      mtime: row.mtime,
      mode: row.mode,
      name: row.name,
      relativePath: row.relative_path,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      overwrite: row.overwrite === 1,
      error: row.error,
      errorType: row.error_type,
      transferredBytes: row.transferred_bytes,
      speed: row.speed,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  _persistTx(tx) {
    try {
      stmts.insertTx.run({
        id: tx.id,
        jobId: tx.jobId,
        device: tx.device,
        src: tx.src,
        dst: tx.dst,
        size: tx.size,
        mtime: tx.mtime,
        mode: tx.mode,
        name: tx.name,
        relativePath: tx.relativePath,
        status: tx.status,
        attempts: tx.attempts,
        maxAttempts: tx.maxAttempts,
        overwrite: tx.overwrite ? 1 : 0,
        error: tx.error,
        errorType: tx.errorType,
        transferredBytes: tx.transferredBytes,
        speed: tx.speed,
        createdAt: tx.createdAt,
        startedAt: tx.startedAt,
        completedAt: tx.completedAt,
      });
    } catch (e) {
      // If insert fails (duplicate), update instead
      this._updatePersistedTx(tx);
    }
  }

  _updatePersistedTx(tx) {
    try {
      stmts.updateTx.run({
        id: tx.id,
        status: tx.status,
        attempts: tx.attempts,
        overwrite: tx.overwrite ? 1 : 0,
        error: tx.error,
        errorType: tx.errorType,
        transferredBytes: tx.transferredBytes,
        speed: tx.speed,
        startedAt: tx.startedAt,
        completedAt: tx.completedAt,
        dst: tx.dst,
        name: tx.name,
      });
    } catch (e) {
      console.error(`[adb:tx] DB persist error for ${tx.id}:`, e.message);
    }
  }

  createTransactions(jobId, deviceId, fileEntries, options = {}) {
    const txIds = [];
    const overwriteSet = new Set(options.overwritePaths || []);
    const skipSet = new Set(options.skipPaths || []);
    const renameMap = options.renameMap || {};

    const insertMany = db.transaction((entries) => {
      for (const file of entries) {
        let dst = file.dst;
        if (renameMap[file.src]) {
          const newName = renameMap[file.src];
          const parent = dst.substring(0, dst.lastIndexOf('/'));
          dst = `${parent}/${newName}`;
        }

        const tx = {
          id: newTxId(),
          jobId,
          device: deviceId,
          src: file.src,
          dst,
          size: file.size,
          mtime: file.mtime,
          mode: file.mode || '644',
          name: file.name || basename(file.src),
          relativePath: file.relativePath || basename(file.src),
          status: skipSet.has(file.src) ? TX_STATUS.SKIPPED : TX_STATUS.PENDING,
          attempts: 0,
          maxAttempts: 3,
          overwrite: overwriteSet.has(file.src) || overwriteSet.has(file.dst),
          error: null,
          errorType: null,
          transferredBytes: 0,
          speed: 0,
          createdAt: Date.now(),
          startedAt: null,
          completedAt: null,
        };

        this.transactions.set(tx.id, tx);
        this._persistTx(tx);
        txIds.push(tx.id);
      }
    });

    insertMany(fileEntries);
    this.jobIndex.set(jobId, txIds);
    return txIds.map((id) => this.transactions.get(id));
  }

  getTransaction(txId) {
    return this.transactions.get(txId) || null;
  }

  getTransactions(jobId) {
    const ids = this.jobIndex.get(jobId) || [];
    return ids.map((id) => this.sanitize(this.transactions.get(id))).filter(Boolean);
  }

  getFailedTransactions(jobId) {
    return this.getTransactions(jobId).filter((tx) => tx.status === TX_STATUS.FAILED);
  }

  getPendingTransactions(jobId) {
    const ids = this.jobIndex.get(jobId) || [];
    return ids
      .map((id) => this.transactions.get(id))
      .filter((tx) => tx && tx.status === TX_STATUS.PENDING);
  }

  updateStatus(txId, newStatus, error = null, errorType = null) {
    const tx = this.transactions.get(txId);
    if (!tx) return false;

    const allowed = VALID_TRANSITIONS[tx.status] || [];
    if (!allowed.includes(newStatus) && tx.status !== newStatus) {
      if (newStatus !== tx.status) return false;
    }

    tx.status = newStatus;
    if (error) tx.error = error;
    if (errorType) tx.errorType = errorType;

    if (newStatus === TX_STATUS.TRANSFERRING && !tx.startedAt) {
      tx.startedAt = Date.now();
    }
    if ([TX_STATUS.COMMITTED, TX_STATUS.FAILED, TX_STATUS.SKIPPED, TX_STATUS.CANCELLED].includes(newStatus)) {
      tx.completedAt = Date.now();
    }

    this._updatePersistedTx(tx);
    return true;
  }

  incrementAttempt(txId) {
    const tx = this.transactions.get(txId);
    if (tx) {
      tx.attempts += 1;
      this._updatePersistedTx(tx);
    }
  }

  updateProgress(txId, transferredBytes, speed = 0) {
    const tx = this.transactions.get(txId);
    if (!tx) return;
    tx.transferredBytes = transferredBytes;
    if (speed > 0) tx.speed = speed;
    // Throttle DB persist: every 5s or every 5% change for resume accuracy
    const now = Date.now();
    const pct = tx.size > 0 ? (transferredBytes / tx.size) * 100 : 0;
    if (!tx._lastProgressPersist) tx._lastProgressPersist = 0;
    const pctChanged = tx.size > 0 ? Math.abs(pct - (tx._lastProgressPct || 0)) : 100;
    if (now - tx._lastProgressPersist > 5000 || pctChanged >= 5) {
      tx._lastProgressPersist = now;
      tx._lastProgressPct = pct;
      this._updatePersistedTx(tx);
    }
  }

  setDestination(txId, newDst) {
    const tx = this.transactions.get(txId);
    if (!tx) return false;
    tx.dst = newDst;
    tx.name = basename(newDst);
    tx.overwrite = false;
    tx.status = TX_STATUS.PENDING;
    tx.error = null;
    tx.errorType = null;
    tx.completedAt = null;
    this._updatePersistedTx(tx);
    return true;
  }

  setOverwrite(txId, overwrite = true) {
    const tx = this.transactions.get(txId);
    if (!tx) return false;
    tx.overwrite = overwrite;
    tx.status = TX_STATUS.PENDING;
    tx.error = null;
    tx.errorType = null;
    tx.completedAt = null;
    this._updatePersistedTx(tx);
    return true;
  }

  skipTransaction(txId) {
    return this.updateStatus(txId, TX_STATUS.SKIPPED);
  }

  resetFailed(jobId) {
    const ids = this.jobIndex.get(jobId) || [];
    let count = 0;
    for (const id of ids) {
      const tx = this.transactions.get(id);
      if (tx && tx.status === TX_STATUS.FAILED) {
        tx.status = TX_STATUS.PENDING;
        tx.error = null;
        tx.errorType = null;
        tx.completedAt = null;
        tx.transferredBytes = 0;
        this._updatePersistedTx(tx);
        count++;
      }
    }
    return count;
  }

  getJobSummary(jobId) {
    const txs = this.getTransactions(jobId);
    const total = txs.length;
    const committed = txs.filter((t) => t.status === TX_STATUS.COMMITTED).length;
    const failed = txs.filter((t) => t.status === TX_STATUS.FAILED).length;
    const skipped = txs.filter((t) => t.status === TX_STATUS.SKIPPED).length;
    const pending = txs.filter((t) =>
      [TX_STATUS.PENDING, TX_STATUS.CONFLICT_CHECK, TX_STATUS.TRANSFERRING, TX_STATUS.VERIFYING, TX_STATUS.METADATA, TX_STATUS.CONFLICT].includes(t.status)
    ).length;
    const totalBytes = txs.reduce((s, t) => s + (t.size || 0), 0);
    const transferredBytes = txs.reduce((s, t) => {
      if (t.status === TX_STATUS.COMMITTED) return s + t.size;
      return s + (t.transferredBytes || 0);
    }, 0);

    const active = txs.find((t) =>
      [TX_STATUS.TRANSFERRING, TX_STATUS.VERIFYING, TX_STATUS.METADATA, TX_STATUS.CONFLICT_CHECK].includes(t.status)
    );
    const done = committed + skipped + failed;
    const currentIndex = active ? txs.indexOf(active) + 1 : done;
    const pendingConflicts = txs.filter((t) =>
      [TX_STATUS.PENDING, TX_STATUS.CONFLICT_CHECK, TX_STATUS.CONFLICT].includes(t.status)
    ).length;

    return {
      total,
      committed,
      failed,
      skipped,
      pending,
      pendingConflicts,
      done,
      currentIndex,
      totalBytes,
      transferredBytes,
      currentFile: active ? active.name : null,
      currentTxId: active ? active.id : null,
    };
  }

  sanitize(tx) {
    if (!tx) return null;
    return {
      id: tx.id,
      jobId: tx.jobId,
      src: tx.src,
      dst: tx.dst,
      size: tx.size,
      mtime: tx.mtime,
      name: tx.name,
      status: tx.status,
      attempts: tx.attempts,
      error: tx.error,
      errorType: tx.errorType,
      transferredBytes: tx.transferredBytes,
      speed: tx.speed,
      overwrite: tx.overwrite,
      createdAt: tx.createdAt,
      startedAt: tx.startedAt,
      completedAt: tx.completedAt,
    };
  }

  removeJob(jobId) {
    const ids = this.jobIndex.get(jobId) || [];
    for (const id of ids) this.transactions.delete(id);
    this.jobIndex.delete(jobId);
    try { stmts.deleteTxsByJob.run(jobId); } catch {}
  }
}

const transactionEngine = new TransactionEngine();
export default transactionEngine;
