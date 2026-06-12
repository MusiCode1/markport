/**
 * Browser shim for the `electron` module.
 *
 * Obsidian uses (from analysis of app.js):
 *   - electron.ipcRenderer.sendSync('trash', path)
 *   - electron.ipcRenderer.sendSync('is-dev')
 *   - electron.ipcRenderer.sendSync('resources') / 'frame' / 'documents-dir' / 'desktop-dir' / 'file-url'
 *   - electron.ipcRenderer.send('open-url', url)
 *   - electron.remote.shell.showItemInFolder(path)
 *   - electron.remote.dialog.showOpenDialogSync(...)         (only used for translation file picker)
 *   - electron.remote.Menu.buildFromTemplate(template)
 *   - electron.remote.session.fromPartition(...)             (webview)
 *   - electron.remote.webContents.fromId(...)                (webview)
 *   - electron.remote.nativeTheme.removeAllListeners('updated')
 *   - electron.webFrame.getZoomLevel / setZoomLevel
 *
 * We implement the minimum needed to boot and edit notes; the rest
 * are stubs that log so we can spot uses we missed.
 */
(function (global) {
  // ---- Clipboard image cache ------------------------------------------
  //
  // electron.clipboard.readImage() must return a NativeImage synchronously.
  // The browser Clipboard API is async and blocked on plain HTTP anyway,
  // so instead we intercept the native 'paste' DOM event (which fires before
  // Obsidian's handler) and cache any image payload. readImage() returns the
  // last cached image so Obsidian's paste handler gets real pixel data.
  //
  // The cache is overwritten on every paste that contains an image and cleared
  // when Obsidian reads it (to avoid stale images showing up on text pastes).

  let _clipboardImageCache = null; // { data: Uint8Array, mime: string } | null

  document.addEventListener('paste', function (ev) {
    const items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = function () {
          _clipboardImageCache = {
            data: new Uint8Array(reader.result),
            mime: item.type,
          };
        };
        reader.readAsArrayBuffer(file);
        break; // only need the first image
      }
    }
  }, true); // capture phase so we run before Obsidian's listeners

  function _makeNativeImage(cached) {
    // Minimal NativeImage shim. Obsidian calls isEmpty() then toPNG() / toBuffer().
    const empty = !cached;
    return {
      isEmpty:    () => empty,
      toPNG:      () => (cached ? cached.data : new Uint8Array(0)),
      toJPEG:     () => (cached ? cached.data : new Uint8Array(0)),
      toBuffer:   () => (cached ? cached.data : new Uint8Array(0)),
      toBitmap:   () => (cached ? cached.data : new Uint8Array(0)),
      toDataURL:  () => {
        if (!cached) return '';
        let binary = '';
        for (let i = 0; i < cached.data.length; i++) binary += String.fromCharCode(cached.data[i]);
        return 'data:' + cached.mime + ';base64,' + btoa(binary);
      },
      getSize:    () => ({ width: 0, height: 0 }),
      resize:     function () { return this; },
      crop:       function () { return this; },
    };
  }

  // Save a reference to the real window.open BEFORE Obsidian patches it.
  // Obsidian overrides window.open to route URLs through its own link handler,
  // which calls ipcRenderer.send('open-url', ...) — so if our 'open-url'
  // handler calls window.open, we get infinite recursion. Using this saved
  // reference bypasses Obsidian's patch and opens a real new tab.
  const _nativeWindowOpen = window.open.bind(window);

  function warnUnimplemented(name) {
    return function () {
      console.warn('[obsidian-web] electron.' + name + ' called but not implemented:', arguments);
      return null;
    };
  }

  // Zoom level tracked at module scope so webContents and webFrame agree.
  let zoomLevel = 0;

  // ---- Menu (Electron native menu replacement) -------------------------
  //
  // Obsidian uses electron.remote.Menu to build context menus and the app
  // menu. The DOM-based context menus that the user actually sees are
  // rendered by Obsidian itself separately. We only need to provide an
  // EventEmitter-shaped object that emits 'menu-will-close' when the
  // popup is dismissed, since Obsidian listens for that to clean up.

  // Currently-open native menu DOM node, if any. Click anywhere else
  // closes it.
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
      // styled menus; this fallback is for the rare cases it actually
      // calls electron.remote.Menu.buildFromTemplate(...).popup().
      if (openMenuEl) openMenuEl.remove();
      const el = document.createElement('div');
      el.className = 'menu mod-context';
      el.style.position = 'fixed';
      el.style.zIndex = '99999';
      const x = (opts && opts.x) || 0;
      const y = (opts && opts.y) || 0;
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

  // Build a fake BrowserWindow / webContents pair. Obsidian asks for many
  // methods on these; rather than enumerate every one, we generate stubs
  // on access and log what gets called so we can spot real needs.
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
      session: { webRequest: { onBeforeRequest: () => {}, onBeforeSendHeaders: () => {} } },
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
        // Methods returning constants - check our table.
        if (Object.prototype.hasOwnProperty.call(windowMethodReturns, prop)) {
          const v = windowMethodReturns[prop];
          return typeof v === 'function' ? v : (() => v);
        }
        // Default: a no-op function so chained calls don't crash.
        return () => {};
      },
    });
    return win;
  }
  const webContentsInstance = makeWebContents();

  // ---- ipcRenderer ------------------------------------------------------

  const ipcListeners = new Map();

  // Channels that take no args and return a value via GET /api/electron/<channel>.
  const SIMPLE_GET_CHANNELS = new Set([
    'is-dev', 'is-quitting', 'resources', 'frame',
    'documents-dir', 'desktop-dir', 'version',
    'vault', 'vault-list', 'sandbox', 'starter', 'help',
    'update', 'check-update', 'disable-update', 'insider-build',
    'cli', 'disable-gpu', 'adblock-lists', 'adblock-frequency',
    'get-icon', 'get-sandbox-vault-path', 'get-documents-path',
  ]);

  const ipcRenderer = {
    sendSync(channel, ...args) {
      const vaultId = global.__obsidianWeb && global.__obsidianWeb.vaultId;
      const vaultSuffix = vaultId ? '?vault=' + encodeURIComponent(vaultId) : '';

      // Special-cased channels that need args or non-GET semantics.
      if (channel === 'file-url') {
        // Include the vault ID so the server can resolve the path correctly.
        const vaultParam = vaultId ? '&vault=' + encodeURIComponent(vaultId) : '';
        return global.__owSyncJson('GET', '/api/electron/file-url?path=' + encodeURIComponent(args[0] || '') + vaultParam).value;
      }
      if (channel === 'trash') {
        return global.__owSyncJson('POST', '/api/electron/trash', { path: args[0], vault: vaultId }).ok || false;
      }
      if (channel === 'set-icon') {
        return global.__owSyncJson('POST', '/api/electron/set-icon', { name: args[0], data: args[1] }).value;
      }
      if (channel === 'vault-open') {
        const result = global.__owSyncJson('POST', '/api/vaults/open', { path: args[0], create: args[1] === true });
        if (!result.ok) return result.error || false;
        localStorage.setItem('obsidian-web:lastVaultId', result.id);
        setTimeout(() => { location.href = '/?vault=' + encodeURIComponent(result.id); }, 0);
        return true;
      }
      if (channel === 'vault-remove') {
        return global.__owSyncJson('POST', '/api/vaults/remove', { path: args[0] }).value;
      }
      if (channel === 'vault-move') {
        return global.__owSyncJson('POST', '/api/vaults/move', { oldPath: args[0], newPath: args[1] }).value;
      }

      // Generic GET-no-args channels — serve from bootstrap cache if available.
      if (SIMPLE_GET_CHANNELS.has(channel)) {
        const bootstrapElectron = global.__owBootstrapCache && global.__owBootstrapCache.electron;
        if (bootstrapElectron && Object.prototype.hasOwnProperty.call(bootstrapElectron, channel)) {
          return bootstrapElectron[channel];
        }
        try {
          return global.__owSyncJson('GET', '/api/electron/' + channel + vaultSuffix).value;
        } catch (err) {
          console.warn('[obsidian-web] sendSync(' + channel + ') failed:', err.message);
          return null;
        }
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
      // Use _nativeWindowOpen (saved before Obsidian patches window.open)
      // to avoid the infinite recursion: Obsidian's patched window.open
      // routes back through ipcRenderer.send('open-url', ...).
      if (channel === 'open-url' && args[0]) {
        _nativeWindowOpen(args[0], '_blank', 'noopener');
        return;
      }

      // 'open-window' / 'move-to-window': Obsidian requests that the current
      // pane or vault open in a new Electron window. We can't create a full
      // second Obsidian instance, but we can open a new browser tab pointing
      // at the same vault so the user at least gets a second view.
      if (channel === 'open-window' || channel === 'move-to-window' || channel === 'new-window') {
        const params = new URLSearchParams(location.search);
        const vaultId = params.get('vault') || (global.__obsidianWeb && global.__obsidianWeb.vaultId);
        const url = vaultId
          ? location.origin + '/?vault=' + encodeURIComponent(vaultId)
          : location.origin + '/';
        _nativeWindowOpen(url, '_blank', 'noopener');
        return;
      }

      // 'open-vault-manager' / 'open-vault-picker': Obsidian wants to show the
      // vault switcher UI. Open our /starter page in a new tab.
      if (
        channel === 'open-vault-manager' ||
        channel === 'open-vault-picker' ||
        channel === 'manage-vaults'
      ) {
        _nativeWindowOpen(location.origin + '/starter', '_blank', 'noopener');
        return;
      }

      // Application-menu IPC channels - ignored on web. Obsidian renders
      // its own DOM menus separately; the Electron menu bar isn't visible.
      if (
        channel === 'set-menu' ||
        channel === 'update-menu-items' ||
        channel === 'render-menu' ||
        channel === 'context-menu'
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
      const wrapper = (...a) => { this.off(channel, wrapper); fn(...a); };
      // bind correctly to the ipcRenderer object so `this` resolves
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
      // "Show in folder" — open the file directly in a new tab since we can't
      // launch a native file manager. Strips the virtual /vault/ prefix and
      // maps to /api/fs/read so the browser can display or download the asset.
      showItemInFolder: (filePath) => {
        const rel = (filePath || '').replace(/^\/vault\//, '').replace(/^\/+/, '');
        const vaultId = global.__obsidianWeb && global.__obsidianWeb.vaultId;
        const vaultParam = vaultId ? '&vault=' + encodeURIComponent(vaultId) : '';
        _nativeWindowOpen('/api/fs/read?path=' + encodeURIComponent(rel) + vaultParam, '_blank', 'noopener');
      },
      openExternal: (url) => { _nativeWindowOpen(url, '_blank', 'noopener'); return Promise.resolve(); },
      // "Open path" — same as showItemInFolder for vault files; for anything
      // else treat it like openExternal.
      openPath: (filePath) => {
        if ((filePath || '').startsWith('/vault/') || (filePath || '').startsWith('vault/')) {
          const rel = (filePath || '').replace(/^\/vault\//, '').replace(/^\/+/, '');
          const vaultId = global.__obsidianWeb && global.__obsidianWeb.vaultId;
          const vaultParam = vaultId ? '&vault=' + encodeURIComponent(vaultId) : '';
          _nativeWindowOpen('/api/fs/read?path=' + encodeURIComponent(rel) + vaultParam, '_blank', 'noopener');
        } else {
          _nativeWindowOpen(filePath, '_blank', 'noopener');
        }
        return Promise.resolve('');
      },
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
      fromId: () => null,
      getFocusedWebContents: () => null,
    },
    // safeStorage: Electron's credential encryption API (used for keychain).
    //
    // Problem: In real Electron, encryptString() returns a Buffer (binary).
    // Obsidian may store it by first doing Buffer.from(result, 'base64'), so
    // any non-base64-safe tag in our return value gets corrupted on the
    // round-trip. Previous fix ('OW:' prefix) broke because ':' is not a
    // valid base64 character.
    //
    // Solution: Store the actual secret server-side (in .keychain.json via
    // the /api/keytar endpoint, using synchronous XHR so encryptString stays
    // synchronous). Return a token that is the base64 encoding of 'ow:' + id.
    //
    //   encryptString('secret') → stores secret, returns btoa('ow:abc123...')
    //     e.g. 'b3c6YWJj...'
    //
    // The token survives EITHER storage path:
    //   • String path: stored/retrieved as 'b3c6YWJj...' → atob() → 'ow:id' → lookup ✓
    //   • Buffer path: Buffer.from('b3c6YWJj...', 'base64') → Uint8Array of
    //     'ow:id' bytes → TextDecoder → 'ow:id' → lookup ✓
    safeStorage: {
      isEncryptionAvailable() { return true; },
      encryptString(text) {
        // Generate a random 18-char hex ID
        const rnd = new Uint8Array(9);
        crypto.getRandomValues(rnd);
        const id = Array.from(rnd).map(b => b.toString(16).padStart(2, '0')).join('');
        // Persist secret server-side via synchronous XHR
        try {
          global.__owSyncJson('PUT', '/api/keytar', {
            service: '__safeStorage__',
            account: id,
            password: text,
          });
        } catch (e) {
          console.warn('[obsidian-web] safeStorage.encryptString: store failed:', e.message);
        }
        // Return base64 of 'ow:' + id  — this is a valid base64 string that
        // decodes back to the marker string whether Obsidian treats it as a
        // plain string or decodes it as base64 first.
        const marker = 'ow:' + id;
        return btoa(String.fromCharCode(...new TextEncoder().encode(marker)));
      },
      decryptString(buf) {
        // Recover the 'ow:id' marker regardless of whether buf arrived as a
        // plain string (Obsidian stored token as-is) or Uint8Array (Obsidian
        // did Buffer.from(token, 'base64') before storing).
        let marker;
        if (typeof buf !== 'string') {
          marker = new TextDecoder().decode(buf);
        } else {
          try { marker = atob(buf); } catch (_) { marker = buf; }
        }

        // Current token format: marker = 'ow:' + id
        if (marker && marker.startsWith('ow:')) {
          const id = marker.slice(3);
          try {
            const url = '/api/keytar?service=' + encodeURIComponent('__safeStorage__')
                      + '&account=' + encodeURIComponent(id);
            const result = global.__owSyncJson('GET', url);
            if (result && result.password != null) return result.password;
          } catch (e) {
            if (!e.status || e.status !== 404) {
              console.warn('[obsidian-web] safeStorage.decryptString: lookup failed:', e.message);
            }
          }
        }

        // Legacy: old 'OW:' tagged base64 format (previous implementation)
        const s = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
        if (s.startsWith('OW:')) {
          try {
            const bin = atob(s.slice(3));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder().decode(bytes);
          } catch (_) {}
        }

        // Legacy: old comma-separated numbers from Uint8Array.toString()
        if (typeof buf === 'string' && /^\d+(,\d+)*$/.test(buf)) {
          try {
            return new TextDecoder().decode(new Uint8Array(buf.split(',').map(Number)));
          } catch (_) {}
        }

        // Last resort: return as-is
        return s;
      },
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
    app: {
      getPath: (name) => '/' + name,
      getVersion: () => '1.12.7',
      getName: () => 'Obsidian',
      // Returns the OS UI locale. Used by sticky-heading, Dataview, and others
      // for date/number formatting. We derive it from the browser's language.
      getLocale: () => (navigator.language || 'en').split('-')[0],
      getSystemLocale: () => navigator.language || 'en',
    },
    getCurrentWindow: makeWindow,
    getCurrentWebContents: () => webContentsInstance,
    BrowserWindow: function () { return makeWindow(); },
    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text),
      readText: () => navigator.clipboard.readText(),
      // Returns the image that was most recently pasted (captured via the DOM
      // paste event above). Clears the cache so a subsequent text paste doesn't
      // accidentally return a stale image.
      readImage: () => {
        const cached = _clipboardImageCache;
        _clipboardImageCache = null;
        return _makeNativeImage(cached);
      },
      // Returns the MIME types currently on the clipboard. Obsidian checks this
      // to decide whether a paste contains an image. Report 'image/png' when
      // our cache is populated (i.e. the user just pasted an image).
      availableFormats: () => (_clipboardImageCache ? ['image/png'] : []),
      hasImage: () => !!_clipboardImageCache,
      writeImage: () => {},
    },
  };
  remote.BrowserWindow.getFocusedWindow = () => makeWindow();
  remote.BrowserWindow.getAllWindows = () => [makeWindow()];
  remote.BrowserWindow.fromWebContents = () => makeWindow();

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

  // ---- module export ---------------------------------------------------

  global.__owElectron = {
    ipcRenderer,
    remote,
    webFrame,
    shell: remote.shell,
    clipboard: remote.clipboard,
  };
})(window);
