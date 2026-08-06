'use strict';

const path = require('path');

// Resolve `relPath` against `vaultPath`, refusing to escape it (path
// traversal guard). Re-implemented here rather than imported from
// runtime-server/api/fs.js — that resolveSafe is coupled to `req` and a
// multi-vault registry (getVaultRoot(req)); this package is single-VAULT_PATH
// and has no req. See brief §3(ד2)/§6.
//
// Used both by manifest.js (while walking) and blob.js (when resolving a
// hash→path lookup to an absolute path before streaming) — a poisoned or
// stale index entry must never be able to point outside VAULT_PATH.
function resolveSafe(vaultPath, relPath) {
  if (typeof relPath !== 'string') {
    throw new Error('path must be a string');
  }
  const root = path.resolve(vaultPath);
  const absolute = path.resolve(root, relPath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    const err = new Error('path escapes vault root: ' + relPath);
    err.code = 'EESCAPE';
    throw err;
  }
  return absolute;
}

module.exports = resolveSafe;
