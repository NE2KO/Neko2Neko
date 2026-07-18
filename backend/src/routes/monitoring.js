import { Router } from 'express';
import { execSync, spawnSync, spawn } from 'node:child_process';
import { getCurrentStats, getHistory, getHistoryAggregated } from '../monitor/engine.js';
import { getClientCount } from '../monitor/websocket.js';
import { detectPlatform } from '../monitor/platdetect.js';
import { getProcesses } from '../monitor/processes.js';
import { getServices, serviceAction } from '../monitor/services.js';
import { getLogs } from '../monitor/logs.js';
import { getAlerts, setThreshold, checkAlerts } from '../monitor/alerts.js';
import { getWebStats } from '../monitor/webStats.js';
import { listContainers, getContainerStats, getContainerInfo, getContainerLogs, listImages, getDockerInfo, containerAction } from '../monitor/docker.js';
import { queryDiskIoDailySummary, getTotalDiskIo, getMetricsStats, cleanupOldMetrics, optimizeMetricsTable } from '../monitor/historical.js';
import { cache } from '../monitor/monitoringCache.js';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { scanForMissing, getQueueStatus, pauseQueue, resumeQueue, clearQueue, stopQueue, startQueue } from '../utils/thumbnailQueue.js';
import { getScannerStatus } from '../utils/fileScanner.js';
import { getActiveSessions, getSessionStats, disconnectSession } from '../utils/sessionTracker.js';
import { getUploadStats } from '../utils/uploadManager.js';
import { randomUUID } from 'node:crypto';

const router = Router();

// --- iperf3 benchmark (in-memory jobs) ---
const iperfJobs = new Map(); // id -> { createdAt, proc, done, lines: [], listeners:Set<res> }

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function jobEnsure(id) {
  if (!iperfJobs.has(id)) {
    iperfJobs.set(id, { createdAt: Date.now(), proc: null, done: false, lines: [], listeners: new Set() });
  }
  return iperfJobs.get(id);
}

function jobAppend(id, line) {
  const job = jobEnsure(id);
  job.lines.push(line);
  if (job.lines.length > 2000) job.lines.splice(0, job.lines.length - 2000);
  for (const res of job.listeners) {
    try { sseSend(res, 'line', { line }); } catch {}
  }
}

function jobFinish(id, status) {
  const job = jobEnsure(id);
  job.done = true;
  for (const res of job.listeners) {
    try { sseSend(res, 'done', status); } catch {}
    try { res.end(); } catch {}
  }
  job.listeners.clear();
  // cleanup later
  setTimeout(() => {
    try {
      const j = iperfJobs.get(id);
      if (j && j.done) iperfJobs.delete(id);
    } catch {}
  }, 5 * 60 * 1000);
}

router.get('/media', (req, res) => {
  try {
    const m = cache.media || {};
    res.json({
      totalFiles: m.totalFiles || 0,
      videos: m.videos || 0,
      audio: m.audio || 0,
      images: m.images || 0,
      other: m.other || 0,
      thumbnails: m.thumbnails || { onDisk: 0, inDb: 0, missing: 0, skipped: 0 },
      database: m.database || { size: 0, walSize: 0, total: 0 },
      uploads: getUploadStats(),
    });
  } catch (err) {
    console.error('[monitoring/media] Error:', err);
    res.status(500).json({ error: 'Failed to fetch media stats' });
  }
});

router.post('/media/thumbnails/generate', async (req, res) => {
  try {
    scanForMissing().catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', (req, res) => {
  res.json(getCurrentStats());
});

// Combined overview endpoint — single call for all overview data
router.get('/overview', async (req, res) => {
  try {
    const webStats = getWebStats();
    const alerts = getAlerts();
    const logs = getLogs(5);
    let dockerInfo = null;
    let dockerContainers = [];
    try { dockerInfo = getDockerInfo(); } catch {}
    try { dockerContainers = await listContainers(true); } catch {}
    let servicesCount = { total: 0, running: 0, failed: 0 };
    try {
      const svcs = getServices();
      servicesCount = {
        total: svcs.length,
        running: svcs.filter(s => s.active === 'active' && s.sub === 'running').length,
        failed: svcs.filter(s => s.active === 'failed').length,
      };
    } catch {}
    res.json({
      serverInfo: webStats,
      maxUptime: cache.maxUptime,
      alerts: alerts.history || [],
      logs: logs.logs || [],
      dockerInfo,
      dockerContainers,
      servicesCount,
      diskIo: getTotalDiskIo(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  const range = req.query.range || '1h';
  const data = getHistoryAggregated(range);
  res.json({ range, data });
});

router.get('/disk-io/daily', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  res.json({ data: queryDiskIoDailySummary(days) });
});

router.get('/disk-io/total', (req, res) => {
  res.json(getTotalDiskIo());
});

router.get('/metrics/stats', (req, res) => {
  try {
    res.json(getMetricsStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/metrics/cleanup', (req, res) => {
  try {
    const result = cleanupOldMetrics();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/metrics/optimize', (req, res) => {
  try {
    const result = optimizeMetricsTable();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/ws-status', (req, res) => {
  res.json({ connected: getClientCount() > 0, clients: getClientCount() });
});

// Start an iperf3 client benchmark (requires iperf3 installed on backend host).
// POST /api/monitoring/network/iperf/start { host, port, seconds, reverse }
router.post('/network/iperf/start', (req, res) => {
  try {
    const host = String(req.body?.host || '').trim();
  if (!/^[\d.\-a-fA-F:]+$/.test(host)) return res.status(400).json({ error: 'Invalid host format' });
    const port = Math.min(Math.max(parseInt(req.body?.port || 5201), 1), 65535);
    const seconds = Math.min(Math.max(parseInt(req.body?.seconds || 10), 1), 120);
    const reverse = Boolean(req.body?.reverse);

    if (!host) return res.status(400).json({ error: 'Missing host' });

    // quick presence check
    try {
      execSync('command -v iperf3', { stdio: 'ignore' });
    } catch {
      return res.status(400).json({ error: 'iperf3 not found on backend host (install iperf3)' });
    }

    const id = randomUUID();
    const job = jobEnsure(id);

    const args = ['-c', host, '-p', String(port), '-t', String(seconds), '-i', '1'];
    if (reverse) args.push('-R');

    // Spawn iperf3 and stream stdout/stderr to SSE listeners.
    const child = spawn('iperf3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    job.proc = child;

    jobAppend(id, `[iperf3] starting: iperf3 ${args.join(' ')}`);

    const onData = (buf) => {
      const s = String(buf);
      for (const line of s.split(/\r?\n/)) {
        if (line.trim().length) jobAppend(id, line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => jobFinish(id, { code }));
    child.on('error', (err) => {
      jobAppend(id, `[iperf3] error: ${err?.message || err}`);
      jobFinish(id, { code: -1, error: err?.message || String(err) });
    });

    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream iperf output
// GET /api/monitoring/network/iperf/stream/:id
router.get('/network/iperf/stream/:id', (req, res) => {
  const id = req.params.id;
  const job = iperfJobs.get(id);
  if (!job) return res.status(404).json({ error: 'Unknown job id' });
  sseInit(res);

  // replay existing lines
  for (const line of job.lines) {
    sseSend(res, 'line', { line });
  }
  if (job.done) {
    sseSend(res, 'done', { done: true });
    return res.end();
  }

  job.listeners.add(res);
  req.on('close', () => {
    try { job.listeners.delete(res); } catch {}
  });
});

router.get('/platform', (req, res) => {
  res.json(detectPlatform());
});

router.get('/processes', (req, res) => {
  const sortBy = req.query.sort || 'cpu';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ processes: getProcesses(sortBy, limit), total: getProcesses(sortBy, 9999).length });
});

router.get('/services', (req, res) => {
  const filter = req.query.filter || '';
  res.json({ services: getServices(filter) });
});

router.post('/services/:name/:action', (req, res) => {
  const result = serviceAction(req.params.name, req.params.action);
  res.json(result);
});

router.get('/logs', (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  const filter = req.query.filter || '';
  const unit = req.query.unit || '';
  const priority = req.query.priority || '';
  res.json({ entries: getLogs(lines, filter, unit, priority) });
});

router.get('/alerts', (req, res) => {
  res.json(getAlerts());
});

router.post('/alerts/threshold', (req, res) => {
  const { key, config } = req.body;
  if (!key || !config) return res.status(400).json({ error: 'Missing key or config' });
  res.json(setThreshold(key, config));
});

router.post('/alerts/check', (req, res) => {
  const stats = getCurrentStats();
  const triggered = checkAlerts(stats);
  res.json({ triggered });
});

router.get('/web-stats', (req, res) => {
  res.json(getWebStats());
});

router.get('/docker', async (req, res) => {
  try {
    const containers = await listContainers(true);
    const data = await Promise.all(
      containers.map(async c => {
        const stats = await getContainerStats(c.Id);
        const info = await getContainerInfo(c.Id);
        return {
          id: c.Id,
          names: c.Names,
          image: c.Image,
          state: c.State,
          status: c.Status,
          created: c.Created,
          restartCount: info?.restartCount ?? 0,
          cpuPercent: stats?.cpuPercent ?? 0,
          memUsage: stats?.memUsage ?? 0,
          memLimit: stats?.memLimit ?? 0,
          memPercent: stats?.memPercent ?? 0,
        };
      })
    );
    res.json({ containers: data });
  } catch (err) {
    console.error('[monitoring/docker] Error:', err);
    res.status(500).json({ error: 'Failed to fetch docker containers' });
  }
});

router.post('/docker/:id/:action', async (req, res) => {
  const result = await containerAction(req.params.id, req.params.action);
  res.json(result);
});

router.get('/docker/:id/logs', async (req, res) => {
  try {
    const tail = Math.min(parseInt(req.query.tail) || 100, 500);
    const lines = await getContainerLogs(req.params.id, tail);
    res.json({ logs: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/docker/:id/inspect', async (req, res) => {
  try {
    const info = await getContainerInfo(req.params.id);
    if (!info) return res.status(404).json({ error: 'Container not found' });
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/docker-images', async (req, res) => {
  try {
    const images = await listImages();
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/docker-info', async (req, res) => {
  try {
    const info = await getDockerInfo();
    res.json(info || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/power', (req, res) => {
  const { action } = req.body;
  if (!['shutdown', 'reboot'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  res.json({ success: true, message: `${action} initiated` });
  const cmd = action === 'shutdown' ? 'systemctl poweroff' : 'systemctl reboot';
  setTimeout(() => {
    try {
      spawn('sudo', [cmd], { detached: true, stdio: 'ignore' }).unref();
    } catch (err) {
      console.error(`[system] ${action} failed:`, err.message);
    }
  }, 1000);
});

router.post('/restart/backend', (req, res) => {
  res.json({ success: true, message: 'Restarting backend...' });
  setTimeout(() => {
    process.kill(process.pid, 'SIGTERM');
  }, 500);
});

router.post('/restart/frontend', (req, res) => {
  try {
    const frontendDir = join(new URL('../../../frontend', import.meta.url).pathname);
    const npmBin = join(dirname(process.execPath), 'npm');
    const result = spawnSync(npmBin, ['run', 'build'], {
      cwd: frontendDir,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.substring(0, 500) || `Exited with code ${result.status}`);
    res.json({ success: true, message: 'Frontend rebuilt successfully' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Queue Status
router.get('/queues', (req, res) => {
  res.json({
    queues: [getQueueStatus(), getScannerStatus()],
  });
});

router.post('/queues/:type/:action', (req, res) => {
  const { type, action } = req.params;
  if (type === 'thumbnail') {
    if (action === 'pause') pauseQueue();
    else if (action === 'resume') resumeQueue();
    else if (action === 'stop') stopQueue();
    else if (action === 'start') startQueue();
    else if (action === 'clear') clearQueue();
    else return res.status(400).json({ error: 'Invalid action' });
    // Return current state so frontend doesn't have to wait for WebSocket broadcast
    return res.json({ ok: true, ...getQueueStatus() });
  } else if (type === 'scan') {
    if (action === 'clear') {
      // No-op: scan has no queue to clear
    }
    else return res.status(400).json({ error: 'Invalid action' });
  } else {
    return res.status(404).json({ error: 'Unknown queue type' });
  }
  res.json({ ok: true });
});

// Active Sessions
router.get('/sessions', (req, res) => {
  res.json({ sessions: getActiveSessions(), stats: getSessionStats() });
});

// Session SSE stream
router.get('/sessions/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ sessions: getActiveSessions(), stats: getSessionStats() })}\n\n`);
  }, 3000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Disconnect a session
router.delete('/sessions/:id', (req, res) => {
  const ok = disconnectSession(parseInt(req.params.id));
  res.json({ ok });
});

// Hardware: sensors, fan, disk health — ALL from cache, zero file I/O in handler
router.get('/hardware', (req, res) => {
  const result = { sensors: cache.sensors || {}, fan: cache.fan || { available: false, mode: null, speed: null }, battery: cache.battery || { available: false, percent: null, status: null }, disks: [] };
  res.json(result);
});

// CPU frequency — from cache, zero file I/O in handler
router.get('/cpu-freq', (req, res) => {
  res.json(cache.cpuFreq || { current: null, max: null, min: null, hardwareMax: null });
});

router.post('/cpu-freq', (req, res) => {
  const { maxMhz } = req.body;
  if (maxMhz == null) return res.status(400).json({ error: 'Missing maxMhz' });
  const mhz = parseInt(maxMhz);
  if (isNaN(mhz) || mhz < 400 || mhz > 10000) return res.status(400).json({ error: 'Invalid frequency' });
  try {
    execSync(`sudo cpupower frequency-set -u ${mhz}000 2>/dev/null`, { timeout: 5000 });
    return res.json({ ok: true, maxMhz: mhz });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Fan control: set speed via nbfc
const MANUAL_FLAG = '/tmp/nbfc_fan_manual';

router.post('/hardware/fan', (req, res) => {
  const { speed } = req.body;
  try {
    if (speed === 'auto' || speed == null) {
      try { if (existsSync(MANUAL_FLAG)) unlinkSync(MANUAL_FLAG); } catch {}
      execSync('nbfc set -a 2>/dev/null', { timeout: 3000 });
      try { writeFileSync('/tmp/nbfc_fan_state', 'auto'); } catch {}
      return res.json({ ok: true, mode: 'auto' });
    }
    const pct = parseInt(speed);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'Speed must be 0-100 or "auto"' });
    }
    // Write flag FIRST so waybar script sees it before checking state
    try { writeFileSync(MANUAL_FLAG, String(pct)); } catch {}
    try { writeFileSync('/tmp/nbfc_fan_state', String(pct)); } catch {}
    execSync(`nbfc set -s ${pct} 2>/dev/null`, { timeout: 3000 });
    return res.json({ ok: true, mode: 'manual', speed: pct });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
