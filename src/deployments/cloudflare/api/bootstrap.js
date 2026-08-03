/**
 * Bootstrap endpoint — builds the single-shot preload response.
 *
 * Mirrors server/api/bootstrap.js but reads from the Durable Object's
 * in-memory maps instead of scanning a real filesystem.
 *
 * Response shape: { electron, fs, dirs }
 *   electron — IPC stub values (vault info, version, …)
 *   fs       — { path: { content?, mtime, size, isFile, isDirectory? } }
 *   dirs     — { path: [{ name, isFile, isDirectory, isSymbolicLink, mtime, size }] }
 */

const APP_VERSION = '1.12.7';

export function buildBootstrap(vault) {
  const fs   = {};
  const dirs = {};

  // ── File entries ─────────────────────────────────────────────────────────
  for (const [path, data] of vault.files) {
    fs[path] = {
      content: data.content,
      mtime:   data.mtime,
      size:    data.size,
      isFile:  true,
    };
  }

  // ── Directory stat entries (so stat(dir) works from cache) ───────────────
  for (const [dirPath] of vault.dirs) {
    if (dirPath !== '') {
      fs[dirPath] = {
        mtime:       Date.now(),
        size:        0,
        isFile:      false,
        isDirectory: true,
      };
    }
  }

  // ── Directory listings ───────────────────────────────────────────────────
  for (const [dirPath, entries] of vault.dirs) {
    dirs[dirPath] = entries;
  }

  // ── Electron IPC values ──────────────────────────────────────────────────
  const electron = {
    'vault':          { id: 'demo', path: '/vault' },
    'vault-list':     { demo: { path: '/vault', ts: Date.now(), open: true } },
    'is-dev':         false,
    'version':        APP_VERSION,
    'frame':          'native',
    // Must match app.js's hardcoded EULA string exactly, or boot silently
    // freezes (see src/server/api/electron.js for the full explanation).
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

  return { electron, fs, dirs };
}
