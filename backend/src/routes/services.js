import { Router } from 'express';
import { registerService, setStatus, getAllStatus, getStatus, startService, stopService, restartService, restartAll } from '../services/registry.js';
import { startWatcher, stopWatcher, isWatcherRunning } from '../utils/watcher.js';
import { startMaintenanceScheduler, stopMaintenanceScheduler, isMaintenanceRunning } from '../utils/maintenance.js';
import { stopQueue, startQueue, isQueueStopped, getQueueStatus } from '../utils/thumbnailQueue.js';
import { enableManager, disableManager, isManagerEnabled, getManagerStatus } from '../downloader/manager.js';
import { scanPlaylists, stopScan, getPlaylistScannerStatus } from '../utils/playlistScanner.js';
import { startEngine, stopEngine, getEngineStatus } from '../monitor/engine.js';
import { startWebSocketServer, stopWebSocketServer, getClientCount } from '../monitor/websocket.js';
import { initHistoricalTable } from '../monitor/historical.js';
import adbManager from '../utils/adbManager.js';

const router = Router();

// GET /api/services — all services status
router.get('/', (req, res) => {
  try {
    refreshStatuses();
    const all = getAllStatus();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/services/:name — single service status
router.get('/:name', (req, res) => {
  const status = getStatus(req.params.name);
  if (!status) return res.status(404).json({ error: 'Service not found' });
  res.json(status);
});

// POST /api/services/:name/start
router.post('/:name/start', async (req, res) => {
  try {
    await startService(req.params.name);
    res.json({ success: true, status: getStatus(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services/:name/stop
router.post('/:name/stop', async (req, res) => {
  try {
    await stopService(req.params.name);
    res.json({ success: true, status: getStatus(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services/:name/restart
router.post('/:name/restart', async (req, res) => {
  try {
    await restartService(req.params.name);
    res.json({ success: true, status: getStatus(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services/restart-all
router.post('/restart-all', async (req, res) => {
  try {
    const results = await restartAll();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function refreshStatuses() {
  // Media Vault
  const mvStatus = getStatus('mediaVault');
  if (mvStatus) {
    const watcherRunning = isWatcherRunning();
    const maintenanceRunning = isMaintenanceRunning();
    const thumbStopped = isQueueStopped();
    const actuallyRunning = watcherRunning || maintenanceRunning || !thumbStopped;
    // Only override if not manually stopped via API
    if (mvStatus.status !== 'stopped') {
      mvStatus.status = actuallyRunning ? 'running' : 'stopped';
    }
    mvStatus.info = {
      watcher: watcherRunning,
      maintenance: maintenanceRunning,
      thumbnails: !thumbStopped,
      thumbPending: getQueueStatus().pending,
    };
  }

  // Downloader
  const dlStatus = getStatus('downloader');
  if (dlStatus) {
    const enabled = isManagerEnabled();
    if (dlStatus.status !== 'stopped') {
      dlStatus.status = enabled ? 'running' : 'stopped';
    }
    dlStatus.info = getManagerStatus();
  }

  // Playlists
  const plStatus = getStatus('playlists');
  if (plStatus) {
    plStatus.info = getPlaylistScannerStatus();
  }

  // Monitor
  const engStatus = getEngineStatus();
  const monStatus = getStatus('monitor');
  if (monStatus) {
    if (monStatus.status !== 'stopped') {
      monStatus.status = engStatus.running ? 'running' : 'stopped';
    }
    monStatus.info = {
      ...engStatus,
      wsClients: getClientCount(),
    };
  }

  // ADB Transfer
  const adbStatus = getStatus('adbTransfer');
  if (adbStatus) {
    const enabled = adbManager.isEnabled();
    if (adbStatus.status !== 'stopped') {
      adbStatus.status = enabled ? 'running' : 'stopped';
    }
    adbStatus.info = { enabled };
  }
}

// Register all services
export function registerAllServices() {
  // Media Vault
  registerServiceWithHandlers('mediaVault', {
    start: async () => {
      startWatcher();
      startMaintenanceScheduler();
      startQueue();
    },
    stop: async () => {
      stopWatcher();
      stopMaintenanceScheduler();
      stopQueue();
    },
    getStatus: async () => ({
      watcher: isWatcherRunning(),
      maintenance: isMaintenanceRunning(),
      thumbnails: !isQueueStopped(),
      thumbPending: getQueueStatus().pending,
    }),
  });

  // Downloader
  registerServiceWithHandlers('downloader', {
    start: async () => { enableManager(); },
    stop: async () => { disableManager(); },
    getStatus: async () => getManagerStatus(),
  });

  // Playlists
  registerServiceWithHandlers('playlists', {
    start: async () => { await scanPlaylists(); },
    stop: async () => { stopScan(); },
    getStatus: async () => getPlaylistScannerStatus(),
  });

  // Monitor
  registerServiceWithHandlers('monitor', {
    start: async () => { startEngine(); },
    stop: async () => { stopEngine(); },
    getStatus: async () => getEngineStatus(),
  });

  // ADB Transfer
  registerServiceWithHandlers('adbTransfer', {
    start: async () => { adbManager.enable(); },
    stop: async () => { adbManager.disable(); },
    getStatus: async () => ({ enabled: adbManager.isEnabled() }),
  });

  // Mark all as running since server.js already starts them at staggered intervals
  setStatus('mediaVault', 'running', { watcher: true, maintenance: true, thumbnails: true });
  setStatus('downloader', 'running', { enabled: true });
  setStatus('playlists', 'running', {});
  setStatus('monitor', 'running', {});
  setStatus('adbTransfer', 'running', { enabled: true });

  // Set running flags so is*Running() functions return true
  // (server.js starts these directly, not through the registry)
  if (typeof globalThis !== 'undefined') {
    // These flags are checked by refreshStatuses()
    // We need to ensure they match reality
  }
}

// Helper to register with registry
function registerServiceWithHandlers(name, handlers) {
  registerService(name, handlers);
}

export default router;
