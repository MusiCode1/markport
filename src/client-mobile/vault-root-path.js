/**
 * vault-root-path.js — pure helper: "is this fullPath() output the vault
 * root?" (docs/plans/electron-shim-foundation.md §3.3).
 *
 * No browser/DOM deps — runs under node:test and inside the browser via a
 * plain <script> tag (attaches to window.__owVaultRootPath), same pattern as
 * bootstrap-lookup.js / cache-invalidation.js.
 *
 * WHY this exists: `Vault.readRaw("")` (desktop-only code path — gated on
 * `bn.isDesktopApp`) reads the vault root AS A FILE to detect one specific
 * condition (empty/missing vault). A real filesystem answers that with
 * EISDIR ("it's a directory, not a file"), not ENOENT ("not found") — the
 * bundle branches on the error CODE (`"ENOENT"===i.code`), so answering the
 * wrong code makes it think the vault doesn't exist at all and discards it
 * (`this.vault=null, this.openVaultChooser(!0)`).
 *
 * Root identification is NOT `path === ''` (measured, live): the actual path
 * capacitor-shim.js's fullPath() can produce for a root read is
 * `"<vaultId>//"` (trailing double slash — a resolvePrefix('EXTERNAL') empty
 * prefix concatenated with a path that itself resolved to a lone slash), so
 * this normalizes trailing slashes before comparing.
 */
(function () {
  'use strict';

  // Everything callers actually observed at the vault root, post
  // fullPath()'s own vaultId-stripping: the empty string (the common case),
  // a lone slash or dot (defensive), and the measured "<id>//" shape with
  // its trailing slashes stripped down to nothing.
  function isVaultRootPath(p) {
    if (typeof p !== 'string') return false;
    const stripped = p.replace(/\/+$/, '');
    return stripped === '' || stripped === '.';
  }

  const api = { isVaultRootPath };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.__owVaultRootPath = api;
  }
})();
