---
title: "Running Markport yourself - Markport"
description: "How to run your own instance of Markport, statically or on a Node server."
---

# Running Markport yourself

> There is no public instance, on purpose. This page is how you run your own.
> A Hebrew version of this page is at [`docs/he/install.md`](he/install.md).

There are two ways to run it, and they share the same browser-side core. Pick whichever fits:

- **Static** - a folder of files. Any static host, or your own machine. Vaults live in your
  browser (OPFS) or in a folder you pick on disk. Nothing is stored on a server.
- **Node server** - stores vaults as real files on disk and pushes live updates to the client.

---

## Before either one

You need **Node 18 or newer**, and a copy of Obsidian's renderer.

```bash
git clone https://github.com/MusiCode1/markport
cd markport
node scripts/update-obsidian-mobile.js --version 1.12.7
```

That script downloads Obsidian's official Android APK and unpacks its `assets/public/` tree
into `vendor/obsidian-mobile/`. Nothing is modified: the extracted bundle is byte-for-byte
identical to Obsidian's own. This repository does not contain or redistribute it - the download
goes from Obsidian to your machine.

> **Pass `--version 1.12.7` explicitly.** Without it the script takes the latest release, which
> is 1.13 or newer and will not start. See "What does not work" on the [home page](/).

---

## Option 1: the Node server

```bash
cd src/runtime-server/server
npm install
npm start
```

Open `http://127.0.0.1:3000`.

`npm run dev` instead of `npm start` reloads on file changes.

### Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `127.0.0.1` | set to `0.0.0.0` to accept connections from other machines |
| `VAULT_PATH` | `user-data/demo-vault` | the vault directory to serve |

**The server speaks plain HTTP and has no authentication.** That is deliberate: TLS and auth are
the operator's job, and a reverse proxy in front of it (Caddy is a good choice) does both in a few
lines. Do not expose it directly.

---

## Option 2: the static build

```bash
cd src/deployments/cloudflare
npm install
npm run build
```

The result lands in `.tmp/deployments/cloudflare/public/` - a plain directory of files. Serve it
from anywhere: Cloudflare Pages, Vercel, Netlify, nginx, or a local static server.

The build also produces a small Worker (`_worker.js`) that does two things: it serves the app
shell for `/starter` and `/vault/<id>`, and it proxies plugin downloads. On a host with no
serverless functions the app still loads, but installing community plugins from inside it will
not work, because a browser cannot reach `github.com` directly.

---

## What you need to know either way

**HTTPS is not optional.** Browser storage (OPFS) is unavailable in an insecure context, so on a
plain `http://` host that is not `localhost`, creating a vault fails silently. `localhost` is
fine for trying it out.

**Chromium gives the complete experience.** Folder vaults - opening a real directory on your disk -
and auto-refresh on external file changes are Chromium-only. Firefox and Safari get browser-local
vaults; Safari shipped OPFS writes much later than reads, so check your version.

**Markport is not made by, affiliated with, or endorsed by Obsidian.** What you run is your own
instance, on your own machine, from a bundle you downloaded yourself.

---

Anything else - the architecture, the shim layer, the reasoning - is in
[the architecture notes](/architecture) and the [repository](https://github.com/MusiCode1/markport).
