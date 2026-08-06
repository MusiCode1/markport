'use strict';

// Integration (brief §4 Commit 2): hash matches `sha256sum`, cache skips
// re-hash on an unchanged file, ETag/If-None-Match -> 304, walk is
// recursive + files-only, path-traversal stays inside the fixture vault.

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const http = require('http');

const { createManifestService, createManifestRouter } = require('../manifest');

async function makeFixtureVault() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-manifest-'));
  await fsp.mkdir(path.join(root, 'notes', 'nested'), { recursive: true });
  await fsp.mkdir(path.join(root, '.obsidian'), { recursive: true });
  await fsp.mkdir(path.join(root, 'empty-dir'), { recursive: true });
  await fsp.writeFile(path.join(root, 'top.md'), '# top level note\n');
  await fsp.writeFile(path.join(root, 'notes', 'a.md'), 'note a content');
  await fsp.writeFile(path.join(root, 'notes', 'nested', 'b.md'), 'note b, nested');
  await fsp.writeFile(path.join(root, '.obsidian', 'config.json'), '{"x":1}');
  return root;
}

function realSha256(absPath) {
  const out = execFileSync('sha256sum', [absPath], { encoding: 'utf8' });
  return out.split(/\s+/)[0];
}

async function withFixture(t, fn) {
  const root = await makeFixtureVault();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return fn(root);
}

test('manifest entries: recursive, files only, path/size/hash correct (matches sha256sum)', async (t) => {
  await withFixture(t, async (root) => {
    const service = createManifestService(root);
    const { cursor, entries } = await service.build();

    assert.equal(typeof cursor, 'string');
    assert.ok(cursor.length > 0);

    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, [
      '.obsidian/config.json',
      'notes/a.md',
      'notes/nested/b.md',
      'top.md',
    ]);
    // empty-dir/ must not appear as an entry (files only).
    assert.ok(!paths.some((p) => p.includes('empty-dir')));

    for (const entry of entries) {
      const absPath = path.join(root, ...entry.path.split('/'));
      const stat = await fsp.stat(absPath);
      assert.equal(entry.size, stat.size);
      assert.equal(entry.hash, realSha256(absPath), `hash mismatch for ${entry.path}`);
    }
  });
});

test('cache: rebuilding an unchanged vault does zero re-hashing', async (t) => {
  await withFixture(t, async (root) => {
    const service = createManifestService(root);
    const first = await service.build();
    assert.ok(service.stats.hashComputations >= first.entries.length);

    service.resetStats();
    const second = await service.build();
    assert.equal(service.stats.hashComputations, 0, 'no file changed — cache should skip every re-hash');
    assert.equal(second.cursor, first.cursor);
    assert.deepEqual(second.entries, first.entries);
  });
});

test('cache: only the changed file gets re-hashed after a content edit', async (t) => {
  await withFixture(t, async (root) => {
    const service = createManifestService(root);
    await service.build();
    service.resetStats();

    // Sleep briefly so mtime actually advances on filesystems with coarse
    // mtime resolution, then edit exactly one file.
    await new Promise((r) => setTimeout(r, 20));
    await fsp.writeFile(path.join(root, 'notes', 'a.md'), 'note a content — EDITED');

    const rebuilt = await service.build();
    assert.equal(service.stats.hashComputations, 1, 'only the edited file should be re-hashed');
    const edited = rebuilt.entries.find((e) => e.path === 'notes/a.md');
    assert.equal(edited.hash, realSha256(path.join(root, 'notes', 'a.md')));
  });
});

test('ETag / If-None-Match -> 304 on an unchanged manifest', async (t) => {
  await withFixture(t, async (root) => {
    const service = createManifestService(root);
    const app = express();
    app.use(createManifestRouter(service));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    t.after(() => new Promise((r) => server.close(r)));

    const first = await fetch(`${baseUrl}/manifest`);
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const body = await first.json();
    assert.equal(etag, `"${body.cursor}"`);

    const second = await fetch(`${baseUrl}/manifest`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
  });
});

test('perf regression: walk+hash a ~500-file vault (§0.1 spike scale) completes quickly, cache eliminates re-hash cost', async (t) => {
  // Local disk, not a network mount — isolates the algorithm's own cost
  // (walk/hash/cache/concurrency) from filesystem latency, which is what
  // §0.1(3) asked to validate. (A live run against the large network-mounted
  // vault used for manual perf spikes is documented separately in the
  // executor's deviations — that mount's slowness is environmental, not a
  // property of this code: even a plain readdir-only `find` over it took
  // several minutes with no hashing involved at all.)
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-perf-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const FOLDERS = 50;
  const FILES_PER_FOLDER = 10; // 500 files
  for (let f = 0; f < FOLDERS; f++) {
    const dir = path.join(root, `folder-${f}`);
    await fsp.mkdir(dir, { recursive: true });
    for (let i = 0; i < FILES_PER_FOLDER; i++) {
      await fsp.writeFile(path.join(dir, `note-${i}.md`), `# note ${f}-${i}\n` + 'lorem ipsum '.repeat(50));
    }
  }

  const service = createManifestService(root);
  const coldStart = Date.now();
  const first = await service.build();
  const coldMs = Date.now() - coldStart;
  assert.equal(first.entries.length, FOLDERS * FILES_PER_FOLDER);
  assert.equal(service.stats.hashComputations, FOLDERS * FILES_PER_FOLDER);
  assert.ok(coldMs < 5000, `cold build of 500 local files took ${coldMs}ms — expected well under 5s`);

  service.resetStats();
  const warmStart = Date.now();
  const second = await service.build();
  const warmMs = Date.now() - warmStart;
  assert.equal(service.stats.hashComputations, 0, 'cache should skip every re-hash on an unchanged vault');
  assert.ok(warmMs < coldMs, 'cached rebuild should be faster than the cold build');
  assert.equal(second.cursor, first.cursor);
});

test('resolveSafe (used by the walk) blocks path traversal out of the vault', async () => {
  const resolveSafe = require('../resolve-safe');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-traversal-'));
  try {
    assert.equal(resolveSafe(root, 'notes/a.md'), path.join(root, 'notes', 'a.md'));
    assert.throws(() => resolveSafe(root, '../../../etc/passwd'), /escapes vault root/);
    assert.throws(() => resolveSafe(root, '..'), /escapes vault root/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
