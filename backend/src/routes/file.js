import { Router } from 'express';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    if (!engine) return res.status(500).json({ error: 'Media engine not ready' });
    const target = await engine.getServeTarget(req.params.id);
    if (target.error === 'not_found' || target.error === 'file_missing') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (target.error === 'not_available') {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(target.path, {
      maxAge: '1d',
      acceptRanges: true,
      lastModified: true,
      headers: target.headers,
      root: '/',
      dotfiles: 'ignore',
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error('[file] Error:', err);
    res.status(500).json({ error: 'File serving failed' });
  }
});

export default router;
