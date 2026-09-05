---
title: "Architecture - Markport"
description: "How Markport runs Obsidian's renderer in a browser, and why it is built this way."
---

# Architecture - Markport

> Audience: people changing the code. The "why", not the "how to use it" (that is `README.md`).
> A Hebrew version of this document is at [`docs/he/architecture.md`](he/architecture.md).

## What this is

Markport runs Obsidian's own renderer (the upstream bundle, `vendor/obsidian-mobile/`) in a
standard browser, using shims that stand in for Electron and Capacitor. After the mobile-first
collapse there is **one core** (`client-mobile`) with a **swappable backend**, not two runtimes.

## Runtime layers

| Layer | Status | Storage | Deployment |
|---|---|---|---|
| **serverless** | ★ primary | OPFS in the browser + folder vaults (File System Access API) | CF Pages static + Worker proxy |
| **server** | supported, option 2 | real files through `/api/fs` | `deployments/server/` (node; no Dockerfile in the repo) |
| **desktop** | kept, future open | - | `vendor/obsidian-desktop`, parallel to mobile |

**What decides between serverless and server** is *not* a probe or capability detection against
`/api/fs` - there is none. It is the **local registry** (`window.__owLocalVaults`, loaded
synchronously in a `<script>` before `boot.js`; see the load order in `index.html`). If the vault
id appears in the registry, its recorded `type` (`'local'` / `'folder'`) selects OPFS.
**Otherwise the default is `'server'`** - including on a static deployment with no server at all
(`boot.js:149-151`):

```js
var __owV = window.__owLocalVaults && window.__owLocalVaults.get(VAULT_ID);
var VAULT_TYPE = __owV ? (__owV.type || 'local') : 'server';
```

So a vault id that was never created or opened locally, and therefore is not in the registry,
will try `'server'` even on Cloudflare. There is no automatic fallback to OPFS for an
unregistered id.

## Directory layout

```
vendor/                    upstream, gitignored, produced by scripts (shared)
  obsidian-mobile/         the active renderer (from the Android APK)
  obsidian-desktop/        second option (parallel)
  plugins/                 LiveSync and friends
scripts/                   shared tooling: update/patch-obsidian-{mobile,desktop}
src/
  core/                    (future) shared base shims: path/os/url/btime + dispatcher
  client-mobile/           the client (the "Mobile" name stays) - OPFS backend, boot, seed, SW
  runtime-server/          server-specific code, isolated:
     server/               Node: /api/fs, watch, bootstrap
     client-shims/         the HTTP backend branch + server-only shims
  deployments/
     cloudflare/           serverless (static + _worker.js)   <- default
     server/               server deployment (node; no Dockerfile in the repo today)
```

## Guiding principles

- **Serverless is primary.** No change to the core may break the static deployment.
- **HTTPS and auth are the operator's job.** The server speaks plain HTTP; a reverse proxy
  (Caddy is a good choice) supplies TLS and authentication. That is why `crypto.subtle` is used
  natively, with no hand-written polyfills.
- **The forward-looking "server side"** is OPFS plus a sync plugin, not a wider `/api/fs`.
- **Boot order:** the filesystem adapter has to exist before boot, in order to open a vault -
  which means it **cannot** be a plugin.

## Obsidian's bundle (`vendor/`)

- `vendor/*` is gitignored and produced by `scripts/update-obsidian-mobile.js`, which downloads
  the official APK.
- **Zero patches.** `vendor/obsidian-mobile/app.js` is byte-identical to the APK's own
  `assets/public/app.js`. `scripts/patch-obsidian-mobile.js` still exists as infrastructure,
  with an empty `PATCHES` list, for a future Obsidian version that might need one.
- All platform behaviour - mobile versus desktop layout, including the vault-profile panel - is
  adjusted at **runtime** by `client-mobile/platform-bridge.js`, which intercepts
  `Object.defineProperty` to capture Obsidian's own `Platform` object rather than editing
  `app.js`.
- **Version bump:** run the update script with `--version <X>`. If a future patch is ever added
  and it throws, follow the ANCHOR/REBUILD block in `scripts/patch-obsidian-mobile.js`.
