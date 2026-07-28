'use strict';

/**
 * Integration test for seedExampleVault (seed-example-vault.js) — exercises
 * the real production logic end-to-end against a fake OpfsStore (same shape
 * as storage/opfs-store.js makeStore()) and a mocked global fetch (same
 * shape as /example-vault.json, see build-assets.sh). Full-browser/OPFS
 * verification (DoD #2-#6 in docs/plans/cf-mobile-seed.md §5) is out of
 * scope for a node:test/bun test process — covered separately by calev-heavy.
 */

const assert = require('assert/strict');
const test = require('node:test');
const { seedExampleVault } = require('../seed-example-vault');

// ── fake OpfsStore — same stat/writeFile contract as storage/opfs-store.js ──
function makeFakeStore(initialFiles) {
  const files = new Map(Object.entries(initialFiles || {}));
  return {
    files,
    async stat({ path }) {
      if (!files.has(path)) {
        const e = new Error('stat: not found: ' + path);
        e.code = 'ENOENT';
        throw e;
      }
      return { isDirectory: false };
    },
    async writeFile({ path, data }) {
      files.set(path, data);
      return { uri: '' };
    },
  };
}

const EXAMPLE_FILES = [
  ['.obsidian/app.json', '{"legacyEditor":false}'],
  ['.obsidian/community-plugins.json', '["dataview","templater-obsidian"]'],
  ['Welcome.md', '# Welcome'],
  ['How It Works.md', '# How It Works'],
  ['Features/Markdown Showcase.md', '# Markdown Showcase'],
  ['Features/Tags.md', '# Tags'],
];

function makeFakeFetch(files) {
  return async function fakeFetch(url) {
    if (url === '/example-vault.json' || url.indexOf('/example-vault.json?') === 0) {
      return { ok: true, json: async () => files };
    }
    return { ok: false };
  };
}

test('seedExampleVault seeds content files, skips .obsidian/ entirely (finding 1)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await seedExampleVault(store);

  assert.equal(store.files.get('Welcome.md'), '# Welcome');
  assert.equal(store.files.get('How It Works.md'), '# How It Works');
  assert.equal(store.files.get('Features/Markdown Showcase.md'), '# Markdown Showcase');
  assert.equal(store.files.get('Features/Tags.md'), '# Tags');

  // finding 1 — .obsidian/* must NOT be seeded (would overwrite seedSystemPlugins'
  // community-plugins.json and un-enable the layout switcher)
  assert.equal(store.files.has('.obsidian/app.json'), false);
  assert.equal(store.files.has('.obsidian/community-plugins.json'), false);
});

test('seedExampleVault is idempotent — a second run on an already-seeded vault is a no-op', async (t) => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url) => { calls.push(url); return makeFakeFetch(EXAMPLE_FILES)(url); };
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await seedExampleVault(store);
  assert.equal(calls.length, 1);

  await seedExampleVault(store);   // second boot — Welcome.md already exists → gate skips
  assert.equal(calls.length, 1, 'no /example-vault.json fetch on the second (idempotent) run');
});

test('seedExampleVault is a no-op when the vault already has Welcome.md (existing content, not first-visit)', async (t) => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url) => { calls.push(url); return makeFakeFetch(EXAMPLE_FILES)(url); };
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore({ 'Welcome.md': '# my own welcome note' });
  await seedExampleVault(store);

  assert.equal(calls.length, 0, 'gate short-circuits before any fetch');
  assert.equal(store.files.get('Welcome.md'), '# my own welcome note', 'existing content untouched');
});

test('seedExampleVault is a no-op when /example-vault.json is missing (local dev — no regression, DoD#6)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await seedExampleVault(store);

  assert.equal(store.files.size, 0);
});

test('seedExampleVault does not reject when fetch throws (network failure)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await assert.doesNotReject(seedExampleVault(store));
  assert.equal(store.files.size, 0);
});

// ── opts.force (docs/plans/demo-origin-split.md §4 Commit 3) ────────────────
// force:true skips the stat-gate and re-writes every template file, used by
// boot.js's re-seed-on-content-change block (window.__owDemoContent hash
// mismatch) — NOT by the first-visit seed, which still uses the default gate.

test('seedExampleVault({force:true}) writes template files even though Welcome.md already exists', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore({ 'Welcome.md': '# stale welcome (old template)' });
  await seedExampleVault(store, { force: true });

  assert.equal(store.files.get('Welcome.md'), '# Welcome', 'force rewrites the stale template file');
  assert.equal(store.files.get('How It Works.md'), '# How It Works');
});

test('seedExampleVault({force:true}) still skips .obsidian/ entirely (finding 1 holds under force too)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore({ 'Welcome.md': '# stale' });
  await seedExampleVault(store, { force: true });

  assert.equal(store.files.has('.obsidian/app.json'), false);
  assert.equal(store.files.has('.obsidian/community-plugins.json'), false);
});

test('seedExampleVault({force:true}) does not touch a visitor-created file outside the template', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore({ 'Welcome.md': '# stale', 'My Note.md': '# my own note, not in the template' });
  await seedExampleVault(store, { force: true });

  assert.equal(store.files.get('My Note.md'), '# my own note, not in the template', 'visitor file untouched — not deleted, not overwritten');
  assert.equal(store.files.get('Welcome.md'), '# Welcome', 'template file still refreshed');
});

// ── return value + opts.cacheBust (calev-heavy NO-GO, Commit 3 phase-verify —
// reports/obsidian-web/demo-origin-split-commit3-calev.md, NBug1 + NBug2) ──

test('seedExampleVault resolves true when it actually writes files', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const result = await seedExampleVault(makeFakeStore());
  assert.equal(result, true);
});

test('seedExampleVault resolves false (not true) when the gate skips it (already seeded, no force)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const result = await seedExampleVault(makeFakeStore({ 'Welcome.md': '# already here' }));
  assert.equal(result, false);
});

test('seedExampleVault resolves false (not true) when /example-vault.json fetch fails — NBug2: caller must not mark the attempt as done', async (t) => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500 });
  t.after(() => { global.fetch = origFetch; });

  const result = await seedExampleVault(makeFakeStore());
  assert.equal(result, false);
});

test('seedExampleVault resolves false (not true) when fetch throws (network failure)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  t.after(() => { global.fetch = origFetch; });

  const result = await seedExampleVault(makeFakeStore());
  assert.equal(result, false);
});

test('seedExampleVault(store, {force:true, cacheBust}) appends ?v=<cacheBust> to the example-vault.json request — NBug1: a still-controlling PREVIOUS service worker caches that URL cache-first, so a fixed URL can silently serve a stale (pre-redeploy) payload even though the new build hash already differs', async (t) => {
  const requestedUrls = [];
  const origFetch = global.fetch;
  global.fetch = async (url) => { requestedUrls.push(url); return makeFakeFetch(EXAMPLE_FILES)(url); };
  t.after(() => { global.fetch = origFetch; });

  await seedExampleVault(makeFakeStore({ 'Welcome.md': '# stale' }), { force: true, cacheBust: 'a165e8e61a880d38' });

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], '/example-vault.json?v=a165e8e61a880d38');
});

test('seedExampleVault(store, {force:true}) without cacheBust still uses the plain URL (backward compatible)', async (t) => {
  const requestedUrls = [];
  const origFetch = global.fetch;
  global.fetch = async (url) => { requestedUrls.push(url); return makeFakeFetch(EXAMPLE_FILES)(url); };
  t.after(() => { global.fetch = origFetch; });

  await seedExampleVault(makeFakeStore({ 'Welcome.md': '# stale' }), { force: true });

  assert.equal(requestedUrls[0], '/example-vault.json');
});
