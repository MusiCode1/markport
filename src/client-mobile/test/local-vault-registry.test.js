'use strict';

/**
 * Unit tests for local-vault-registry.js's create(name, opts) — extended
 * (docs/plans/seed-demo.md §3א, §6 risk) to accept a fixed `opts.id` (used
 * by the lazy Demo vault, boot.js ensureDemo) while falling back to uuid()
 * when omitted (existing callers — create-vault interceptor, folder-vault
 * flow — must see zero behavior change).
 *
 * No DOM available under node:test/bun test — polyfills a fake
 * `localStorage` on `global` before requiring the module (same "no window.
 * qualifier" pattern documented at the top of local-vault-registry.js).
 * Full-browser verification (registry persists across reload, etc.) is out
 * of scope here — covered by calev-heavy.
 */

const assert = require('assert/strict');
const test = require('node:test');

function makeFakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function freshRegistry() {
  global.localStorage = makeFakeLocalStorage();
  delete require.cache[require.resolve('../local-vault-registry')];
  return require('../local-vault-registry');
}

test('create() with no opts.id mints a uuid — unchanged behavior for existing callers (brief §6 risk)', () => {
  const registry = freshRegistry();
  const v1 = registry.create('My Vault');
  const v2 = registry.create('Another Vault');
  assert.ok(v1.id, 'id is truthy');
  assert.ok(v2.id, 'id is truthy');
  assert.notEqual(v1.id, v2.id, 'two create() calls without opts.id get different ids');
  assert.equal(v1.name, 'My Vault');
  assert.equal(registry.get(v1.id).name, 'My Vault');
});

test('create() with opts.id uses the fixed id instead of minting a uuid (brief §3א, core of ensureDemo)', () => {
  const registry = freshRegistry();
  const v = registry.create('Demo', { id: '0000demo0000demo' });
  assert.equal(v.id, '0000demo0000demo');
  assert.equal(registry.get('0000demo0000demo').name, 'Demo');
});

test('create() with opts.id twice overwrites the same entry (idempotent id) rather than creating a duplicate', () => {
  const registry = freshRegistry();
  registry.create('Demo', { id: 'fixed-id' });
  registry.create('Demo', { id: 'fixed-id' });
  const all = registry.list();
  assert.equal(all.filter((v) => v.id === 'fixed-id').length, 1);
});

test('create() default type is "local"; opts.type is respected', () => {
  const registry = freshRegistry();
  const v1 = registry.create('A');
  assert.equal(v1.type, 'local');
  const v2 = registry.create('B', { type: 'folder' });
  assert.equal(v2.type, 'folder');
});

test('has()/get() reflect create() with a fixed id', () => {
  const registry = freshRegistry();
  assert.equal(registry.has('0000demo0000demo'), false);
  registry.create('Demo', { id: '0000demo0000demo' });
  assert.equal(registry.has('0000demo0000demo'), true);
});

// ── vaultPath(id, name) — docs/plans/electron-shim-foundation.md §3.4 ──

test('vaultPath(id, name) builds "/ow/<id>/<name>"', () => {
  const registry = freshRegistry();
  assert.equal(registry.vaultPath('abc123', 'My Vault'), '/ow/abc123/My Vault');
});

test('vaultPath(id) with no/empty name falls back to the id itself — two-arg signature is deliberate: get(id) does not return id, so vaultPath(get(id)) would otherwise silently produce "/ow/undefined/<name>"', () => {
  const registry = freshRegistry();
  assert.equal(registry.vaultPath('abc123'), '/ow/abc123/abc123');
  assert.equal(registry.vaultPath('abc123', ''), '/ow/abc123/abc123');
  assert.equal(registry.vaultPath('abc123', undefined), '/ow/abc123/abc123');
});
