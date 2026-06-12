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

const config = require('./config');
const systemPlugins = require('./system-plugins');
const createFsRouter = require('./api/fs');
const createElectronRouter = require('./api/electron');
const createVaultsRouter = require('./api/vaults');
const createBootstrapRouter = require('./api/bootstrap');
const { warmUpBootstrapCache } = require('./api/bootstrap');
const createProxyRouter = require('./api/proxy');
const createKeytarRouter = require('./api/keytar');
const createLocalStorageRouter = require('./api/localstorage');
const createPbkdf2Router = require('./api/pbkdf2');
const attachWatchServer = require('./api/watch');
const VaultRegistry = require('./vault-registry');
const { createAuthMiddleware } = require('./middleware/auth');

function createApp(appConfig = config) {
  const app = express();
  const vaultRegistry = new VaultRegistry(appConfig.registryPath, {
    // Restrict /api/vaults/open to paths under vaultsRoot (VAULTS_ROOT env,
    // default user-data/). The configured boot vault is always allowed even
    // if it lives elsewhere. Tests pass no vaultsRoot → unrestricted.
    vaultsRoot: appConfig.vaultsRoot,
    allowPaths: [appConfig.vaultPath],
  });

  // Compression — critical for /api/bootstrap (38MB uncompressed → ~6MB).
  // Brotli gives ~84% reduction, gzip ~79%. The middleware auto-selects based
  // on Accept-Encoding: browsers get brotli, curl/other tools get gzip.
  app.use(compression({ level: 6 }));

  // Optional TOTP auth — enabled by setting TOTP_SECRET env var.
  // Generate a secret: node -e "const {authenticator}=require('otplib');console.log(authenticator.generateSecret())"
  // Then visit /__totp-setup?token=YOUR_SECRET to scan the QR code.
  const authMiddleware = createAuthMiddleware(appConfig);
  if (authMiddleware) {
    app.use(authMiddleware);
    console.log('[auth] TOTP authentication enabled — visit /__totp-setup?token=YOUR_SECRET to configure your authenticator app');
  }

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

  // Favicon and app icons from the project root.
  const rootIconFiles = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'];
  for (const f of rootIconFiles) {
    app.get('/' + f, (req, res) => {
      res.sendFile(path.join(appConfig.projectRoot, f));
    });
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

  // Service Worker — served from the root path so its scope covers the whole
  // origin. Service-Worker-Allowed: / is required because the file lives
  // under /client/ but must control pages at /. Cache-Control: no-cache
  // ensures browsers always re-fetch it so SW updates propagate promptly.
  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(appConfig.clientPath, 'sw.js'));
  });

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
  app.use('/api/keytar', createKeytarRouter(appConfig.userDataPath));
  app.use('/api/localstorage', createLocalStorageRouter(appConfig.userDataPath));
  app.use('/api/pbkdf2', createPbkdf2Router());
  app.use('/api/bootstrap', createBootstrapRouter(vaultRegistry, appConfig.vaultPath));
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
    console.log('  