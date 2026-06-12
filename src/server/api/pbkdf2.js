'use strict';

/**
 * PBKDF2 key derivation endpoint — offloaded from the browser because
 * 100 000 iterations of pure-JS SHA-256 would freeze the page for ~10 s.
 * Node's crypto.pbkdf2 runs in a libuv thread pool and typically completes
 * in 50–200 ms.
 *
 * POST /api/pbkdf2
 *   Body: { password: hexString, salt: hexString, iterations: number, keyLen: number }
 *   Response: { key: hexString }
 *
 * Only PBKDF2-HMAC-SHA256 is supported (the only algorithm needed by ion-sync).
 */

const express = require('express');
const crypto = require('crypto');

function createPbkdf2Router() {
  const router = express.Router();
  router.use(express.json());

  router.post('/', (req, res) => {
    const { password, salt, iterations, keyLen } = req.body || {};

    if (typeof password !== 'string' || typeof salt !== 'string' ||
        !Number.isInteger(iterations) || !Number.isInteger(keyLen)) {
      return res.status(400).json({ error: 'Missing or invalid fields (password, salt, iterations, keyLen required)' });
    }
    if (iterations < 1 || iterations > 2_000_000) {
      return res.status(400).json({ error: 'iterations out of range' });
    }
    if (keyLen < 1 || keyLen > 64) {
      return res.status(400).json({ error: 'keyLen out of range' });
    }

    let pwBuf, saltBuf;
    try {
      pwBuf   = Buffer.from(password, 'hex');
      saltBuf = Buffer.from(salt,     'hex');
    } catch (e) {
      return res.status(400).json({ error: 'password and salt must be hex-encoded' });
    }

    crypto.pbkdf2(pwBuf, saltBuf, iterations, keyLen, 'sha256', (err, derivedKey) => {
      if (err) {
        console.error('[pbkdf2] derivation error:', err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json({ key: derivedKey.toString('hex') });
    });
  });

  return router;
}

module.exports = createPbkdf2Router;
