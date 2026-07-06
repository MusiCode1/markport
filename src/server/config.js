const path = require('path');

// Repo root — two levels up from src/server/.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Single source of truth for the Obsidian app version we ship.
// Both bootstrap.js and electron.js import this instead of hardcoding it.
const APP_VERSION = '1.12.7';

// Virtual path that the renderer sees as its vault root.
// Must match the value the client shims use (src/client/boot.js VAULT_BASE).
const VAULT_BASE = '/vault';

const crypto = require('crypto');
const fsSync = require('fs');

function parsePort(raw) {
  if (!raw) return 3000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT value: "${raw}". Must be an integer between 1 and 65535.`);
  }
  return n;
}

/**
 * Compute a short cache-buster string from the mtimes of all files under
 * the src/client/ (or src/client-mobile/) directory. Changes to any client
 * file automatically produce a new bust value without any manual ?v= bump.
 *
 * Returns a 6-char hex string, e.g. "a3f7c2".
 */
function computeClientCacheBust(clientPath) {
  try {
    const hash = crypto.createHash('sha1');
    function walk(dir) {
      let entries;
      try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); }
      catch (_) { return; }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(abs);
        } else {
          try {
            const s = fsSync.statSync(abs);
            hash.update(abs + ':' + s.mtimeMs);
          } catch (_) {}
        }
      }
    }
    walk(clientPath);
    return hash.digest('hex').slice(0, 6);
  } catch (_) {
    return 'dev';
  }
}

const CLIENT_PATH = path.resolve(PROJECT_ROOT, 'src', 'client');
const CLIENT_MOBILE_PATH = path.resolve(PROJECT_ROOT, 'src', 'client-mobile');
const OBSIDIAN_PATH = path.resolve(PROJECT_ROOT, 'vendor', 'obsidian');
const OBSIDIAN_MOBILE_PATH = path.resolve(PROJECT_ROOT, 'vendor', 'obsidian-mobile');

module.exports = {
  port: parsePort(process.env.PORT),
  host: process.env.HOST || '127.0.0.1',
  vaultPath: path.resolve(PROJECT_ROOT, process.env.VAULT_PATH || 'user-data/demo-vault'),
  registryPath: path.resolve(PROJECT_ROOT, process.env.VAULT_REGISTRY || 'user-data/registry.json'),
  obsidianPath: OBSIDIAN_PATH,
  obsidianMobilePath: OBSIDIAN_MOBILE_PATH,
  clientPath: CLIENT_PATH,
  clientMobilePath: CLIENT_MOBILE_PATH,
  projectRoot: PROJECT_ROOT,
  appVersion: APP_VERSION,
  vaultBase: VAULT_BASE,
  // Computed once at startup from src/client/ + src/client-mobile/ file mtimes.
  // Used by index.html, starter.html and client-mobile/index.html to inject
  // ?v=<bust> on all client scripts — no manual ?v=N bump needed.
  clientCacheBust: computeClientCacheBust(CLIENT_PATH) + computeClientCacheBust(CLIENT_MOBILE_PATH),
  // Set WATCH_POLLING=true when the vault lives on a filesystem that does not
  // support inotify (rclone/FUSE, NFS, SMB, …).  Without polling chokidar
  // will never fire any events on those mounts.
  watchPolling: process.env.WATCH_POLLING === 'true',
  watchPollInterval: process.env.WATCH_POLL_INTERVAL
    ? parseInt(process.env.WATCH_POLL_INTERVAL, 10)
    : 3000,
  auth: {
    username: process.env.OBSIDIAN_WEB_USERNAME || 'ethan',
    password: process.env.OBSIDIAN_WEB_PASSWORD || '',
    realm: process.env.OBSIDIAN_WEB_REALM || 'Obsidian Web',
    sessionSecret: process.env.OBSIDIAN_WEB_SESSION_SECRET || `${process.env.OBSIDIAN_WEB_USERNAME || 'ethan'}:${process.env.OBSIDIAN_WEB_PASSWORD || ''}:${process.env.OBSIDIAN_WEB_REALM || 'Obsidian Web'}`,
    cookieName: process.env.OBSIDIAN_WEB_COOKIE_NAME || 'obsidian_web_session',
    cookieDays: parseInt(process.env.OBSIDIAN_WEB_COOKIE_DAYS || '30', 10),
  },
  bootstrap: {
    // Master switch. When false, /api/bootstrap returns { disabled: true }
    // immediately without scanning the vault. Useful for minimal deployments
    // where the round-trip-saving isn't worth the precompute.
    enabled: process.env.BOOTSTRAP_DISABLED !== 'true',

    // Per-file size cap (KB). Files larger than this get stat-only in the
    // response — content is fetched on demand.
    maxFileKB: parseInt(process.env.BOOTSTRAP_MAX_FILE_KB || '500', 10),

    // Total response size cap (MB) on the UNCOMPRESSED JSON. When the
    // accumulated file content would exceed this, the server stops adding
    // content but still returns dirs+electron. Marks response with
    // { capped: true }.
    maxTotalMB: parseInt(process.env.BOOTSTRAP_MAX_TOTAL_MB || '50', 10),
  },
};
