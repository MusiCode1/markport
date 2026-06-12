'use strict';

/**
 * Server-side keychain store — replaces the native `keytar` module.
 * Credentials are stored in <user-data>/.keychain.json (plain JSON).
 * This file lives inside the USER_DATA volume so it persists across
 * container restarts and is as safe as the rest of your vault data.
 *
 * API:
 *   GET    /api/keytar?service=&account=   → { password } or 404
 *   PUT    /api/keytar                     ← { service, account, password }
 *   DELETE /api/keytar?service=&account=   → { ok }
 *   GET    /api/keytar/all?service=        → [{ account, password }, ...]
 */

const express = require('express');
const fsp = require('fs/promises');
const path = require('path');

function createKeytarRouter(userDataPath) {
  const router = express.Router();
  const keychainFile = path.join(userDataPath, '.keychain.json');

  async function load() {
    try {
      const txt = await fsp.readFile(keychainFile, 'utf8');
      return JSON.parse(txt);
    } catch (_) {
      return {};
    }
  }

  async function save(data) {
    await fsp.mkdir(path.dirname(keychainFile), { recursive: true });
    await fsp.writeFile(keychainFile, JSON.stringify(data, null, 2), 'utf8');
  }

  // GET /api/keytar?service=X&account=Y
  router.get('/', async (req, res) => {
    const { service, account } = req.query;
    if (!service || !account) return res.status(400).json({ error: 'service and account required' });
    const data = await load();
    const password = data[service] && data[service][account];
    if (password == null) return res.status(404).json({ error: 'not found' });
    res.json({ password });
  });

  // GET /api/keytar/all?service=X
  router.get('/all', async (req, res) => {
    const { service } = req.query;
    if (!service) return res.status(400).json({ error: 'service required' });
    const data = await load();
    const entries = Object.entries(data[service] || {}).map(([account, password]) => ({ account, password }));
    res.json(entries);
  });

  // PUT /api/keytar  { service, account, password }
  router.put('/', express.json(), async (req, res) => {
    const { service, account, password } = req.body || {};
    if (!service || !account || password == null) return res.status(400).json({ error: 'service, account, password required' });
    const data = await load();
    if (!data[service]) data[service] = {};
    data[service][account] = password;
    await save(data);
    res.json({ ok: true });
  });

  // DELETE /api/keytar?service=X&account=Y
  router.delete('/', async (req, res) => {
    const { service, account } = req.query;
    if (!service || !account) return res.status(400).json({ error: 'service and account required' });
    const data = await load();
    let deleted = false;
    if (data[service] && data[service][account] != null) {
      delete data[service][account];
      if (Object.keys(data[service]).length === 0) delete data[service];
      await save(data);
      deleted = true;
    }
    res.json({ ok: deleted });
  });

  return router;
}

module.exports = createKeytarRouter;
