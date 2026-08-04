const assert = require('assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createApp } = require('../index');

async function startTestServer(config) {
  const app = createApp(config);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('opening a server folder registers it as a recent vault', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const vaultPath = path.join(tmp, 'my-vault');
  await fsp.mkdir(vaultPath);

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath,
  });
  t.after(server.close);

  const openResponse = await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath, create: false }),
  });
  assert.equal(openResponse.status, 200);
  const opened = await openResponse.json();
  assert.equal(opened.ok, true);
  assert.equal(typeof opened.id, 'string');

  const listResponse = await fetch(server.baseUrl + '/api/vaults/list');
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();

  assert.equal(list[opened.id].path, vaultPath);
  assert.equal(list[opened.id].open, true);
  assert.equal(typeof list[opened.id].ts, 'number');
});

test('moving a recent vault renames the folder and updates the registry', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const oldPath = path.join(tmp, 'old-vault');
  const newPath = path.join(tmp, 'new-vault');
  await fsp.mkdir(oldPath);

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: oldPath,
  });
  t.after(server.close);

  const openResponse = await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: oldPath, create: false }),
  });
  const opened = await openResponse.json();

  const moveResponse = await fetch(server.baseUrl + '/api/vaults/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath }),
  });
  assert.equal(moveResponse.status, 200);
  assert.deepEqual(await moveResponse.json(), { ok: true, value: '' });

  await assert.rejects(fsp.stat(oldPath), { code: 'ENOENT' });
  assert.equal((await fsp.stat(newPath)).isDirectory(), true);

  const list = await (await fetch(server.baseUrl + '/api/vaults/list')).json();
  assert.equal(list[opened.id].path, newPath);
});

test('electron vault-list exposes the recent vault registry shape', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const vaultPath = path.join(tmp, 'starter-vault');
  await fsp.mkdir(vaultPath);

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath,
  });
  t.after(server.close);

  const opened = await (await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath, create: false }),
  })).json();

  const electronResponse = await fetch(server.baseUrl + '/api/electron/vault-list');
  assert.equal(electronResponse.status, 200);
  const electronList = await electronResponse.json();

  assert.deepEqual(electronList.value, {
    [opened.id]: {
      path: vaultPath,
      ts: electronList.value[opened.id].ts,
      open: true,
    },
  });
});

test('fs requests are scoped to the selected vault id', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const vaultA = path.join(tmp, 'vault-a');
  const vaultB = path.join(tmp, 'vault-b');
  await fsp.mkdir(vaultA);
  await fsp.mkdir(vaultB);

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: vaultA,
  });
  t.after(server.close);

  const openedA = await (await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultA, create: false }),
  })).json();
  const openedB = await (await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultB, create: false }),
  })).json();

  const writeResponse = await fetch(
    server.baseUrl + `/api/fs/write?vault=${openedB.id}&path=${encodeURIComponent('note.md')}&encoding=utf8`,
    { method: 'PUT', body: 'written in b' },
  );
  assert.equal(writeResponse.status, 200);

  await assert.rejects(fsp.stat(path.join(vaultA, 'note.md')), { code: 'ENOENT' });
  assert.equal(await fsp.readFile(path.join(vaultB, 'note.md'), 'utf8'), 'written in b');

  const readAResponse = await fetch(
    server.baseUrl + `/api/fs/read?vault=${openedA.id}&path=${encodeURIComponent('note.md')}&encoding=utf8`,
  );
  assert.equal(readAResponse.status, 404);
});

test('move returns 500 when filesystem rename fails', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const vaultPath = path.join(tmp, 'mv-vault');
  await fsp.mkdir(vaultPath);

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath,
  });
  t.after(server.close);

  await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath, create: false }),
  });

  // Try to move to a destination inside a nonexistent parent — rename will fail.
  const newPath = path.join(tmp, 'nonexistent-parent', 'dest');
  const moveResponse = await fetch(server.baseUrl + '/api/vaults/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath: vaultPath, newPath }),
  });
  assert.equal(moveResponse.status, 500);
  const body = await moveResponse.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, 'string');
});

test('trash endpoint rejects path that escapes vault root via sibling prefix', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  // vault is at /tmp/.../a, sibling is /tmp/.../abcdef
  const vaultPath = path.join(tmp, 'a');
  const siblingPath = path.join(tmp, 'abcdef');
  const siblingFile = path.join(siblingPath, 'secret.txt');
  await fsp.mkdir(vaultPath);
  await fsp.mkdir(siblingPath);
  await fsp.writeFile(siblingFile, 'secret');

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath,
  });
  t.after(server.close);

  const opened = await (await fetch(server.baseUrl + '/api/vaults/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath, create: false }),
  })).json();

  // Construct a relative path that resolves into the sibling directory.
  // From /tmp/.../a, '../abcdef/secret.txt' → /tmp/.../abcdef/secret.txt
  const traversalPath = path.join('..', 'abcdef', 'secret.txt');
  const trashResponse = await fetch(server.baseUrl + '/api/electron/trash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: traversalPath, vault: opened.id }),
  });
  assert.equal(trashResponse.status, 500);

  // Sibling file must still exist — not deleted.
  assert.equal((await fsp.stat(siblingFile)).isFile(), true);
});

test('remove returns 404 when vault is not in registry', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const server = await startTestServer({
    clientPath: path.join(tmp, 'client'),
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: tmp,
  });
  t.after(server.close);

  const response = await fetch(server.baseUrl + '/api/vaults/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/does/not/exist' }),
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('starter route serves the mobile shell (not a redirect)', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const clientMobilePath = path.join(tmp, 'client-mobile');
  await fsp.mkdir(clientMobilePath);
  await fsp.writeFile(path.join(clientMobilePath, 'index.html'), '<html><body>shell</body></html>');

  const server = await startTestServer({
    clientMobilePath,
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: tmp,
  });
  t.after(server.close);

  // path-based routing (docs/plans/url-routing.md §3ג): /starter now serves
  // the shell directly (200), not a 302 — the chooser/onboarding decision is
  // made client-side by boot.js reading location.pathname.
  const response = await fetch(server.baseUrl + '/starter', { redirect: 'manual' });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /shell/);
});

test('vault/:id route serves the mobile shell with the id visible in the URL', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const clientMobilePath = path.join(tmp, 'client-mobile');
  await fsp.mkdir(clientMobilePath);
  await fsp.writeFile(path.join(clientMobilePath, 'index.html'), '<html><body>shell</body></html>');

  const server = await startTestServer({
    clientMobilePath,
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: tmp,
  });
  t.after(server.close);

  const response = await fetch(server.baseUrl + '/vault/abc123', { redirect: 'manual' });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /shell/);
});

test('vault/:id/* route serves the mobile shell for a nested note deep link', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const clientMobilePath = path.join(tmp, 'client-mobile');
  await fsp.mkdir(clientMobilePath);
  await fsp.writeFile(path.join(clientMobilePath, 'index.html'), '<html><body>shell</body></html>');

  const server = await startTestServer({
    clientMobilePath,
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: tmp,
  });
  t.after(server.close);

  // docs/plans/vault-note-deeplink.md §3ד/DoD#1 — document-level deep link
  // with a nested note path still serves the same shell (200), not 404.
  const response = await fetch(server.baseUrl + '/vault/x/Features/Tags', { redirect: 'manual' });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /shell/);
});

test('github/:owner/:repo route serves the mobile shell, bare and with a note path', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-web-'));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));

  const clientMobilePath = path.join(tmp, 'client-mobile');
  await fsp.mkdir(clientMobilePath);
  await fsp.writeFile(path.join(clientMobilePath, 'index.html'), '<html><body>shell</body></html>');

  const server = await startTestServer({
    clientMobilePath,
    obsidianPath: path.join(tmp, 'obsidian'),
    registryPath: path.join(tmp, 'vaults.json'),
    vaultPath: tmp,
  });
  t.after(server.close);

  // The shareable vault URL — boot.js resolves the repository client-side and
  // hands off to /vault/<id>. A 404 here would make the link dead on arrival,
  // which is the one thing it exists to avoid.
  for (const route of [
    '/github/notnilcn/ggdd',
    '/github/notnilcn/ggdd/Game%20Design%20Docs/01%20Executive%20Summary',
  ]) {
    const response = await fetch(server.baseUrl + route, { redirect: 'manual' });
    assert.equal(response.status, 200, `route should serve the shell: ${route}`);
    assert.match(await response.text(), /shell/);
  }
});
