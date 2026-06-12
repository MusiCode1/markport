/**
 * Stubs for electron.remote and ipcRenderer functionality that Obsidian
 * uses. Keep this minimal - we only implement what the renderer actually
 * calls. See the analysis in the project README.
 */

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const config = require('../config');

// Imported lazily to avoid circular require — same pattern as api/fs.js.
function invalidateBootstrapCache(vaultId) {
  try {
    const { serverCache } = require('./bootstrap');
    if (serverCache && vaultId) serverCache.delete(vaultId);
  } catch (_) {}
}

const APP_VERSION = config.appVersion;
const VAULT_BASE = config.vaultBase; // virtual path the renderer sees

function createElectronRouter(vaultRegistry, fallbackVaultRoot) {
  const router = express.Router();

  function getCurrentVault(req) {
    const vaults = vaultRegistry.list();
    const requestedId = req.query.vault || (req.body && req.body.vault);
    if (requestedId) {
      // Explicit vault requested — return it or null; never silently fall back to another vault.
      return vaults[requestedId] ? { id: requestedId, ...vaults[requestedId] } : null;
    }

    // No vault specified — use the most recently opened one as a fallback.
    const openVault = Object.entries(vaults)
      .filter(([, vault]) => vault.open)
      .sort((a, b) => b[1].ts - a[1].ts)[0];
    if (openVault) {
      return { id: openVault[0], ...openVault[1] };
    }

    return null;
  }

  function getVaultRoot(req) {
    const vault = getCurrentVault(req);
    return vault ? vault.path : fallbackVaultRoot;
  }

  // ipcRenderer.sendSync('trash', filePath)
  // For now we just delete; later we can move to ~/.local/share/Trash.
  router.post('/trash', express.json(), async (req, res) => {
    try {
      // Obsidian passes the virtual vault path (/vault/some/file.md).
      // Strip the VAULT_BASE prefix so it resolves correctly against the
      // real vault root (same stripping original-fs.js does for /api/fs/*).
      let rel = req.body.path || '';
      const vaultPrefix = VAULT_BASE + '/';
      if (rel.startsWith(vaultPrefix)) rel = rel.slice(vaultPrefix.length);
      else if (rel === VAULT_BASE) rel = '';
      else rel = rel.replace(/^\/+/, '');
      const vaultRoot = getVaultRoot(req);
      const absolute = path.resolve(vaultRoot, '.' + path.sep + rel);
      const resolvedRoot = path.resolve(vaultRoot);
      if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
        throw new Error('path escapes vault');
      }
      const stats = await fsp.stat(absolute);
      if (stats.isDirectory()) {
        await fsp.rm(absolute, { recursive: true, force: true });
      } else {
        await fsp.unlink(absolute);
      }
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ipcRenderer.sendSync('is-dev')
  router.get('/is-dev', (req, res) => {
    res.json({ value: false });
  });

  // ipcRenderer.sendSync('resources')
  router.get('/resources', (req, res) => {
    res.json({ value: '' });
  });

  // ipcRenderer.sendSync('frame')
  router.get('/frame', (req, res) => {
    res.json({ value: 'hidden' });
  });

  // ipcRenderer.sendSync('documents-dir') / 'desktop-dir'
  router.get('/documents-dir', (req, res) => {
    res.json({ value: path.join(os.homedir(), 'Documents') });
  });
  router.get('/desktop-dir', (req, res) => {
    res.json({ value: path.join(os.homedir(), 'Desktop') });
  });

  // ipcRenderer.sendSync('file-url', filePath)
  // Obsidian calls this to turn a vault-relative virtual path (e.g.
  // /vault/images/photo.png) into a URL it can use as <img src>.
  // In Electron that works via the app:// protocol; in a browser we must
  // return a real HTTP URL. We strip the virtual vault prefix and return
  // a path to our /api/fs/read endpoint, which serves the raw binary.
  router.get('/file-url', (req, res) => {
    const filePath = req.query.path || '';
    // Strip the virtual vault base prefix (/vault/ by default).
    const prefix = VAULT_BASE + '/';
    const relative = filePath.startsWith(prefix)
      ? filePath.slice(prefix.length)
      : filePath.replace(/^\/+/, '');
    const vault = getCurrentVault(req);
    const vaultParam = vault ? '&vault=' + encodeURIComponent(vault.id) : '';
    res.json({ value: '/api/fs/read?path=' + encodeURIComponent(relative) + vaultParam });
  });

  // ipcRenderer.sendSync('version')
  router.get('/version', (req, res) => {
    res.json({ value: APP_VERSION });
  });

  // ipcRenderer.sendSync('vault')
  // Returns {id, path} for the vault associated with the current window.
  router.get('/vault', (req, res) => {
    const vault = getCurrentVault(req);
    res.json({ value: vault ? { id: vault.id, path: VAULT_BASE } : {} });
  });

  // ipcRenderer.sendSync('vault-list')
  router.get('/vault-list', (req, res) => {
    res.json({ value: vaultRegistry.list() });
  });

  router.post('/vault-open', express.json(), (req, res) => {
    const result = vaultRegistry.open(req.body.path, req.body.create === true);
    res.json({ value: result.ok ? true : result.error });
  });

  router.post('/vault-remove', express.json(), (req, res) => {
    res.json({ value: vaultRegistry.remove(req.body.path) });
  });

  router.post('/vault-move', express.json(), (req, res) => {
    res.json({ value: vaultRegistry.move(req.body.oldPath, req.body.newPath) });
  });

  // ipcRenderer.sendSync('sandbox') - opens a sandbox vault, ignore.
  router.get('/sandbox', (req, res) => res.json({ value: null }));
  // ipcRenderer.sendSync('starter') - returns the URL of the vault-picker page.
  // Obsidian uses this to know where to navigate when the user opens the vault
  // manager. Returning '/starter' lets it open our vault management page.
  router.get('/starter', (req, res) => res.json({ value: '/starter' }));
  router.get('/help', (req, res) => res.json({ value: null }));

  // Update / insider channels - we are never updating, never insider.
  router.get('/update', (req, res) => res.json({ value: '' }));
  router.get('/check-update', (req, res) => res.json({ value: false }));
  router.get('/disable-update', (req, res) => res.json({ value: true }));
  router.get('/insider-build', (req, res) => res.json({ value: false }));
  router.get('/cli', (req, res) => res.json({ value: false }));
  router.get('/disable-gpu', (req, res) => res.json({ value: false }));
  router.get('/is-quitting', (req, res) => res.json({ value: false }));

  // Adblock / icon - we don't manage these in the web version.
  router.get('/adblock-lists', (req, res) => res.json({ value: [] }));
  router.get('/adblock-frequency', (req, res) => res.json({ value: 0 }));
  router.get('/get-icon', (req, res) => res.json({ value: null }));
  router.post('/set-icon', express.json(), (req, res) => res.json({ value: null }));

  router.get('/get-sandbox-vault-path', (req, res) => res.json({ value: '' }));
  router.get('/get-documents-path', (req, res) => {
    res.json({ value: path.join(os.homedir(), 'Documents') });
  });

  return router;
}

module.exports = createElectronRouter;
