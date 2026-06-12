'use strict';

/**
 * Server-backed localStorage store.
 *
 * Obsidian (and its plugins) keep state in window.localStorage — including
 * the safeStorage keychain *tokens* that point at secrets in .keychain.json.
 * Browser localStorage is scoped per device AND per origin, so credentials
 * entered on one PC (or via one URL, e.g. LAN vs cloudflared tunnel) don't
 * roam. The client shim (client/shims/remote-localstorage.js) replaces
 * window.localStorage with a copy of this server-side store, making that
 * state follow the server instead of the browser.
 *
 * This mirrors real Electron semantics: one Obsidian install = one shared
 * localStorage across all vaults, persisted next to the rest of user-data.
 *
 * API:
 *   GET /api/localstorage           → { key: value, ... }   (full map)
 *   PUT /api/localstorage           ← { entries: { key: value | null } }
 *                                      null deletes the key. Batched by the
 *                                      client's debounced write-through.
 */

const express = require('express');
const fsp = require('fs/promises');
const path = require('path');

function createLocalStorageRouter(userDataPath) {
  const router = express.Router();
  const storeFile = path.join(userDataPath, '.localstorage.json');

  // Serialize writes so concurrent PUTs don't interleave load/save.
  let writeChain = Promise.resolve();

  async function load() {
    try {
      return JSON.parse(await fsp.readFile(storeFile, 'utf8')) || {};
    } catch (_) {
      return {};
    }
  }

  async function save(data) {
    await fsp.mkdir(path.dirname(storeFile), { recursive: true });
    // Atomic: temp file + rename, same pattern as vault-registry.
    const tmp = storeFile + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, storeFile);
  }

  router.get('/', async (req, res) => {
    res.json(await load());
  });

  router.put('/', express.json({ limit: '5mb' }), (req, res) => {
    const entries = req.body && req.body.entries;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries object required' });
    }
    writeChain = writeChain.then(async () => {
      const data = await load();
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) delete data[key];
        else data[key] = String(value);
      }
      await save(data);
      res.json({ ok: true });
    }).catch((err) => {
      res.status(500).json({ error: err.message });
    });
  });

  return router;
}

module.exports = createLocalStorageRouter;
