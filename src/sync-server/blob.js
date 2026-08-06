'use strict';

const express = require('express');

const resolveSafe = require('./resolve-safe');

const HASH_RE = /^[0-9a-f]{64}$/;

// Content-addressed blob route: GET /sync/v1/blob/:hash → the bytes of
// whichever file has that sha256 content hash (dedup is automatic —
// identical content = identical hash = one file serves every path that
// shares it, per manifest.js's hashIndex).
function createBlobRouter(vaultPath, manifestService) {
  const router = express.Router();

  router.get('/blob/:hash', async (req, res, next) => {
    try {
      const { hash } = req.params;
      if (!HASH_RE.test(hash)) {
        res.status(404).end();
        return;
      }

      let relPath = manifestService.getHashIndex().get(hash);
      if (!relPath) {
        // v1: the index might be stale (a file was added/changed since the
        // last manifest build) — rebuild by rescanning once and retry.
        // (brief §3ג / §6 — v2 will maintain this incrementally via watch.)
        await manifestService.build();
        relPath = manifestService.getHashIndex().get(hash);
      }
      if (!relPath) {
        res.status(404).end();
        return;
      }

      // Defense-in-depth: even though relPath came from our own index (never
      // from user input), re-validate it stays inside VAULT_PATH before
      // touching the filesystem — a poisoned/stale index entry must never be
      // able to serve a file outside the vault (brief §6).
      const absPath = resolveSafe(vaultPath, relPath);

      // hash-addressed content never changes for a given hash → cache forever.
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(absPath, (err) => {
        if (err && !res.headersSent) {
          if (err.code === 'ENOENT') {
            res.status(404).end();
            return;
          }
          next(err);
        }
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createBlobRouter };
