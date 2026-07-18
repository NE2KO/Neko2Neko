import { Router } from 'express';
import { stat } from 'node:fs/promises';
import { getFileWithRelPath } from '../utils/fileResolver.js';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const file = getFileWithRelPath(req.params.id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    await stat(file.fullPath);

    res.sendFile(file.fullPath, {
      maxAge: '1d',
      acceptRanges: true,
      lastModified: true,
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable',
      },
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
