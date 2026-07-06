/**
 * Obsidian Web - HTTP/WebSocket server.
 *
 * Serves three things:
 *   1. The custom src/client/ + src/client-mobile/ files (boot.js, shims, HTML).
 *   2. Obsidian's untouched renderer files from vendor/obsidian/ and
 *      vendor/obsidian-mobile/.
 *   3. A file system API at /api/fs/* and a watcher at /api/watch.
 */

const express = require('express');
const compression = require('compression');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');
const systemPlugins = require('./system-plugins');
const createFsRouter = require('./api/fs');
const createElectronRouter = require('./api/electron');
const createVaultsRouter = require('./api/vaults');
const createBootstrapRouter = require('./api/bootstrap');
const { warmUpBootstrapCache } = require('./api/bootstrap');
const createProxyRouter = require('./api/proxy');
const attachWatchServer = require('./api/watch');
const VaultRegistry = require('./vault-registry');

function createApp(appConfig = {}) {
  // Merge with the default config so partial overrides (used by tests) don't
  // crash on missing fields like clientMobilePath. Explicit overrides still win.
  appConfig = Object.assign({}, config, appConfig);
  const app = express();
  const vaultRegistry = new VaultRegistry(appConfig.registryPath);

  function constantTimeEqual(a, b) {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }

  function parseCookies(cookieHeader) {
    const out = {};
    for (const part of String(cookieHeader || '').split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  }

  function encodeSession(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', appConfig.auth.sessionSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function decodeSession(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', appConfig.auth.sessionSecret).update(body).digest('base64url');
    if (!constantTimeEqual(sig, expected)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function getSession(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    return decodeSession(cookies[appConfig.auth.cookieName]);
  }

  function setSession(res, username) {
    const token = encodeSession({ username, exp: Date.now() + appConfig.auth.cookieDays * 86400000 });
    const parts = [
      `${appConfig.auth.cookieName}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (appConfig.publicOrigin && String(appConfig.publicOrigin).startsWith('https://')) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${appConfig.auth.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  function isAuthorized(req) {
    const { username, password } = appConfig.auth || {};
    if (!password) return true;
    const session = getSession(req);
    if (session && constantTimeEqual(session.username, username || '')) return true;
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    let raw;
    try {
      raw = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
      return false;
    }
    const idx = raw.indexOf(':');
    if (idx < 0) return false;
    const user = raw.slice(0, idx);
    const pass = raw.slice(idx + 1);
    return constantTimeEqual(user, username || '') && constantTimeEqual(pass, password);
  }

  function requireAuth(req, res, next) {
    if (isAuthorized(req)) return next();
    res.status(302).setHeader('Location', '/login');
    res.end();
  }

  app.get('/login', (req, res) => {
    if (!appConfig.auth.password) return res.redirect('/');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login · Obsidian Web</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:8vh auto;padding:24px}input,button{width:100%;box-sizing:border-box;padding:12px;margin:8px 0;font-size:16px}button{cursor:pointer}</style></head><body><h1>Sign in</h1><form method="post" action="/login"><input name="username" autocomplete="username" placeholder="Username" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" required><button type="submit">Sign in</button></form></body></html>`);
  });

  app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    const { username, password } = appConfig.auth || {};
    if (!password) return res.redirect('/');
    if (constantTimeEqual(req.body.username || '', username || '') && constantTimeEqual(req.body.password || '', password)) {
      setSession(res, username || '');
      res.redirect('/');
      return;
    }
    res.status(401).send('Invalid credentials');
  });

  app.all('/logout', (req, res) => {
    clearSession(res);
    res.redirect('/login');
  });

  // Compression — critical for /api/bootstrap (38MB uncompressed → ~6MB).
  // Brotli gives ~84% reduction, gzip ~79%. The middleware auto-selects based
  // on Accept-Encoding: browsers get brotli, curl/other tools get gzip.
  app.use(compression({ level: 6 }));
  app.use(requireAuth);

  // Request logging - very chatty, but invaluable while we are still
  // figuring out what Obsidian asks for during boot.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const url = req.originalUrl;
      // Skip noisy static assets to keep the log readable.
      if (!url.startsWith('/api') && !url.startsWith('/i18n') && !url.startsWith('/lib') && url !== '/') {
        return;
      }
      console.log(`${req.method} ${res.statusCode} ${url} (${ms}ms)`);
    });
    next();
  });

  // Inject ?v=<cacheBust> into all client script/link tags so browsers pick up
  // changes automatically. The bust value is recomputed at server startup from
  // client/ and client-mobile/ file mtimes — no manual ?v=N bump needed.
  const cacheBust = appConfig.clientCacheBust || 'dev';
  async function sendHtmlWithCacheBust(res, filePath) {
    try {
      let html = await fsp.readFile(filePath, 'utf8');
      // Inject (or replace) ?v=<bust> on all /client/ and /client-mobile/ script and link tags.
      // Handles both: existing ?v=3 and paths without any query string.
      html = html.replace(/((?:src|href)="\/client(?:-mobile)?\/[^"]*?)(\?v=[^"&]*)?"(?=[^>]*>)/g,
        (_, prefix) => `${prefix}?v=${cacheBust}"`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);
    } catch (err) {
      res.status(500).send('Error loading page: ' + err.message);
    }
  }

  // Custom entry point - our index.html, not Obsidian's.
  app.get('/', (req, res) => {
    sendHtmlWithCacheBust(res, path.join(appConfig.clientPath, 'index.html'));
  });

  app.get(['/starter', '/starter.html'], (req, res) => {
    sendHtmlWithCacheBust(res, path.join(appConfig.clientPath, 'starter.html'));
  });

  // Mobile client entry point.
  app.get('/mobile', (req, res) => {
    sendHtmlWithCacheBust(res, path.join(appConfig.clientMobilePath, 'index.html'));
  });

  // Static files - order matters: client/ first, then obsidian/.
  app.use('/client', express.static(appConfig.clientPath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use('/client-mobile', express.static(appConfig.clientMobilePath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use('/obsidian', express.static(appConfig.obsidianPath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use('/obsidian-mobile', express.static(appConfig.obsidianMobilePath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  // Obsidian's renderer fetches resources via absolute paths like /i18n/he.txt
  // and /lib/... because under Electron those resolve via the app:// protocol
  // to the bundle root. Mirror them onto the obsidian/ tree.
  const RESOURCE_DIRS = ['i18n', 'lib', 'public', 'sandbox'];
  for (const dir of RESOURCE_DIRS) {
    app.use('/' + dir, express.static(path.join(appConfig.obsidianPath, dir), {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }));
  }

  // Worker scripts. Obsidian creates `new Worker("worker.js")` which under
  // Electron resolves to /Resources/obsidian/worker.js, but in a browser
  // it resolves relative to the document URL. Serve them at the root.
  //
  // THIS IS CRITICAL for the metadata indexer: without worker.js the
  // metadataCache `this.work(t)` call (which postMessage's to the worker
  // and waits for a reply) hangs forever, leaving inProgressTaskCount > 0
  // and blocking everything that waits for onCleanCache (rename, etc.).
  const ROOT_FILES = ['worker.js', 'sim.js'];
  for (const f of ROOT_FILES) {
    app.get('/' + f, (req, res) => {
      res.sendFile(path.join(appConfig.obsidianPath, f), {
        headers: { 'Cache-Control': 'no-cache' },
      });
    });
  }

  // API routes.
  app.use('/api/bootstrap', createBootstrapRouter(vaultRegistry, appConfig.vaultPath, appConfig.bootstrap));
  app.use('/api/proxy-request', createProxyRouter());
  app.use('/api/vaults', createVaultsRouter(vaultRegistry));
  app.use('/api/fs', createFsRouter(vaultRegistry, appConfig.vaultPath));
  app.use('/api/electron', createElectronRouter(vaultRegistry, appConfig.vaultPath));

  app.locals.vaultRegistry = vaultRegistry;
  return app;
}

function startServer(appConfig = config) {
  // Discover system plugins (repo-shipped plugins overlaid onto every vault)
  // before any FS handler runs.
  systemPlugins.init();

  const app = createApp(appConfig);
  const server = http.createServer(app);
  attachWatchServer(server, app.locals.vaultRegistry, appConfig.vaultPath);

  server.listen(appConfig.port, appConfig.host, () => {
    console.log('==========================================');
    console.log('  Obsidian Web');
    console.log('==========================================');
    console.log('  Vault:    ' + appConfig.vaultPath);
    console.log('  Obsidian: ' + appConfig.obsidianPath);
    console.log('  Listening on http://' + appConfig.host + ':' + appConfig.port);
    console.log('==========================================');

    // Pre-build the bootstrap cache in the background so the first browser
    // request is a cache HIT instead of a cold build.
    setImmediate(() => {
      warmUpBootstrapCache(app.locals.vaultRegistry, appConfig.vaultPath, appConfig.bootstrap)
        .catch((err) => console.warn('[bootstrap] warm-up error:', err.message));
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };
