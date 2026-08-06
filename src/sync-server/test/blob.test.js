'use strict';

// Integration (brief §4 Commit 3): bytes served for a hash are correct,
// unknown hash → 404, immutable Cache-Control header set.

const test = require('node:test');
const assert = require('assert/strict');
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const http = require('http');

const { createManifestService, createManifestRouter } = require('../manifest');
const { createBlobRouter } = require('../blob');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function startTestServer() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-blob-'));
  await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
  await fsp.writeFile(path.join(root, 'notes', 'a.md'), 'hello from a');
  await fsp.writeFile(path.join(root, 'notes', 'b.md'), 'hello from b, longer content here');

  const manifestService = createManifestService(root);
  await manifestService.build(); // populate the hash index blob.js relies on

  const app = express();
  app.use(createManifestRouter(manifestService));
  app.use(createBlobRouter(root, manifestService));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    root,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((r) => server.close(r));
      await fsp.rm(root, { recursive: true, force: true });
    },
  };
}

test('GET /blob/:hash returns the exact bytes for that content hash', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const hash = sha256('hello from a');
  const res = await fetch(`${baseUrl}/blob/${hash}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, 'hello from a');
});

test('GET /blob/:hash sets immutable Cache-Control', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const hash = sha256('hello from b, longer content here');
  const res = await fetch(`${baseUrl}/blob/${hash}`);
  assert.equal(res.status, 200);
  const cacheControl = res.headers.get('cache-control');
  assert.match(cacheControl, /immutable/);
  assert.match(cacheControl, /max-age=31536000/);
});

test('GET /blob/:hash with an unknown (but well-formed) hash -> 404', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const unknownHash = 'f'.repeat(64);
  const res = await fetch(`${baseUrl}/blob/${unknownHash}`);
  assert.equal(res.status, 404);
});

test('GET /blob/:hash with a malformed hash -> 404 (no FS lookup attempted)', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const res = await fetch(`${baseUrl}/blob/not-a-hash-at-all`);
  assert.equal(res.status, 404);
});

test('content-identical files dedup onto the same hash — either path resolves', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-blob-dedup-'));
  await fsp.writeFile(path.join(root, 'dup1.md'), 'same content everywhere');
  await fsp.writeFile(path.join(root, 'dup2.md'), 'same content everywhere');

  const manifestService = createManifestService(root);
  await manifestService.build();

  const app = express();
  app.use(createBlobRouter(root, manifestService));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((r) => server.close(r));
    await fsp.rm(root, { recursive: true, force: true });
  });

  const hash = sha256('same content everywhere');
  const res = await fetch(`${baseUrl}/blob/${hash}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'same content everywhere');
});

test('blob lookup stays inside the vault even if the index somehow held an escaping path', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-blob-poison-'));
  await fsp.writeFile(path.join(root, 'real.md'), 'a real vault file');
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  // Simulate a poisoned/corrupted index entry — resolveSafe (defense in
  // depth, brief §6) must refuse to serve it rather than escaping VAULT_PATH.
  const poisonedHash = 'a'.repeat(64);
  const poisonedIndex = new Map([[poisonedHash, '../../../../../../etc/passwd']]);
  const fakeManifestService = {
    getHashIndex: () => poisonedIndex,
    build: async () => { /* no-op: index "refresh" still returns the same poison */ },
  };

  const app = express();
  app.use(createBlobRouter(root, fakeManifestService));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((r) => server.close(r)));

  const res = await fetch(`${baseUrl}/blob/${poisonedHash}`);
  // Must NOT be a 200 serving /etc/passwd — resolveSafe throws (its error
  // message legitimately contains the substring "vault root: <path>", so we
  // check for /etc/passwd's actual shape, not just any occurrence of "root").
  assert.notEqual(res.status, 200);
  const body = await res.text();
  assert.ok(!/root:.*:0:0:/.test(body), 'must not have leaked /etc/passwd content');
  assert.ok(!body.includes('/bin/bash') && !body.includes('/bin/sh'), 'must not have leaked /etc/passwd content');
});
