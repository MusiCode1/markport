# obsidian-web

Run Obsidian's desktop app in a standard browser — no Electron needed.

**[Live Demo →](https://obsidian-web.tzlev.ovh)**

obsidian-web loads Obsidian's original renderer (`app.js`) completely unmodified and replaces every Node.js / Electron dependency with lightweight HTTP shims. The result is real Obsidian running in any modern browser.

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
| Path | `src/server/` | `src/deployments/cloudflare/` |
| Storage | Real filesystem | Durable Object (in-memory) |
| Persistence | Full | R2 (optional) or reset every N hours |
| Use case | Personal use, self-hosted | Public demo, zero-maintenance |
| URL | `http://localhost:3000` | [obsidian-web.tzlev.ovh](https://obsidian-web.tzlev.ovh) |

## Repo layout

```
src/                         our source code
├── client/                  desktop runtime (loaded at /)
├── client-mobile/           mobile runtime (loaded at /mobile)
├── server/                  Node.js HTTP/WS backend
├── plugins/                 system plugin overlay (e.g. obsidian-web-layout)
└── deployments/             provider-specific deployments
    └── cloudflare/          Cloudflare Workers + Durable Object

vendor/                      extracted Obsidian bundles (gitignored)
├── obsidian/                desktop renderer
├── obsidian-mobile/         mobile renderer (with build-time patches)
└── Obsidian.AppImage        source binary

user-data/                   user-facing data
├── demo-vault/              example vault (tracked)
└── registry.json            recent-vaults registry (gitignored, runtime)

.tmp/                        intermediate / build artifacts (folder tracked,
                             contents gitignored via internal .gitignore)
scripts/                     build tooling (update-obsidian, patch-obsidian-mobile)
```

---

## Setup (Node.js server)

Download and extract the latest Obsidian renderer files:

```bash
node scripts/update-obsidian.js
```

Install and run the backend:

```bash
cd src/server
npm install
npm run dev   # auto-reloads on file changes (uses node --watch)
```

For production (no reload overhead):
```bash
npm start
```

Open `http://127.0.0.1:3000`.

Open `http://127.0.0.1:3000/starter` to manage recent vaults and add a
server folder path as a vault.

## Docker (self-hosted / NAS)

The repo ships a `docker-compose.yml` for running obsidian-web on a NAS or any Docker host.

```bash
docker compose up -d
```

### Vault location

Inside the container, the server's working root is `/app/user-data/`. The `docker-compose.yml` mounts a host directory there:

```
${USER_DATA:-./user-data}  →  /app/user-data
```

**Your vault folder must live under that mount point.** For example, if your `.env` has:

```
USER_DATA=/volume1/obsidian
```

then place your vault at `/volume1/obsidian/<VaultName>/` on the host. Inside the container it appears at `/app/user-data/<VaultName>/`. The `VAULT_PATH` env var (default `user-data/demo-vault`) tells the server which subdirectory to open on boot — set it to `user-data/<VaultName>` to open your vault automatically.

### Configuration (`.env`)

Copy `.env.example` to `.env` and fill in your values:

| Variable | Default | Description |
|----------|---------|-------------|
| `USER_DATA` | `./user-data` | Host path mounted to `/app/user-data` — put your vault here |
| `VAULT_PATH` | `user-data/demo-vault` | Relative path inside the container to the vault to open on boot |
| `PORT` | `3000` | Host port |
| `TOTP_SECRET` | _(empty — auth disabled)_ | Base-32 TOTP secret; set to enable auth. Generate with `node -e "const {authenticator}=require('otplib');console.log(authenticator.generateSecret())"` then visit `/__totp-setup?token=YOUR_SECRET` to scan the QR code. |
| `WATCH_POLLING` | `false` | Set to `true` on network filesystems (NFS, SMB, rclone) that don't support inotify |

### Notes

- The Obsidian renderer is downloaded into a named Docker volume (`obsidian_vendor`) on first start — no manual step needed.
- Run behind a reverse proxy (nginx, Caddy, Cloudflare Tunnel) for HTTPS. Without HTTPS, the Web Crypto API (`crypto.subtle`) is unavailable; the project includes a pure-JS polyfill so plugins like ion-sync that rely on AES-GCM/PBKDF2 still work on plain HTTP.
- If you use a third-party sync plugin (e.g. ion-sync) that previously synced to the vault on another device, the initial sync may encounter ENOTDIR errors where old sync artifacts left files where directories should be. The server auto-repairs these by removing the blocking file and recreating the correct directory structure.

---

## Obsidian Version

`vendor/obsidian/` is generated from the official `obsidianmd/obsidian-releases` GitHub releases and is intentionally ignored by Git.

Useful commands:

```bash
# latest stable release
node scripts/update-obsidian.js

# specific release
node scripts/update-obsidian.js --version 1.12.7

# re-download even if cached
node scripts/update-obsidian.js --force

# remove cached .asar.gz/.asar after a successful extraction
node scripts/update-obsidian.js --no-cache
```

The updater uses the official `obsidian-<version>.asar.gz` release asset, verifies the SHA-256 digest when GitHub provides one, extracts it locally, validates required renderer files, then replaces `obsidian/`.

### Mobile bundle (`vendor/obsidian-mobile/`)

The project ships **two runtimes** — a desktop one at `/` and a mobile one at `/mobile`. The mobile runtime needs the Obsidian Android APK bundle, extracted into `vendor/obsidian-mobile/`. Like `vendor/obsidian/`, this directory is gitignored and downloaded on demand:

```bash
# extract vendor/obsidian-mobile/ from the latest Android APK release
node scripts/update-obsidian-mobile.js

# specific version
node scripts/update-obsidian-mobile.js --version 1.12.7
```

This script downloads the official APK, unpacks the `assets/public/` tree to `vendor/obsidian-mobile/`, and **applies four build-time patches** to `vendor/obsidian-mobile/app.js` (via `scripts/patch-obsidian-mobile.js`) that expose `window.__owPlatform`, merge `window.__owPlatformOverrides`, and surface the desktop-layout vault profile panel. If a patch fails to match, the script aborts loudly — that's our signal that the Obsidian minifier changed.

Both runtimes share the same server. Run **both updater scripts** if you want `/` and `/mobile` to work. If you only want one of them, you can run just the corresponding script.

| Runtime URL | Updater | Notes |
|---|---|---|
| `/` (desktop) | `node scripts/update-obsidian.js` | Required for legacy fallback |
| `/mobile` | `node scripts/update-obsidian-mobile.js` | **Preferred runtime.** Applies patches automatically. |

## Configuration

Server environment variables:

- `PORT`: HTTP port, default `3000`.
- `HOST`: bind address, default `127.0.0.1`.
- `VAULT_PATH`: vault path relative to the project root or absolute, default `user-data/demo-vault`.
- `VAULT_REGISTRY`: recent-vault registry JSON path, default `user-data/registry.json`.

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

The Node.js server (`src/server/`) can be deployed to any Linux box. A typical setup:

1. Clone the repo and run `node scripts/update-obsidian.js` to get Obsidian's renderer files
2. `cd src/server && npm install && npm start`
3. Put it behind a reverse proxy (nginx, Caddy, Cloudflare Tunnel) with HTTPS
4. Do not expose the server directly to the internet without auth — there is no application-level authentication

## Notes

- Obsidian's extracted files are treated as third-party artifacts. Do not edit files under `vendor/obsidian/` or `vendor/obsidian-mobile/`; update wrappers/shims instead.
- The default vault is `user-data/demo-vault/`.
- The current starter folder picker is prompt-based: enter an absolute server path.
- Do not bind the server to a public IP without a tunnel or auth layer in front.
- Current architecture and roadmap are in `PLAN.md`.

## Disclaimer

This is an **educational proof-of-concept** exploring how Electron-based apps can run in a standard browser. It is not affiliated with, endorsed by, or associated with [Obsidian](https://obsidian.md) or Dynalist Inc.

This repository does **not** include Obsidian's source code. The `vendor/obsidian/` and `vendor/obsidian-mobile/` directories are gitignored — users must download Obsidian's renderer themselves using the provided setup scripts. Obsidian's code remains the property of Dynalist Inc. under their [Terms of Service](https://obsidian.md/terms).

If the Obsidian team has any concerns about this project, please [open an issue](https://github.com/MusiCode1/obsidian-web/issues) and we will address them promptly.

## Credits

Built by [MusiCode1](https://github.com/MusiCode1) and [Claude Code](https://claude.ai/code).
