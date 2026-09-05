# System plugin dev guide

> How to add an Obsidian plugin that is injected automatically into every vault, through the
> overlay in `src/runtime-server/server/system-plugins.js`.
> A Hebrew version of this document is at [`docs/he/system-plugin-dev-guide.md`](he/system-plugin-dev-guide.md).

---

## What is a "system plugin"?

An ordinary Obsidian plugin that lives **in the repo, under `src/plugins/<id>/`**, instead of
inside each user's vault. The server exposes it as though it were part of every opened vault's
`.obsidian/plugins/<id>/`, and `.obsidian/community-plugins.json` appears to the app as though
the id were already registered there.

The point: the plugin is available from the first moment, to every user, with nothing to install
and without leaving anything behind in their vault.

---

## How it differs from a normal Obsidian plugin

| | Community plugin | System plugin |
|---|---|---|
| Where it lives | `<vault>/.obsidian/plugins/<id>/` | `src/plugins/<id>/` |
| Who installs it | the user, through the UI or by hand | a Markport developer, by committing it |
| `community-plugins.json` | the user controls it | always enabled; re-injected at load |
| `data.json` settings | per vault, in the vault | per vault, in the vault - a system plugin is not "global" |
| Bundling | up to you: a build (TS/Rollup) or plain JS | no build chain - plain CommonJS JS |
| Updating | plugin marketplace / GitHub release | `git pull` |

---

## Adding one, in six steps

### 1. Create a directory under `src/plugins/`

The directory name **must** equal the `id` you declare in `manifest.json`. The server does not
tolerate a mismatch.

```bash
mkdir src/plugins/markport-<name>
cd src/plugins/markport-<name>
```

**Naming:** prefix new plugins with `markport-`, so their origin is obvious and they cannot
collide with a community plugin. The one existing system plugin is still called
`obsidian-web-layout`; that id is deliberately frozen, because it is also the directory name
inside every existing vault's `.obsidian/plugins/`.

### 2. Write `manifest.json`

A standard Obsidian manifest. The `id` has to match the directory name.

```json
{
  "id": "markport-<name>",
  "name": "Markport - <Human Name>",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Short description.",
  "author": "Markport",
  "isDesktopOnly": false
}
```

Two things matter here:

- `isDesktopOnly: false`, or the mobile runtime will not load it.
- Leave out `authorUrl`, `fundingUrl` and the rest - they are meaningless for a plugin that is
  not going to the community directory.

### 3. Write `main.js` as a CommonJS module

There is no build chain. The file *is* the source.

```js
'use strict';

const obsidian = require('obsidian');

class MyPlugin extends obsidian.Plugin {
  async onload() {
    // Check that we are running inside Markport before touching anything
    // that depends on our globals. On real Obsidian, __owPlatform does not
    // exist, and the plugin should stay a no-op there.
    //
    // Caveat: __owPlatform is published at RUNTIME, by intercepting
    // Object.defineProperty as Obsidian's own bundle loads - it is not
    // injected at build time. So it can also be undefined ON Markport
    // itself, for a few seconds, while app.js is still downloading. Do not
    // gate anything that must run before the vault is up on this check alone.
    if (typeof window.__owPlatform === 'undefined') {
      console.log('[markport-<name>] not running on Markport, skipping');
      return;
    }

    this.addRibbonIcon('settings', 'My Plugin', () => {
      new obsidian.Notice('Hello from Markport');
    });

    this.addCommand({
      id: 'my-plugin:do-thing',
      name: 'Do the thing',
      callback: () => { /* ... */ },
    });
  }

  async onunload() {
    // cleanup
  }
}

module.exports = MyPlugin;
```

**What the environment gives you**

- `require('obsidian')` - Obsidian's own plugin API (`Plugin`, `Notice`, `Modal`, `Setting`,
  `TFile`, …). This is Obsidian's `require`, not Node's.
- `window.__owPlatform` - present only on Markport, so it works as feature detection. See the
  caveat in the code above: it appears at runtime, not at load, so it can be briefly undefined.
- `window.app` - the application, available after `onload`.
- `localStorage` - ordinary. The convention is to namespace keys as
  `obsidian-web:<plugin-id>:*`; that prefix is frozen for the same compatibility reason as the
  plugin id above.

**What you cannot use**

- `require('fs')` and `require('child_process')` - they do not exist in the mobile runtime.
  Use `app.vault.adapter` instead.
- Build artefacts under `src/plugins/<id>/`. `main.js` is the file itself, not a build output.

### 4. Optionally, `styles.css`

If the plugin adds UI with CSS, drop a `styles.css` in the same directory. Obsidian loads it
automatically.

### 5. There is no build or install step

`system-plugins.js` scans `src/plugins/` in `init()`, at server startup:

- **Editing `main.js`, `styles.css` or `manifest.json`:** no server restart needed. The files are
  served through `/api/fs/read` on every request, and Obsidian loads them when the vault starts.
  You do need to reload the browser.
- **Adding or removing a directory:** this does need a server restart, because `init()` only
  scans at startup.

### 6. Verify

The server listens on port 3000 by default (`PORT` overrides it).

```bash
# 1. the server sees the plugin
curl -s "http://localhost:3000/api/fs/readdir?path=.obsidian/plugins" | jq '.[].name'
# should include "markport-<name>"

# 2. the manifest is served
curl -s "http://localhost:3000/api/fs/read?path=.obsidian/plugins/markport-<name>/manifest.json"

# 3. the id appears in the virtual community-plugins.json
curl -s "http://localhost:3000/api/fs/read?path=.obsidian/community-plugins.json"
# should return an array containing "markport-<name>"

# 4. in the browser, after a reload
#    app.plugins.plugins['markport-<name>']    -> an instance of your class
#    app.plugins.manifests['markport-<name>']  -> the manifest
```

---

## The iterative loop

```bash
# 1. edit src/plugins/markport-<name>/main.js
# 2. in browser DevTools:
app.plugins.disablePlugin('markport-<name>');
app.plugins.enablePlugin('markport-<name>');
# or just reload the page.
```

**Watch out:** `disablePlugin` on a system plugin is not persistent - it comes back on reload.
That is deliberate, and annoying when you are trying to observe behaviour without the plugin.
Workaround: rename the directory temporarily and restart the server.

---

## An existing example

`src/plugins/obsidian-web-layout/` is the first system plugin and a good minimal one to copy:

- about 140 lines
- adds a ribbon icon and three commands, and hides both when `localStorage.EmulateMobile` is
  active, rather than staying visible but inert
- reads and writes `localStorage`; no `data.json` settings
- feature-detects `window.__owPlatform`

Read it before writing a new one.

---

## Planned: opt-in through a `SYSTEM_PLUGINS` env var

**Not implemented.** There is no `process.env.SYSTEM_PLUGINS` in the code today.

```bash
SYSTEM_PLUGINS=markport-layout,obsidian-livesync node index.js
```

The idea is to limit which ids from `src/plugins/` get injected - useful for a deployment that
does not want a given plugin's files present at all, rather than merely disabled. If you add a
system plugin that only suits some deployments, document that in `README.md`.
