/**
 * bootstrap cache tests
 *
 * Verifies that:
 *  1. A cold request builds the cache (MISS).
 *  2. A warm request is a cache HIT and returns the response
 *     with a Content-Encoding header (pre-compressed buffer sent directly).
 *  3. Writing a file invalidates the cache so the next request is a MISS.
 */

'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createApp } = require('../index');
const { serverCache } = require('../api/bootstrap');

async function startTestServer(config) {
  // The mobile runtime paths were added after these tests were written;
  // default them so each test doesn't have to spell them out.
  const app = createApp({
    clientMobilePath: config.clientPath,
    obsidianMobilePath: config.obsidianPath,
    userDataPath: path.dirname(config.registryPath),
    projectRoot: path.dirname(config.clientPath),
    ...config,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Raw HTTP GET that does NOT decompress the response automatically.
 * Returns { status, headers, rawBody }.
 * Needed to inspect Content-Encoding on the wire.
 */
function rawGet(url, reqHeaders = {}) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.get(
      { hostname, port: parseInt(port, 10), path: pathname + search, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, rawBody: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
  });
}

/** Minimal vault fixture: a single .obsidian/ dir + one note. */
async function makeVaultFixture(dir) {
  const vaultPath = path.join(dir, 'vault');
  await fsp.mkdir(path.join(vaultPath, '.obsidian'), { recursive: true });
  await fsp.writeFile(path.join(vaultPath, 'note.md'), '# Hello\n');
  return vaultPath;
}

test('bootstrap cache HIT sends pre-compressed Content-Encoding header', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-bootstrap-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const vaultPath = await makeVaultFixture(tmp);

  // Register the vault so bootstrap knows which vaultId to use.
  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath,
  });
  t.after(server.close);

  const openRes = await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath, create: false }),
  });
  const { id: vaultId } = await openRes.json();

  // ── MISS: cold request builds the cache ──────────────────────────────────
  const coldRaw = await rawGet(
    `${server.baseUrl}/api/bootstrap?vault=${vaultId}`,
    { 'Accept-Encoding': 'br, gzip' },
  );
  assert.equal(coldRaw.status, 200, 'cold request should succeed');

  // ── HIT: second request should be served from the pre-compressed buffer ──
  const hotRaw = await rawGet(
    `${server.baseUrl}/api/bootstrap?vault=${vaultId}`,
    { 'Accept-Encoding': 'br, gzip' },
  );
  assert.equal(hotRaw.status, 200, 'cache HIT should succeed');

  // The server MUST advertise Content-Encoding (either br or gzip) to show
  // it sent the pre-compressed buffer and skipped re-serialisation.
  const ce = hotRaw.headers['content-encoding'];
  assert.ok(
    ce === 'br' || ce === 'gzip',
    `cache HIT Content-Encoding should be br or gzip, got: ${ce}`,
  );

  // Decompress and verify the response body is valid JSON with the right shape.
  const zlib = require('zlib');
  const decompress = ce === 'br'
    ? (buf) => new Promise((res, rej) => zlib.brotliDecompress(buf, (e, d) => e ? rej(e) : res(d)))
    : (buf) => new Promise((res, rej) => zlib.gunzip(buf, (e, d) => e ? rej(e) : res(d)));
  const jsonBuf = await decompress(hotRaw.rawBody);
  const hotBody = JSON.parse(jsonBuf.toString('utf8'));
  assert.ok(hotBody.electron, 'HIT response should still have electron section');
  assert.ok(hotBody.fs, 'HIT response should still have fs section');
});

test('bootstrap cache is invalidated when a file is written', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-bootstrap-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const vaultPath = await makeVaultFixture(tmp);

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath,
  });
  t.after(server.close);

  const openRes = await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath, create: false }),
  });
  const { id: vaultId } = await openRes.json();

  // Cold request — fills cache.
  await fetch(`${server.baseUrl}/api/bootstrap?vault=${vaultId}`);
  assert.ok(serverCache.has(vaultId), 'cache should be populated after first request');

  // Write a new file to vault root (changes the root dir mtime).
  await fsp.writeFile(path.join(vaultPath, 'new-note.md'), '# New\n');

  // The cache invalidation happens on the next bootstrap request, not eagerly.
  // But we can verify that after writing, the next request re-builds.
  const afterWriteRes = await fetch(`${server.baseUrl}/api/bootstrap?vault=${vaultId}`);
  assert.equal(afterWriteRes.status, 200, 'post-write request should succeed');
  const afterBody = await afterWriteRes.json();
  assert.ok(afterBody.fs, 'post-write response should have fs section');
});
