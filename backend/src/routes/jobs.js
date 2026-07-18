import { Router } from 'express';
import { getPollInterval } from '../monitor/engine.js';
import { getWatcherStatus } from '../utils/watcher.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const engine = { pollIntervalMs: getPollInterval() };
    const watcher = getWatcherStatus();
    res.json({ engine, watcher });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
