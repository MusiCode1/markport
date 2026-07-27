'use strict';

/**
 * Unit tests for vault-root-path.js's isVaultRootPath (docs/plans/
 * electron-shim-foundation.md §3.3) — the desktop-only `Vault.readRaw("")`
 * empty-vault probe reads the vault root AS A FILE and branches on error
 * CODE, so identifying "this IS the vault root" correctly is what makes
 * capacitor-shim.js answer EISDIR instead of a raw 404/ENOENT that would
 * wrongly discard a perfectly good, non-empty vault.
 *
 * Root identification is explicitly NOT `path === ''` — see the measured
 * "<id>//" shape in the module's own header comment.
 */

const assert = require('assert/strict');
const test = require('node:test');
const { isVaultRootPath } = require('../vault-root-path');

test('empty string is the root', () => {
  assert.equal(isVaultRootPath(''), true);
});

test('a lone slash is the root', () => {
  assert.equal(isVaultRootPath('/'), true);
});

test('a lone dot is the root', () => {
  assert.equal(isVaultRootPath('.'), true);
});

test('the measured "<id>//" shape (after fullPath() strips the vault-id prefix, leaving a trailing "//") is the root', () => {
  // fullPath() itself already strips the "<vaultId>/" prefix — what reaches
  // this check for the measured live path
  // {"directory":"EXTERNAL","path":"0000demo0000demo//"} is a lone
  // trailing "/" left over. Cover that shape directly, plus a couple of
  // trailing-slash variants for good measure.
  assert.equal(isVaultRootPath('/'), true);
  assert.equal(isVaultRootPath('//'), true);
  assert.equal(isVaultRootPath('///'), true);
});

test('a legitimate non-root path must NOT be flagged as root', () => {
  assert.equal(isVaultRootPath('Welcome.md'), false);
  assert.equal(isVaultRootPath('Features/Backlinks.md'), false);
  assert.equal(isVaultRootPath('.obsidian/plugins/foo/main.js'), false);
  // a directory-looking non-root path with a trailing slash is still not
  // the vault root — only an EMPTY (post-normalization) path is.
  assert.equal(isVaultRootPath('Features/'), false);
});

test('non-string input is never treated as root', () => {
  assert.equal(isVaultRootPath(undefined), false);
  assert.equal(isVaultRootPath(null), false);
});
