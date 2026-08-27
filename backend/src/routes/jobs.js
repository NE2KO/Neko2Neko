import { Router } from 'express';
import { getPollInterval } from '../monitor/engine.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const engine = { pollIntervalMs: getPollInterval() };
    const scannerStatus = globalThis.mediaScanner?.getStatus() || {};
    const watcher = { isScanning: scannerStatus.isScanning || false, pendingRescan: scannerStatus.pendingRescan || false };
    res.json({ engine, watcher });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
