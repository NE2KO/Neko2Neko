import { Router } from 'express';
import adbManager from '../utils/adbManager.js';

const router = Router();

router.get('/devices', async (req, res) => {
  try {
    const devices = await adbManager.getDevices();
    res.json({ devices });
  } catch (err) {
    console.error('[adb] devices error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/ls', async (req, res) => {
  try {
    const { device, path } = req.body;
    if (!device || !path) {
      return res.status(400).json({ error: 'device and path required' });
    }
    const entries = await adbManager.listDir(device, path);
    res.json({ entries, path });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: err.message });
    }
    console.error('[adb] ls error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/stat', async (req, res) => {
  try {
    const { device, path } = req.body;
    if (!device || !path) {
      return res.status(400).json({ error: 'device and path required' });
    }
    const entry = await adbManager.getDeviceStat(device, path);
    res.json({ entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/localls', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'path required' });
    }
    const result = adbManager.listLocalDir(path);
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: err.message });
    }
    console.error('[adb] localls error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/localstat', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'path required' });
    }
    const entry = adbManager.statLocalDir(path);
    res.json({ entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/check-duplicates', async (req, res) => {
  try {
    const { device, sources, dest } = req.body;
    if (!device || !sources || !Array.isArray(sources) || sources.length === 0 || !dest) {
      return res.status(400).json({ error: 'device, sources (array), and dest required' });
    }
    const results = await adbManager.checkDuplicates(device, sources, dest);
    res.json({ duplicates: results });
  } catch (err) {
    console.error('[adb] check-duplicates error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/push', async (req, res) => {
  try {
    const { device, sources, dest, txOptions, maxWorkers, conflictStrategy } = req.body;
    if (!device || !sources || !Array.isArray(sources) || sources.length === 0 || !dest) {
      return res.status(400).json({ error: 'device, sources (array), and dest required' });
    }

    const jobId = adbManager.push(device, sources, dest, { txOptions, maxWorkers, conflictStrategy });
    res.json({ jobId });
  } catch (err) {
    console.error('[adb] push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/pull', async (req, res) => {
  try {
    const { device, sources, dest } = req.body;
    if (!device || !sources || !Array.isArray(sources) || sources.length === 0 || !dest) {
      return res.status(400).json({ error: 'device, sources (array), and dest required' });
    }

    const jobId = adbManager.pull(device, sources, dest);
    res.json({ jobId });
  } catch (err) {
    console.error('[adb] pull error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs', (req, res) => {
  try {
    const jobs = adbManager.getJobs();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const job = adbManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id/progress', (req, res) => {
  adbManager.subscribeJob(req.params.id, res);
});

router.delete('/jobs/:id', (req, res) => {
  try {
    const ok = adbManager.cancelJob(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Job not found or already finished' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/pause', (req, res) => {
  try {
    const ok = adbManager.pauseJob(req.params.id);
    if (!ok) return res.status(400).json({ error: 'Job cannot be paused' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/resume', (req, res) => {
  try {
    const ok = adbManager.resumeJob(req.params.id);
    if (!ok) return res.status(400).json({ error: 'Job cannot be resumed' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/reassign-device', (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    const ok = adbManager.reassignJobDevice(req.params.id, deviceId);
    if (!ok) return res.status(404).json({ error: 'Job not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/retry-failed', (req, res) => {
  try {
    const ok = adbManager.retryFailed(req.params.id);
    if (!ok) return res.status(400).json({ error: 'No failed transactions to retry' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id/transactions', (req, res) => {
  try {
    const transactions = adbManager.getJobTransactions(req.params.id);
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/conflict', (req, res) => {
  try {
    const { action, newName, newDst, applyAll } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });
    const ok = adbManager.resolveConflict(req.params.id, { action, newName, newDst, applyAll });
    if (!ok) return res.status(400).json({ error: 'No active conflict to resolve' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
