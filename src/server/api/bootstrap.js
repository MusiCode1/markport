/**
 * Bootstrap endpoint.
 *
 * Returns everything the client needs for a cold start in a single HTTP
 * response, so the shims can serve subsequent reads from an in-memory
 * cache instead of making individual round-trips.
 *
 * GET /api/bootstrap?vault=<id>
 *   Returns electron IPC values + full .obsidian/ tree + dirs cache.
 *
 * GET /api/bootstrap?vault=<id>&full=1
 *   Returns the above PLUS content+stat for all text vault files.
 *
 * Response shape:
 * {
 *   electron: { "vault": {id,path}, "version": "1.12.7", ... },
 *   fs: {
 *     // text file — stat + content
 *     "notes/note.md":  { content: "...", mtime, size, isFile: true },
 *     // directory stat
 *     "notes":          { mtime, size, isFile: false, isDirectory: true },
 *   },
 *   dirs: {
 *     // directory listing WITH stat info per entry (mtime, size)
 *     "notes": [{ name, isFile, isDirectory, isSymbolicLink, mtime, size }, ...],
 *     ...
 *   }
 * }
 *
 * Binary files (images, PDFs, etc.) are NOT read into fs cache upfront.
 * Instead, the client populates fs cache lazily when it serves readdir from
 * dirs cache — each entry in dirs includes mtime+size, so after a readdir
 * subsequent stat(path) calls are answered from cache.
 */

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const config = require('../config');

// ── Server-side bootstrap cache ───────────────────────────────────────────────
//
// Keyed by vaultId. On cache hit we compare directory mtimes; only
// directories whose mtime changed are re-walked. This turns subsequent
// bootstrap builds from O(files) full scans into O(dirs) mtime checks,
// which is cheap (~266 stats at 2ms each = ~530ms instead of 2-8s).
//
// On a cache HIT the server sends a pre-compressed Buffer directly, skipping
// JSON.stringify + zlib on every request.  The compression middleware is
// bypassed by setting Content-Encoding before res.end().
//
// Structure:
// {
//   [vaultId]: {
//     response:   { electron, fs, dirs },   // last built response (used for partial rebuilds)
//     dirMtimes:  { [relDir]: mtime },      // mtime snapshot for invalidation
//     compressed: { br: Buffer, gz: Buffer } // pre-compressed for fast HIT path
//   }
// }
const serverCache = new Map();

// ── In-flight build deduplication ─────────────────────────────────────────────
//
// Maps vaultId → Promise<cacheEntry> for any build currently in progress.
// If two requests arrive for the same cold vault simultaneously, the second
// one waits on the same promise instead of starting a duplicate full scan.
const pendingBuilds = new Map();

// ── Build progress (for /api/bootstrap/status polling) ───────────────────────
// key = vaultId → { state, label, dirs, totalDirs, files, done, total, pct }
const buildProgress = new Map();

function setProgress(vaultId, update) {
  const current = buildProgress.get(vaultId) || {};
  buildProgress.set(vaultId, { ...current, ...update });
}

/** Compress a Buffer with both brotli and gzip concurrently. */
function preCompress(buf) {
  return Promise.all([
    new Promise((resolve, reject) =>
      zlib.brotliCompress(
        buf,
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
        (err, result) => (err ? reject(err) : resolve(result)),
      ),
    ),
    new Promise((resolve, reject) =>
      zlib.gzip(buf, { level: 6 }, (err, result) => (err ? reject(err) : resolve(result))),
    ),
  ]).then(([br, gz]) => ({ br, gz }));
}

const APP_VERSION = config.appVersion;
const VAULT_BASE = config.vaultBase;
const READ_BATCH = 30;

// Text extensions — we fetch and cache the full content of these files.
const TEXT_EXTENSIONS = new Set([
  '.md', '.json', '.txt', '.csv',
  '.css', '.js', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.sh', '.bash', '.zsh', '.fish',
  '.lua', '.py', '.rb', '.rs', '.go',
  '.tex', '.bib', '.sty',
  '.svg',
]);

// Max size (bytes) for any single file we include in the bootstrap.
// Files larger than this get stat-only (no content).
// Plugin main.js files: small ones (<~500KB) load fast; large ones (>500KB)
// are better fetched on demand rather than bloating the bootstrap payload.
const MAX_CONTENT_BYTES = 500 * 1024; // 500 KB
// Directories that should always be ignored to prevent bloating the bootstrap cache.
const IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', '.tmp', 'dist', 'out', 'bower_components']);

function isTextFile(filename, size) {
  if (!TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase())) return false;
  if (size !== undefined && size > MAX_CONTENT_BYTES) return false;
  return true;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk a directory, building:
 *   fsCache  — stat+content for text files, stat-only for dirs
 *   dirsCache — directory listings WITH mtime+size per entry
 *
 * Binary files are NOT put in fsCache here.  The client shim will populate
 * fsCache lazily when it serves a readdir answer from dirsCache.
 */
async function walkDir(dir, root, fsCache, dirsCache, walkHidden = false, progress = null) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (_) { return; }

  const relDir = path.relative(root, dir).split(path.sep).join('/') || '';

  // Stat all entries in parallel (needed to populate dirs cache with mtime+size).
  const entryStats = await Promise.all(
    entries.map(async (e) => {
      if (!walkHidden && e.name.startsWith('.')) return null;
      if (e.isDirectory() && IGNORED_DIR_NAMES.has(e.name)) return null;
      try {
        const s = await fsp.stat(path.join(dir, e.name));
        return {
          name: e.name,
          isFile: e.isFile(),
          isDirectory: e.isDirectory(),
          isSymbolicLink: e.isSymbolicLink(),
          mtime: s.mtime.getTime(),
          size: s.size,
        };
      } catch (_) {
        return {
          name: e.name,
          isFile: e.isFile(),
          isDirectory: e.isDirectory(),
          isSymbolicLink: e.isSymbolicLink(),
          mtime: 0,
          size: 0,
        };
      }
    }),
  );

  // dirs cache: all entries with stat info (client uses this for both
  // readdir and to lazily populate fs stat cache for each entry).
  dirsCache[relDir] = entryStats.filter(Boolean);

  if (progress) {
    progress.dirs = (progress.dirs || 0) + 1;
    progress.cb();
  }

  // Collect text files to read in this batch.
  const textFiles = [];

  for (const e of entryStats) {
    if (!e) continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');

    if (e.isDirectory) {
      // Put directory stat in fs cache so stat(dir) works.
      fsCache[rel] = { mtime: e.mtime, size: e.size, isFile: false, isDirectory: true };
      await walkDir(abs, root, fsCache, dirsCache, walkHidden, progress);
    } else if (isTextFile(e.name, e.size)) {
      // Text file within size limit: stat now, content added after batch read.
      fsCache[rel] = { mtime: e.mtime, size: e.size, isFile: true };
      textFiles.push({ abs, rel });
    }
    // Binary files or oversized text files: NOT added to fsCache here.
    // They'll be added lazily by the client when readdir is served.
  }

  // Read text file contents in parallel batches.
  for (let i = 0; i < textFiles.length; i += READ_BATCH) {
    const batch = textFiles.slice(i, i + READ_BATCH);
    await Promise.all(batch.map(async ({ abs, rel }) => {
      try {
        const content = await fsp.readFile(abs, 'utf8');
        fsCache[rel] = { ...fsCache[rel], content };
      } catch (_) {}
    }));
    if (progress) {
      progress.filesRead = (progress.filesRead || 0) + batch.length;
      progress.cb();
    }
  }
}

// ── core build ────────────────────────────────────────────────────────────────

/**
 * Build (or validate) the bootstrap cache entry for a single vault.
 *
 * - On first call or after invalidation: scans the vault, pre-compresses the
 *   JSON and stores everything in `serverCache`.
 * - On subsequent calls with unchanged dirs: returns the existing cache entry
 *   immediately (O(dirs) mtime checks only).
 * - Concurrent calls for the same vault share a single in-flight promise
 *   (pendingBuilds), so two simultaneous cold requests don't trigger two
 *   parallel full vault scans.
 *
 * Returns the cache entry: { response, dirMtimes, compressed }.
 * This function is used both by the HTTP handler and by the warm-up routine.
 */
async function buildCacheEntry(vaultId, vaultRoot, vaultRegistry, full = false) {
  // Deduplicate concurrent builds for the same vault+full combination.
  const buildKey = (vaultId || '') + ':' + (full ? 'full' : 'partial');
  if (pendingBuilds.has(buildKey)) {
    return pendingBuilds.get(buildKey);
  }
  const promise = _buildCacheEntry(vaultId, vaultRoot, vaultRegistry, full)
    .finally(() => pendingBuilds.delete(buildKey));
  pendingBuilds.set(buildKey, promise);
  return promise;
}

async function _buildCacheEntry(vaultId, vaultRoot, vaultRegistry, full = false) {
  const t0 = Date.now();
  const vault = vaultId ? vaultRegistry.get(vaultId) : null;

  // ── Electron IPC values ────────────────────────────────────────────
  const electronValues = {
    'vault':          vault ? { id: vaultId, path: VAULT_BASE } : {},
    'vault-list':     vaultRegistry.list(),
    'is-dev':         false,
    'version':        APP_VERSION,
    // 'native': browser supplies window chrome; 'hidden' would reserve an
    // empty frameless titlebar (see api/electron.js /frame).
    'frame':          'native',
    // Must match app.js's hardcoded EULA string exactly, or app.js calls
    // window.close() and boot silently freezes with no window.app and no
    // error (see api/electron.js /terms for the full explanation).
    'terms':          'I understand and agree that I am not allowed to '
                     + 'distribute the Obsidian application, in any form, without explicit '
                     + 'approval from the Obsidian team. I also understand that Obsidian is '
                     + 'a registered trademark, and I cannot use it without explicit '
                     + 'permission granted by the Obsidian team.',
    'policy':         {},
    'resources':      '',
    'file-url':       '',
    'disable-update': true,
    'update':         '',
    'check-update':   false,
    'insider-build':  false,
    'cli':            false,
    'disable-gpu':    false,
    'is-quitting':    false,
  };

  // ── Cache validation ───────────────────────────────────────────────
  const cached = serverCache.get(vaultId);
  if (cached) {
    const changedDirs = [];
    await Promise.all(
      Object.entries(cached.dirMtimes).map(async ([relDir, oldMtime]) => {
        const absDir = relDir
          ? path.join(vaultRoot, relDir.split('/').join(path.sep))
          : vaultRoot;
        try {
          const s = await fsp.stat(absDir);
          if (s.mtime.getTime() !== oldMtime) changedDirs.push(relDir);
        } catch (_) {
          changedDirs.push(relDir); // dir deleted → invalidate
        }
      }),
    );

    if (changedDirs.length === 0 && (cached.isFull || !full)) {
      const hitMs = Date.now() - t0;
      console.log(`[bootstrap] vault=${vaultId.slice(0, 8)}… cache HIT (${hitMs}ms)`);
      return cached;
    }

    console.log(`[bootstrap] vault=${vaultId.slice(0, 8)}… cache MISS (${changedDirs.length} dirs changed): ${changedDirs.slice(0, 5).join(', ')}`);
  }

  // ── Progress tracking ───────────────────────────────────────────
  const progress = {
    dirs: 0, filesRead: 0,
    cb() {
      const files = Object.keys(fsCache).filter(k => fsCache[k].isFile !== false).length;
      setProgress(vaultId, {
        state: 'scanning',
        label: 'Scanning vault...',
        dirs: this.dirs,
        files,
        filesRead: this.filesRead,
        total: files,
      });
    },
  };
  setProgress(vaultId, { state: 'scanning', label: 'Scanning vault...', dirs: 0, files: 0, filesRead: 0, pct: 0 });

  // ── FS + dirs walk ────────────────────────────────────────────────
  const fsCache = {};
  const dirsCache = {};

  // Always: walk .obsidian/ fully (plugins, themes, snippets…).
  const obsidianDir = path.join(vaultRoot, '.obsidian');
  try { await walkDir(obsidianDir, vaultRoot, fsCache, dirsCache, true, progress); } catch (_) {}

  // Vault root listing.
  try {
    const rootEntries = await fsp.readdir(vaultRoot, { withFileTypes: true });
    const rootStats = await Promise.all(
      rootEntries
        .filter(e => !e.name.startsWith('.'))
        .map(async (e) => {
          try {
            const s = await fsp.stat(path.join(vaultRoot, e.name));
            return {
              name: e.name,
              isFile: e.isFile(),
              isDirectory: e.isDirectory(),
              isSymbolicLink: e.isSymbolicLink(),
              mtime: s.mtime.getTime(),
              size: s.size,
            };
          } catch (_) {
            return {
              name: e.name,
              isFile: e.isFile(),
              isDirectory: e.isDirectory(),
              isSymbolicLink: e.isSymbolicLink(),
              mtime: 0,
              size: 0,
            };
          }
        }),
    );
    dirsCache[''] = rootStats.filter(Boolean);
  } catch (_) {}

  // If full=1: walk the entire vault (non-hidden) using the same walkDir helper
  // used for .obsidian/ above. walkDir builds both fsCache and dirsCache
  // recursively, including file content for text files. The root-listing entry
  // (dirsCache['']) built above will be overwritten with identical data —
  // that's fine; we avoid duplicating the walk logic.
  if (full) {
    setProgress(vaultId, { state: 'scanning', label: 'Scanning vault (full)...' });
    await walkDir(vaultRoot, vaultRoot, fsCache, dirsCache, false, progress);
  }

  setProgress(vaultId, { state: 'reading', label: 'Reading files...', pct: 80 });
  const fileCount = Object.keys(fsCache).length;
  const dirCount = Object.keys(dirsCache).length;
  const withContent = Object.values(fsCache).filter(v => v.content !== undefined).length;
  const byteCount = Object.values(fsCache)
    .filter(v => v.content)
    .reduce((s, v) => s + v.size, 0);

  const response = { electron: electronValues, fs: fsCache, dirs: dirsCache };

  // Snapshot directory mtimes for future invalidation checks.
  const dirMtimes = {};
  await Promise.all(
    Object.keys(dirsCache).map(async (relDir) => {
      const absDir = relDir
        ? path.join(vaultRoot, relDir.split('/').join(path.sep))
        : vaultRoot;
      try {
        const s = await fsp.stat(absDir);
        dirMtimes[relDir] = s.mtime.getTime();
      } catch (_) {
        dirMtimes[relDir] = 0;
      }
    }),
  );

  // Pre-compress once. Subsequent HIT requests send the buffer directly,
  // skipping JSON.stringify + zlib (~800ms → <5ms).
  setProgress(vaultId, { state: 'compressing', label: 'Compressing...', pct: 90 });
  const jsonBuf = Buffer.from(JSON.stringify(response));
  let compressed = {};
  try { compressed = await preCompress(jsonBuf); } catch (_) {}

  const entry = { response, dirMtimes, compressed, isFull: full };
  if (vaultId) serverCache.set(vaultId, entry);
  setProgress(vaultId, { state: 'ready', label: 'Ready', pct: 100 });
  // Clean up progress after a short delay so late pollers see "ready".
  setTimeout(() => buildProgress.delete(vaultId), 5000);

  const ms = Date.now() - t0;
  console.log(
    `[bootstrap] vault=${vaultId.slice(0, 8)}… full=${full} ` +
    `files=${fileCount}(content:${withContent}) dirs=${dirCount} ` +
    `size=${(byteCount / 1024).toFixed(0)}KB time=${ms}ms`,
  );

  return entry;
}

// ── router ────────────────────────────────────────────────────────────────────

function createBootstrapRouter(vaultRegistry, fallbackVaultRoot) {
  const router = express.Router();

  // Lightweight status endpoint for progress polling.
  router.get('/status', (req, res) => {
    const vaultId = req.query.vault || '';
    const progress = buildProgress.get(vaultId);
    if (!progress) {
      return res.json({ state: 'idle', label: '' });
    }
    res.json(progress);
  });

  router.get('/', async (req, res) => {
    const vaultId = req.query.vault || '';
    const full = req.query.full === '1';

    const vault = vaultId ? vaultRegistry.get(vaultId) : null;
    const vaultRoot = vault ? vault.path : fallbackVaultRoot;

    // Stale-while-revalidate: if ANY cached entry exists, serve it immediately
    // and rebuild in the background. This prevents the browser from blocking on
    // a full vault rescan (which can take 30-60s for large vaults) when the
    // cache was merely invalidated by a dir mtime change (e.g. ion-sync activity).
    //
    // Only block on a true cold start (no entry at all). On the next request
    // after the background build finishes, the client will get fresh data.
    const existing = serverCache.get(vaultId);
    let entry;
    if (existing) {
      const needsFull = full && !existing.isFull;
      if (needsFull) {
        console.log(`[bootstrap] vault=${vaultId.slice(0, 8)}… serving partial/stale while full build runs in background`);
      } else {
        console.log(`[bootstrap] vault=${vaultId.slice(0, 8)}… serving stale-while-revalidate`);
      }
      // Fire background refresh (deduplicated via pendingBuilds — no-op if already running).
      buildCacheEntry(vaultId, vaultRoot, vaultRegistry, full)
        .catch((err) => console.warn('[bootstrap] background revalidation error:', err.message));
      entry = existing;
    } else {
      // Cold start — no cached entry at all. Must wait for the initial build.
      entry = await buildCacheEntry(vaultId, vaultRoot, vaultRegistry, full);
    }

    // Send the pre-compressed buffer directly, bypassing middleware
    // re-serialisation. Setting Content-Encoding before res.end() causes
    // the compression middleware to skip this response (shouldTransform = false).
    const { compressed } = entry;
    const ae = req.headers['accept-encoding'] || '';
    let buf, encoding;
    if (ae.includes('br') && compressed.br) {
      buf = compressed.br;
      encoding = 'br';
    } else if ((ae.includes('gzip') || ae.includes('deflate')) && compressed.gz) {
      buf = compressed.gz;
      encoding = 'gzip';
    }

    if (buf) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', buf.length);
      return res.status(200).end(buf);
    }
    // Fallback: client doesn't accept any compression (very rare).
    res.json(entry.response);
  });

  return router;
}

/**
 * Warm up the bootstrap cache for all registered vaults in the background.
 * Called at server start so the first real user request is a cache HIT.
 */
async function warmUpBootstrapCache(vaultRegistry, fallbackVaultRoot) {
  const vaults = vaultRegistry.list();
  const ids = Object.keys(vaults);
  if (ids.length === 0 && fallbackVaultRoot) {
    // No registered vaults yet — warm up the fallback vault.
    try {
      await buildCacheEntry('', fallbackVaultRoot, vaultRegistry, false);
    } catch (err) {
      console.warn('[bootstrap] warm-up failed for fallback vault:', err.message);
    }
    return;
  }
  for (const id of ids) {
    const { path: vaultPath } = vaults[id];
    try {
      // Phase 1: fast partial build so the first request is never a cold MISS.
      await buildCacheEntry(id, vaultPath, vaultRegistry, false);
      // Phase 2: full build in background — replaces the partial entry when done.
      buildCacheEntry(id, vaultPath, vaultRegistry, true)
        .catch((err) => console.warn(`[bootstrap] full warm-up failed for vault ${id}:`, err.message));
    } catch (err) {
      console.warn(`[bootstrap] warm-up failed for vault ${id}:`, err.message);
    }
  }
}

module.exports = createBootstrapRouter;
module.exports.serverCache = serverCache;
module.exports.pendingBuilds = pendingBuilds;
module.exports.warmUpBootstrapCache = warmUpBootstrapCache;
