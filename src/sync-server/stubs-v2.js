'use strict';

const express = require('express');

// v2 endpoints (brief §3ה / §2 "מחוץ") — not implemented in v1 (pull
// read-only). Documented stubs so a client gets a clear, self-describing 501
// instead of a generic 404, and the intended v2 API surface is visible here
// even before it's built: /changes (cursor-delta), /live (WS realtime),
// /commit (push), PUT /blob/:hash (push), /deletions (tombstones).
function createStubRouter() {
  const router = express.Router();

  const notImplemented = (req, res) => {
    res.status(501).json({
      error: 'not implemented in v1 (pull read-only sync — see brief §2/§3ה)',
      path: req.originalUrl,
    });
  };

  router.get('/changes', notImplemented);
  router.get('/live', notImplemented); // v2: upgrades to a WebSocket
  router.post('/commit', notImplemented);
  router.put('/blob/:hash', notImplemented);
  router.all('/deletions', notImplemented);

  return router;
}

module.exports = { createStubRouter };
