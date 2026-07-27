# obsidian-web

Run Obsidian in a standard browser — no Electron, no native app needed.

**[Live Demo →](https://obsidian-online.pages.dev)** — client-only: your vault lives entirely in
your own browser (OPFS), nothing is stored on any server, and nothing is shared between visitors.
See "Two deployment modes" below.

obsidian-web loads Obsidian's original renderer (`app.js`) completely unmodified and replaces every Node.js / Capacitor / Electron dependency it depends on with lightweight browser-compatible shims. The result is real Obsidian running in any modern browser.

### What works

- Full Markdown editing and preview (CodeMirror + Obsidian's renderer)
- File tree, tabs, split panes, graph view
- Bidirectional links and backlinks
- Search and command palette
- Core plugins (file explorer, tags, bookmarks, outgoing links, etc.)
- Real-time sync across tabs via WebSocket — **Node.js server mode only** (`/api/watch`); not available in the client-only (OPFS) deployment, which has no server to push events from
- RTL / Unicode support

### Fast bootstrap (Node.js server mode)

Against the Node.js server, the browser version can load faster than the desktop app. Instead of Obsidian reading dozens of config files one by one from disk, everything is served in a single HTTP request (`/api/bootstrap`) — all files, directories, and metadata arrive at once, before Obsidian even starts running. When it calls `statSync` or `readFileSync`, the answer is already waiting in memory. **The client-only (OPFS) deployment doesn't use this path** — there's no HTTP round-trip for vault reads at all; the vault is read directly from the browser's local storage.

### Browser support (OPFS)

The client-only deployment (and local/folder vaults on the Node server) are backed by
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
(Origin Private File System). Support varies by browser:

| Capability | Chromium | Firefox | Safari |
|---|:---:|:---:|:---:|
| Vault storage — read (`getDirectory`) | ✅ | ✅ | ✅ |
| Vault storage — write (`createWritable`) | ✅ | ✅ | ⚠️ shipped much later than `getDirectory` — check your Safari version before relying on it |
| Folder vaults (`showDirectoryPicker`) | ✅ | ❌ | ❌ |
| Auto-refresh on external folder change (`FileSystemObserver`) | ✅ | ❌ | ❌ — falls back to refresh on tab focus |

**OPFS requires a secure context** (`https://` or `localhost`). Over plain HTTP on a bare IP address, `navigator.storage.getDirectory` is `undefined` and vault creation fails silently — this applies to local development too, not just production.

### Two deployment modes

| | **Node.js server** | **Cloudflare (client-only)** |
|---|---|---|
| Path | `src/runtime-server/server/` | `src/deployments/cloudflare/` |
| Storage | Real filesystem, via `/api/fs` | OPFS — entirely inside your browser |
| Persistence | Full | Until you clear this site's browsing data |
| Sharing | Whoever can reach the server/port | Nobody — private to your browser, never sent anywhere |
| Use case | Personal use, self-hosted | Public demo, zero-maintenance, no server-side vault storage |
| URL | `http://localhost:3000` | [obsidian-online.pages.dev](https://obsidian-online.pages.dev) |

There's also `src/sync-server/` — a separate, optional pull-sync server (`/sync/v1`, content-hash
based, Bearer-token auth via `SYNC_TOKEN`) that lets an OPFS vault pull from a server-hosted vault
directory. It's not part of either deployment above — see `src/sync-server/README.md`.

### Requirements

Node 18+ or Bun. Most packages' scripts invoke `node` (`src/client-mobile` tests, the
`runtime-server` backend, the Cloudflare deployment's build script); `src/sync-server` is the one
package that runs on `bun` (`bun index.js` / `bun test`).

## Repo layout

```
src/                         our source code
├── client-mobile/           the (only) runtime, loaded at / (and aliased at /mobile)
├── runtime-server/
│   └── server/              Node.js HTTP/WS backend
├── sync-server/             optional pull-sync server (/sync/v1, SYNC_TOKEN) — separate from
│                             the runtime-server backend above, see src/sync-server/README.md
├── plugins/                 system plugin overlay (e.g. obsidian-web-layout)
└── deployments/             provider-specific deployments
    └── cloudflare/          client-only static deployment (OPFS) + a small edge Worker —
                              no server-side vault storage of any kind

vendor/                      extracted Obsidian bundles (gitignored)
├── obsidian-mobile/         mobile renderer (with build-time patches) — the only renderer in use
├── obsidian-desktop/        legacy desktop renderer — vestigial, no longer served by the
│                             server (routes removed in collapse-desktop); kept only because
│                             scripts/update-obsidian-desktop.js still exists (see Notes)
└── Obsidian.AppImage        source binary

user-data/                   user-facing data
├── demo-vault/              example vault (tracked)
└── registry.json            recent-vaults registry (gitignored, runtime)

.tmp/                        intermediate / build artifacts (folder tracked,
                             contents gitignored via internal .gitignore)
scripts/                     build tooling (update-obsidian-mobile, patch-obsidian-mobile;
                             update-obsidian-desktop.js is vestigial, see Notes)
```

> **Note**: `src/client/` (the desktop runtime) was removed in the `collapse-desktop` slice —
> the mobile runtime is now the only runtime, served at both `/` and `/mobile`. The desktop
> code is still recoverable from git history via the `archive/desktop-runtime` tag.

---

## Setup (Node.js server)

Download and extract the Obsidian mobile renderer bundle (the only runtime the server serves):

```bash
node scripts/update-obsidian-mobile.js && node scripts/patch-obsidian-mobile.js
```

Install and run the backend:

```bash
cd src/runtime-server/server
npm install
npm run dev   # auto-reloads on file changes (uses node --watch)
```

For production (no reload overhead):
```bash
npm start
```

Open `http://127.0.0.1:3000`. `/mobile` also works (backwards-compatible alias, same page).
`/starter` (the old desktop vault picker) redirects to `/` on the Node server — it no longer
serves a page of its own, but existing bookmarks/links still land you on the app instead of a
404. The client-only Cloudflare deployment serves `/starter` too, via its own Worker route
(`index.js`) that returns the same app shell — see "Cloudflare (client-only) deployment" below;
that deployment is not a plain static host.

`/mobile` is **not** part of the Cloudflare (client-only) deployment — it's a route this Node
server adds; the static deployment only serves `/`.

## Obsidian Version

### Mobile bundle (`vendor/obsidian-mobile/`) — the only runtime

`/` and `/mobile` are both served by the mobile runtime, which needs the Obsidian Android APK bundle extracted into `vendor/obsidian-mobile/`. Like the (now vestigial) `vendor/obsidian-desktop/`, this directory is gitignored and downloaded on demand:

```bash
# extract vendor/obsidian-mobile/ from the latest Android APK release
node scripts/update-obsidian-mobile.js

# specific version
node scripts/update-obsidian-mobile.js --version 1.12.7
```

This script downloads the official APK, unpacks the `assets/public/` tree to `vendor/obsidian-mobile/`, and **applies four build-time patches** to `vendor/obsidian-mobile/app.js` (via `scripts/patch-obsidian-mobile.js`) that expose `window.__owPlatform`, merge `window.__owPlatformOverrides`, and surface the desktop-layout vault profile panel. If a patch fails to match, the script aborts loudly — that's our signal that the Obsidian minifier changed.

| Runtime URL | Updater |
|---|---|
| `/` | `node scripts/update-obsidian-mobile.js && node scripts/patch-obsidian-mobile.js` |
| `/mobile` (alias) | same as `/` — identical `index.html` |

## Configuration

Server environment variables:

- `PORT`: HTTP port, default `3000`.
- `HOST`: bind address, default `127.0.0.1`.
- `VAULT_PATH`: vault path relative to the project root or absolute, default `user-data/demo-vault`.
- `VAULT_REGISTRY`: recent-vault registry JSON path, default `user-data/registry.json`.

### Bootstrap configuration

The `/api/bootstrap` endpoint preloads vault content into memory for fast
boot. Both `/` and `/mobile` (the same runtime) consume it. Defaults work
for most vaults. To customize:

- `BOOTSTRAP_DISABLED=true` — skip the bootstrap entirely. Each FS read
  goes individually over HTTP. Useful for minimal deployments where the
  precompute is not worth it. Cold boot of a large vault drops back to
  ~20s; with bootstrap enabled it is ~2-3s.
- `BOOTSTRAP_MAX_FILE_KB=500` — skip individual files larger than this
  from the cache (default: 500 KB). Their stat is still cached; content
  is fetched on demand.
- `BOOTSTRAP_MAX_TOTAL_MB=50` — cap the total uncompressed response size
  (default: 50 MB). When reached, server stops adding content but still
  returns dirs+stat for the remaining files. Response carries
  `capped: true` and `cappedReason`.

## Deployment

## Cloudflare (client-only) deployment (`src/deployments/cloudflare/`)

A static deployment that runs entirely on Cloudflare's edge. Vaults live in the browser (OPFS) —
there is **no server-side vault storage of any kind** here (the old server-side in-memory vault
store, internally called `VaultDO`, was removed). A small Worker (`index.js`) still handles two
things a plain static host can't:

- `POST /api/proxy-request` — a CORS-safe edge proxy so community-plugin installs can reach
  GitHub/obsidian.md (they don't send CORS headers)
- `GET /starter` and `/vault/*` — SPA-fallback routes that return the same app shell as `/`, so
  deep links and bookmarks don't 404

Everything else is served as a static asset (`env.ASSETS`). See
`src/deployments/cloudflare/README.md` for the full picture (system plugins, proxy caching, known
gaps).

```bash
cd src/deployments/cloudflare
npm install
npm run build   # scripts/build-assets.sh → .tmp/deployments/cloudflare/public
npm run dev     # local emulation (wrangler dev) — does NOT publish anywhere
```

`npm run build` needs network access (GitHub API + release-asset CDN) to fetch the LiveSync
plugin on a cold cache; if unreachable, it **warns and continues** without LiveSync rather than
failing the build.

`npm run deploy` (build, then `wrangler deploy`) publishes to the real Cloudflare account
configured in `wrangler.toml` — only run it when you actually intend to publish; use `npm run dev`
for local testing.

### Architecture

```
Browser
  ├─ vault storage: OPFS (client-side only, never leaves the browser)
  └─ HTTP → CF Worker (index.js)
              ├─ POST /api/proxy-request  → edge proxy (GitHub/obsidian.md, CORS)
              ├─ GET /starter, /vault/*   → same app shell as / (SPA fallback)
              └─ everything else          → static assets (CF CDN)
```

### Key files

| File | Purpose |
|------|---------|
| `src/deployments/cloudflare/index.js` | Worker entry: `/api/proxy-request` + `/starter`/`/vault/*` fallback, else static assets |
| `src/deployments/cloudflare/proxy-worker.js` | The CORS-safe outbound proxy implementation |
| `src/deployments/cloudflare/template.js` | Demo vault content — seeded client-side into a new visitor's own OPFS vault on first visit |
| `src/deployments/cloudflare/wrangler.toml` | Worker config: static asset directory, no server-side vault bindings |
| `src/deployments/cloudflare/scripts/build-assets.sh` | Build: copies the mobile bundle, builds the system-plugins manifest + example-vault JSON |
| `src/deployments/cloudflare/test/` | `bun test` — proxy + build-assets tests |
| `.tmp/deployments/cloudflare/public/...` | Built static assets (generated by `npm run build`) |

---

## Node.js deployment

The Node.js server (`src/runtime-server/server/`) can be deployed to any Linux box. A typical setup:

1. Clone the repo and run `node scripts/update-obsidian-mobile.js && node scripts/patch-obsidian-mobile.js` to get Obsidian's renderer files
2. `cd src/runtime-server/server && npm install && npm start`
3. Put it behind a reverse proxy (nginx, Caddy, Cloudflare Tunnel) with HTTPS
4. Do not expose the server directly to the internet without auth — there is no application-level authentication

## Notes

- Obsidian's extracted files are treated as third-party artifacts. Do not edit files under `vendor/obsidian-mobile/`; update wrappers/shims instead.
- The default vault is `user-data/demo-vault/`.
- Do not bind the server to a public IP without a tunnel or auth layer in front.
- See `docs/architecture.md` for the current architecture and design principles.
- `vendor/obsidian-desktop/` and `scripts/update-obsidian-desktop.js` (the legacy desktop renderer + its
  downloader) are **vestigial** — the server no longer serves any route from them (removed
  in the `collapse-desktop` slice). They are left in place rather than deleted; if you don't
  already have `vendor/obsidian-desktop/` populated, you don't need it — everything now runs on
  `vendor/obsidian-mobile/`.

## Disclaimer

This is an **educational proof-of-concept** exploring how Electron-based apps can run in a standard browser. It is not affiliated with, endorsed by, or associated with [Obsidian](https://obsidian.md) or Dynalist Inc.

This repository does **not** include Obsidian's source code. The `vendor/obsidian-desktop/` and `vendor/obsidian-mobile/` directories are gitignored — users must download Obsidian's renderer themselves using the provided setup scripts. Obsidian's code remains the property of Dynalist Inc. under their [Terms of Service](https://obsidian.md/terms).

If the Obsidian team has any concerns about this project, please [open an issue](https://github.com/MusiCode1/obsidian-web/issues) and we will address them promptly.

## License

[GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`).

**This applies to obsidian-web's own code only** — everything under `src/` and `scripts/`.
You are free to use, study, modify and redistribute it; if you distribute a modified
version, it must also be GPL-3.0 and its source must be available.

It does **not** apply to Obsidian itself. The `vendor/` directories hold Obsidian's own
proprietary bundle, are gitignored, and remain governed solely by
[Dynalist Inc.'s Terms of Service](https://obsidian.md/terms). Nothing here grants any rights
over Obsidian's code. **This repository** does not contain and does not distribute Obsidian's
source — the setup scripts download it and apply a small set of documented patches to **your
local copy** at install time. The **public live demo**, however, *does* serve Obsidian's bundle
(so it can run in visitors' browsers) — see `build-assets.sh`, which copies it into the deployed
static assets. If the Obsidian team has concerns about that, see the Disclaimer above.

## Credits

Built by [MusiCode1](https://github.com/MusiCode1) and [Claude Code](https://claude.ai/code).
