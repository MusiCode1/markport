# Obsidian Web - Plan & Status

Live wrapper that runs Obsidian's renderer in a normal browser by replacing
its Electron dependencies with HTTP shims. Obsidian's own code stays
untouched so we can swap in newer versions without forking.

## Architecture

```
Browser
├── src/client/ (our code, /)
│   ├── index.html  - custom loader, defines script order
│   ├── boot.js     - installs window.require + globals
│   └── shims/      - one file per Node/Electron module we replace
├── src/client-mobile/ (our code, /mobile)
│   ├── index.html
│   ├── boot.js
│   └── shims/capacitor-shim.js  - 13 Capacitor plugins routed to /api/*
└── vendor/ (extracted from Obsidian, never modified; gitignored)
    ├── obsidian-desktop/  (desktop bundle)
    └── obsidian-mobile/   (mobile bundle, zero build-time patches — byte-identical to the APK)

Server (src/runtime-server/server/)
├── index.js              - Express + WebSocket
├── vault-registry.js     - persistent recent-vault registry (user-data/registry.json)
├── system-plugins.js     - overlay from src/plugins/ into vault's .obsidian/plugins/
├── api/bootstrap.js      - single-shot preload: electron IPC + .obsidian/ + dirs cache
├── api/fs.js             - REST file system over HTTP (scoped per vault id)
├── api/electron.js       - stubs for ipcRenderer.sendSync channels
├── api/vaults.js         - vault list/open/remove/move API
├── api/proxy.js          - outbound HTTP proxy (Obsidian release/asset hosts)
└── api/watch.js          - chokidar -> WebSocket for fs.watch (per vault)

Vault
└── plain Markdown files (the user's actual content)
```

### Two parallel client runtimes — `src/client/` vs `src/client-mobile/`

The same Node.js server (`src/runtime-server/server/`) hosts two completely separate browser
runtimes that share its API:

| Route | Bundle loaded | Adapter chosen | Shim layer | Use case |
|---|---|---|---|---|
| `/` | `vendor/obsidian-desktop/app.js` (desktop) | `FileSystemAdapter` via `original-fs` shim | `src/client/shims/*` (electron, original-fs, ipcRenderer, …) | Legacy fallback; desktop-class plugin compatibility (full Node API surface). |
| `/mobile` | `vendor/obsidian-mobile/app.js` (Android APK bundle) | `CapacitorAdapter` via `capacitor-shim.js` | `src/client-mobile/shims/capacitor-shim.js` + minimal node shims (path, url, os, crypto, …) | Preferred runtime. Uses Obsidian's mobile codepaths (no sync XHR, no Electron assumptions). Layout (mobile/desktop UI) chosen at boot via `__owPlatformOverrides`. |

```
                  ┌── /         → src/client/index.html        → desktop bundle + electron shims
Browser → server ─┤
                  └── /mobile   → src/client-mobile/index.html → mobile bundle + Capacitor shim
                        │
                        ├── share /api/*  (fs, watch, bootstrap, vaults, electron)
                        └── share vendor/obsidian-desktop/* and vendor/obsidian-mobile/* static assets
```

**Default recommendation:** `/mobile`. It's lighter (3.6 MB bundle vs 7+ MB),
has no sync XHR (so no deprecation pressure), and the runtime Platform
interceptor (`client-mobile/platform-bridge.js`) lets it serve both desktop
and mobile UI layouts via the layout switcher plugin. The desktop runtime
stays available for plugins that need full Node/Electron surface (e.g.
obsidian-git that shells out to `git`).

**Long-term plan:** keep both. Removing the desktop runtime would lose
plugin compatibility for any plugin that touches Electron `remote` or
`child_process`. See `docs/investigations.md` for the deep dive on what
each adapter expects.

## Status

- Boot loads, all shims install successfully.
- Obsidian recognises the vault, sets the page title to "vault - Obsidian 1.12.7".
- File system operations work: stat, readdir, read, write, mkdir, unlink, rename.
- Obsidian creates and writes `.obsidian/` config files.
- Obsidian opens notes in tabs and saves edits back to disk.
- Hebrew RTL renders correctly out of the box.
- WebSocket-based fs.watch wiring is in place, with polling support for rclone/FUSE vaults (`WATCH_POLLING=true`).
- Bootstrap fetch is async: spinner renders immediately, Obsidian scripts injected dynamically after cache is ready.
- Metadata indexing completes after serving `/worker.js` from the root URL.
- File rename through the Obsidian UI works end-to-end.
- `scripts/update-obsidian-desktop.js` downloads the latest official Obsidian release and regenerates `obsidian-desktop/`.
- `/starter` serves a wrapped Obsidian starter screen with recent vaults.
- Vaults are tracked in a server-side registry and FS/watch requests are scoped by vault id.
- `/api/bootstrap` returns electron IPC + `.obsidian/` tree + dirs cache in one shot (brotli ~6MB).
  - Server-side mtime-based invalidation cache: HIT latency 4–20ms (down from ~800ms).
  - Server pre-compresses the response on build; HIT sends the pre-compressed Buffer directly.
  - Warm-up runs at server start so the first browser request is always a cache HIT.
- Can be deployed to any Linux box behind a reverse proxy. The app itself
  has no auth — use Cloudflare Access, HTTP Basic, or similar.
- **System plugin injection.** Plugins shipped under `<repo>/plugins/` are
  overlaid onto every vault by `server/system-plugins.js` + `server/api/fs.js`:
  reads/stats fall back to the repo copy when the vault doesn't have one;
  `community-plugins.json` is merged on read and stripped on write so the
  user's vault stays clean. The first such plugin is **`obsidian-web-layout`**
  — a ribbon icon + commands to switch between `auto/mobile/desktop` layouts.
  Users get it automatically when they open any vault on obsidian-web.

### Known issues / loose ends

#### A. Folder picker is still prompt-based
The starter now works through `/starter` and lists recent vaults from the
server registry. The temporary directory picker is `window.prompt()` with a
server path. Later we should replace it with a real server-side folder browser.

#### B. fs.watch on FUSE/rclone vaults
On FUSE-backed vaults (e.g. rclone), inotify doesn't work. chokidar falls
back to polling mode (`WATCH_POLLING=true`). External changes (e.g. from
another device via cloud storage) are only detected after the FUSE layer
picks them up.

#### ~~C. Some sync XHR calls 404 silently~~ ✅ נפתר
`__owSyncRequest` עם `opts.silent404=true` זורק ENOENT נקי במקום הודעת HTTP verbose.
`statSync` ו-`readFileSync` מפעילים את הדגל. הרעש מקוד שלנו נעלם; ה-browser XHR
log עדיין מופיע (לא ניתן לדכא) אבל רק בDevTools.

#### ~~D. crypto fully stubbed~~ ✅ נפתר 2026-05-11
`crypto.randomBytes` ו-`createHash` מיושמים. ה-async path של `createHash`
עובד דרך `crypto.subtle.digest` (SHA-1/256/512). MD5 ממופה ל-SHA-256
(WebCrypto לא תומך MD5 — plugins שצריכים MD5 חייבים לבנדל בעצמם, וזה
מה ש-LiveSync עושה עם `spark-md5`). ה-sync path מחזיר ריק עם warning —
אם plugin עתידי באמת ידרוש sync, נחזור לשיקול.

See `docs/investigations.md` for solved issues and debugging notes.

## Roadmap

### Phase 1 — boot and editing MVP (done)
1. Load Obsidian's renderer without modifying `obsidian-desktop/app.js`.
2. Verify that indexing completes and the editor pane renders a note.
3. Click on a note in the file tree and confirm it opens.
4. Edit a note and confirm it saves to disk on the server.
5. Rename a file through the UI and confirm it persists to disk.
6. Regenerate `obsidian-desktop/` from the latest official release.

### Phase 2 — quality of life
5. Silence noisy 404s in sync-http; treat ENOENT as a normal not-found.
6. ✅ Implement a small in-memory cache on the client for stat/readdir results
   (invalidated by fs.watch events). Done via bootstrap + `__owBootstrapCache`.
7. ✅ Pre-flight bundle: `/api/bootstrap` endpoint returns electron IPC + `.obsidian/` +
   dirs cache in one shot. Pre-compressed on server; HIT latency 4–20ms.
8. Persist a per-vault session id so reloads don't re-index from scratch.

### Phase 3 — multi-vault + auth
9. Vault list / create / open / remove API. (done for MVP)
10. Wire the starter page so the vault picker actually works. (done with prompt picker)
11. Auth: currently provided by Cloudflare Access in front of the tunnel.
    Application-level auth (HTTP Basic / JWT) is still open — needed if the
    server is ever exposed without a CF tunnel.
12. Replace prompt picker with a server-side folder browser.

### Phase 4 — production quality
13. Handle very large files (range requests, streaming for >256MB writes).
14. Plugins: figure out which ones need extra shims, which work as-is.
15. Auto-update checks: compare current `obsidian/package.json` with the
    latest GitHub release and warn before incompatible upgrades.
16. Compatibility test suite: a Playwright harness that boots, opens a
    note, edits it, switches views, and checks no console errors.
17. Replace deprecated sync XHR with SharedArrayBuffer + Atomics.wait
    if any browser starts blocking sync XHR.

### Phase 5 — performance
18. Client-side cache for file content (LRU, invalidated by fs.watch).
19. Differential sync: send only diffs on writes.
20. Bundle splitting / lazy loading of `lib/*` (PixiJS, PDF.js, MathJax,
    Mermaid, Reveal) - they account for most of the byte weight.
21. Service worker for offline read-only mode.

## Open architectural questions

- **Plugins.** Obsidian plugins are JS files loaded at runtime. Most
  Mobile-compatible plugins should work. Desktop-only plugins that use
  Node APIs directly will fail; we can either shim more APIs or document
  which plugins are unsupported.
- **`window.process`.** We expose a minimal stub. If a plugin reads
  process.versions.node and gates behaviour on it, we may need to be
  more careful (claiming we're "node 20" might trigger code paths we
  can't satisfy).
- **Obsidian Sync.** Will not work - it's a paid Electron-only service.
  The web wrapper effectively replaces it: every device uses the same
  server-side vault.
- **Mobile.** Implemented as `/mobile` — a parallel runtime that loads
  the mobile bundle (`obsidian-mobile/app.js`) with a `CapacitorAdapter`
  shim instead of the desktop FileSystemAdapter. A runtime interceptor
  (`client-mobile/platform-bridge.js`, wraps `Object.defineProperty` —
  see `docs/plans/runtime-platform-descriptors.md`) exposes the Platform
  object as `window.__owPlatform` and lets `client-mobile/boot.js` choose
  the layout via `window.__owPlatformOverrides` based on
  `localStorage['obsidian-web:layout-mode']` (auto / mobile / desktop).
  `isMobileApp` stays `true` so the Capacitor adapter is always active;
  only the `isMobile` flag (which controls UI layout) is toggled. Zero
  build-time patches remain (`scripts/patch-obsidian-mobile.js` keeps an
  empty patch list as infrastructure for a future Obsidian version) — the
  desktop-layout vault-profile panel that used to need one is now covered
  by `platform-bridge.js` locking `isDesktopApp` directly. See
  `docs/walkthrough.md` (2026-05-11, 2026-07-26, 2026-07-27) and
  `docs/investigations.md` ("Build-time patch approach (implemented)").

---

## Integration Plan: obsidian-livesync

> Added: 2026-05-09
> Updated: 2026-05-11 — approach changed; see "Updated approach" below.

## Updated approach (2026-05-11): direct fetch + CORS

The earlier plan (kept verbatim below for reference) routed all LiveSync
traffic through `server/api/proxy.js` with a configurable `PROXY_ALLOWED_HOSTS`
allowlist. After working with the mobile runtime and looking at the actual
LiveSync architecture, **we are abandoning the proxy approach for LiveSync.**

### Why we rejected the proxy approach

- **Operational burden.** Every user who runs LiveSync needs to maintain an
  allowlist on the server. For a public/demo deployment, this becomes a
  vector for abuse (someone could route arbitrary traffic through the host).
- **CF Workers limits.** The Cloudflare Workers demo (`cf/`) has CPU-time
  and subrequest limits that would make a busy LiveSync session expensive.
- **Liability / cost.** A self-hosted obsidian-web would become a paid-egress
  gateway for whoever uses it — not something the project should ship by default.
- **Redundancy.** LiveSync clients already speak directly to their CouchDB.
  Inserting our server between them adds latency, breaks `_changes` long-polling
  semantics, and provides no value.

### Why direct fetch is the right answer

- **Zero infrastructure.** The browser fetches CouchDB directly. We don't
  ship any new endpoint and pay no egress cost.
- **Infinite scale.** Adding users to obsidian-web adds zero load on our
  CouchDB-related code path — there isn't one.
- **Already accepted in the LiveSync community.** Desktop and mobile
  LiveSync both speak directly to CouchDB; obsidian-web doing the same is
  the conventional architecture.

### Required changes

1. **`App.requestUrl` in `client-mobile/shims/capacitor-shim.js`** — currently
   returns `{}`. Implement a real `fetch()` wrapper that returns the same shape
   LiveSync expects (`{ status, text, headers, arrayBuffer }`). Same for
   `CapacitorHttp.request` when it appears.
2. **`createHash`** — already fixed on `client-mobile/boot.js` (async path via
   `crypto.subtle.digest`). LiveSync ships its own `spark-md5` so it doesn't
   need our MD5 anyway; our shim is only used for sha256.
3. **`server/api/proxy.js`** — no change. Stays in place for the Obsidian
   release / asset hosts the desktop bundle reaches out to (`releases.obsidian.md`,
   `obsidian.md/api/...`). LiveSync traffic will not go through it.
4. **No `PROXY_ALLOWED_HOSTS` env var.** Cancelled — see Task 1 below
   ("Superseded by direct fetch approach").

### CouchDB CORS requirement

Direct fetch only works if CouchDB allows requests from the obsidian-web origin.
Standard LiveSync configuration:

```ini
# /opt/couchdb/etc/local.ini
[chttpd]
enable_cors = true

[cors]
origins = *
credentials = true
methods = GET,PUT,POST,HEAD,DELETE
headers = accept, authorization, content-type, origin, referer, x-csrf-token
```

(`origins = *` is the LiveSync default; tighten if you publish a fixed host.)

### CF demo deployment — `SYSTEM_PLUGINS` env var (planned)

The Cloudflare Workers demo (`cf/`) runs vault state in a Durable Object
that resets every 4 hours. Shipping LiveSync there by default would have it
sync into a vault that vanishes — meaningless and confusing.

**Plan (documentation only; not implemented yet):** add a `SYSTEM_PLUGINS`
env var read by `server/system-plugins.js` (and the CF equivalent) that
acts as an opt-in filter on which directories under `<repo>/plugins/` are
exposed:

- **Self-hosted Node server (default):**
  `SYSTEM_PLUGINS=obsidian-web-layout,obsidian-livesync` (or unset → all).
- **CF demo (`wrangler.toml`):**
  `SYSTEM_PLUGINS=obsidian-web-layout` (LiveSync excluded; vault is ephemeral).

When `SYSTEM_PLUGINS` is set, `init()` only loads ids that appear in the list.
When unset, behavior is unchanged (every directory under `plugins/` is a
system plugin). Implementation lives in `server/system-plugins.js`; the env
read should be in `server/config.js` for consistency with other settings.

### Direct-fetch implementation checklist

- [ ] `capacitor-shim.js`: replace `App.requestUrl: () => Promise.resolve({})` with a real fetch wrapper.
- [ ] Self-test with `app.requestUrl({ url: 'https://example.com', method: 'GET' })` from DevTools.
- [ ] Install LiveSync into `test-vault/.obsidian/plugins/obsidian-livesync/` (manual; will graduate to system plugin once stable).
- [ ] Verify initial replication with a small CouchDB on Fly.io or local.
- [ ] Document CORS config in `docs/livesync.md` when the integration ships.

Detailed agent-executable plan: `docs/plans/livesync-implementation.md`.

### Phase 2 (planned, after LiveSync ships): per-vault storage type — "local vaults"

Once LiveSync is operational on server-backed vaults, we plan to add a
second vault type: **local vaults**. These live in browser OPFS (Origin
Private File System) instead of the server filesystem, and sync between
devices exclusively through LiveSync ↔ CouchDB.

| | Server vault (current) | Local vault (planned) |
|---|---|---|
| Storage | Server filesystem (`/api/fs/*`) | Browser OPFS |
| Cross-device sync | Each device opens obsidian-web | Mandatory LiveSync ↔ CouchDB |
| Cross-tab sync (same browser) | chokidar → WebSocket | BroadcastChannel (v1: single-tab only) |
| Backup | Server disk | CouchDB (and OPFS replicas on other devices) |
| Privacy | Files on our server | Files only in browser + user's CouchDB |
| Available on | `/` and `/mobile` | `/mobile` only |

The two types coexist on the same deployment. Starter page lets the
user pick which kind to create. No migration of existing server vaults
required.

- Detailed agent-executable plan: `docs/plans/local-vaults-implementation.md`
- Design rationale (incl. the rejected "pure client-only" pivot):
  `docs/plans/future-direction-client-only.md`

---

## Superseded — kept for reference (original 2026-05-09 plan)

> The text below was the original integration plan. It is superseded by the
> direct-fetch approach above. Specifically: **Tasks 1, 3, and 4 do not apply.**
> Tasks 2 (`createHash`) was implemented in `client/boot.js` and mirrored to
> `client-mobile/boot.js` on 2026-05-11. Tasks 5 and 6 still apply (they're
> the manual E2E test and documentation).

### Background

[obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) is a
community plugin that syncs Obsidian vaults via CouchDB or object storage
(MinIO, S3, R2, Cloudflare R2). It also supports experimental WebRTC P2P sync.
The goal: allow obsidian-web to participate in a livesync network, so desktop
Obsidian and obsidian-web stay in sync through the same CouchDB backend.

### Target architecture

```
Desktop Obsidian + LiveSync ─────┐
Mobile Obsidian  + LiveSync ─────┤──► CouchDB ◄──── LiveSync plugin
                                 │                   (runs inside obsidian-web)
                                 │                         │
                              changes                  reads/writes
                              propagated                    ↓
                                                   server vault on disk
                                                   (chokidar → WS → all browsers)
```

All browsers open on obsidian-web share the same vault on disk. LiveSync
running inside one of those browser sessions keeps that vault in sync with
the CouchDB backend.

### Feasibility assessment

| Layer | Status | Notes |
|---|---|---|
| Plugin loading | ✅ works | bootstrap serves `.obsidian/plugins/` including `main.js` |
| File read/write | ✅ works | vault API → fs shim → `/api/fs/*` → disk |
| Plugin settings | ✅ works | `data.json` stored and served normally |
| PouchDB (local cache) | ✅ works | uses IndexedDB, fully available in browser |
| `requestUrl` → CouchDB | ❌ blocked | CouchDB host not in proxy allowlist |
| `_changes` feed (WS/SSE) | ⚠️ needs testing | may bypass proxy if LiveSync opens WebSocket directly |
| `window.crypto` | ⚠️ partial | `createHash` returns empty buffers (issue D in Known Issues) |
| `main.js` size > 500KB | ⚠️ minor | loaded separately, not in bootstrap; ~200ms extra on first load |

### Critical blocker: proxy allowlist

`requestUrl()` calls from plugins go through `server/api/proxy.js`, which
enforces a hard-coded allowlist of Obsidian-owned domains. A CouchDB host
(fly.io, self-hosted, IBM Cloudant, Cloudflare R2) is not in the list and
gets a 403.

**Fix:** add a `PROXY_ALLOWED_HOSTS` environment variable that extends the
allowlist at runtime.

### Crypto stub (issue D)

LiveSync uses `createHash('md5')` and `createHash('sha256')` for chunk
deduplication and integrity checks. The current stub returns empty buffers,
which will silently corrupt LiveSync's checksums.

**Fix:** implement `createHash` using the Web Crypto API (`crypto.subtle.digest`).
Note: `subtle.digest` is async, so the sync `createHash().update().digest()`
interface needs a sync workaround (pre-computed via `TextEncoder` or a
WASM-based MD5/SHA implementation).

### Implementation tasks

#### Task 1 — Configurable proxy allowlist (server) — SUPERSEDED

> **Superseded by direct fetch approach (2026-05-11).** Do not implement.
> The `PROXY_ALLOWED_HOSTS` env var is no longer planned. The proxy stays
> in place only for Obsidian release/asset hosts that the desktop bundle
> reaches out to; LiveSync traffic goes directly from the browser to CouchDB.
> See the "Updated approach (2026-05-11)" section above and Gap 13 in
> `docs/documentation-gaps.md`.
>
> Original plan below for historical context.

File: `server/config.js`
```js
// NEW
export const PROXY_EXTRA_HOSTS = (process.env.PROXY_ALLOWED_HOSTS || '')
    .split(',').map(h => h.trim()).filter(Boolean);
```

File: `server/api/proxy.js` — extend `isAllowed()`:
```js
import { PROXY_EXTRA_HOSTS } from '../config.js';

// after existing allowlist checks:
if (PROXY_EXTRA_HOSTS.some(h => host === h || host.endsWith('.' + h))) return true;
```

Usage:
```bash
PROXY_ALLOWED_HOSTS=my-db.fly.dev node server/index.js
# or multiple:
PROXY_ALLOWED_HOSTS=my-db.fly.dev,my-backup-db.example.com node server/index.js
```

#### Task 2 — Fix `createHash` stub (client)

File: `client/boot.js` — replace the `crypto` module entry.

Option A (pure-JS, synchronous, small):
- Bundle a ~3KB synchronous MD5 + SHA-256 implementation (e.g. `spark-md5` +
  `sha.js`) and expose them through the `createHash` interface.
- Keeps everything synchronous, no API changes needed.

Option B (Web Crypto, async-compatible):
- Expose `createHash` as a sync wrapper that computes hashes using a
  pre-allocated WASM module.
- More complex but avoids shipping JS hash code.

Recommended: **Option A**. LiveSync only uses MD5/SHA-256. `spark-md5` is
~4KB gzipped; `sha.js` ~5KB gzipped. Both are synchronous.

The hash API to implement:
```js
crypto.createHash('md5')   // or 'sha256', 'sha1'
  .update(data)            // Buffer | string
  .digest('hex')           // → hex string
  .digest('base64')        // → base64 string
  .digest()                // → Buffer
```

#### Task 3 — Verify `_changes` feed connectivity

LiveSync subscribes to CouchDB's `_changes?feed=longpoll` (or `eventsource`).
These requests also go through `requestUrl`, so Task 1 covers them too.

If LiveSync uses `EventSource` directly (not via `requestUrl`), it bypasses
the proxy. Test with DevTools network tab after enabling the plugin.

#### Task 4 — CouchDB CORS configuration

The CouchDB server must allow requests from the obsidian-web origin.
Add to `local.ini`:
```ini
[cors]
enable = true
origins = https://your-obsidian-web-host.example.com
headers = Authorization,Content-Type
credentials = true
```

For fly.io CouchDB deployments, this is set via `flyctl ssh console` or
the CouchDB admin panel (`/_utils`).

#### Task 5 — Manual end-to-end test

After Tasks 1–4:
1. Install LiveSync plugin in `test-vault/.obsidian/plugins/obsidian-livesync/`.
2. Start server with `PROXY_ALLOWED_HOSTS=<couchdb-host>`.
3. Open obsidian-web in browser.
4. Go to LiveSync settings → configure CouchDB URI.
5. Verify: initial replication completes, status bar shows ⚡.
6. Edit a note on desktop Obsidian → verify it appears in obsidian-web within seconds.
7. Edit a note in obsidian-web → verify it appears on desktop Obsidian.

#### Task 6 — Documentation

Add a `docs/livesync.md` guide covering:
- Prerequisites (CouchDB already set up with another device)
- Installing the plugin in the vault directory on the server
- Setting `PROXY_ALLOWED_HOSTS`
- CouchDB CORS config
- Known limitations (IndexedDB is per-browser, `createHash` alternative)

### Known limitations after integration

- **IndexedDB is per-browser session.** LiveSync's PouchDB cache is not
  shared between browsers accessing the same obsidian-web instance. Each
  browser will do its own initial replication from CouchDB. Subsequent syncs
  are incremental and fast.
- **No offline write buffering.** If the CouchDB server is unreachable,
  LiveSync will queue changes locally in IndexedDB (standard LiveSync
  behaviour). obsidian-web's own disk writes still work regardless.
- **Cloudflare Workers deployment.** The CF variant uses Durable Objects
  for storage; CouchDB sync through the proxy is not applicable there.
  That deployment is read-only / demo mode; LiveSync is not a target for it.
- **Multiple obsidian-web sessions running LiveSync simultaneously** is
  functionally safe (each syncs independently) but wastes bandwidth. Consider
  documenting that only one session needs LiveSync active at a time.

## Files to know about

| File | Purpose |
|------|---------|
| `src/runtime-server/server/index.js` | HTTP/WS entry point; triggers bootstrap warm-up on listen |
| `src/runtime-server/server/config.js` | port, host, vault path, obsidian path |
| `src/runtime-server/server/vault-registry.js` | persistent recent-vault registry |
| `src/runtime-server/server/system-plugins.js` | overlay from `src/plugins/` into vault's `.obsidian/plugins/` |
| `src/runtime-server/server/api/bootstrap.js` | single-shot preload endpoint; server-side mtime cache; pre-compression |
| `src/runtime-server/server/api/vaults.js` | vault list/open/remove/move API |
| `src/runtime-server/server/api/fs.js` | REST file ops (scoped per vault id) |
| `src/runtime-server/server/api/electron.js` | sendSync channel handlers |
| `src/runtime-server/server/api/proxy.js` | outbound HTTP proxy for Obsidian release/asset hosts |
| `src/runtime-server/server/api/watch.js` | chokidar bridge (per-connection vault watcher) |
| `src/client/index.html` | script load order |
| `src/client/starter.html` | wrapped Obsidian starter entry |
| `src/client/boot.js` | window.require, modules table, platform globals |
| `src/client/shims/sync-http.js` | sync XMLHttpRequest helpers |
| `src/client/shims/original-fs.js` | fs over HTTP |
| `src/client/shims/electron.js` | ipcRenderer + remote stubs |
| `src/client/shims/path.js` | POSIX path utilities |
| `src/client/shims/url.js` | pathToFileURL, fileURLToPath |
| `src/client/shims/os.js` | tmpdir, hostname, etc. |
| `src/client/shims/btime.js` | birthtime stub (no-op) |
| `src/client-mobile/` | mobile-runtime client (boot.js + capacitor shim + index.html for `/mobile`) |
| `src/plugins/obsidian-web-layout/` | system-plugin: ribbon + commands to switch mobile/desktop layout |
| `src/deployments/cloudflare/` | Cloudflare Workers deployment (Worker + Durable Object + build script) |
| `vendor/obsidian-desktop/` | extracted desktop bundle, untouched |
| `vendor/obsidian-mobile/` | extracted mobile bundle, zero build-time patches — byte-identical to the APK; platform behaviour is runtime (`client-mobile/platform-bridge.js`) |
| `user-data/demo-vault/` | example vault shipped with the repo |
| `user-data/registry.json` | recent-vaults registry (gitignored, runtime) |
| `.tmp/` | build artifacts + intermediate (folder tracked, contents gitignored) |
| `scripts/update-obsidian-desktop.js` | downloads asar, extracts desktop bundle to `vendor/obsidian-desktop/` |
| `scripts/update-obsidian-mobile.js` | downloads APK, extracts mobile bundle |
| `scripts/patch-obsidian-mobile.js` | zero regex patches (empty list, kept as infrastructure for a future Obsidian version). `__owPlatform`/`__owPlatformOverrides` are runtime (`client-mobile/platform-bridge.js`), not patches |
| `test-vault/` | scratch vault for development |
