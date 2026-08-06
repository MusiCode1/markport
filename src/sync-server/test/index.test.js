'use strict';

// Integration (brief §4 Commit 4): curl-style end-to-end through the real
// wired app — auth gates manifest/blob/stubs; SYNC_TOKEN missing at boot
// -> the process refuses to start (fail-closed) before ever listening.

const test = require('node:test');
const assert = require('assert/strict');
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { createApp } = require('../index');

const TOKEN = 'e2e-test-token-xyz';

async function makeFixtureVault() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-e2e-'));
  await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
  await fsp.writeFile(path.join(root, 'notes', 'a.md'), 'hello e2e');
  return root;
}

async function startApp(vaultPath) {
  const app = createApp({ vaultPath, syncToken: TOKEN });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('end-to-end: no token -> 401 on manifest and blob', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const manifestRes = await fetch(`${baseUrl}/sync/v1/manifest`);
  assert.equal(manifestRes.status, 401);

  const blobRes = await fetch(`${baseUrl}/sync/v1/blob/${'a'.repeat(64)}`);
  assert.equal(blobRes.status, 401);
});

test('end-to-end: full pull flow with a correct token — manifest then blob', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const manifestRes = await fetch(`${baseUrl}/sync/v1/manifest`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(manifestRes.status, 200);
  const manifest = await manifestRes.json();
  assert.equal(manifest.entries.length, 1);
  const [entry] = manifest.entries;
  assert.equal(entry.path, 'notes/a.md');
  assert.equal(entry.hash, crypto.createHash('sha256').update('hello e2e').digest('hex'));

  const blobRes = await fetch(`${baseUrl}/sync/v1/blob/${entry.hash}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(blobRes.status, 200);
  assert.equal(await blobRes.text(), 'hello e2e');
});

test('end-to-end: v2 stubs return 501 (with a valid token)', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const headers = { authorization: `Bearer ${TOKEN}` };
  for (const [method, urlPath] of [
    ['GET', '/sync/v1/changes'],
    ['GET', '/sync/v1/live'],
    ['POST', '/sync/v1/commit'],
    ['PUT', `/sync/v1/blob/${'b'.repeat(64)}`],
    ['GET', '/sync/v1/deletions'],
  ]) {
    const res = await fetch(`${baseUrl}${urlPath}`, { method, headers });
    assert.equal(res.status, 501, `${method} ${urlPath} should be 501`);
  }

  // v2 stubs are behind auth too — no token -> 401, not 501.
  const noAuthRes = await fetch(`${baseUrl}/sync/v1/changes`);
  assert.equal(noAuthRes.status, 401);
});

test('boot fail-closed: SYNC_TOKEN unset -> process exits before listening', async (t) => {
  const env = { ...process.env };
  delete env.SYNC_TOKEN;
  env.VAULT_PATH = '/tmp';
  env.PORT = '0'; // irrelevant — should never reach listen()

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /SYNC_TOKEN/);
});

test('boot fail-closed: VAULT_PATH unset -> process exits before listening', async (t) => {
  const env = { ...process.env, SYNC_TOKEN: TOKEN };
  delete env.VAULT_PATH;

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /VAULT_PATH/);
});

test('boot fail-closed: VAULT_PATH pointing at a nonexistent path -> process exits before listening (calev-heavy finding 1)', async (t) => {
  const env = {
    ...process.env,
    SYNC_TOKEN: TOKEN,
    VAULT_PATH: path.join(os.tmpdir(), 'sync-server-definitely-does-not-exist-' + Date.now()),
  };

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /VAULT_PATH does not exist/);
});

test('boot fail-closed: VAULT_PATH pointing at a file (not a directory) -> process exits before listening (calev-heavy finding 1)', async (t) => {
  const notADir = path.join(os.tmpdir(), 'sync-server-vault-path-is-a-file-' + Date.now());
  await fsp.writeFile(notADir, 'not a directory');
  t.after(() => fsp.rm(notADir, { force: true }));

  const env = { ...process.env, SYNC_TOKEN: TOKEN, VAULT_PATH: notADir };

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /VAULT_PATH is not a directory/);
});
