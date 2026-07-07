const express = require('express');

function createVaultsRouter(vaultRegistry) {
  const router = express.Router();

  router.get('/list', (req, res) => {
    res.json(vaultRegistry.list());
  });

  router.post('/open', express.json(), (req, res) => {
    const result = vaultRegistry.open(req.body.path, req.body.create === true);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  router.post('/move', express.json(), (req, res) => {
    if (req.readonlyNoop) return res.json({ ok: true });
    if (!req.body || typeof req.body.oldPath !== 'string' || typeof req.body.newPath !== 'string') {
      return res.status(400).json({ ok: false, error: 'oldPath and newPath are required' });
    }
    try {
      const result = vaultRegistry.move(req.body.oldPath, req.body.newPath);
      if (result.notFound) return res.status(404).json({ ok: false, error: 'vault not found' });
      if (!result.ok) return res.status(500).json({ ok: false, error: result.error, code: result.code });
      // Return { ok: true, value: '' } for backward compat with the Obsidian starter IPC shape.
      res.json({ ok: true, value: '' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/remove', express.json(), (req, res) => {
    if (req.readonlyNoop) return res.json({ ok: true });
    if (!req.body || typeof req.body.path !== 'string') {
      return res.status(400).json({ ok: false, error: 'path is required' });
    }
    try {
      const removed = vaultRegistry.remove(req.body.path);
      if (!removed) return res.status(404).json({ ok: false, error: 'vault not found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createVaultsRouter;
