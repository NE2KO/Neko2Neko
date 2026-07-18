import { spawn, execSync, exec } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import transactionEngine, { expandSourcesToFiles, TX_STATUS } from './adbTransaction.js';
import AdbWorkerPool from './adbWorkerPool.js';
const execAsync = promisify(exec);

class ProgressStream extends Transform {
  constructor(totalBytes, onProgress) {
    super({ highWaterMark: 4 * 1024 * 1024 });
    this.transferred = 0;
    this.totalBytes = totalBytes;
    this.onProgress = onProgress;
    this.lastReport = 0;
    this.reportInterval = 500;
  }

  _transform(chunk, encoding, callback) {
    this.transferred += chunk.length;
    const now = Date.now();
    if (now - this.lastReport > this.reportInterval) {
      this.lastReport = now;
      this.onProgress(this.transferred, this.totalBytes);
    }
    this.push(chunk);
    callback();
  }

  _flush(callback) {
    this.onProgress(this.transferred, this.totalBytes, true);
    callback();
  }
}

function findCommonParent(paths) {
  if (paths.length === 0) return '/';
  if (paths.length === 1) {
    const p = paths[0];
    return statSync(p).isDirectory() ? p : p.substring(0, p.lastIndexOf('/') + 1) || '/';
  }

  const normalized = paths.map(p => p.replace(/\/+/g, '/').replace(/\/+$/, ''));
  const parts = normalized.map(p => p.split('/'));

  let common = [];
  for (let i = 0; i < parts[0].length; i++) {
    const segment = parts[0][i];
    if (parts.every(p => p[i] === segment)) {
      common.push(segment);
    } else {
      break;
    }
  }

  return common.join('/') || '/';
}

function findCommonParentStr(paths) {
  if (paths.length === 0) return '/';
  if (paths.length === 1) {
    const p = paths[0].replace(/\/+/g, '/').replace(/\/+$/, '');
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : '/';
  }

  const normalized = paths.map(p => p.replace(/\/+/g, '/').replace(/\/+$/, ''));
  const parts = normalized.map(p => p.split('/'));

  let common = [];
  for (let i = 0; i < parts[0].length; i++) {
    const segment = parts[0][i];
    if (parts.every(p => p[i] === segment)) {
      common.push(segment);
    } else {
      break;
    }
  }

  return common.join('/') || '/';
}

function escapeShellSingle(path) {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

// Safe ADB command execution using spawn (no shell interpretation)
function adbExec(deviceId, args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('adb', ['-s', deviceId, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `adb exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function parseLsOutput(stdout) {
  const entries = [];
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('total') || line.trim() === '') continue;

    const trimmed = line.trimStart();
    const first = trimmed[0];
    if (first !== '-' && first !== 'd' && first !== 'l') continue;

    const type = first === 'd' ? 'dir' : 'file';

    const parts = trimmed.split(/\s+/);
    if (parts.length < 8) continue;

    const size = parseInt(parts[4], 10);
    if (isNaN(size)) continue;

    let mtime = 0;
    let nameStartIdx = -1;

    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[5]) && parts[6] && /^\d{2}:\d{2}$/.test(parts[6])) {
      const dateStr = `${parts[5]}T${parts[6]}:00`;
      const ts = new Date(dateStr).getTime();
      if (!isNaN(ts)) mtime = Math.floor(ts / 1000);
      nameStartIdx = 7;
    } else if (/^[A-Z][a-z]{2}$/.test(parts[5])) {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthIdx = monthNames.indexOf(parts[5]);
      if (monthIdx === -1) continue;
      const day = parseInt(parts[6], 10);
      if (isNaN(day)) continue;
      const timeOrYear = parts[7];
      if (!timeOrYear) continue;

      let year, time;
      if (timeOrYear.includes(':')) {
        year = new Date().getFullYear();
        time = timeOrYear;
      } else {
        year = parseInt(timeOrYear, 10);
        time = '00:00';
      }
      const dateStr = `${parts[5]} ${day} ${year} ${time}`;
      const ts = new Date(dateStr).getTime();
      if (!isNaN(ts)) mtime = Math.floor(ts / 1000);
      nameStartIdx = 8;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(parts[5]) && parts[6] && /^\d{4}$/.test(parts[6])) {
      const dateStr = `${parts[5]}T${parts[6]}-01-01T00:00:00`;
      nameStartIdx = 7;
    }

    if (nameStartIdx === -1) continue;
    const name = parts.slice(nameStartIdx).join(' ');
    if (!name || name === '.' || name === '..') continue;

    entries.push({ type, size, mtime, name });
  }

  return entries;
}

const deviceCache = { devices: [], timestamp: 0 };
const DEVICE_CACHE_TTL = 3000;

class AdbManager {
  constructor() {
    this.jobs = new Map();
    this.jobIdCounter = 0;
    this.deviceQueues = new Map();

    // Crash recovery: reset stuck transactions + restore active jobs
    try {
      transactionEngine.recoverStuckTransactions();
      this._recoverJobs();
    } catch (e) {
      console.error('[adb] Recovery failed:', e.message);
    }
  }

  // Recover active jobs from DB after restart
  _recoverJobs() {
    const rows = transactionEngine.recoverActiveJobs();
    for (const row of rows) {
      let sources;
      try { sources = JSON.parse(row.sources_json); } catch { sources = []; }
      const job = {
        id: row.id,
        type: row.type || 'push',
        device: row.device_id,
        deviceSerial: row.device_serial || '',
        deviceIp: row.device_ip || '',
        sources,
        dest: row.dest,
        status: 'queued', // start fresh from queue
        progress: 0,
        totalBytes: 0,
        transferredBytes: 0,
        speed: 0,
        eta: null,
        error: null,
        createdAt: row.created_at,
        startedAt: null,
        completedAt: null,
        process: null,
        sseClients: new Set(),
        engine: row.engine || 'transactional',
        txOptions: {},
        maxWorkers: row.max_workers || 3,
        conflictStrategy: row.conflict_strategy || 'ask',
        conflict: null,
        conflictLock: false,
        currentFile: null,
        activePushProcess: null,
        jobState: {
          applyAll: row.apply_all === 1,
          decision: row.apply_all_decision || null,
          scope: row.apply_all === 1 ? 'recovered' : 'none',
        },
        _recovered: true,
      };
      // Try auto-resolve device (in case port changed)
      if (row.device_serial) {
        const resolved = this._syncFindDeviceBySerial(row.device_serial);
        if (resolved && resolved.id !== row.device_id) {
          console.log(`[adb] Re-mapped job ${job.id} device ${row.device_id} → ${resolved.id}`);
          job.device = resolved.id;
        }
      }
      this.jobs.set(job.id, job);
      this._enqueue(job.device, job.id);
      console.log(`[adb] Recovered job ${job.id} (${sources.length} files → ${job.dest})`);
    }
  }

  // Sync ADB device lookup for crash recovery (no cache, no async)
  _syncFindDeviceBySerial(serial) {
    try {
      const output = execSync('adb devices -l', { timeout: 3000, encoding: 'utf-8' });
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2 || parts[1] !== 'device') continue;
        const isTcpIp = parts[0].includes(':');
        const devSerial = isTcpIp ? parts[0].split(':')[0] : parts[0];
        if (devSerial === serial) return { id: parts[0], serial: devSerial, isTcpIp };
      }
    } catch {}
    return null;
  }

  async getDevices() {
    const now = Date.now();
    if (deviceCache.devices.length > 0 && now - deviceCache.timestamp < DEVICE_CACHE_TTL) {
      return deviceCache.devices;
    }

    try {
      const output = execSync('adb devices -l', { timeout: 5000, encoding: 'utf-8' });
      const lines = output.split('\n').filter(Boolean);
      const devices = [];

      for (const line of lines) {
        if (line.startsWith('List of devices') || line.startsWith('*') || line.trim() === '') continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        if (parts[1] !== 'device' && parts[1] !== 'recovery' && parts[1] !== 'sideload') continue;

        const isTcpIp = parts[0].includes(':');
        const device = {
          id: parts[0],
          state: parts[1],
          deviceSerial: isTcpIp ? parts[0].split(':')[0] : parts[0],
          isTcpIp,
        };
        for (let i = 2; i < parts.length; i++) {
          if (parts[i].startsWith('model:')) {
            device.model = parts[i].replace('model:', '').replace(/_/g, ' ');
          }
          if (parts[i].startsWith('product:')) {
            device.product = parts[i].replace('product:', '');
          }
          if (parts[i].startsWith('usb:')) {
            device.usb = parts[i].replace('usb:', '');
          }
          if (parts[i].startsWith('transport_id:')) {
            device.transportId = parts[i].replace('transport_id:', '');
          }
        }
        devices.push(device);
      }

      deviceCache.devices = devices;
      deviceCache.timestamp = now;
      return devices;
    } catch (err) {
      console.error('[adb] Failed to list devices:', err.message);
      return [];
    }
  }

  async listDir(deviceId, path) {
    try {
      // Use spawn with separate args — path is passed as-is, no shell splitting
      const output = await adbExec(deviceId, ['shell', 'ls', '-la', path], 10000);
      return parseLsOutput(output);
    } catch (err) {
      const msg = err.stderr || err.message || 'Unknown error';
      if (msg.includes('No such file or directory') || msg.includes('No such directory')) {
        throw Object.assign(new Error('Directory not found'), { code: 'ENOENT' });
      }
      if (msg.includes('Permission denied')) {
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      }
      throw new Error(`adb ls failed: ${msg}`);
    }
  }

  async getDeviceStat(deviceId, path) {
    try {
      const output = await adbExec(deviceId, ['shell', 'ls', '-ld', path], 5000);
      const entries = parseLsOutput(output);
      return entries[0] || null;
    } catch {
      return null;
    }
  }

  async checkDuplicates(deviceId, sources, destDir) {
    const results = [];
    for (const sourcePath of sources) {
      const sourceName = sourcePath.split('/').filter(Boolean).pop();
      const devicePath = destDir.endsWith('/') ? destDir + sourceName : destDir + '/' + sourceName;
      try {
        const entry = await this.getDeviceStat(deviceId, devicePath);
        if (entry) {
          results.push({
            source: sourcePath,
            devicePath,
            exists: true,
            size: entry.size,
            name: sourceName,
          });
        } else {
          results.push({ source: sourcePath, devicePath, exists: false, name: sourceName });
        }
      } catch {
        results.push({ source: sourcePath, devicePath, exists: false, name: sourceName });
      }
    }
    return results;
  }

  listLocalDir(path) {
    try {
      const entries = readdirSync(path);
      const result = [];

      for (const name of entries) {
        if (name === '.' || name === '..') continue;
        try {
          const fullPath = path.endsWith('/') ? path + name : path + '/' + name;
          const stat = statSync(fullPath);
          result.push({
            type: stat.isDirectory() ? 'dir' : 'file',
            name,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs / 1000),
          });
        } catch {
          result.push({ type: 'file', name, size: 0, mtime: 0 });
        }
      }

      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });

      return { entries: result, path };
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw Object.assign(new Error('Directory not found'), { code: 'ENOENT' });
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      }
      throw err;
    }
  }

  statLocalDir(path) {
    try {
      if (!existsSync(path)) return null;
      const stat = statSync(path);
      return {
        type: stat.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs / 1000),
        name: path.split('/').filter(Boolean).pop() || '/',
      };
    } catch {
      return null;
    }
  }

  async getLocalTotalSize(sources) {
    try {
      if (sources.length === 1) {
        const s = statSync(sources[0]);
        if (s.isFile()) return s.size;
      }
      const { stdout } = await execAsync(
        `du -sb ${sources.map(s => escapeShellSingle(s)).join(' ')} 2>/dev/null | tail -1`,
        { timeout: 60000 }
      );
      const match = stdout.match(/^(\d+)/);
      if (match) return parseInt(match[1], 10);
    } catch (err) {
      console.error('[adb] getLocalTotalSize failed:', err.message);
    }
    return 0;
  }

  async getDeviceTotalSize(deviceId, sources) {
    try {
      // Build shell command with properly quoted paths for device shell
      const shellCmd = `du -sk ${sources.map(s => escapeShellSingle(s)).join(' ')} 2>/dev/null | tail -1`;
      const stdout = await adbExec(deviceId, ['shell', shellCmd], 60000);
      const match = stdout.match(/^(\d+)/);
      if (match) return parseInt(match[1], 10) * 1024;
    } catch (err) {
      console.error('[adb] getDeviceTotalSize failed:', err.message);
    }
    return 0;
  }

  _getDeviceIdentity(deviceId) {
    const isTcpIp = deviceId.includes(':');
    return {
      serial: isTcpIp ? deviceId.split(':')[0] : deviceId,
      ip: isTcpIp ? deviceId.split(':')[0] : '',
    };
  }

  async _findDeviceByIdentity(deviceSerial) {
    const devices = await this.getDevices();
    // Exact match by serial or IP
    const exact = devices.find(d => d.deviceSerial === deviceSerial);
    if (exact) return exact;
    // For IP serials, also try matching device ID directly
    return devices.find(d => d.id === deviceSerial) || null;
  }

  push(deviceId, sources, destDir, options = {}) {
    const jobId = `push_${++this.jobIdCounter}_${Date.now()}`;
    const ident = this._getDeviceIdentity(deviceId);
    const job = {
      id: jobId,
      type: 'push',
      device: deviceId,
      deviceSerial: ident.serial,
      deviceIp: ident.ip,
      sources: [...sources],
      dest: destDir,
      status: 'queued',
      progress: 0,
      totalBytes: 0,
      transferredBytes: 0,
      speed: 0,
      eta: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      process: null,
      sseClients: new Set(),
      engine: 'transactional',
      txOptions: options.txOptions || {},
      maxWorkers: options.maxWorkers || 3,
      conflictStrategy: options.conflictStrategy || 'ask', // 'skip' | 'overwrite' | 'ask'
      conflict: null,
      conflictLock: false,
      currentFile: null,
      activePushProcess: null,
      // Per-job conflict state (applyAll)
      jobState: {
        applyAll: false,
        decision: null,   // 'skip' | 'overwrite' | 'rename'
        scope: 'none',    // 'none' | 'queue'
      },
    };

    this.jobs.set(jobId, job);
    transactionEngine.saveJob(job);
    this._enqueue(deviceId, jobId);
    return jobId;
  }

  pull(deviceId, sources, destDir) {
    const jobId = `pull_${++this.jobIdCounter}_${Date.now()}`;
    const ident = this._getDeviceIdentity(deviceId);
    const job = {
      id: jobId,
      type: 'pull',
      device: deviceId,
      deviceSerial: ident.serial,
      deviceIp: ident.ip,
      sources: [...sources],
      dest: destDir,
      status: 'queued',
      progress: 0,
      totalBytes: 0,
      transferredBytes: 0,
      speed: 0,
      eta: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      process: null,
      sseClients: new Set(),
    };

    this.jobs.set(jobId, job);
    transactionEngine.saveJob(job);
    this._enqueue(deviceId, jobId);
    return jobId;
  }

  _enqueue(deviceId, jobId) {
    if (!this.deviceQueues.has(deviceId)) {
      this.deviceQueues.set(deviceId, []);
    }
    const queue = this.deviceQueues.get(deviceId);
    const isRunning = [...this.jobs.values()].some(j =>
      j.device === deviceId && ['running', 'paused', 'waiting_conflict'].includes(j.status)
    );
    queue.push(jobId);
    if (!isRunning) {
      this._processQueue(deviceId);
    }
  }

  async _processQueue(deviceId) {
    const queue = this.deviceQueues.get(deviceId);
    if (!queue || queue.length === 0) return;

    const jobId = queue[0];
    const job = this.jobs.get(jobId);
    if (!job) {
      queue.shift();
      this._processQueue(deviceId);
      return;
    }

    try {
      if (job.type === 'push') {
        await this._executePush(job);
      } else {
        await this._executePull(job);
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = Date.now();
      this._broadcastJob(job);
      transactionEngine.updateJobDbStatus(job);
    }

    queue.shift();
    this._processQueue(deviceId);
  }

  async _calculateTotalSize(job) {
    if (job.type === 'push') {
      job.totalBytes = await this.getLocalTotalSize(job.sources);
    } else {
      job.totalBytes = await this.getDeviceTotalSize(job.device, job.sources);
    }
  }

  _buildTarArgs(sources) {
    const commonParent = findCommonParentStr(sources);

    let tarArgs;
    if (commonParent === '/') {
      tarArgs = ['cf', '-', '--transform', 's|^/||', '--warning', 'none', ...sources];
    } else {
      const relPaths = sources.map(s => {
        const rel = s.startsWith(commonParent + '/') ? s.slice(commonParent.length + 1) : s;
        return rel;
      });

      tarArgs = ['cf', '-', '-C', commonParent, ...relPaths];
    }

    return { tarArgs, commonParent };
  }

  async _executePush(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    this._broadcastJob(job);
    transactionEngine.updateJobDbStatus(job);

    const fileEntries = expandSourcesToFiles(job.sources, job.dest);
    if (fileEntries.length === 0) {
      job.status = 'failed';
      job.error = 'No files found in selected sources';
      job.completedAt = Date.now();
      this._broadcastJob(job);
      transactionEngine.updateJobDbStatus(job);
      return;
    }

    if (transactionEngine.getTransactions(job.id).length === 0) {
      transactionEngine.createTransactions(job.id, job.device, fileEntries, job.txOptions || {});
    }

    job.totalBytes = fileEntries.reduce((s, f) => s + f.size, 0);
    console.log(`[adb:push:${job.id}] Transactional push: ${fileEntries.length} file(s), ${job.totalBytes} bytes → ${job.dest}`);

    const pool = new AdbWorkerPool(job.maxWorkers || 3);

    while (true) {
      if (job.status === 'cancelled') break;

      if (job.status === 'paused') {
        await this._waitUntilResumed(job);
        if (job.status === 'cancelled') break;
        job.status = 'running';
      }

      await pool.processJob(job, {
        onProgress: (j) => this._updateJobFromTransactions(j),
        onConflict: (j, tx) => this._broadcastConflict(j, tx),
        waitForConflictDecision: (j) => this._waitForConflictDecision(j),
      });

      if (job.status === 'waiting_conflict') {
        await this._waitForConflictDecision(job);
        if (job.status === 'cancelled') break;
        job.status = 'running';
        job.conflict = null;
        continue;
      }

      const pending = transactionEngine.getPendingTransactions(job.id);
      if (pending.length === 0) break;
      if (job.status !== 'running') break;
    }

    this._finalizeTransactionalJob(job);
  }

  _updateJobFromTransactions(job) {
    const summary = transactionEngine.getJobSummary(job.id);
    const prevTransferred = job.transferredBytes || 0;
    job.transferredBytes = summary.transferredBytes;
    job.totalBytes = summary.totalBytes;
    job.progress = summary.totalBytes > 0
      ? Math.min(100, Math.round((summary.transferredBytes / summary.totalBytes) * 100))
      : 0;
    job.currentFile = summary.currentFile;
    job.txSummary = summary;
    const now = Date.now();

    // Tier 1: Use ADB-reported speed from active transaction (most accurate)
    const activeTx = summary.currentTxId
      ? transactionEngine.getTransaction(summary.currentTxId)
      : null;
    if (activeTx && activeTx.status === 'transferring' && activeTx.speed > 0) {
      job.speed = activeTx.speed;
      job._lastGoodSpeed = job.speed;
      job._lastSpeedTime = now;
    } else if (activeTx && activeTx.status === 'transferring' && activeTx.transferredBytes > 0 && activeTx.startedAt) {
      // Tier 1b: ADB didn't report speed — calculate from transferred bytes
      const secs = (now - activeTx.startedAt) / 1000;
      if (secs > 1) {
        job.speed = Math.round(activeTx.transferredBytes / secs);
        job._lastGoodSpeed = job.speed;
        job._lastSpeedTime = now;
      }
    }
    // Tier 2: During verify/metadata, keep last known speed (don't drop to 0)
    else if (activeTx && (activeTx.status === 'verifying' || activeTx.status === 'metadata')) {
      job.speed = job._lastGoodSpeed || 0;
    }
    // Tier 3: Sliding window from transferred bytes + last good speed cache
    else {
      if (!job._speedWindow) job._speedWindow = [];
      const deltaBytes = summary.transferredBytes - prevTransferred;
      if (deltaBytes > 0) {
        job._speedWindow.push({ bytes: deltaBytes, time: now });
      }
      const cutoff = now - 3000;
      job._speedWindow = job._speedWindow.filter(s => s.time >= cutoff);

      if (job._speedWindow.length >= 2) {
        const windowBytes = job._speedWindow.reduce((s, e) => s + e.bytes, 0);
        const windowMs = job._speedWindow[job._speedWindow.length - 1].time - job._speedWindow[0].time;
        if (windowMs > 0) {
          job.speed = Math.round(windowBytes / (windowMs / 1000));
          job._lastGoodSpeed = job.speed;
          job._lastSpeedTime = now;
        }
      } else if (summary.transferredBytes > 0) {
        const secs = (now - (job.startedAt || now)) / 1000;
        if (secs > 0) {
          job.speed = Math.round(summary.transferredBytes / secs);
          job._lastGoodSpeed = job.speed;
          job._lastSpeedTime = now;
        }
      } else {
        job.speed = job._lastGoodSpeed && job._lastSpeedTime && (now - job._lastSpeedTime) < 10000
          ? job._lastGoodSpeed
          : 0;
      }
    }

    if (job.speed > 0 && summary.totalBytes > 0) {
      job.eta = Math.max(0, Math.round((summary.totalBytes - summary.transferredBytes) / job.speed));
    }

    this._broadcastJob(job);
  }

  _finalizeTransactionalJob(job) {
    const summary = transactionEngine.getJobSummary(job.id);
    job.completedAt = Date.now();
    job.txSummary = summary;

    // Cleanup global conflict state — prevent stale applyAll from leaking to next job
    job.jobState = { applyAll: false, decision: null, scope: null, timestamp: null };

    if (job.status === 'cancelled') {
      for (const tx of transactionEngine.getTransactions(job.id)) {
        if ([TX_STATUS.PENDING, TX_STATUS.CONFLICT, TX_STATUS.CONFLICT_CHECK].includes(tx.status)) {
          transactionEngine.updateStatus(tx.id, TX_STATUS.CANCELLED);
        }
      }
      this._updateJobFromTransactions(job);
      transactionEngine.updateJobDbStatus(job);
      return;
    }

    if (summary.failed > 0 && summary.committed === 0) {
      job.status = 'failed';
      job.error = `${summary.failed} of ${summary.total} file(s) failed`;
    } else if (summary.failed > 0) {
      job.status = 'completed';
      job.error = `${summary.failed} of ${summary.total} file(s) failed`;
      job.progress = Math.round((summary.committed / summary.total) * 100);
    } else {
      job.status = 'completed';
      job.progress = 100;
      job.transferredBytes = summary.totalBytes;
    }

    console.log(`[adb:push:${job.id}] Done: ${summary.committed}/${summary.total} committed, ${summary.failed} failed, ${summary.skipped} skipped`);
    this._broadcastJob(job);
    transactionEngine.updateJobDbStatus(job);
  }

  _waitForConflictDecision(job) {
    return new Promise((resolve) => {
      job._conflictResolve = resolve;
    });
  }

  _waitUntilResumed(job) {
    return new Promise((resolve) => {
      job._resumeResolve = resolve;
    });
  }

  _broadcastConflict(job, tx) {
    const payload = JSON.stringify({
      conflict: job.conflict,
      transaction: transactionEngine.sanitize(tx),
      job: this._sanitizeJob(job),
    });
    for (const client of job.sseClients) {
      try {
        client.write(`event: conflict\ndata: ${payload}\n\n`);
      } catch {}
    }
  }

  resolveConflict(jobId, decision) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Extract action — defensive programming
    const applyAll = decision?.applyAll === true;
    const action = decision?.action;
    
    if (!action) {
      console.warn(`[adb] resolveConflict: no action in decision`, decision);
      return false;
    }

    // PERSIST GLOBAL DECISION — ALWAYS, regardless of current status
    // This must happen BEFORE status check to avoid race condition
    if (applyAll) {
      job.jobState = {
        ...(job.jobState || {}),
        applyAll: true,
        decision: action,  // ✅ Guaranteed to be set
        scope: 'queue',
        timestamp: Date.now(),
      };
      console.log(`[adb:push:${jobId}] APPLY-ALL SET: action=${action} (global persistent)`);
      transactionEngine.updateJobDbStatus(job);
    }

    // Status check ONLY for resolving current conflict
    // If status already changed, applyAll is still set — worker will pick it up
    if (job.status !== 'waiting_conflict') {
      if (applyAll) {
        // State saved, worker will apply on next conflict automatically
        this._broadcastJob(job);
        return true;
      }
      return false;
    }

    // Handle applyAll: resolve current conflict + let worker pool handle rest
    if (applyAll) {
      const txId = job.conflict?.txId;
      const tx = txId ? transactionEngine.getTransaction(txId) : null;
      if (tx) {
        if (action === 'skip') {
          transactionEngine.skipTransaction(tx.id);
        } else if (action === 'overwrite') {
          transactionEngine.setOverwrite(tx.id, true);
        } else if (action === 'rename' && decision.newName) {
          const newDst = `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${decision.newName}`;
          transactionEngine.setDestination(tx.id, newDst);
        }
      }

      job.status = 'running';
      job.conflict = null;
      job._conflictResolve?.(decision);
      job._conflictResolve = null;
      this._broadcastJob(job);
      return true;
    }

    // Single conflict resolution (no applyAll)
    const txId = job.conflict?.txId;
    const tx = txId ? transactionEngine.getTransaction(txId) : null;

    if (action === 'cancel') {
      job.status = 'cancelled';
      if (tx) transactionEngine.updateStatus(tx.id, TX_STATUS.CANCELLED);
      job._conflictResolve?.({ action: 'cancel' });
      job._conflictResolve = null;
      this._broadcastJob(job);
      return true;
    }

    if (action === 'skip' && tx) {
      transactionEngine.skipTransaction(tx.id);
    } else if (action === 'overwrite' && tx) {
      transactionEngine.setOverwrite(tx.id, true);
    } else if (action === 'rename' && tx) {
      const newDst = decision.newDst || (decision.newName ? `${tx.dst.substring(0, tx.dst.lastIndexOf('/') + 1)}${decision.newName}` : null);
      if (newDst) {
        transactionEngine.setDestination(tx.id, newDst);
      } else {
        transactionEngine.setOverwrite(tx.id, true);
      }
    }

    job.status = 'running';
    job.conflict = null;
    job._conflictResolve?.(decision);
    job._conflictResolve = null;
    this._broadcastJob(job);
    return true;
  }

  pauseJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || !['running', 'waiting_conflict'].includes(job.status)) return false;
    job.status = 'paused';
    this._broadcastJob(job);
    transactionEngine.updateJobDbStatus(job);
    return true;
  }

  resumeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return false;
    job.status = 'running';
    job._resumeResolve?.();
    job._resumeResolve = null;
    this._broadcastJob(job);
    transactionEngine.updateJobDbStatus(job);
    return true;
  }

  retryFailed(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    const count = transactionEngine.resetFailed(jobId);
    if (count === 0) return false;

    job.status = 'queued';
    job.error = null;
    job.completedAt = null;
    job.startedAt = Date.now();
    transactionEngine.saveJob(job);
    this._enqueue(job.device, jobId);
    return true;
  }

  getJobTransactions(jobId) {
    return transactionEngine.getTransactions(jobId);
  }

  reassignJobDevice(jobId, newDeviceId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    const ident = this._getDeviceIdentity(newDeviceId);
    job.device = newDeviceId;
    job.deviceSerial = ident.serial;
    job.deviceIp = ident.ip;
    transactionEngine.saveJob(job);
    return true;
  }

  async _executePull(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    this._broadcastJob(job);

    await this._calculateTotalSize(job);

    const destDir = job.dest;
    const sources = job.sources;

    console.log(`[adb:pull:${job.id}] Starting pull: ${sources.length} file(s), total=${job.totalBytes} bytes`);
    console.log(`[adb:pull:${job.id}] sources: ${JSON.stringify(sources)}`);
    console.log(`[adb:pull:${job.id}] dest: ${destDir}`);

    // Process each source sequentially using adb pull
    let transferred = 0;
    let totalFiles = sources.length;
    let completedFiles = 0;

    for (const sourcePath of sources) {
      if (job.status === 'cancelled') break;

      const sourceName = sourcePath.split('/').filter(Boolean).pop() || sourcePath;
      const localDest = join(destDir, sourceName);

      console.log(`[adb:pull:${job.id}] PULL: ${sourcePath} -> ${localDest}`);

      try {
        await this._runAdbPull(job, sourcePath, localDest, (progress) => {
          // Progress callback from adb pull
          const fileProgress = progress.percent || 0;
          const fileBytes = Math.round((fileProgress / 100) * (job.totalBytes / totalFiles));
          transferred = completedFiles * (job.totalBytes / totalFiles) + fileBytes;
          job.transferredBytes = transferred;
          job.progress = job.totalBytes > 0 ? Math.min(100, Math.round((transferred / job.totalBytes) * 100)) : 0;

          const secs = (Date.now() - job.startedAt) / 1000;
          if (secs > 0 && transferred > 0) {
            job.speed = Math.round(transferred / secs);
            if (job.speed > 0 && job.totalBytes > 0) {
              job.eta = Math.max(0, Math.round((job.totalBytes - transferred) / job.speed));
            }
          }

          this._broadcastJob(job);
        });

        completedFiles++;
        console.log(`[adb:pull:${job.id}] OK: ${sourceName}`);
      } catch (err) {
        console.error(`[adb:pull:${job.id}] FAILED: ${sourceName} — ${err.message}`);
        job.status = 'failed';
        job.error = `pull failed: ${sourceName} — ${err.message}`;
        job.completedAt = Date.now();
        this._broadcastJob(job);
        return;
      }
    }

    if (job.status === 'cancelled') {
      console.log(`[adb:pull:${job.id}] CANCELLED`);
      return;
    }

    job.status = 'completed';
    job.progress = 100;
    job.transferredBytes = job.totalBytes || transferred;
    job.completedAt = Date.now();
    const elapsed = ((Date.now() - job.startedAt) / 1000).toFixed(1);
    console.log(`[adb:pull:${job.id}] COMPLETED in ${elapsed}s (${completedFiles} files)`);
    this._broadcastJob(job);
  }

  _runAdbPull(job, remotePath, localPath, onProgress) {
    return new Promise((resolve, reject) => {
      const proc = spawn('adb', [
        '-s', job.device, 'pull', remotePath, localPath
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      job.process = { adb: proc };

      let stderr = '';
      let lastActivity = Date.now();

      // Stall detection
      const stallTimer = setInterval(() => {
        if (Date.now() - lastActivity > 120000) {
          clearInterval(stallTimer);
          try { proc.kill('SIGTERM'); } catch {}
          reject(new Error('Pull stalled (120s timeout)'));
        }
      }, 10000);

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        lastActivity = Date.now();

        // Parse adb pull progress: "[ XX%] /path/file"
        const pctMatch = text.match(/\[\s*(\d+)%\]/);
        if (pctMatch && onProgress) {
          onProgress({ percent: parseInt(pctMatch[1], 10) });
        }
      });

      proc.stdout.on('data', () => {
        lastActivity = Date.now();
      });

      proc.on('close', (code) => {
        clearInterval(stallTimer);
        job.process = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `adb pull failed (code ${code})`));
        }
      });

      proc.on('error', (err) => {
        clearInterval(stallTimer);
        job.process = null;
        reject(err);
      });
    });
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return this._sanitizeJob(job);
  }

  getJobs() {
    const all = [...this.jobs.values()];
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all.map(j => this._sanitizeJob(j));
  }

  _sanitizeJob(job) {
    const base = {
      id: job.id,
      type: job.type,
      device: job.device,
      deviceSerial: job.deviceSerial || '',
      deviceIp: job.deviceIp || '',
      recovered: job._recovered || false,
      sources: job.sources,
      dest: job.dest,
      status: job.status,
      progress: job.progress,
      totalBytes: job.totalBytes,
      transferredBytes: job.transferredBytes,
      speed: job.speed,
      eta: job.eta,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      engine: job.engine || null,
      currentFile: job.currentFile || null,
      conflict: job.conflict || null,
      jobState: job.jobState || null,
    };

    if (job.engine === 'transactional') {
      base.txSummary = transactionEngine.getJobSummary(job.id);
      base.currentFile = base.txSummary?.currentFile || job.currentFile;
      base.totalPendingConflicts = base.txSummary?.pendingConflicts || 0;
    }

    return base;
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return false;

    job.status = 'cancelled';
    job.completedAt = Date.now();
    transactionEngine.updateJobDbStatus(job);

    if (job.activePushProcess) {
      try { job.activePushProcess.kill('SIGTERM'); } catch {}
      job.activePushProcess = null;
    }

    if (job.process) {
      try {
        if (job.process.tar) job.process.tar.kill('SIGTERM');
        if (job.process.adb) job.process.adb.kill('SIGTERM');
      } catch {}
    }

    if (job._conflictResolve) {
      job._conflictResolve({ action: 'cancel' });
      job._conflictResolve = null;
    }
    if (job._resumeResolve) {
      job._resumeResolve();
      job._resumeResolve = null;
    }

    this._broadcastJob(job);
    return true;
  }

  subscribeJob(jobId, res) {
    const job = this.jobs.get(jobId);
    if (!job) {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write(`data: ${JSON.stringify(this._sanitizeJob(job))}\n\n`);

    job.sseClients.add(res);

    res.on('close', () => {
      job.sseClients.delete(res);
    });
  }

  _broadcastJob(job) {
    const data = JSON.stringify(this._sanitizeJob(job));
    for (const client of job.sseClients) {
      try {
        client.write(`event: progress\ndata: ${data}\n\n`);

        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          client.write(`event: done\ndata: ${data}\n\n`);
        }
        if (job.status === 'waiting_conflict') {
          client.write(`event: conflict\ndata: ${JSON.stringify({ conflict: job.conflict, job: this._sanitizeJob(job) })}\n\n`);
        }
      } catch {}
    }
  }

  enable() {
    this._disabled = false;
  }

  disable() {
    this._disabled = true;
  }

  isEnabled() {
    return !this._disabled;
  }
}

const adbManager = new AdbManager();
export default adbManager;
