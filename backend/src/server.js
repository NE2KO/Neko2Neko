import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import filesRouter from './routes/files.js';
import fileRouter from './routes/file.js';
import thumbnailRouter, { THUMBNAIL_DIR } from './routes/thumbnails.js';
import streamRouter from './routes/stream.js';
import monitoringRouter from './routes/monitoring.js';
import jobsRouter from './routes/jobs.js';
import downloaderRouter from './routes/downloader.js';
import uploadRouter from './routes/upload.js';
import settingsRouter from './routes/settings.js';
import playbackRouter from './routes/playback.js';
import adbRouter from './routes/adb.js';
import playlistsRouter from './routes/playlists.js';
import metadataRouter from './routes/metadata.js';
import scrcpyRouter from './routes/scrcpy.js';
import sendRouter, { startSendScheduler } from './routes/send.js';
import { initTelegramInbound } from './utils/telegramBot.js';
import videoCacheRouter from './routes/videoCache.js';
import { setupWhatsAppRoutes, markListenerStarted, pushLog } from './routes/whatsapp.js';
import { trackRequest } from './monitor/webStats.js';
import { addLogClient, getLogs } from './utils/logCapture.js';
import { initHistoricalTable } from './monitor/historical.js';
import { startEngine, getEngineStatus } from './monitor/engine.js';
import { startWebSocketServer } from './monitor/websocket.js';
import { startMonitoringCache } from './monitor/monitoringCache.js';
import db, { stmts, setupFTS, deferredDbInit } from './db.js';
globalThis.db = db;
globalThis.stmts = stmts;

import { startWatcher, addSseClient, runIncrementalScan } from './utils/watcher.js';
import { startMaintenanceScheduler } from './utils/maintenance.js';
import { get } from './utils/runtimeSettings.js';
import { sessionMiddleware } from './utils/sessionTracker.js';
import { PATHS, SETTINGS } from './config/paths.js';
import { createLogger } from './utils/logger.js';
import servicesRouter, { registerAllServices } from './routes/services.js';
import { requireService } from './middleware/serviceGuard.js';
import aiRouter from './routes/ai.js';
import aiProvidersRouter from './routes/ai-providers.js';
import aiContextRouter from './routes/ai-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const log = createLogger('system');

process.on('unhandledRejection', (reason) => {
  log.error({ msg: 'Unhandled rejection', error: reason?.message || reason });
});

const app = express();
const PORT = process.env.PORT || 3001;

// MEDIA ROOT CONFIG (multiple roots)
export const MEDIA_ROOT = [
  process.env.MEDIA_ROOT || '/home/CATIAA/homelab'
].flatMap(r => r.split(':'))
.map(r => r.trim())
.filter(Boolean);

app.use(cors());
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(sessionMiddleware);

app.use((req, res, next) => {
  trackRequest(req.method, req.path);
  next();
});

// Connection: close removed — let HTTP/1.1 keep-alive work naturally.
// Monitoring dashboard reuses single TCP connection instead of 1 new/sec.

// API ROUTES
app.use('/api/files', requireService('mediaVault'), filesRouter);
app.use('/api/search', requireService('mediaVault'), filesRouter); // alias/search endpoint
app.use('/file', requireService('mediaVault'), fileRouter);
app.use('/thumbnails', express.static(THUMBNAIL_DIR));
app.use('/thumbnails', requireService('mediaVault'), thumbnailRouter);
app.use('/stream', requireService('mediaVault'), streamRouter);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/monitoring/jobs', jobsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/ai/providers', aiProvidersRouter);
app.use('/api/ai', aiContextRouter);
app.use('/api/playback', playbackRouter);
app.get('/api/logs/stream', addLogClient);
app.get('/api/logs', (req, res) => {
  res.json({ logs: getLogs(parseInt(req.query.limit) || 100) });
});
app.use('/api/download', requireService('downloader'), downloaderRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/adb', requireService('adbTransfer'), adbRouter);
app.use('/api/playlists', playlistsRouter);
// Guard playlist scan/refresh when playlists service is stopped
app.use('/api/playlists/scan', requireService('playlists'));
app.use('/api/playlists/:id/refresh', requireService('playlists'));
app.use('/api/metadata', requireService('mediaVault'), metadataRouter);
app.use('/api/scrcpy', scrcpyRouter);
app.use('/api/send', sendRouter);
app.use('/api/video-cache', videoCacheRouter);
setupWhatsAppRoutes(app);

try { initTelegramInbound(); } catch (e) { console.warn('[startup] telegram inbound init failed:', e.message); }
try { startSendScheduler(); } catch (e) { console.warn('[startup] send scheduler init failed:', e.message); }

// Folder lookup (used by frontend fetchFolderById)
app.get('/api/folders/:id', (req, res) => {
  try {
    const folder = stmts.getFolder.get(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ id: folder.id, path: folder.path, parent_id: folder.parent_id, depth: folder.depth, file_count: folder.file_count, total_size: folder.total_size });
  } catch (err) {
    console.error('[/api/folders/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch folder' });
  }
});

app.get('/api/debug', async (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  let playbackStats = null;
  try { const pe = await import('./utils/playbackEngine.js'); playbackStats = pe.getPlaybackStats(); } catch {}
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: 'Media Vault',
    system: {
      uptime: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
      memory: {
        rss: `${(memUsage.rss/1024/1024).toFixed(1)} MB`,
        heapUsed: `${(memUsage.heapUsed/1024/1024).toFixed(1)} MB`,
        heapTotal: `${(memUsage.heapTotal/1024/1024).toFixed(1)} MB`,
      },
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version
    },
    playback: playbackStats,
  });
});

// Health check — responds instantly, no DB dependency
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate, max-age=0');
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/ready', async (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate, max-age=0');
  try {
    const eng = getEngineStatus();
    const running = eng.running;
    const hasStats = eng.lastStats !== null;
    let database = false;
    try {
      db.prepare('SELECT 1').get();
      database = true;
    } catch {}
    let lastSync = null;
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const tsFile = join(process.cwd(), 'data', '.last-scan-time');
      if (existsSync(tsFile)) {
        const ms = BigInt(readFileSync(tsFile, 'utf8').trim());
        if (ms > 0n) lastSync = new Date(Number(ms)).toISOString();
      }
    } catch {}
    const ready = running && hasStats && database;
    res.json({
      state: ready ? 'ready' : 'warming_up',
      http: true,
      database,
      monitoring: {
        running,
        hasStats,
        lastStats: eng.lastStats,
      },
      scanner: { lastSync },
    });
  } catch (err) {
    res.json({
      state: 'warming_up',
      http: true,
      database: false,
      monitoring: { running: false, hasStats: false, lastStats: null },
      scanner: { lastSync: null },
    });
  }
});

// SSE UPDATES
app.get('/api/updates', addSseClient);

// FRONTEND BUILD
// Serve source maps (.map) with no-cache so the crash screen can fetch a
// fresh one after a rebuild. The dist static block below is immutable +
// 1y maxAge, which would otherwise cache a stale map across rebuilds.
app.get(/.*\.map$/, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(join(__dirname, '../../frontend/dist', req.path));
});

app.use(express.static(join(__dirname, '../../frontend/dist'), {
  maxAge: 31536000000,
  immutable: true,
  index: false,
}));

// Serve favicon with a no‑content response to avoid repeated fetches
app.get('/favicon.ico', (req, res) => {
  // 204 tells browser there is no icon – avoids caching loops
  res.status(204).end();
});

app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(join(__dirname, '../../frontend/dist/index.html'));
});

// STARTUP VALIDATION
function validateStartup() {
  const criticalFailures = [];
  const warnings = [];

  let sqliteOk = false;
  try { db.prepare('SELECT 1').get(); sqliteOk = true; }
  catch (e) { criticalFailures.push({ check: 'sqlite', error: e.message }); }

  if (!sqliteOk) criticalFailures.push({ check: 'sqlite', error: 'database unreachable' });

  for (const dir of [PATHS.cacheRoot, PATHS.logsRoot, PATHS.thumbnails]) {
    try { accessSync(dir, constants.W_OK); } catch (e) {
      criticalFailures.push({ check: 'directory_writable', path: dir, error: e.code });
    }
  }

  try {
    const r = spawnSync('which', ['ffmpeg'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    if (r.error || r.status !== 0) warnings.push('ffmpeg not found in PATH');
  } catch { warnings.push('ffmpeg not found in PATH'); }

  try {
    const r = spawnSync('which', ['ffprobe'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    if (r.error || r.status !== 0) warnings.push('ffprobe not found in PATH');
  } catch { warnings.push('ffprobe not found in PATH'); }

  for (const w of warnings) log.warn({ msg: 'startup warning', warning: w });
  for (const f of criticalFailures) log.error({ msg: 'startup critical failure', ...f });

  if (criticalFailures.length > 0) {
    log.error({ msg: 'Critical startup failures detected — aborting', count: criticalFailures.length });
    process.exit(1);
  }

  log.info({ msg: 'Startup validation passed', warnings: warnings.length });
}

// SERVER INIT
// --- Optional TLS -----------------------------------------------------------
// If certs/key.pem + certs/cert.pem exist (or TLS_KEY/TLS_CERT env point to
// them), serve over HTTPS. This is REQUIRED for browser audio-output routing
// (HTMLMediaElement.setSinkId), which only works in a secure context. Without
// certs we fall back to plain HTTP. Generate self-signed certs with e.g.:
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem \
//     -out certs/cert.pem -days 365 -subj "/CN=homelab-local"
function loadTlsCredentials() {
  const keyPath = process.env.TLS_KEY || join(process.cwd(), 'certs', 'key.pem');
  const certPath = process.env.TLS_CERT || join(process.cwd(), 'certs', 'cert.pem');
  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    } catch (e) {
      log.warn({ msg: 'TLS cert read failed, falling back to HTTP', error: e.message });
    }
  }
  return null;
}
const tlsCredentials = loadTlsCredentials();
const server = tlsCredentials ? createHttpsServer(tlsCredentials, app) : createHttpServer(app);
server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;
server.maxConnections = 100;
server.timeout = 15000;

app.set('trust proxy', 1);

// GRACEFUL SHUTDOWN HANDLING
async function handleShutdown(signal) {
  log.info({ msg: `Received ${signal} — shutting down gracefully` });

  log.info({ msg: 'Stopping watcher...' });
  try { const { stopWatcher } = await import('./utils/watcher.js'); stopWatcher(); } catch (e) { log.warn({ msg: 'watcher stop failed', error: e.message }); }

  log.info({ msg: 'Stopping maintenance...' });
  try { const { stopMaintenanceScheduler } = await import('./utils/maintenance.js'); stopMaintenanceScheduler(); } catch (e) { log.warn({ msg: 'maintenance stop failed', error: e.message }); }

  log.info({ msg: 'Stopping monitor engine...' });
  try { const { stopEngine } = await import('./monitor/engine.js'); stopEngine(); } catch (e) { log.warn({ msg: 'engine stop failed', error: e.message }); }

  log.info({ msg: 'Stopping WebSocket server...' });
  try { const { stopWebSocketServer } = await import('./monitor/websocket.js'); stopWebSocketServer(); } catch (e) { log.warn({ msg: 'websocket stop failed', error: e.message }); }

  log.info({ msg: 'Rejecting new playback jobs...' });
  try { const { requestShutdown } = await import('./utils/playbackEngine.js'); requestShutdown(); } catch (e) { log.warn({ msg: 'playback shutdown request failed', error: e.message }); }

  log.info({ msg: 'Waiting for active playback jobs to drain...' });
  try {
    const { waitForDrain } = await import('./utils/playbackEngine.js');
    await waitForDrain(SETTINGS.shutdownTimeoutMs);
  } catch (e) { log.warn({ msg: 'playback drain failed', error: e.message }); }

  log.info({ msg: 'Persisting playback LRU cache...' });
  try { const { shutdown } = await import('./utils/playbackEngine.js'); shutdown(); } catch (e) { log.warn({ msg: 'playback LRU persist failed', error: e.message }); }

  server.close(() => {
    log.info({ msg: 'HTTP server closed' });
    process.exit(0);
  });

  setTimeout(() => {
    log.error({ msg: 'Force exiting after shutdown timeout' });
    process.exit(1);
  }, 15000);
}

// Handle shutdown signals
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGQUIT', () => handleShutdown('SIGQUIT'));

// PORT CONFLICT HANDLING
function startServerWithPortFallback() {
  let currentPort = PORT;
  const maxRetries = 5;
  let retryCount = 0;

  const attemptStart = () => {
    server.listen(currentPort, '0.0.0.0', () => {
      console.log(`[server] Running: ${tlsCredentials ? 'https' : 'http'}://0.0.0.0:${currentPort}`);
      console.log(`[server] Media root: ${MEDIA_ROOT.join(', ')}`);
      console.log(`[server] DB: ${join(__dirname, '../../data/media.db')}`);

      // Register all services for service control
      registerAllServices();

      // Start lightweight services first
      startWebSocketServer(server);

      // Start monitoring cache — all hardware/sensor reads via background timers
      setTimeout(() => startMonitoringCache(stmts, db), 1500);

      // Init historical table — 0.5s
      setTimeout(() => initHistoricalTable(), 500);

      // Phase 2: Background init — staggered to avoid blocking
      // DB deferred init (settings seed, migrations, indexes) — 1s after listen
      setTimeout(() => {
        console.log('[server] Running deferred DB init...');
        deferredDbInit();
      }, 1000);

      // FTS index setup — 2s after listen (after DB init)
      setTimeout(() => {
        console.log('[server] Running FTS setup...');
        setupFTS().catch(e => console.error('[server] FTS setup failed:', e.message));
      }, 2000);

      // Engine starts collecting immediately — uses async first collect so it doesn't block listen
      startEngine(server);

      // Watcher + maintenance — lightweight, can start immediately
      startWatcher();
      startMaintenanceScheduler();

      // Proactively faststart-remux all cached videos so every play serves a
      // web-seekable copy (no green frame / offset-seek blank wait). Deferred
      // + fire-and-forget so it never blocks startup.
      setTimeout(async () => {
        try {
          const { optimizeAllCached } = await import('./utils/videoCache.js');
          await optimizeAllCached();
        } catch (err) {
          console.error('[server] Cached video optimize failed:', err.message);
        }
      }, 8000);

      // Playlist scan — 5s
      setTimeout(async () => {
        try {
          const { scanPlaylists } = await import('./utils/playlistScanner.js');
          await scanPlaylists();
        } catch (err) {
          console.error('[server] Playlist scan failed:', err.message);
        }
      }, 5000);

      // Incremental scan — 20s (after FTS rebuild completes to avoid SQLite lock)
      setTimeout(async () => {
        const { existsSync, readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { getEngineStatus } = await import('./monitor/engine.js');
        const SCAN_TS_FILE = join(process.cwd(), 'data', '.last-scan-time');
        const MAX_STALE_MS = 24 * 60 * 60 * 1000; // skip scan if last scan < 24h ago AND engine has stats

        const hasRecentScan = existsSync(SCAN_TS_FILE)
          ? (() => {
              try {
                const ms = BigInt(readFileSync(SCAN_TS_FILE, 'utf8').trim());
                return (Date.now() - Number(ms)) < MAX_STALE_MS;
              } catch { return false; }
            })()
          : false;
        const eng = getEngineStatus();
        const hasStats = eng.lastStats !== null;

        if (hasRecentScan && hasStats) {
          console.log('[server] Skipping initial scan: DB is fresh (last scan < 24h, engine stats ready)');
          console.log('[server] Watcher will pick up any changes; run full scan manually via API if needed');
          return;
        }

        console.log('[server] Starting initial scan (cold or stale DB)...');
        try {
          const result = await runIncrementalScan();
          if (result) console.log('[server] Initial sync:', result);
        } catch (err) {
          console.error('[server] Initial scan failed:', err);
        }
      }, 20000);

      // WhatsApp bot initialization
      const initWhatsApp = async (attempt = 1) => {
        try {
          const { connect: waConnect, getClient, getConnectionStatus } = await import('../../whatsapp-bot/src/connection.js');
          const { startListener } = await import('../../whatsapp-bot/src/listener.js');
          const { setLogSink } = await import('../../whatsapp-bot/src/utils.js');
          setLogSink(pushLog);
          const client = await waConnect();
          startListener(client);
          markListenerStarted();
          console.log('[server] WhatsApp bot initialized');
        } catch (err) {
          const status = await import('../../whatsapp-bot/src/connection.js').then(m => m.getConnectionStatus());
          if (status.stopped) {
            console.log('[server] WhatsApp bot stopped by user, skipping retry');
            return;
          }
          console.error(`[server] WhatsApp bot init failed (attempt ${attempt}):`, err.message);
          if (attempt < 5) {
            const retryDelay = attempt * 5000;
            console.log(`[server] Retrying WhatsApp init in ${retryDelay / 1000}s...`);
            setTimeout(() => initWhatsApp(attempt + 1), retryDelay);
          }
        }
      };
      setTimeout(() => initWhatsApp(), 10000);
    });
  };

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && retryCount < maxRetries) {
      retryCount++;
      currentPort++;
      console.warn(`[server] Port ${currentPort - 1} in use, trying ${currentPort} (${retryCount}/${maxRetries})`);
      
      // Clear any existing listeners and try again
      server.removeAllListeners('error');
      attemptStart();
      
    } else {
      console.error('[server] Failed to start after all port attempts:', error.message);
      process.exit(1);
    }
  });

  // Initial attempt
  attemptStart();
}

// START SERVER — with port fallback handling
startServerWithPortFallback();

export default app;
