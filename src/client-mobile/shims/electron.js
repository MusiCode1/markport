/**
 * Browser shim for the `electron` module — desktop-layout runtime.
 *
 * Seeded from `archive/desktop-runtime:src/client/shims/electron.js`
 * (docs/plans/electron-shim-foundation.md §3.1) and heavily reworked for a
 * client-only deployment (no Node server on the other end of a sync-XHR) and
 * for `Platform.isDesktopApp` actually being turned on (docs/plans/
 * desktop-layout-now.md).
 *
 * Two exposure points, both required (§3.1):
 *   - `window.electron`               — 16 direct global accesses in app.js
 *   - `require('electron')`           — 22 `En(function(e){...})` call sites,
 *                                        wired via boot.js's `modules` map
 *                                        (this file only sets the global;
 *                                        boot.js does the require() wiring)
 *
 * Obsidian uses (from analysis of app.js — see docs/plans/
 * electron-shim-foundation.md §3.1/§3.2 and desktop-shell-shim.md §2 for the
 * full call-site inventory):
 *   - electron.ipcRenderer.sendSync(<23 channels>) — see CHANNEL ANSWERS below
 *   - electron.ipcRenderer.send(<7 channels>) — menu channels + open-url +
 *     request-url + create-browser-session/check-update/insider-build
 *   - electron.remote.shell.showItemInFolder(path)
 *   - electron.remote.dialog.showOpenDialogSync(...)
 *   - electron.remote.Menu.buildFromTemplate(template).popup(opts)
 *   - electron.remote.systemPreferences.{getUserDefault,getMediaAccessStatus}
 *   - electron.remote.app.{relaunch,quit,getPath,getVersion,getName,getLocale}
 *   - electron.remote.safeStorage.* (SecretStorage's desktop backend)
 *   - electron.remote.getCurrentWindow() / getCurrentWebContents()
 *   - electron.remote.clipboard.{writeText,readText}
 *   - electron.nativeImage.createFromBuffer(...) + clipboard.writeImage(...)
 *     (Web Viewer's "copy image" — NOT gated on isDesktopApp, reachable even
 *     in mobile layout; see docs/plans/electron-shim-foundation.md §3.1 #6)
 *   - electron.webFrame.getZoomLevel / setZoomLevel
 *
 * We implement the minimum needed to boot, edit notes, and drive the desktop
 * layout's vault-switching/menu/window-chrome paths; the rest are stubs that
 * log so we can spot uses we missed.
 */
(function (global) {
  'use strict';

  function warnUnimplemented(name) {
    return function () {
      console.warn('[obsidian-web] electron.' + name + ' called but not implemented:', arguments);
      return null;
    };
  }

  // Zoom level tracked at module scope so webContents and webFrame agree.
  let zoomLevel = 0;

  // ── last known pointer position — §5ד ───────────────────────────────────
  // Real Electron's Menu.popup() defaults to the current cursor position
  // when opts.x/opts.y are omitted. Measured (docs/plans/
  // desktop-layout-now.md §5ד): BOTH call sites in this bundle that open a
  // native menu pass only `{window}` — no x/y — so without this, every
  // native-menu popup would render pinned to (0,0) instead of near the
  // click. Tracked on mousedown/contextmenu (capture) so it's populated
  // before any click handler that might open a menu synchronously.
  const lastPointer = { x: 0, y: 0 };
  ['mousedown', 'contextmenu'].forEach((evt) => {
    document.addEventListener(evt, (ev) => {
      if (typeof ev.clientX === 'number') lastPointer.x = ev.clientX;
      if (typeof ev.clientY === 'number') lastPointer.y = ev.clientY;
    }, true);
  });

  // ---- Menu (Electron native menu replacement) -------------------------
  //
  // Obsidian uses electron.remote.Menu to build context menus and the app
  // menu. The DOM-based context menus that the user actually sees most of
  // the time are rendered by Obsidian itself separately (useNativeMenu is
  // false by default on Linux — docs/plans/desktop-layout-now.md §5). This
  // IS exercised when useNativeMenu is on, or for the app-menu-less desktop
  // chrome — we only need to provide an EventEmitter-shaped object that
  // emits 'menu-will-close' when the popup is dismissed, since Obsidian
  // listens for that to clean up.

  // Currently-open native menu DOM node, if any. Click anywhere else closes it.
  let openMenuEl = null;
  document.addEventListener('mousedown', (ev) => {
    if (openMenuEl && !openMenuEl.contains(ev.target)) {
      const m = openMenuEl;
      openMenuEl = null;
      m.dispatchEvent(new CustomEvent('menu-will-close'));
      m.remove();
    }
  }, true);

  function makeMenu(template) {
    const handlers = { 'menu-will-close': new Set() };
    const items = Array.isArray(template) ? template : [];

    function emit(eventName, ...args) {
      for (const fn of handlers[eventName] || []) {
        try { fn(...args); } catch (e) { console.error('[menu] handler error:', e); }
      }
    }

    function ensureHandlerSet(name) {
      if (!handlers[name]) handlers[name] = new Set();
      return handlers[name];
    }

    function popup(opts) {
      // Render a simple DOM context menu. Obsidian also renders its own
      // styled menus; this fallback is for the cases it actually calls
      // electron.remote.Menu.buildFromTemplate(...).popup() — see
      // docs/plans/desktop-layout-now.md §5/§5ד.
      if (openMenuEl) openMenuEl.remove();
      const el = document.createElement('div');
      el.className = 'menu mod-context';
      el.style.position = 'fixed';
      el.style.zIndex = '99999';
      // §5ד: opts.x/opts.y are NOT passed by either call site in this
      // bundle (both pass only {window}) — fall back to the last known
      // pointer position, matching real Electron's own default behavior,
      // instead of silently pinning to (0,0).
      const x = (opts && typeof opts.x === 'number') ? opts.x : lastPointer.x;
      const y = (opts && typeof opts.y === 'number') ? opts.y : lastPointer.y;
      el.style.left = x + 'px';
      el.style.top = y + 'px';

      for (const it of items) {
        if (it.type === 'separator') {
          const sep = document.createElement('div');
          sep.className = 'menu-separator';
          el.appendChild(sep);
          continue;
        }
        if (it.visible === false) continue;
        const row = document.createElement('div');
        row.className = 'menu-item' + (it.enabled === false ? ' is-disabled' : '');
        row.textContent = it.label || '';
        row.addEventListener('click', () => {
          if (typeof it.click === 'function') {
            try { it.click(); } catch (e) { console.error(e); }
          }
          if (openMenuEl === el) {
            openMenuEl = null;
            emit('menu-will-close');
            el.remove();
          }
        });
        el.appendChild(row);
      }
      document.body.appendChild(el);
      openMenuEl = el;
    }

    function closePopup() {
      if (openMenuEl) {
        const m = openMenuEl;
        openMenuEl = null;
        emit('menu-will-close');
        m.remove();
      }
    }

    const menu = {
      items,
      popup,
      closePopup,
      append: (item) => items.push(item),
      insert: (idx, item) => items.splice(idx, 0, item),
      on(eventName, fn) {
        ensureHandlerSet(eventName).add(fn);
        return menu;
      },
      off(eventName, fn) {
        if (handlers[eventName]) handlers[eventName].delete(fn);
        return menu;
      },
      addListener(e, f) { return menu.on(e, f); },
      removeListener(e, f) { return menu.off(e, f); },
      removeAllListeners(eventName) {
        if (eventName && handlers[eventName]) handlers[eventName].clear();
        else for (const k in handlers) handlers[k].clear();
        return menu;
      },
      once(eventName, fn) {
        const wrap = (...args) => {
          handlers[eventName].delete(wrap);
          fn(...args);
        };
        ensureHandlerSet(eventName).add(wrap);
        return menu;
      },
      emit,
    };
    return menu;
  }

  // ── BrowserWindow / webContents stubs — §5ב/§5ג ─────────────────────────
  //
  // §5ג (measured — a prior claim here was wrong and killed a spike run):
  // `makeWindow()` must NOT be a "sweeping" Proxy whose default branch makes
  // EVERY unknown access truthy — a guard like `if (win.someFlag)` for a
  // flag we never measured would then incorrectly take the "supported"
  // branch and crash deeper in electron-only code we don't implement. The
  // fix is not "no Proxy" (foundation explicitly permits exactly one here,
  // and this object's API surface is open-ended enough that SOME fallback
  // is required — §5ב "must be tolerant: any unrecognized method → a
  // type-appropriate no-op, never undefined, never a throw") — the fix is
  // that every property we DO know about (booleans, numbers, objects) is an
  // explicit, correctly-typed table entry, so it never falls through to the
  // generic fallback; the fallback itself stays a plain no-op FUNCTION
  // (BrowserWindow's surface is overwhelmingly methods), which is what a
  // caller invoking an unknown method expects, not what a caller reading an
  // unknown boolean FLAG would expect. The double-click-titlebar bug that
  // originally exposed this (§5ג) was never actually about this Proxy's
  // default branch — `isMaximizable` IS in the explicit table below — it
  // was `remote.systemPreferences` being entirely missing. That's fixed
  // below by actually providing it, not by removing the Proxy.
  const windowMethodReturns = {
    isMaximized: false,
    isMinimized: false,
    isFullScreen: false,
    isFullScreenable: true,
    isFocused: true,
    isVisible: true,
    isAlwaysOnTop: false,
    isMaximizable: true,
    isMinimizable: true,
    isClosable: true,
    isResizable: true,
    isMovable: true,
    isModal: false,
    isKiosk: false,
    isMenuBarVisible: false,
    isMenuBarAutoHide: false,
    isDocumentEdited: false,
    isSimpleFullScreen: false,
    isHiddenInMissionControl: false,
    getTitle: '',
    getBounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    getContentBounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    getNormalBounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    getSize: [window.innerWidth, window.innerHeight],
    getContentSize: [window.innerWidth, window.innerHeight],
    getPosition: [0, 0],
    getOpacity: 1,
    getNativeWindowHandle: new Uint8Array(8),
  };

  // §5ב — measured via alias (`var w = this.win.electronWindow`) call sites
  // that a plain grep on the literal token missed: these are STATEFUL
  // (maximize/minimize/restore actually flip the flags the getters report,
  // so a caller that does `maximize(); isMaximized()` sees a consistent
  // story) rather than pure no-ops, since the double-click-titlebar handler
  // (§5ג) reads isMaximized() right after calling maximize()/unmaximize().
  const winState = { maximized: false, minimized: false, alwaysOnTop: false };
  const windowStatefulMethods = {
    maximize: () => { winState.maximized = true; winState.minimized = false; },
    unmaximize: () => { winState.maximized = false; },
    minimize: () => { winState.minimized = true; },
    restore: () => { winState.minimized = false; },
    show: () => { winState.minimized = false; },
    setAlwaysOnTop: (v) => { winState.alwaysOnTop = !!v; },
    isAlwaysOnTop: () => winState.alwaysOnTop,
  };

  function makeWebContents() {
    const wc = {
      id: 1,
      executeJavaScript: () => Promise.resolve(),
      on: () => {},
      off: () => {},
      once: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
      send: () => {},
      sendSync: () => null,
      getZoomFactor: () => 1 + zoomLevel * 0.1,
      setZoomFactor: (f) => { zoomLevel = (f - 1) * 10; },
      getZoomLevel: () => zoomLevel,
      setZoomLevel: (l) => { zoomLevel = l; },
      isDestroyed: () => false,
      isLoading: () => false,
      isFocused: () => true,
      focus: () => {},
      reload: () => location.reload(),
      reloadIgnoringCache: () => location.reload(),
      openDevTools: () => {},
      closeDevTools: () => {},
      isDevToolsOpened: () => false,
      undo: () => document.execCommand('undo'),
      redo: () => document.execCommand('redo'),
      cut: () => document.execCommand('cut'),
      copy: () => document.execCommand('copy'),
      paste: () => document.execCommand('paste'),
      pasteAndMatchStyle: () => document.execCommand('paste'),
      selectAll: () => document.execCommand('selectAll'),
      delete: () => document.execCommand('delete'),
      print: () => window.print(),
      printToPDF: () => Promise.resolve(new Uint8Array(0)),
      capturePage: () => Promise.resolve({ toPNG: () => new Uint8Array(0) }),
      // §3.1 change #4 (spellchecker): getCurrentWebContents().session needs
      // availableSpellCheckerLanguages (an Array — enhance.js polyfills
      // Array.prototype.contains) + setSpellCheckerLanguages, or
      // updateOptions() throws on `n.contains` in the desktop layout
      // (bn.isDesktopApp && !Ie && Bn(...) — Bn() reads exactly this path).
      session: {
        availableSpellCheckerLanguages: [],
        setSpellCheckerLanguages: () => {},
        webRequest: { onBeforeRequest: () => {}, onBeforeSendHeaders: () => {} },
      },
      setWindowOpenHandler: () => {},
    };
    return wc;
  }

  function makeWindow() {
    const win = new Proxy({}, {
      get(_, prop) {
        if (prop === 'webContents') return webContentsInstance;
        if (prop === 'id') return 1;
        if (prop === 'focusTime') return Date.now();
        if (Object.prototype.hasOwnProperty.call(windowStatefulMethods, prop)) {
          return windowStatefulMethods[prop];
        }
        if (prop === 'isMaximized') return () => winState.maximized;
        if (prop === 'isMinimized') return () => winState.minimized;
        // Methods returning constants - check our (correctly-typed) table.
        if (Object.prototype.hasOwnProperty.call(windowMethodReturns, prop)) {
          const v = windowMethodReturns[prop];
          return typeof v === 'function' ? v : (() => v);
        }
        // Default: a no-op function so unmeasured method calls don't crash —
        // see the big comment above windowMethodReturns for why this stays
        // a function (not a blanket "truthy" default) and why that's safe.
        return () => {};
      },
    });
    return win;
  }
  const webContentsInstance = makeWebContents();

  // ── main-window instance — §10א (fix round after calev NO-GO) ──────────
  // A SINGLE instance, not a factory: `window.electronWindow` and
  // `electron.remote.getCurrentWindow()` must be the SAME object, so any
  // identity comparison in the bundle (or a caller that stashes the
  // reference and later checks `win === electronWindow`) sees one
  // consistent window, matching real Electron's single BrowserWindow for
  // the main renderer. Measured (docs/plans/desktop-layout-now.md §10א):
  // §5ב's claim that "the bundle sets window.electronWindow itself via
  // remote.getCurrentWindow()" was wrong — that assignment (`v$`) only
  // runs for CHILD windows (popout / print-preview); the main window's own
  // `window.electronWindow` is never set by anything in app.js, and is
  // instead expected to already exist before app.js runs (in real
  // Electron, a preload script does this). `WorkspaceRoot.prototype.focus`
  // reads `this.win.electronWindow` — and for the main window `this.win
  // === window` — so without this, any call into `openFile`/`revealLeaf`/
  // `setActiveLeaf(...,{focus:true})` while `document.hasFocus()===false`
  // throws `TypeError: Cannot read properties of undefined (reading
  // 'isMinimized')`. See global.electronWindow assignment at the bottom of
  // this file for where it's actually wired onto `window`.
  const mainWindowInstance = makeWindow();

  // ---- ipcRenderer ------------------------------------------------------

  const ipcListeners = new Map();

  // ── sendSync — 23 channels, a bought answer for every one (docs/plans/
  // electron-shim-foundation.md §3.2) — `is-dev` and `version` run on EVERY
  // boot (top-level `En(...)`), so `warnUnimplemented`'s console.warn is
  // reserved for channels genuinely NOT in this table.
  //
  // Seven of these are ALSO setters, per the args[0]==null rule (loose
  // equality — catches null AND undefined, but not `false`/`0`, both of
  // which are legitimate write values): frame, disable-update, disable-gpu,
  // adblock-lists, adblock-frequency, insider-build, cli. Writes persist to
  // localStorage under our own namespace and the setter returns the value
  // that was written (two call sites consume the write's return value).
  //
  // `frame` is the ONE explicit exception (docs/plans/desktop-layout-now.md
  // §5א — an explicit override of the design in electron-shim-foundation.md
  // §3.2, which said 'hidden'): its GETTER always answers 'native',
  // regardless of anything ever written through the Settings → Appearance
  // "Frame style" dropdown, because the read that matters is the ONE that
  // gates whether the bundle builds a fake DOM titlebar at window
  // construction (`"native"!==t && (e.frameDom=new Ix(...))`) — any other
  // answer means a fake titlebar layered on top of the real browser chrome.
  // Do not "fix" this to reflect the Settings dropdown's last write.
  const SETTER_CHANNELS = {
    'disable-update': { key: 'ow-electron:disable-update', default: true },
    'disable-gpu': { key: 'ow-electron:disable-gpu', default: false },
    'adblock-lists': { key: 'ow-electron:adblock-lists', default: [] },
    'adblock-frequency': { key: 'ow-electron:adblock-frequency', default: 0 },
    'insider-build': { key: 'ow-electron:insider-build', default: false },
    'cli': { key: 'ow-electron:cli', default: null },
  };

  function readSetting(entry) {
    const raw = localStorage.getItem(entry.key);
    if (raw === null) return entry.default;
    try { return JSON.parse(raw); } catch (e) { return entry.default; }
  }
  function writeSetting(entry, value) {
    localStorage.setItem(entry.key, JSON.stringify(value));
    return value;
  }

  // Plain GET-only channels (no write call site in this bundle) with a
  // fixed, bought answer.
  const GET_CHANNEL_VALUES = {
    'is-dev': false,
    'is-quitting': false,
    'resources': '',
    'documents-dir': '/documents',
    'desktop-dir': '/desktop',
    'sandbox': false,
    'update': null,
    'check-update': null,
    'get-icon': null,
    'get-sandbox-vault-path': '',
    'get-documents-path': '/documents',
  };

  const ipcRenderer = {
    sendSync(channel, ...args) {
      // §5א — see the big comment above SETTER_CHANNELS. Always 'native',
      // never derived from a write.
      if (channel === 'frame') return 'native';

      // version — read LAZILY (inside this handler, not at module-eval
      // time) from window.__owObsidianVersion, the single source of truth
      // (docs/plans/electron-shim-foundation.md §3.0). This is what the
      // top-level `En(function(e){ Uee = e.ipcRenderer.sendSync("version") })`
      // overwrites Obsidian's own valid default with — it must never be
      // empty/undefined, or `requireApiVersion` breaks silently for every
      // community plugin.
      if (channel === 'version') return window.__owObsidianVersion || '1.12.7';

      // relaunch — a distinct, simpler mechanism than remote.app.relaunch
      // (§5ג below); the only sane web equivalent of either is a reload.
      if (channel === 'relaunch') { location.reload(); return true; }

      // file-url — one of the TWO top-level, unconditional `En(...)` calls
      // that run on every boot regardless of the flag (docs/plans/
      // electron-shim-foundation.md §3.0): `bn.resourcePathPrefix =
      // e.ipcRenderer.sendSync("file-url")`. Verified: this is the ONLY
      // assignment to resourcePathPrefix in the whole bundle, so it never
      // changes again after boot — 'file:///' is what it already defaults
      // to, i.e. answering this is a NO-OP relative to today's behavior,
      // not a real path-resolution feature. Any other answer changes
      // resource-path resolution app-wide. Fixed answer regardless of args
      // — the archived seed's per-path proxy-to-a-Node-server (__owSyncJson)
      // doesn't apply here (no such server in this deployment).
      if (channel === 'file-url') return 'file:///';

      // set-icon — accepted, no-op (no real dock/tray icon in a browser tab).
      if (channel === 'set-icon') return null;

      // copy-asar / trash — genuinely unreachable in this deployment
      // (docs/plans/electron-shim-foundation.md §9 Q1: trash's only caller
      // sits on the desktop FileSystemAdapter, which this bundle never
      // constructs) — kept as an explicit, named no-op rather than falling
      // through to the generic "unhandled channel" warning below, so a
      // future reader knows this was measured, not missed.
      if (channel === 'copy-asar' || channel === 'trash') {
        return warnUnimplemented('ipcRenderer.sendSync(' + channel + ')')();
      }

      // ── vault / vault-list / vault-open / starter / help ────────────────
      // docs/plans/desktop-shell-shim.md §2.4 — the vault-switcher panel's
      // click handler calls these. The panel itself renders because
      // `platform-bridge.js` locks `isDesktopApp` directly (the build-time
      // patch that used to flip this one bundle check was removed outright
      // in docs/plans/zero-patches.md — zero patches remain). The
      // registry (`window.__owLocalVaults`, local-vault-registry.js) only
      // ever holds local/folder vaults — a server vault's id simply won't
      // be in it, hence `|| {}` throughout instead of letting a `null`
      // registry.get() result throw.
      if (channel === 'vault') {
        const registry = window.__owLocalVaults;
        const id = window.__owVaultId || '';
        const name = (registry && registry.get(id) || {}).name;
        const path = registry ? registry.vaultPath(id, name) : '/ow/' + id + '/' + id;
        return { path };
      }
      if (channel === 'vault-list') {
        const registry = window.__owLocalVaults;
        const out = {};
        if (registry) {
          for (const v of registry.list()) {
            out[v.id] = { path: registry.vaultPath(v.id, v.name) };
          }
        }
        return out;
      }
      if (channel === 'vault-open') {
        // §2.4 — id extraction anchors on api.vaultPath's own "/ow/<id>/<name>"
        // shape; a vault NAME may itself contain '/', so this only trusts
        // the id segment (bounded by the two slashes vaultPath always
        // emits), never splits on the rest of the string.
        const m = /^\/ow\/([^/]+)\//.exec(args[0] || '');
        if (!m) return false;
        const id = m[1];
        // Deferred one tick (mirrors the archived seed) — this is a
        // *synchronous* IPC call; navigating mid-call, before sendSync even
        // returns `true` to its caller, would abandon whatever the caller
        // still does with that return value this same turn.
        setTimeout(() => { location.href = '/vault/' + encodeURIComponent(id); }, 0);
        return true;   // ⚠️ MUST be exactly `true` — `!0!==sendSync(...)` shows an error Notice otherwise.
      }
      if (channel === 'starter') {
        location.href = '/starter';
        return null;
      }
      if (channel === 'help') {
        window.open('https://help.obsidian.md/', '_blank', 'noopener');
        return null;
      }

      if (Object.prototype.hasOwnProperty.call(SETTER_CHANNELS, channel)) {
        const entry = SETTER_CHANNELS[channel];
        if (args[0] == null) return readSetting(entry);
        return writeSetting(entry, args[0]);
      }

      if (Object.prototype.hasOwnProperty.call(GET_CHANNEL_VALUES, channel)) {
        return GET_CHANNEL_VALUES[channel];
      }

      console.warn('[obsidian-web] unhandled ipcRenderer.sendSync:', channel, args);
      window.__owMissing && window.__owMissing.record('sendSync', channel);
      return null;
    },
    send(channel, ...args) {
      // 'request-url': Obsidian uses this IPC channel to make outbound HTTP
      // requests (community plugins list, Templater templates, etc.).
      // We proxy through /api/proxy-request to avoid CORS restrictions.
      if (channel === 'request-url') {
        const [replyId, req] = args;
        if (!replyId || !req) return;

        let bodyEncoded;
        if (req.body) {
          // req.body may be a string or Uint8Array/ArrayBuffer
          try {
            const bytes = typeof req.body === 'string'
              ? new TextEncoder().encode(req.body)
              : new Uint8Array(req.body instanceof ArrayBuffer ? req.body : req.body.buffer || req.body);
            bodyEncoded = btoa(String.fromCharCode(...bytes));
          } catch (_) {
            bodyEncoded = btoa(String(req.body));
          }
        }

        fetch('/api/proxy-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: req.url,
            method: req.method || 'GET',
            headers: req.headers || {},
            contentType: req.contentType,
            body: bodyEncoded,
            binary: req.binary || false,
          }),
        })
          .then(async (res) => {
            const json = await res.json();
            if (!res.ok) {
              ipcRenderer.emit(replyId, null, { error: json.error || ('proxy error ' + res.status) });
              return;
            }
            // Decode base64 body back to ArrayBuffer
            const b64 = json.body || '';
            const bin = atob(b64);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            ipcRenderer.emit(replyId, null, {
              status: json.status,
              headers: json.headers || {},
              body: buf.buffer,
              ok: json.status >= 200 && json.status < 300,
            });
          })
          .catch((err) => {
            ipcRenderer.emit(replyId, null, { error: err.message });
          });
        return;
      }

      // 'open-url' opens in a new tab.
      if (channel === 'open-url' && args[0]) {
        window.open(args[0], '_blank', 'noopener');
        return;
      }

      // context-menu — a ROUND-TRIP channel (docs/plans/desktop-shell-shim.md
      // §2.6א), not fire-and-forget: the caller registers
      // `ipcRenderer.once('context-menu', cb)` synchronously BEFORE calling
      // `send('context-menu')` (see the bundle's own `Rn(e)`), then waits up
      // to 1000ms for that `once` to fire; a silent no-op here (the
      // archived seed's original behavior) means the wait always times out,
      // `p` stays null, and the caller returns early — the editor's
      // right-click context menu never opens, with NO console error (§2.6א:
      // "מצב-הכשל הוא 'לא קורה כלום'"). Answered in a microtask (not
      // synchronously — `once` must already be registered, which it always
      // is by the time `send` is even called, but a microtask hop keeps
      // this decoupled from that ordering guarantee, same reasoning as
      // platform-bridge.js's onAppJsSettled). Payload shape reverse-engineered
      // from the two callers (`p.webContentsId`, `p.editFlags.{canCut,
      // canCopy,canPaste}`, `p.misspelledWord`) — misspelledWord stays falsy
      // so the spellchecker-suggestions branch (out of scope) is skipped.
      if (channel === 'context-menu') {
        queueMicrotask(() => {
          ipcRenderer.emit('context-menu', {}, {
            webContentsId: webContentsInstance.id,
            editFlags: {
              canCut: true, canCopy: true, canPaste: true, canDelete: true,
              canSelectAll: true, canUndo: true, canRedo: true,
            },
            misspelledWord: '',
          });
        });
        return;
      }

      // Application-menu IPC channels + a few About-screen fire-and-forget
      // channels — ignored on web, silently and explicitly (docs/plans/
      // electron-shim-foundation.md §3.2 "ipcRenderer.send — לא היה באף
      // מלאי"): Obsidian renders its own DOM menus separately (the
      // Electron menu bar isn't visible), and create-browser-session /
      // check-update / insider-build fire on every Settings-open/About-open
      // — routing them to the generic "unhandled" warning below would spam
      // the console on ordinary use.
      if (
        channel === 'set-menu' ||
        channel === 'update-menu-items' ||
        channel === 'render-menu' ||
        channel === 'create-browser-session' ||
        channel === 'check-update' ||
        channel === 'insider-build'
      ) {
        return;
      }
      console.warn('[obsidian-web] unhandled ipcRenderer.send:', channel, args);
      window.__owMissing && window.__owMissing.record('send', channel);
    },
    on(channel, fn) {
      if (!ipcListeners.has(channel)) ipcListeners.set(channel, new Set());
      ipcListeners.get(channel).add(fn);
    },
    once(channel, fn) {
      const self = ipcRenderer;
      const w = (...a) => { self.off(channel, w); fn(...a); };
      self.on(channel, w);
    },
    off(channel, fn) {
      const set = ipcListeners.get(channel);
      if (set) set.delete(fn);
    },
    emit(channel, event, ...data) {
      const set = ipcListeners.get(channel);
      if (set) set.forEach((fn) => fn(event, ...data));
    },
    removeAllListeners(channel) {
      if (channel) ipcListeners.delete(channel);
      else ipcListeners.clear();
    },
    invoke: warnUnimplemented('ipcRenderer.invoke'),
  };

  // ---- remote stubs -----------------------------------------------------

  const remote = {
    shell: {
      showItemInFolder: warnUnimplemented('shell.showItemInFolder'),
      openExternal: (url) => { window.open(url, '_blank', 'noopener'); return Promise.resolve(); },
      openPath: warnUnimplemented('shell.openPath'),
    },
    dialog: {
      showOpenDialogSync: (opts) => {
        const props = (opts && opts.properties) || [];
        if (props.includes('openDirectory')) {
          const value = window.prompt('Enter a server folder path');
          return value ? [value] : undefined;
        }
        // File pickers are only used for translation files for now.
        return undefined;
      },
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialogSync: () => undefined,
      showMessageBoxSync: () => 0,
    },
    Menu: {
      buildFromTemplate: makeMenu,
      getApplicationMenu: () => null,
    },
    session: {
      fromPartition: () => ({ setSpellCheckerLanguages: () => {} }),
      defaultSession: { setSpellCheckerLanguages: () => {} },
    },
    webContents: {
      // fromId — docs/plans/desktop-shell-shim.md §2.6א: the editor's
      // context-menu round-trip resolves `remote.webContents.fromId(p.
      // webContentsId)` and then calls real methods on the result
      // (`.cut()`/`.copy()`/`.paste()`/`.replaceMisspelling()`) — there is
      // only ever ONE webContents in this shim (webContentsInstance),
      // matching the id (1) the context-menu response above always answers
      // with. `() => null` (the archived default) made every one of those
      // calls throw on `null.cut`.
      fromId: () => webContentsInstance,
      getFocusedWebContents: () => webContentsInstance,
    },
    nativeTheme: (function () {
      const t = {
        shouldUseDarkColors: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches,
        themeSource: 'system',
      };
      // Methods return `t` so callers can chain (.removeAllListeners().on()).
      t.addListener = () => t;
      t.removeListener = () => t;
      t.removeAllListeners = () => t;
      t.on = () => t;
      t.off = () => t;
      t.once = () => t;
      t.emit = () => false;
      return t;
    })(),
    // §5ג (measured — a prior claim that "0 consumers" was wrong): TWO real
    // consumers. getUserDefault feeds the double-click-titlebar handler
    // (gated only on win.isMaximizable, which is `true` in our table — see
    // the big comment above windowMethodReturns for why the fix is here,
    // not in the Proxy); returning null makes that handler fall through to
    // its else-branch (isMaximized()?unmaximize():maximize()), which is
    // exactly the sane default. getMediaAccessStatus feeds
    // AudioRecorder.checkPermission — macOS-only in this bundle
    // (`"macOS"===Pe` gate), but this slice is what makes it REACHABLE at
    // all (isDesktopApp was always false before) — 'granted' lets audio
    // recording proceed instead of showing a permanent "access denied"
    // message for a permission model that doesn't exist in a browser tab.
    systemPreferences: {
      getUserDefault: () => null,
      getMediaAccessStatus: () => 'granted',
      isTrustedAccessibilityClient: () => false,
    },
    // §3.1 change #2 — remote.safeStorage: 4 methods. `t1` (SecretStorage's
    // desktop backend, docs/plans/desktop-shell-shim.md §2.3) calls this in
    // its OWN constructor, so it must exist before secretStorage.load() —
    // isEncryptionAvailable()===false makes encrypt/decrypt fall through to
    // plaintext passthrough, which is exactly today's SecureStorage
    // security level (unencrypted localStorage) — not a regression.
    safeStorage: {
      isEncryptionAvailable: () => false,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: (s) => String(s),
      decryptString: (b) => String(b),
    },
    app: {
      getPath: (name) => '/' + name,
      // getVersion — read lazily, same source of truth as the ipcRenderer
      // 'version' channel above (docs/plans/electron-shim-foundation.md §3.0).
      getVersion: () => window.__owObsidianVersion || '1.12.7',
      getName: () => 'Obsidian',
      // Returns the OS UI locale. Used by sticky-heading, Dataview, and others
      // for date/number formatting. We derive it from the browser's language.
      getLocale: () => (navigator.language || 'en').split('-')[0],
      getSystemLocale: () => navigator.language || 'en',
      // §5ג — measured wrong previously ("app.quit=1 in the archive" was
      // actually the STRING literal for the 'is-quitting' ipc CHANNEL, not
      // this method — the archive has ZERO implementations of either).
      // Both About-screen "Relaunch" buttons call
      // `app.relaunch(); app.quit();` back-to-back — a single reload
      // covers the observable behavior ("does something") without a
      // double-reload; relaunch() itself is a no-op (real Electron's
      // relaunch() only SCHEDULES a restart, quit() is what actually exits).
      relaunch: () => {},
      quit: () => { location.reload(); },
    },
    // Returns the SAME instance every call — see mainWindowInstance above
    // (§10א). Popouts/print-preview (out of scope — canPopoutWindow is
    // locked false) still get fresh instances via BrowserWindow() below.
    getCurrentWindow: () => mainWindowInstance,
    getCurrentWebContents: () => webContentsInstance,
    BrowserWindow: function () { return makeWindow(); },
    clipboard: (function () {
      // Capture the NATIVE clipboard methods now, at shim-load time (this
      // runs before Obsidian's app.js boots). Obsidian later monkey-patches
      // navigator.clipboard.writeText to delegate back to
      // electron.clipboard.writeText — if we resolved navigator.clipboard
      // lazily we'd call that patched version, which calls us, looping until
      // "RangeError: Maximum call stack size exceeded". See capacitor-shim.js's
      // identical precaution for Capacitor.Plugins.Clipboard.
      const native = (typeof navigator !== 'undefined' && navigator.clipboard) || null;
      const nativeWrite = native && native.writeText ? native.writeText.bind(native) : null;
      const nativeRead = native && native.readText ? native.readText.bind(native) : null;
      return {
        writeText: (text) => nativeWrite
          ? nativeWrite(text)
          : Promise.reject(new Error('[obsidian-web] clipboard.writeText unavailable')),
        readText: () => nativeRead ? nativeRead() : Promise.resolve(''),
        // readImage — the PASTE path (docs/plans/desktop-shell-shim.md
        // §2.6ב DoD#25 — gated on isDesktopApp, unlike writeImage below).
        // Called SYNCHRONOUSLY by the bundle (`var n = t.readImage()`, no
        // await) — must return a nativeImage-shaped object directly, never
        // a Promise. A browser tab has no real OS-clipboard image API to
        // read from; an always-EMPTY image (isEmpty()===true) makes the
        // bundle's own guard skip the "paste non-text content" branch
        // gracefully instead of throwing on `undefined.createFromBuffer`-
        // shaped access.
        readImage: () => makeNativeImage(new Uint8Array(0)),
        // writeImage — the COPY path (Web Viewer's "copy image" context
        // menu item, `Hn().writeImage(i)`) — NOT gated on isDesktopApp
        // (electron-shim-foundation.md §3.1 change #6), so this must exist
        // regardless of layout. The real bytes are discarded — see
        // nativeImage.createFromBuffer below for why that's acceptable.
        writeImage: (img) => { /* accepted, discarded — see nativeImage below */ },
      };
    })(),
  };
  remote.BrowserWindow.getFocusedWindow = () => makeWindow();
  remote.BrowserWindow.getAllWindows = () => [makeWindow()];
  remote.BrowserWindow.fromWebContents = () => makeWindow();

  // ---- nativeImage --------------------------------------------------------
  // docs/plans/electron-shim-foundation.md §3.1 change #6 (measured: NOT
  // gated on isDesktopApp — Web Viewer's contextMenuItemsForImg calls
  // `electron.nativeImage.createFromBuffer(n), Hn().writeImage(i)`
  // unconditionally on "copy image", reachable in mobile layout too).
  // Without this, "Copy image" throws
  // "Cannot read properties of undefined (reading 'createFromBuffer')".
  // A minimal, correctly-shaped stub is enough — the actual bytes are
  // discarded (this deployment has no real OS clipboard image slot to put
  // them in; the browser's own image-copy path, when it exists, goes
  // through navigator.clipboard.write directly, not through here).
  function makeNativeImage(buf) {
    return {
      isEmpty: () => !buf || buf.byteLength === 0,
      toPNG: () => (buf instanceof Uint8Array ? buf : new Uint8Array(buf || 0)),
      toDataURL: () => '',
      getSize: () => ({ width: 0, height: 0 }),
    };
  }
  const nativeImage = {
    createFromBuffer: (buf) => makeNativeImage(buf),
    createFromDataURL: () => makeNativeImage(new Uint8Array(0)),
    createEmpty: () => makeNativeImage(new Uint8Array(0)),
  };

  // ---- webFrame --------------------------------------------------------

  const webFrame = {
    getZoomLevel: () => zoomLevel,
    setZoomLevel: (level) => {
      zoomLevel = level;
      document.body.style.zoom = String(1 + level * 0.1);
    },
    getZoomFactor: () => 1 + zoomLevel * 0.1,
    setZoomFactor: (f) => { zoomLevel = (f - 1) * 10; },
  };

  // ---- module export -----------------------------------------------------
  // Two exposure points (§3.1) — window.electron for the 16 direct global
  // accesses, and this same object registered as require('electron') by
  // boot.js's `modules` map (window.electron IS the object boot.js reads;
  // there is exactly one instance, never two divergent ones).
  //
  // §3.1 change #7 — the archived seed short-circuited every sendSync
  // channel through `window.__owBootstrapCache.electron` FIRST, before
  // consulting the table above. __owBootstrapCache is a LIVE production
  // symbol (populated by boot.js's server-vault bootstrap fetch — see
  // boot.js's Bootstrap-fetch block) — it has nothing to do with electron
  // channel answers and was never meant to override them. Not carried
  // forward here at all (the bought-answer table above is authoritative).

  const api = {
    ipcRenderer,
    remote,
    webFrame,
    shell: remote.shell,
    clipboard: remote.clipboard,
    nativeImage,
  };

  global.__owElectron = api;
  global.electron = api;

  // Third exposure point — §10א / DoD#14. In real Electron a preload
  // script sets `window.electronWindow` on the MAIN window before the
  // renderer's own script runs; this bundle never does it itself (see the
  // big comment above `mainWindowInstance`). Set here, synchronously, at
  // shim-load time — this file is loaded (index.html) before boot.js,
  // which is loaded before app.js, so it's in place for every consumer
  // (`this.win.electronWindow` et al.) from the first tick app.js runs.
  global.electronWindow = mainWindowInstance;
})(window);
