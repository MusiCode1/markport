---
title: "Markport - Obsidian, running in your browser"
description: "Obsidian's own renderer running in a standard browser. No Electron, no install, no server-side vault."
---

<header class="wrap">
  <p class="wordmark">Markport</p>
  <h1>Obsidian, running in <span>your browser</span></h1>
  <p class="tagline">
    Obsidian's own renderer - the real one, byte-for-byte unmodified - with every
    Electron and Capacitor dependency replaced by browser-native shims.
  </p>
  <div class="actions">
    <a class="btn btn-primary" href="/install">
      Run it yourself
      <small>A few minutes, on your own machine</small>
    </a>
  </div>
  <p class="disclaimer">
    Markport is an independent project. It is not made by, affiliated with, or endorsed by
    Obsidian. <strong>There is no public instance</strong> - see below for why.
  </p>
</header>

## Where your notes live

Two options, and neither one involves a server.

### A real folder on your computer

Point Markport at any directory and it reads and writes that directory directly, through the
browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API).
Your notes stay ordinary Markdown files on your disk - open them in any other editor, back them
up, sync them with whatever you already use. Nothing is copied into the browser, and the browser
cannot see anything outside the folder you picked. Chromium-based browsers only.

### Inside the browser

If you would rather not grant folder access, vaults can live in
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) -
private to you, never uploaded, never shared between visitors. They survive a reload and stay
until you clear that site's browsing data. Works in every modern browser.

> There is also an optional sync server you can run yourself - **pull-only, read-only, no
> encryption**. Not ready for real use yet.

> **One exception:** requests to `github.com`, `githubusercontent.com` and `obsidian.md` -
> installing a community plugin, and the deprecated-plugin check Obsidian itself makes at vault
> load - pass through a small proxy, because a browser cannot reach those hosts directly. Your
> notes are never part of that. A sync server you connect yourself is a direct connection and is
> never proxied.

## Zero patches to Obsidian's bundle

`app.js` is served exactly as Obsidian ships it - verified by checksum against the official
Android bundle. Nothing is rewritten at build time. Platform behaviour (desktop vs. mobile
layout) is adjusted at *runtime*, through a shim that captures Obsidian's own `Platform` object
instead of editing its source. *This repository does not contain or redistribute that bundle.*

## What works

- Full Markdown editing and live preview, powered by Obsidian's own renderer
- File tree, tabs, split panes, graph view
- Wikilinks, backlinks, tags, search, command palette
- Core plugins, and community plugins installed from within the app
- Folder vaults, or browser-local storage - see above
- RTL and full Unicode

## What does not work

- **Plugins that need real Node APIs** - spawning processes, reaching outside the vault. Plugins
  written against the mobile-safe API generally work.
- **Folder vaults** - Chromium only; Firefox and Safari do not implement the directory picker.
- **Auto-refresh on external file changes** - Chromium only; elsewhere it refreshes when the tab
  regains focus.
- **An insecure origin.** Browser storage is unavailable without `https://` (or `localhost`), and
  vault creation fails silently on a bare-IP host.

## Obsidian 1.13

**Obsidian 1.13 and newer.** Markport is pinned to 1.12.7. Starting with 1.13, Obsidian asks its
host environment for a `terms` field carrying a verbatim acknowledgement before it initialises.
The acknowledgement sits on both sides - one supplies it, the other compares against its own copy
*(illustrative, not exact)*.

**On mobile**, through Capacitor's App plugin:

```js
const ACKNOWLEDGEMENT = "I understand and agree that I am not allowed to … granted by the Obsidian team.";

// ### Platform side ###
// The string is compiled into classes.dex and served through Capacitor's App plugin
App.getInfo = () => ({
  name: 'Obsidian', id: 'md.obsidian', build: '…', version: '1.13.4',
  terms: ACKNOWLEDGEMENT,
});

// ### Client side ###
const appInfo = await App.getInfo();
Platform.build   = appInfo.build;
Platform.version = appInfo.version;

// …

if (ACKNOWLEDGEMENT !== appInfo.terms) throw new Error();
```

**On desktop**, the same value over IPC - in the same run that reads `version` and `resources`:

```js
const ACKNOWLEDGEMENT = "I understand and agree that I am not allowed to … granted by the Obsidian team.";

// ### Platform side ###
electron.ipcMain.on("terms",         e => { e.returnValue = ACKNOWLEDGEMENT }),
electron.ipcMain.on("documents-dir", e => { e.returnValue = documentsDir }),
electron.ipcMain.on("resources",     e => { e.returnValue = resourcesPath }),
electron.ipcMain.on("version",       e => { e.returnValue = appVersion }),

// ### Client side ###
Platform.version = electron.ipcRenderer.sendSync("version");
Platform.build   = electron.remote.app.getVersion();

// …

const termsFromIPC = electron.ipcRenderer.sendSync("terms");

if (ACKNOWLEDGEMENT !== termsFromIPC) return window.close();
```

## Browser support

| Capability | Chromium | Firefox | Safari |
|---|:---:|:---:|:---:|
| Vault storage - read | ✅ | ✅ | ✅ |
| Vault storage - write | ✅ | ✅ | ⚠️ |
| Folder vaults | ✅ | ❌ | ❌ |
| Auto-refresh on external change | ✅ | ❌ | ❌ |

> Chromium gives the complete experience. Safari shipped OPFS writes much later than reads -
> check your version. A secure context (`https://` or `localhost`) is required everywhere.

## There is no public instance

There is no public deployment. The code is here to demonstrate the idea. This repository does not
contain or redistribute Obsidian's bundle - if you want it, you can download it from Obsidian,
onto your own machine.

## Run it yourself

Two deployment modes.

- A fully client-side static build - any static host such as Vercel or Cloudflare Pages, or just
  a folder on your own machine.
- An optional Node.js server that stores vaults as real files on disk and pushes live updates to
  the client.

Both run the same browser-side core.

[Setup instructions →](/install)
