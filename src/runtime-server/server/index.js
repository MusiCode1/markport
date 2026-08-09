/**
 * Obsidian Web - HTTP/WebSocket server.
 *
 * Serves three things:
 *   1. The custom src/client-mobile/ files (boot.js, shims, HTML) — the
 *      mobile runtime is the only runtime (desktop src/client was archived,
 *      see git tag archive/desktop-runtime).
 *   2. Obsidian's untouched renderer files from vendor/obsidian-mobile/.
 *   3. A file system API at /api/fs/* and a watcher at /api/watch.
 */

const express = require('express');
const compression = require('compression');
const fs = require('fs');
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
const createSystemPluginFilesRouter = require('./api/system-plugin-files');
const attachWatchServer = require('./api/watch');
const VaultRegistry = require('./vault-registry');

function createApp(appConfig = {}) {
  // Merge with the default config so partial overrides (used by tests) don't
  // crash on missing fields like clientMobilePath. Explicit overrides still win.
  appConfig = Object.assign({}, config, appConfig);
  const app = express();
  const vaultRegistry = new VaultRegistry(appConfig.registryPath);

  // Compression — critical for /api/bootstrap (38MB uncompressed → ~6MB).
  // Brotli gives ~84% reduction, gzip ~79%. The middleware auto-selects based
  // on Accept-Encoding: browsers get brotli, curl/other tools get gzip.
  app.use(compression({ level: 6 }));

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

  // deploy-config inject (docs/plans/deploy-config.md §4 Commit 3) — read once
  // per app (not per-request), mirrors what build-assets.sh does for the CF
  // deploy: replace the <!-- OW_CONFIG_INJECT --> marker in index.html with a
  // literal <script>window.__owConfigInjected={...}</script>, positioned
  // before the deploy-config.js tag (already the case in the source
  // index.html). If the config file is missing/unreadable the snippet stays
  // empty — the marker is replaced with '' (no injected script), so
  // deploy-config.js falls back to its DEFAULTS, same zero-regression
  // behavior as the CF build's "no config" case.
  let deployConfigSnippet = '';
  try {
    const deployConfigPath = path.join(appConfig.projectRoot, 'src', 'config', 'deploy-config.json');
    const deployConfig = JSON.parse(fs.readFileSync(deployConfigPath, 'utf8'));
    deployConfigSnippet = '<script>window.__owConfigInjected=' + JSON.stringify(deployConfig) + '</script>';
  } catch (err) {
    console.warn('[deploy-config] could not read src/config/deploy-config.json — window.__owConfig will use client-side DEFAULTS:', err.message);
  }

  async function sendHtmlWithCacheBust(res, filePath) {
    try {
      let html = await fsp.readFile(filePath, 'utf8');
      // Inject (or replace) ?v=<bust> on all /client/ and /client-mobile/ script and link tags.
      // Handles both: existing ?v=3 and paths without any query string.
      html = html.replace(/((?:src|href)="\/client(?:-mobile)?\/[^"]*?)(\?v=[^"&]*)?"(?=[^>]*>)/g,
        (_, prefix) => `${prefix}?v=${cacheBust}"`);
      html = html.replace('<!-- OW_CONFIG_INJECT -->', deployConfigSnippet);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);
    } catch (err) {
      res.status(500).send('Error loading page: ' + err.message);
    }
  }

  // Entry point - mobile is now the only runtime, served at / (finale of the
  // mobile-first epic; see docs/decisions for the collapse-desktop rationale).
  app.get('/', (req, res) => {
    sendHtmlWithCacheBust(res, path.join(appConfig.clientMobilePath, 'index.html'));
  });

  // Mobile client entry point (alias, backwards-compatible with existing
  // tunnels/links that already point at /mobile).
  app.get('/mobile', (req, res) => {
    sendHtmlWithCacheBust(res, path.join(appConfig.clientMobilePath, 'index.html'));
  });

  // Path-based routing (docs/plans/url-routing.md §3ג): /starter is the
  // chooser/onboarding route (ignores auto-resume) and /vault/:id is an
  // open, shareable vault URL. Both serve the same shell as / — boot.js
  // reads location.pathname to decide what to render. Not a redirect: the
  // id must stay visible/bookmarkable in the browser URL.
  // /vault/:id/* (docs/plans/vault-note-deeplink.md §3ד): document-level
  // deep link — /vault/<id>/<note-path> (note-path may have nested
  // segments). Same shell; boot.js parses id + note-path from the path.
  // /github/:owner/:repo(/*) — the shareable vault URL. Same shell again:
  // boot.js resolves the repository and hands off to /vault/<id>. Unlike
  // /vault/<id> (an id that only means something in the sender's own browser),
  // this one carries enough to materialise the vault on any device, which is
  // what makes a link to a vault shareable at all.
  app.get([
    '/starter', '/starter.html',
    '/vault/:id', '/vault/:id/*',
    '/github/:owner/:repo', '/github/:owner/:repo/*',
  ], (req, res) => {
    sendHtmlWithCacheBust(res, path.join(appConfig.clientMobilePath, 'index.html'));
  });

  // Static files.
  app.use('/client-mobile', express.static(appConfig.clientMobilePath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use('/obsidian-mobile', express.static(appConfig.obsidianMobilePath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  // Obsidian's renderer fetches resources via absolute paths like /i18n/he.txt
  // and /lib/... because under Electron those resolve via the app:// protocol
  // to the bundle root. Mirror them onto the obsidian-mobile/ tree (the only
  // runtime left — obsidian-mobile ships its own i18n/ and lib/, no
  // public/sandbox).
  const RESOURCE_DIRS = ['i18n', 'lib'];
  for (const dir of RESOURCE_DIRS) {
    app.use('/' + dir, express.static(path.join(appConfig.obsidianMobilePath, dir), {
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
      res.sendFile(path.join(appConfig.obsidianMobilePath, f), {
        headers: { 'Cache-Control': 'no-cache' },
      });
    });
  }

  // Service Worker (offline + asset-cache — docs/plans/service-worker-offline.md
  // §3ג) — served from the root so its scope covers the whole app
  // (Service-Worker-Allowed:/). __OW_BUILD__ is replaced with the same
  // cache-bust value used for ?v=<bust> on script tags, so a code change
  // (new mtime hash) produces a new SW cache automatically. no-cache on the
  // SW response itself — otherwise the browser could pin an old SW.
  app.get('/sw.js', async (req, res) => {
    try {
      const raw = await fsp.readFile(path.join(appConfig.clientMobilePath, 'sw.js'), 'utf8');
      const src = raw.replace(/__OW_BUILD__/g, cacheBust);
      res.set({
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
        'Service-Worker-Allowed': '/',
      });
      res.send(src);
    } catch (e) {
      res.status(500).send('// sw unavailable');
    }
  });

  // PWA web manifest — served from the root so scope "/" is natural (icons live
  // under /client-mobile/icons/, served by the existing /client-mobile mount).
  app.get('/manifest.webmanifest', (req, res) => {
    res.sendFile(path.join(appConfig.clientMobilePath, 'manifest.webmanifest'), {
      headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' },
    });
  });

  // API routes.
  app.use('/api/bootstrap', createBootstrapRouter(vaultRegistry, appConfig.vaultPath, appConfig.bootstrap));
  app.use('/api/proxy-request', createProxyRouter());
  app.use('/api/vaults', createVaultsRouter(vaultRegistry));
  app.use('/api/fs', createFsRouter(vaultRegistry, appConfig.vaultPath));
  app.use('/api/electron', createElectronRouter(vaultRegistry, appConfig.vaultPath));
  app.use('/api', createSystemPluginFilesRouter());

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
    console.log('  Obsidian: ' + appConfig.obsidianMobilePath);
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
