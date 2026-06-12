/**
 * File system HTTP API.
 *
 * Maps Node.js fs operations to HTTP endpoints. The client-side shim
 * (client/shims/original-fs.js) translates fs calls into requests here.
 *
 * All paths are relative to the configured vault root for safety.
 */

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const {
  tryGetSystemFilePath,
  getSystemPluginIds,
  mergeCommunityList,
  stripCommunityList,
  SYSTEM_PLUGINS_DIR,
} = require('../system-plugins');

// Imported lazily to avoid circular require — bootstrap.js exports serverCache.
function invalidateBootstrapCache(vaultId) {
  try {
    const { serverCache } = require('./bootstrap');
    if (serverCache) serverCache.delete(vaultId);
  } catch (_) {}
}

// Async existence check used by the system-plugin overlay so we can give
// the vault precedence over the repo copy.
async function fileExists(absPath) {
  try { await fsp.access(absPath); return true; } catch { return false; }
}

// Like fsp.readdir(target, { withFileTypes: true }) but returns [] when
// the directory is missing (ENOENT/ENOTDIR). Other errors still throw.
async function safeReaddir(absPath) {
  try {
    return await fsp.readdir(absPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
}

// ── Write coalescing for rapid writes ──────────────────────────────────────
// On slow filesystems (rclone FUSE) rapid writes to the same file pile up
// and choke the mount.  This mechanism detects per-file write frequency:
//
//   First write to a file   → immediate (no delay)
//   Second write within N ms → buffered; timer reset
//   After N ms of quiet     → flush to disk
//
// Normal note saves go straight to disk.  Rapid-fire config writes
// (workspace.json written 20x/min) coalesce into a single disk write.

const COALESCE_WINDOW_MS = 5000; // writes within this window are coalesced

// key = absolute path → { data, encoding, timer, mtime }
const pendingWrites = new Map();
// key = absolute path → timestamp of last completed write
const lastWriteTime = new Map();

function shouldCoalesce(absPath) {
  const last = lastWriteTime.get(absPath);
  return last && (Date.now() - last) < COALESCE_WINDOW_MS;
}

function scheduleFlush(absPath) {
  const entry = pendingWrites.get(absPath);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    const pending = pendingWrites.get(absPath);
    if (!pending) return;
    pendingWrites.delete(absPath);
    try {
      await fsp.writeFile(absPath, pending.data, pending.encoding ? { encoding: pending.encoding } : undefined);
      lastWriteTime.set(absPath, Date.now());
    } catch (err) {
      console.error('[write-coalesce] flush failed:', absPath, err.message);
    }
  }, COALESCE_WINDOW_MS);
}

function getPendingContent(absPath) {
  return pendingWrites.get(absPath) || null;
}

// Flush all pending writes on shutdown (async with timeout so slow
// filesystems like rclone don't hang the process indefinitely).
async function flushAllPending() {
  const entries = [...pendingWrites.entries()];
  pendingWrites.clear();
  if (entries.length === 0) return;
  console.log('[write-coalesce] flushing', entries.length, 'pending writes...');
  const FLUSH_TIMEOUT = 10000;
  const writes = entries.map(([absPath, entry]) => {
    if (entry.timer) clearTimeout(entry.timer);
    return fsp.writeFile(absPath, entry.data, entry.encoding ? { encoding: entry.encoding } : undefined)
      .catch(err => console.error('[write-coalesce] flush failed:', absPath, err.message));
  });
  await Promise.race([
    Promise.all(writes),
    new Promise(resolve => setTimeout(() => {
      console.warn('[write-coalesce] flush timeout — some writes may be lost');
      resolve();
    }, FLUSH_TIMEOUT)),
  ]);
}

process.on('SIGTERM', () => flushAllPending().finally(() => process.exit(0)));
process.on('SIGINT', () => flushAllPending().finally(() => process.exit(0)));

function createFsRouter(vaultRegistry, fallbackVaultRoot) {
  const router = express.Router();

  function getVaultRoot(req) {
    const vaultId = req.query.vault || (req.body && req.body.vault);
    if (vaultId) {
      const vault = vaultRegistry.get(vaultId);
      if (!vault) {
        const err = new Error('unknown vault: ' + vaultId);
        err.code = 'ENOVAULT';
        throw err;
      }
      return vault.path;
    }
    return fallbackVaultRoot;
  }

  // Resolve a path relative to the vault root, ensuring it stays inside.
  function resolveSafe(req, relPath) {
    if (typeof relPath !== 'string') {
      throw new Error('path must be a string');
    }
    const vaultRoot = getVaultRoot(req);
    const absolute = path.resolve(vaultRoot, '.' + path.sep + relPath);
    const normalizedRoot = path.resolve(vaultRoot);
    if (absolute !== normalizedRoot && !absolute.startsWith(normalizedRoot + path.sep)) {
      throw new Error('path escapes vault root: ' + relPath);
    }
    return absolute;
  }

  // Convert an fs.Stats object into a JSON-friendly form.
  function serializeStats(stats) {
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymbolicLink: stats.isSymbolicLink(),
      size: stats.size,
      mtime: stats.mtime.getTime(),
      ctime: stats.ctime.getTime(),
      atime: stats.atime.getTime(),
      birthtime: stats.birthtime.getTime(),
      mode: stats.mode,
    };
  }

  function handleError(res, err) {
    // ENOTDIR (readdir on a file) and EISDIR (read on a directory) are
    // routine "wrong shape" errors that Obsidian handles via try/catch.
    // We return 404 so the client-side fetch wrapper treats them like
    // any other "not found" without alarming console errors.
    //
    // ENOTDIR is also remapped to ENOENT in the JSON code field: a file
    // sitting where a directory should be is vault corruption. Surfacing
    // ENOENT lets callers (e.g. ion-sync) treat the path as "not yet
    // created" and attempt a write, which goes through mkdirRepair below.
    const status = err.code === 'ENOENT' ? 404
      : err.code === 'EACCES' ? 403
      : err.code === 'EISDIR' ? 404
      : err.code === 'ENOTDIR' ? 404
      : err.code === 'ENOVAULT' ? 404
      : 500;
    const code = err.code === 'ENOTDIR' ? 'ENOENT' : (err.code || null);
    res.status(status).json({ error: err.message, code });
  }

  // mkdir -p with automatic repair: if a regular file is blocking the creation
  // of a directory (ENOTDIR), walk the path to find it, unlink it, then retry.
  // This fixes vaults where a file was written where a directory should be
  // (common when a sync restores a directory before its parent was deleted).
  async function mkdirRepair(dirPath) {
    try {
      await fsp.mkdir(dirPath, { recursive: true });
    } catch (err) {
      if (err.code !== 'ENOTDIR') throw err;
      const root = path.parse(dirPath).root;           // '/' on Linux, 'C:\' on Windows
      const relative = path.relative(root, dirPath);   // path minus root
      let probe = root;
      for (const part of relative.split(path.sep)) {
        if (!part) continue;
        probe = path.join(probe, part);
        let st;
        try { st = await fsp.stat(probe); } catch (_) { break; }
        if (!st.isDirectory()) {
          await fsp.unlink(probe);
          console.warn('[fs] Removed stale file blocking directory creation:', probe);
          break;
        }
      }
      await fsp.mkdir(dirPath, { recursive: true }); // retry after repair
    }
  }

  // Stat a single entry.
  router.get('/stat', async (req, res) => {
    const relPath = req.query.path || '';
    const isPluginsDir = relPath === '.obsidian/plugins' || relPath === '.obsidian/plugins/';

    try {
      const target = resolveSafe(req, relPath);

      // System plugin overlay: if this is a system plugin path AND not in
      // the vault, stat the repo copy instead.
      const systemPath = tryGetSystemFilePath(relPath);
      if (systemPath) {
        const vaultHas = await fileExists(target);
        if (!vaultHas) {
          const stats = await fsp.stat(systemPath);
          return res.json(serializeStats(stats));
        }
      }

      const pending = getPendingContent(target);
      const stats = await fsp.stat(target);
      // If there's a pending write, override mtime so the client sees fresh data.
      if (pending) {
        stats.mtime = new Date(pending.mtime);
        stats.mtimeMs = pending.mtime;
      }
      res.json(serializeStats(stats));
    } catch (err) {
      // Synthesize a directory stat for .obsidian/plugins when the vault
      // doesn't have it yet — otherwise Obsidian's plugin discovery aborts
      // before it ever gets to readdir, and our system plugins stay hidden.
      if ((err.code === 'ENOENT' || err.code === 'ENOTDIR')
          && isPluginsDir
          && getSystemPluginIds().length > 0) {
        const now = Date.now();
        return res.json({
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          size: 4096,
          mtime: now,
          ctime: now,
          atime: now,
          birthtime: now,
          mode: 0o040755,
        });
      }
      handleError(res, err);
    }
  });

  // List directory contents (with stats so the client can avoid extra round-trips).
  router.get('/readdir', async (req, res) => {
    const relPath = req.query.path || '';
    const isPluginsDir = relPath === '.obsidian/plugins' || relPath === '.obsidian/plugins/';
    // Match exactly .obsidian/plugins/<id> (no trailing path); optional trailing slash.
    const inSysDirMatch = relPath.match(/^\.obsidian\/plugins\/([^/]+)\/?$/);
    const inSysDir = inSysDirMatch && getSystemPluginIds().includes(inSysDirMatch[1]);

    try {
      const target = resolveSafe(req, relPath);
      // Helpful debug: log the resolved absolute path when readdir is called.
      // Useful for tracking down "readdir on a file" mysteries.
      if (process.env.OW_DEBUG) {
        console.log('[readdir]', relPath, '->', target);
      }

      // Inside a system plugin dir? If the vault doesn't have its own copy,
      // list from the repo. (If the vault DOES override it, fall through to
      // the normal readdir on the vault copy.)
      if (inSysDir) {
        const vaultEntries = await safeReaddir(target);
        if (vaultEntries.length === 0) {
          const repoDir = path.join(SYSTEM_PLUGINS_DIR, inSysDirMatch[1]);
          const entries = await fsp.readdir(repoDir, { withFileTypes: true });
          const result = await Promise.all(entries.map(async (entry) => {
            const child = path.join(repoDir, entry.name);
            let stats = null;
            try {
              const s = await fsp.stat(child);
              stats = serializeStats(s);
            } catch (_) { /* ignore */ }
            return {
              name: entry.name,
              isFile: entry.isFile(),
              isDirectory: entry.isDirectory(),
              isSymbolicLink: entry.isSymbolicLink(),
              stats,
            };
          }));
          return res.json(result);
        }
      }

      const entries = await fsp.readdir(target, { withFileTypes: true });
      const result = await Promise.all(entries.map(async (entry) => {
        const child = path.join(target, entry.name);
        let stats = null;
        try {
          const s = await fsp.stat(child);
          stats = serializeStats(s);
        } catch (_) {
          // Broken symlink or permission issue: still return the name.
        }
        return {
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          isSymbolicLink: entry.isSymbolicLink(),
          stats,
        };
      }));

      // If listing .obsidian/plugins, merge in system plugin directory entries
      // for ids the vault doesn't already have.
      if (isPluginsDir) {
        for (const id of getSystemPluginIds()) {
          if (!result.find((e) => e.name === id)) {
            result.push({
              name: id,
              isFile: false,
              isDirectory: true,
              isSymbolicLink: false,
              stats: null,
            });
          }
        }
      }

      res.json(result);
    } catch (err) {
      // Synthesize a listing for .obsidian/plugins when the vault doesn't
      // have that directory yet — Obsidian creates it lazily, but we want
      // our system plugins to show up immediately.
      if ((err.code === 'ENOENT' || err.code === 'ENOTDIR')
          && isPluginsDir
          && getSystemPluginIds().length > 0) {
        return res.json(getSystemPluginIds().map((id) => ({
          name: id,
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          stats: null,
        })));
      }
      handleError(res, err);
    }
  });

  // Read a file (text or binary depending on ?encoding).
  router.get('/read', async (req, res) => {
    try {
      const relPath = req.query.path || '';
      const target = resolveSafe(req, relPath);
      const encoding = req.query.encoding || null;

      // Special case: community-plugins.json — merge system ids into the
      // list Obsidian sees, regardless of whether the vault file exists.
      if (relPath === '.obsidian/community-plugins.json') {
        let list = [];
        const pending = getPendingContent(target);
        if (pending) {
          // Pending write — parse the buffered content.
          try {
            const txt = typeof pending.data === 'string' ? pending.data : pending.data.toString('utf8');
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed)) list = parsed;
          } catch (_) { /* malformed: start from empty */ }
        } else {
          try {
            const txt = await fsp.readFile(target, 'utf8');
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed)) list = parsed;
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
          }
        }
        const merged = mergeCommunityList(list);
        if (encoding) {
          return res.type('text/plain; charset=utf-8').send(JSON.stringify(merged));
        }
        return res.type('application/json').send(JSON.stringify(merged));
      }

      // System plugin overlay: if this is a system plugin file AND the
      // vault doesn't have it, serve from <repo>/plugins/.
      const systemPath = tryGetSystemFilePath(relPath);
      if (systemPath) {
        const vaultHas = await fileExists(target);
        if (!vaultHas) {
          if (encoding) {
            const data = await fsp.readFile(systemPath, encoding);
            return res.type('text/plain; charset=utf-8').send(data);
          }
          const data = await fsp.readFile(systemPath);
          return res.type('application/octet-stream').send(data);
        }
      }

      // Serve from debounce buffer if a write is pending.
      const pending = getPendingContent(target);
      if (pending) {
        if (encoding) {
          res.type('text/plain; charset=utf-8').send(typeof pending.data === 'string' ? pending.data : pending.data.toString(encoding));
        } else {
          res.type('application/octet-stream').send(pending.data);
        }
        return;
      }
      if (encoding) {
        const data = await fsp.readFile(target, encoding);
        res.type('text/plain; charset=utf-8').send(data);
      } else {
        const data = await fsp.readFile(target);
        // Use a proper MIME type for common asset types so browsers can render
        // them inline (img src, audio, video). Fall back to octet-stream.
        const ext = path.extname(relPath).toLowerCase();
        const MIME = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
          '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
          '.pdf': 'application/pdf',
        };
        res.type(MIME[ext] || 'application/octet-stream').send(data);
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  // Write a file. Body is the raw content (text or binary).
  // ?encoding=utf8 means the server treats body as utf-8 text.
  router.put('/write', express.raw({ type: '*/*', limit: '256mb' }), async (req, res) => {
    try {
      const relPath = req.query.path || '';
      const target = resolveSafe(req, relPath);
      const encoding = req.query.encoding || null;
      let data = encoding ? req.body.toString(encoding) : req.body;

      // For community-plugins.json: strip our system plugin ids before
      // writing so we don't pollute the user's vault. Malformed JSON is
      // passed through untouched.
      if (relPath === '.obsidian/community-plugins.json' && encoding) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            const cleaned = stripCommunityList(parsed);
            data = JSON.stringify(cleaned, null, 2);
          }
        } catch (_) { /* malformed JSON: pass through as-is */ }
      }

      await mkdirRepair(path.dirname(target));

      // If this file was written recently, coalesce instead of hitting disk.
      if (shouldCoalesce(target)) {
        pendingWrites.set(target, { data, encoding, timer: null, mtime: Date.now() });
        scheduleFlush(target);
        invalidateBootstrapCache(req.query.vault);
        res.json({ ok: true });
        return;
      }

      await fsp.writeFile(target, data, encoding ? { encoding } : undefined);
      lastWriteTime.set(target, Date.now());
      invalidateBootstrapCache(req.query.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/mkdir', express.json(), async (req, res) => {
    try {
      const target = resolveSafe(req, req.body.path || '');
      const recursive = req.body.recursive !== false;
      await fsp.mkdir(target, { recursive });
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/unlink', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      await fsp.unlink(target);
      invalidateBootstrapCache(req.query.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/rmdir', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      const recursive = req.query.recursive === '1';
      if (recursive) {
        await fsp.rm(target, { recursive: true, force: false });
      } else {
        await fsp.rmdir(target);
      }
      invalidateBootstrapCache(req.query.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/rename', express.json(), async (req, res) => {
    try {
      const oldPath = resolveSafe(req, req.body.oldPath || '');
      const newPath = resolveSafe(req, req.body.newPath || '');
      await fsp.rename(oldPath, newPath);
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/copy', express.json(), async (req, res) => {
    try {
      const src = resolveSafe(req, req.body.src || '');
      const dest = resolveSafe(req, req.body.dest || '');
      await fsp.copyFile(src, dest);
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

module.exports = createFsRouter;
