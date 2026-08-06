'use strict';

// TDD (brief §4 Commit 1): no-token/bad-token → 401, constant-time compare,
// zero FS work on reject; good token → next().

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');

const { createAuthMiddleware } = require('../auth');

const TOKEN = 'super-secret-token-abc123';

function startApp(middleware) {
  const app = express();
  let routeHit = 0;
  app.use(middleware);
  app.get('/protected', (req, res) => {
    routeHit += 1;
    res.status(200).json({ ok: true });
  });
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        getRouteHit: () => routeHit,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('createAuthMiddleware requires a non-empty expected token (defensive fail-closed)', () => {
  assert.throws(() => createAuthMiddleware(''), /non-empty/);
  assert.throws(() => createAuthMiddleware(undefined), /non-empty/);
});

test('no Authorization header → 401, route not reached', async (t) => {
  const middleware = createAuthMiddleware(TOKEN);
  const { baseUrl, getRouteHit, close } = await startApp(middleware);
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`);
  assert.equal(res.status, 401);
  assert.equal(getRouteHit(), 0);
});

test('wrong Bearer token → 401, route not reached', async (t) => {
  const middleware = createAuthMiddleware(TOKEN);
  const { baseUrl, getRouteHit, close } = await startApp(middleware);
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, {
    headers: { authorization: 'Bearer wrong-token' },
  });
  assert.equal(res.status, 401);
  assert.equal(getRouteHit(), 0);
});

test('token sharing a long common prefix with the correct one still → 401 (not a length/prefix leak)', async (t) => {
  const middleware = createAuthMiddleware(TOKEN);
  const { baseUrl, getRouteHit, close } = await startApp(middleware);
  t.after(close);

  const almostRight = TOKEN.slice(0, -1) + 'X';
  const res = await fetch(`${baseUrl}/protected`, {
    headers: { authorization: `Bearer ${almostRight}` },
  });
  assert.equal(res.status, 401);
  assert.equal(getRouteHit(), 0);
});

test('correct Bearer token → next() called, route runs', async (t) => {
  const middleware = createAuthMiddleware(TOKEN);
  const { baseUrl, getRouteHit, close } = await startApp(middleware);
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(getRouteHit(), 1);
});

test('rejected requests do zero filesystem work (auth runs before any FS access)', async (t) => {
  const middleware = createAuthMiddleware(TOKEN);
  const { baseUrl, close } = await startApp(middleware);
  t.after(close);

  // Instrument the real fs module the middleware would have to go through if
  // it (or anything downstream) touched the vault — auth.js must never call
  // any of these on the reject path.
  const spies = ['stat', 'readdir', 'readFile', 'createReadStream'];
  const originals = spies.map((name) => fs[name]);
  const calls = { count: 0 };
  spies.forEach((name) => {
    fs[name] = (...args) => {
      calls.count += 1;
      return originals[spies.indexOf(name)](...args);
    };
  });
  t.after(() => spies.forEach((name, i) => { fs[name] = originals[i]; }));

  await fetch(`${baseUrl}/protected`); // no token
  await fetch(`${baseUrl}/protected`, { headers: { authorization: 'Bearer nope' } });

  assert.equal(calls.count, 0);
});

test('auth.js uses crypto.timingSafeEqual on fixed-length digests (constant-time comparison)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  assert.match(src, /timingSafeEqual/);
  assert.match(src, /createHash\(['"]sha256['"]\)/);
});
