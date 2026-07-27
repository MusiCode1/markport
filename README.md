# obsidian-web

Run Obsidian in a standard browser — no Electron, no native app needed.

**[Live Demo →](https://obsidian-online.pages.dev)**

obsidian-web loads Obsidian's original renderer (`app.js`) completely unmodified — zero build-time patches; all platform behaviour (mobile vs. desktop layout) is adjusted at runtime via `client-mobile/platform-bridge.js`, not by rewriting the bundle — and replaces every Node.js / Electron dependency with lightweight HTTP shims. The result is real Obsidian running in any modern browser.

### What works

- Full Markdown editing and preview (CodeMirror + Obsidian's renderer)
- File tree, tabs, split panes, graph view
- Bidirectional links and backlinks
- Search and command palette
- Core plugins (file explorer, tags, bookmarks, outgoing links, etc.)
- Real-time sync across tabs via WebSocket
- RTL / Unicode support

### Fast bootstrap

The browser version can load faster than the desktop app. Instead of Obsidian reading dozens of config files one by one from disk, everything is served in a single HTTP request (`/api/bootstrap`) — all files, directories, and metadata arrive at once, before Obsidian even starts running. When it calls `statSync` or `readFileSync`, the answer is already waiting in memory.

### Two deployment modes

| | **Node.js server** | **Cloudflare Workers** |
|---|---|---|
| Path | `src/runtime-server/server/` | `src/deployments/cloudflare/` |
| Storage | Real filesystem | Durable Object (in-memory) |
| Persistence | Full | R2 (optional) or reset every N hours |
| Use case | Personal use, self-hosted | Public demo, zero-maintenance |
| URL | `http://localhost:3000` | [obsidian-online.pages.dev](https://obsidian-online.pages.dev) |

## Repo layout

```
src/                         our source code
├── client-mobile/           the (only) runtime, loaded at / (and aliased at /mobile)
├── runtime-server/
│   └── server/              Node.js HTTP/WS backend
├── plugins/                 system plugin overlay (e.g. obsidian-web-layout)
└── deployments/             provider-specific deployments
    └── cloudflare/          Cloudflare Workers + Durable Object

vendor/                      extracted Obsidian bundles (gitignored)
├── obsidian-mobile/         mobile renderer (zero build-time patches — byte-identical to Obsidian's own APK) — the only renderer in use
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
`/starter` (the old desktop vault picker) redirects to `/` — it no longer serves a page of
its own, but existing bookmarks/links still land you on the app instead of a 404.

## Obsidian Version

### Mobile bundle (`vendor/obsidian-mobile/`) — the only runtime

`/` and `/mobile` are both served by the mobile runtime, which needs the Obsidian Android APK bundle extracted into `vendor/obsidian-mobile/`. Like the (now vestigial) `vendor/obsidian-desktop/`, this directory is gitignored and downloaded on demand:

```bash
# extract vendor/obsidian-mobile/ from the latest Android APK release
node scripts/update-obsidian-mobile.js

# specific version
node scripts/update-obsidian-mobile.js --version 1.12.7
```

This script downloads the official APK and unpacks the `assets/public/` tree to `vendor/obsidian-mobile/` — **zero build-time patches are applied**; the extracted bundle is byte-for-byte identical to Obsidian's own Android renderer. All platform behaviour — exposing `window.__owPlatform` and merging `window.__owPlatformOverrides` into the live `Platform` flags, including the desktop-layout vault-profile panel — happens at runtime via `client-mobile/platform-bridge.js`, which intercepts `Object.defineProperty` instead of touching a single byte of app.js (see `docs/plans/runtime-platform-descriptors.md` and `docs/plans/zero-patches.md`). `scripts/patch-obsidian-mobile.js` still runs as part of the update step — its patch list is currently empty, kept as infrastructure in case a future Obsidian version needs one; if a future patch's regex fails to match, the script aborts loudly, same as before.

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

## Cloudflare Workers demo (`src/deployments/cloudflare/`)

A standalone deployment that runs entirely on Cloudflare's edge — no server to maintain.

```bash
cd src/deployments/cloudflare
npm install
npm run deploy
```

### Architecture

```
Browser → CF Worker → Durable Object (VaultDO)
             ↓
       /api/* → DO (vault in memory)
       other  → static assets (CF CDN)
```

The Durable Object holds the entire vault in a `Map<path, {content, mtime, size}>`. A single `/api/bootstrap` call preloads all files and directory listings so Obsidian can boot with minimal latency.

### Demo mode (`DEMO_MODE=true`)

- Vault is initialized from a template on cold start
- Resets automatically every N hours via DO alarm
- Core template files (Welcome, How It Works, etc.) are protected from deletion
- No auth required — anyone can visit and try it

### Personal mode (`DEMO_MODE=false`)

- Writes persist to R2
- Requires `API_KEY` secret for access
- No automatic reset

### Configuration

Environment variables in `wrangler.toml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE` | `"true"` | Enable demo mode (in-memory, auto-reset) |
| `RESET_INTERVAL_HOURS` | `"4"` | Hours between automatic vault resets |
| `API_KEY` | — | Required when `DEMO_MODE=false` (set via `wrangler secret put API_KEY`) |

### Key files

| File | Purpose |
|------|---------|
| `src/deployments/cloudflare/index.js` | Worker entry: routes `/api/*` to DO, else to CDN |
| `src/deployments/cloudflare/vault-do.js` | Durable Object: vault state, WebSocket, alarm reset |
| `src/deployments/cloudflare/template.js` | Demo vault content (loaded on cold start / reset) |
| `src/deployments/cloudflare/api/bootstrap.js` | Single-shot preload: electron IPC + fs + dirs |
| `src/deployments/cloudflare/api/fs.js` | REST file system (stat, read, write, readdir, etc.) |
| `src/deployments/cloudflare/api/electron.js` | IPC channel stubs |
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
- Current architecture and roadmap are in `PLAN.md`.
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
proprietary bundle, are gitignored, are never redistributed by this project, and remain
governed solely by [Dynalist Inc.'s Terms of Service](https://obsidian.md/terms). Nothing
here grants any rights over Obsidian's code. obsidian-web does not modify Obsidian's
source in this repository — the setup scripts download it unmodified to **your local
copy** at install time. A patch-application step still exists as infrastructure for a
future Obsidian version that might require one, but currently applies zero patches.

## Credits

Built by [MusiCode1](https://github.com/MusiCode1) and [Claude Code](https://claude.ai/code).
