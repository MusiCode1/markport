/**
 * Capacitor shim for the obsidian-web mobile runtime (`/mobile`).
 *
 * Loaded before `native-bridge.js` and `obsidian-mobile/app.js`. Installs an
 * `androidBridge.postMessage` transport up front, then (after native-bridge
 * has constructed `window.Capacitor`) replaces the key entry points so that
 * all Capacitor plugin calls are served by our HTTP API + WebSocket instead
 * of a native Android process.
 *
 * THE CRITICAL DETAIL — PluginHeaders:
 *   `Capacitor.Plugins.<Name>` is a Proxy that consults `c.PluginHeaders`
 *   to find each method. WITHOUT a matching header entry, every call throws
 *   "<plugin> is not implemented on android" — long before our nativePromise
 *   is ever invoked. We therefore declare PluginHeaders for every plugin +
 *   method below. See `docs/investigations.md` → "PluginHeaders mechanism".
 *
 * PLUGIN INVENTORY (13 plugins shipped in obsidian-mobile 1.12.7 APK):
 *
 *   Real implementations (route to HTTP API):
 *     Filesystem  — readFile, writeFile, appendFile, stat, readdir, mkdir,
 *                   rmdir, rename, copy, deleteFile, trash, getUri,
 *                   startWatch, stopWatch, watchAndStatAll, addListener
 *                   (FS over /api/fs/*, watch over /api/watch WebSocket)
 *
 *   Browser-native (delegate to Web APIs):
 *     Clipboard      — navigator.clipboard.{readText,writeText}
 *     Browser        — window.open(url, '_blank', 'noopener')
 *     Preferences    — localStorage with `cap:` prefix
 *     SecureStorage  — localStorage with `sec:` prefix (NOT encrypted!)
 *
 *   Identity stubs (return realistic info):
 *     Device  — getInfo returns { platform:'android', osVersion:'12', ... }
 *     App     — getInfo returns { name:'Obsidian', version:'1.12.7', ... }
 *
 *   Noop stubs (return success, do nothing — irrelevant on web):
 *     SplashScreen, StatusBar, Keyboard, KeepAwake, Haptics, RateApp
 *
 *   App.requestUrl — real fetch() impl (slice livesync-requesturl).
 *                      Supports GET/POST/PUT, headers, body (string + binary),
 *                      always returns body as base64 (Obsidian calls atob unconditionally).
 *                      See PLAN.md → "Updated approach (2026-05-11): direct fetch + CORS".
 *
 * Vault path: read from localStorage / URL params (same mechanism as desktop).
 * All FS calls get ?vault=<id> query param so the server routes to the right vault.
 *
 * Call flow is documented inline below at the "Android bridge" comment block
 * (~line 488). See also docs/investigations.md → "Capacitor plugin inventory".
 */
(function () {
  'use strict';

  // ── Capture native clipboard BEFORE Obsidian patches it ─────────────────
  // The obsidian-mobile bundle monkey-patches `navigator.clipboard.writeText`
  // and `readText` to delegate to `Capacitor.Plugins.Clipboard.{write,read}`
  // (i.e. our shim below). If our shim then calls `navigator.clipboard.writeText`
  // back, you get an infinite Promise recursion that OOMs the renderer
  // (manifests as "Aw, Snap" / Error code 4 — looks like a full freeze).
  //
  // Bug example: clicking the file-menu → "Copy path" → "As Obsidian URL"
  // triggers `zt(url)` in app.js → `navigator.clipboard.writeText(url)` →
  // patched version calls `Clipboard.write({string})` → our shim calls
  // `navigator.clipboard.writeText` → patched version → … forever.
  //
  // Fix: capture the native methods at IIFE init (this script loads before
  // app.js, so navigator.clipboard.{writeText,readText} are still native).
  const _nativeClipboardWriteText =
    navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : null;
  const _nativeClipboardReadText =
    navigator.clipboard && navigator.clipboard.readText
      ? navigator.clipboard.readText.bind(navigator.clipboard)
      : null;

  // ── helpers ──────────────────────────────────────────────────────────────

  // base64 string → ArrayBuffer
  function base64ToArrayBuffer(b64) {
    const bin = atob(b64 || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  // ArrayBuffer → base64 (chunked — btoa blows the arg stack at ~65k)
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function getVaultId() {
    const params = new URLSearchParams(location.search);
    return params.get('vault') || localStorage.getItem('obsidian-web:lastVaultId') || '';
  }

  function vaultQuery() {
    const id = getVaultId();
    return id ? 'vault=' + encodeURIComponent(id) + '&' : '';
  }

  function encodePath(p) {
    return encodeURIComponent(p);
  }

  // Map Capacitor directory enum → path prefix for our FS API.
  // Android vault root is EXTERNAL; we map all vault-relative paths from there.
  function resolvePrefix(dir) {
    switch (dir) {
      case 'EXTERNAL':
      case 'DOCUMENTS':
        return '';                 // vault root
      case 'CACHE':
        return '.cache/';
      case 'DATA':
      case 'LIBRARY':
        return '.app-data/';
      default:
        return '';
    }
  }

  function fullPath(opts) {
    const prefix = opts.directory ? resolvePrefix(opts.directory) : '';
    let p = opts.path || '';
    // The mobile bundle uses the vault ID as its "base path" for the vault.
    // Strip it so paths resolve correctly against our HTTP API.
    const vaultId = getVaultId();
    if (vaultId) {
      if (p === vaultId) {
        p = '';                              // vault root stat/list
      } else if (p.startsWith(vaultId + '/')) {
        p = p.slice(vaultId.length + 1);    // vault-relative path
      }
    }
    return prefix + p;
  }

  function capError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  // ── opfs-ux: native vault-chooser bridge helpers ────────────────────────
  // The native `.mobile-vault-chooser-screen` (obsidian-mobile/app.js) both
  // (a) validates every entry of its vault list via Filesystem.stat(id) —
  // executor spike found this uses RAW path/id strings, not
  // {name,location,storageType} objects as originally assumed — and
  // (b) calls Filesystem.stat() again as part of register()'s open-flow
  // (both "Open folder as vault" and "Open vault" on an existing row).
  // We seed the list (boot.js's seedNativeVaultList) with '<id>/<name>'
  // strings; this recognizes either form and confirms it's one of ours.
  // Only relevant with no vault active (this bridge only matters for the
  // no-vault chooser screen — never for a real, already-open vault).
  function owResolveNativeVaultId(p) {
    if (getVaultId() || !p) return null;   // real vault active — not our bridge's business
    const slash = p.indexOf('/');
    const id = slash !== -1 ? p.slice(0, slash) : p;
    if (window.__owLocalVaults && window.__owLocalVaults.get(id)) return id;
    let known = [];
    try { known = JSON.parse(localStorage.getItem('ow-known-vault-ids') || '[]'); } catch (e) {}
    return known.indexOf(id) !== -1 ? id : null;
  }

  // ── Bootstrap cache invalidation wrappers ────────────────────────────
  // Each mutation method calls these so the in-memory cache populated by
  // boot.js stays in sync with what's on disk. No-ops when the cache is
  // empty (e.g. BOOTSTRAP_DISABLED, or before boot.js's fetch resolves).
  function invalidateCacheEntry(p) {
    if (window.__owCacheInvalidation && window.__owCacheInvalidation.invalidateCacheEntry) {
      window.__owCacheInvalidation.invalidateCacheEntry(window.__owBootstrapCache, p);
    }
  }
  function invalidateCacheSubtree(prefix) {
    if (window.__owCacheInvalidation && window.__owCacheInvalidation.invalidateCacheSubtree) {
      window.__owCacheInvalidation.invalidateCacheSubtree(window.__owBootstrapCache, prefix);
    }
  }

  // Convert our server's readdir array to Capacitor's expected format.
  function toCapacitorDirEntry(e) {
    return {
      name: e.name,
      type: e.isDirectory ? 'directory' : 'file',
      size: e.size,
      mtime: e.mtime,
      uri:   '',
      ctime: e.mtime,
    };
  }

  // ── Filesystem plugin (server vaults — HTTP /api/fs) ───────────────────
  // Renamed from `Filesystem` to `HttpFilesystem`: for local vaults the
  // `Filesystem` name below now refers to a Proxy dispatcher that routes
  // to either this object (server) or OpfsStore (local). See
  // docs/plans/opfs-wire.md §4 Commit 2.

  const HttpFilesystem = {

    async readFile(opts) {
      const p = fullPath(opts);
      const encoding = opts.encoding;   // 'utf8' | undefined (binary = base64)

      // Bootstrap cache hit — only for text reads with content cached.
      // Misses on binary reads, oversized/capped files, or post-write entries.
      if (window.__owBootstrapLookup) {
        const hit = window.__owBootstrapLookup.lookupContent(
          window.__owBootstrapCache, p, encoding,
        );
        if (hit !== null && hit !== undefined) {
          return { data: hit };
        }
      }

      const url = '/api/fs/read?' + vaultQuery() + 'path=' + encodePath(p) +
        (encoding ? '&encoding=' + encoding : '');
      const res = await fetch(url);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'ENOENT', json.error || 'readFile failed: ' + p);
      }
      if (encoding) {
        const data = await res.text();
        return { data };
      } else {
        // Binary: return base64
        const buf = await res.arrayBuffer();
        return { data: arrayBufferToBase64(buf) };
      }
    },

    async writeFile(opts) {
      const p = fullPath(opts);
      const encoding = opts.encoding;
      let body;
      let contentType = 'application/octet-stream';
      if (encoding) {
        body = opts.data;
        contentType = 'text/plain;charset=UTF-8';
      } else {
        // data is base64
        body = base64ToArrayBuffer(opts.data);
      }
      const url = '/api/fs/write?' + vaultQuery() + 'path=' + encodePath(p) +
        (encoding ? '&encoding=' + encoding : '');
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'EIO', json.error || 'writeFile failed: ' + p);
      }
      invalidateCacheEntry(p);
      return { uri: '' };
    },

    async appendFile(opts) {
      const p = fullPath(opts);
      // data is base64 (used for large binary chunk writes)
      const bin = atob(opts.data || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = '/api/fs/append?' + vaultQuery() + 'path=' + encodePath(p);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes.buffer,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'EIO', json.error || 'appendFile failed: ' + p);
      }
      invalidateCacheEntry(p);
      return {};
    },

    async deleteFile(opts) {
      const p = fullPath(opts);
      const res = await fetch('/api/fs/unlink?' + vaultQuery() + 'path=' + encodePath(p), { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'ENOENT', json.error || 'deleteFile failed: ' + p);
      }
      invalidateCacheEntry(p);
      return {};
    },

    async mkdir(opts) {
      // ── רשת-ביטחון ל"Create a vault" הנייטיב ──────────────────────────────
      // כשאין vault פעיל (window.__owVaultId ריק — boot לא פתר vault), mkdir
      // הוא ה-onCreateVault הנייטיב שיוצר את ה-vault החדש. על פריסת CF/serverless
      // אין /api/fs → הוא היה מחזיר 405; וה-DOM interceptor (boot.js) שביר על
      // פני וריאציות מסך/אירוע/timing (.mobile-onboarding מול .mobile-vault-
      // chooser-screen; pointerup מול click). כאן, ברמת ה-FS, תופסים בוודאות:
      // יוצרים OPFS vault (בשם הסגמנט האחרון של הנתיב) ומנווטים אליו. מתואם עם
      // ה-DOM interceptor דרך window.__owCreatingVault (one-shot משותף → לא כפול).
      if (!window.__owVaultId && window.__owLocalVaults && !window.__owCreatingVault) {
        window.__owCreatingVault = true;
        try {
          const raw = (opts && opts.path) || '';
          const name = raw.split('/').filter(Boolean).pop() || 'Untitled';
          const id = window.__owLocalVaults.create(name).id;   // OPFS (type ברירת-מחדל 'local')
          // path-based routing (slice url-routing): boot מתעלם מ-?vault= — חייב /vault/<id>
          // (call-site זה נשמט ב-migration; הנתיב הזה רץ בדיוק על CF serverless — יעד ה-deploy).
          window.location.href = '/vault/' + encodeURIComponent(id);
          return {};   // "הצלחה" — הניווט גובר על המשך הזרימה הנייטיבית
        } catch (e) {
          window.__owCreatingVault = false;   // כשל → נופלים חזרה לניסיון-שרת
        }
      }

      const p = fullPath(opts);
      const res = await fetch('/api/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p, recursive: opts.recursive || false, vault: getVaultId() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'EIO', json.error || 'mkdir failed: ' + p);
      }
      // A new directory invalidates the parent's listing so it shows up in
      // subsequent readdir calls.
      invalidateCacheEntry(p);
      return {};
    },

    async rmdir(opts) {
      const p = fullPath(opts);
      const res = await fetch('/api/fs/rmdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p, recursive: opts.recursive || false, vault: getVaultId() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'ENOENT', json.error || 'rmdir failed: ' + p);
      }
      // Recursive removal may wipe a whole subtree; non-recursive only drops
      // an empty leaf directory.
      if (opts.recursive) {
        invalidateCacheSubtree(p);
      } else {
        invalidateCacheEntry(p);
      }
      return {};
    },

    async readdir(opts) {
      const p = fullPath(opts);

      // opfs-ux: no vault active + browsing the External/root — this is the
      // native mobile-vault-chooser-screen's supplemental "show subfolders
      // not already in the vault list" scan (readdir(External,"") — brief
      // §0 spike, gap 2). We have no real "device filesystem" to browse; a
      // plain round-trip would hit whatever vault the server treats as
      // default and show ITS subdirectories as fake vaults. Return empty —
      // seedNativeVaultList()/Lte (mobile-external-vaults) is the real list.
      if (!getVaultId() && p === '') {
        return { files: [] };
      }

      if (window.__owBootstrapLookup) {
        const hit = window.__owBootstrapLookup.lookupDir(window.__owBootstrapCache, p);
        if (hit) return { files: hit };
      }

      const res = await fetch('/api/fs/readdir?' + vaultQuery() + 'path=' + encodePath(p));
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'ENOENT', json.error || 'readdir failed: ' + p);
      }
      const entries = await res.json();
      return { files: entries.map(toCapacitorDirEntry) };
    },

    async stat(opts) {
      const p = fullPath(opts);

      // opfs-ux: recognize our own vault ids (local/folder registry or
      // server registry, via ow-known-vault-ids) — see owResolveNativeVaultId
      // above. Needed both for the native list's per-entry validation
      // (Ote.stat(id) in the chooser screen — brief §0 spike) and for the
      // "Open folder as vault"/"Open vault" register() flow's own stat()
      // check. No round-trip: there's no active vault yet to ask the server.
      if (owResolveNativeVaultId(p) !== null) {
        return { type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' };
      }

      if (window.__owBootstrapLookup) {
        const hit = window.__owBootstrapLookup.lookupStat(window.__owBootstrapCache, p);
        if (hit) return hit;
      }

      const res = await fetch('/api/fs/stat?' + vaultQuery() + 'path=' + encodePath(p));
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'ENOENT', json.error || 'stat failed: ' + p);
      }
      const s = await res.json();
      return {
        type:  s.isDirectory ? 'directory' : 'file',
        size:  s.size,
        mtime: s.mtime,
        ctime: s.mtime,
        uri:   '',
      };
    },

    async rename(opts) {
      const from = fullPath({ path: opts.from, directory: opts.directory });
      const to   = fullPath({ path: opts.to,   directory: opts.toDirectory || opts.directory });
      const res = await fetch('/api/fs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: from, newPath: to, vault: getVaultId() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'EIO', json.error || 'rename failed');
      }
      // The renamed entry may have been a directory — invalidate as subtree
      // on BOTH sides for safety. Cheap (O(keys)) and idempotent.
      invalidateCacheSubtree(from);
      invalidateCacheSubtree(to);
      return {};
    },

    async copy(opts) {
      const from = fullPath({ path: opts.from, directory: opts.directory });
      const to   = fullPath({ path: opts.to,   directory: opts.toDirectory || opts.directory });
      const res = await fetch('/api/fs/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: from, dest: to, vault: getVaultId() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw capError(json.code || 'EIO', json.error || 'copy failed');
      }
      // copy targets may be directories — drop the whole `to` subtree.
      invalidateCacheSubtree(to);
      return {};
    },

    async trash(opts) {
      // Map to deleteFile — we don't have a real trash on the server.
      // Must call HttpFilesystem.deleteFile (not the Filesystem Proxy) —
      // otherwise a server-vault trash could get re-dispatched through the
      // Proxy and split across backends. See §4 Commit 2.2.
      return HttpFilesystem.deleteFile(opts);
    },

    async setTimes() { return {}; },       // no-op — server doesn't expose utimes
    async verifyIcloud() { return {}; },   // iOS iCloud check — not applicable
    async open() { return {}; },           // Android file opener — not applicable

    async checkPerms()        { return { publicStorage: 'granted' }; },
    async requestPermissions(){ return { publicStorage: 'granted' }; },
    async requestPerms()      { return { publicStorage: 'granted' }; },
    // opfs-ux: File System Access API polyfill for the native "Open folder
    // as vault" flow (brief §3ג). Chromium-only (feature-detected below —
    // the native onClick handler treats a thrown Error whose message
    // contains "canceled" as a silent user-cancel, same as picker abort).
    // Reuses folder-vault's registry (__owLocalVaults) + handle store
    // (__owFolderHandles) — id/name format matches seedNativeVaultList()'s
    // 'id/name' convention so the native path-resolver (Android:
    // e.contains('/') routes to the External fs instance) AND our own
    // owResolveNativeVaultId() both parse it consistently.
    async choose() {
      if (!('showDirectoryPicker' in window)) throw capError('UNSUPPORTED', 'canceled: not supported');
      let dir;
      try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        throw capError('CANCELED', 'canceled');   // picker dismissed/denied — native swallows this silently
      }
      const created = window.__owLocalVaults.create(dir.name, { type: 'folder' });
      await window.__owFolderHandles.saveHandle(created.id, dir);
      return { path: created.id + '/' + created.name, isRoot: false };
    },

    async getUri(opts) {
      const p = fullPath(opts);
      const id = getVaultId();
      // Return an HTTP URL the app can fetch directly for large binary files
      const url = '/api/fs/read?' + (id ? 'vault=' + encodeURIComponent(id) + '&' : '') + 'path=' + encodePath(p);
      return { uri: location.origin + url };
    },

    // Watch API — Obsidian mobile uses these to detect external file changes.
    // We bridge to our existing WebSocket at /api/watch.
    async startWatch(opts) {
      const vaultId = getVaultId();
      if (!window.__owCapacitorWatcher) {
        const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') +
          '//' + location.host + '/api/watch?vault=' + encodeURIComponent(vaultId);
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'change' || msg.type === 'add' || msg.type === 'unlink') {
              // External (chokidar) write — invalidate cache so subsequent
              // reads pick up the new content/mtime instead of stale cache.
              invalidateCacheEntry(msg.path);
              window.__owCapacitorWatcher._listeners.forEach((cb) => {
                cb({ path: msg.path });
              });
            }
          } catch (_) {}
        };
        ws.onclose = () => { window.__owCapacitorWatcher = null; };
        window.__owCapacitorWatcher = { ws, _listeners: new Set() };
      }
      return {};
    },

    async stopWatch() {
      if (window.__owCapacitorWatcher) {
        window.__owCapacitorWatcher.ws.close();
        window.__owCapacitorWatcher = null;
      }
      return {};
    },

    async watchAndStatAll(opts) {
      // Custom Obsidian API: returns full file tree snapshot + activates watcher.
      //
      // IMPORTANT: the CapacitorAdapter processes the result by calling
      //   for (const i of e.children) this.quickList("", i);
      // quickList("", entry) uses entry.name as the FULL relative path.
      // It does NOT recurse into entry.children — so a nested tree structure
      // would only populate the root level.
      //
      // Fix: return a FLAT list where every entry's `name` is its full
      // relative path (e.g. "10. פרויקטים/myfile.md").
      // Must call HttpFilesystem.startWatch (not the Filesystem Proxy) — see
      // §4 Commit 2.2 (internal references must stay pinned to this backend).
      await HttpFilesystem.startWatch(opts);

      // Prefer the bootstrap cache populated by boot.js — it's the same
      // /api/bootstrap?full=1 response we'd fetch here anyway, so awaiting
      // the in-flight promise avoids a duplicate round-trip.
      let dirs = null;
      if (window.__owBootstrapPromise) {
        await window.__owBootstrapPromise.catch(() => null);
      }
      if (window.__owBootstrapCache && window.__owBootstrapCache.dirs) {
        dirs = window.__owBootstrapCache.dirs;
      }

      // Fallback: bootstrap failed or is disabled — fetch directly so the
      // adapter still gets its tree (slower path, but functional).
      if (!dirs) {
        const vaultId = getVaultId();
        const res = await fetch(
          '/api/bootstrap?vault=' + encodeURIComponent(vaultId) + '&full=1',
          { headers: { 'Accept-Encoding': 'br, gzip' } },
        );
        if (!res.ok) throw capError('EIO', 'watchAndStatAll failed');
        const data = await res.json();
        dirs = data.dirs || {};
      }

      // Flatten the entire dirs map into a single children array.
      // Each entry's name = its full relative vault path.
      const children = [];
      for (const dirPath of Object.keys(dirs)) {
        for (const e of dirs[dirPath]) {
          const relPath = dirPath ? dirPath + '/' + e.name : e.name;
          children.push({
            name: relPath,
            type: e.isDirectory ? 'directory' : 'file',
            size: e.size || 0,
            mtime: e.mtime || 0,
            uri: '',
            ctime: e.mtime || 0,
          });
        }
      }
      return { children };
    },

    // addListener — used for file change events
    addListener(eventName, callback) {
      if (eventName === 'change') {
        if (!window.__owCapacitorWatcher) {
          // HttpFilesystem, not the Filesystem Proxy — see §4 Commit 2.2.
          HttpFilesystem.startWatch({}).catch(() => {});
        }
        // Defer until watcher is ready
        setTimeout(() => {
          if (window.__owCapacitorWatcher) {
            window.__owCapacitorWatcher._listeners.add(callback);
          }
        }, 100);
      }
      return Promise.resolve({
        remove: () => {
          if (window.__owCapacitorWatcher) {
            window.__owCapacitorWatcher._listeners.delete(callback);
          }
        },
      });
    },
  };

  // ── OPFS path normalization wrapper ─────────────────────────────────────
  // Obsidian mobile uses the vaultId as its "base path" and prefixes every
  // FS call with it (e.g. stat({path: vaultId}) on vault-open). OpfsStore's
  // contract is vault-relative paths (see header of opfs-store.js) — it does
  // NOT know about the vaultId prefix or the directory enum. HttpFilesystem
  // already normalizes every call via fullPath() (see rename/copy above);
  // this wrapper gives the OPFS backend the same normalized path so both
  // backends see identical, vault-relative paths. See docs/plans/
  // opfs-vault-path.md §3.
  //
  // Methods that receive opts.path (normalized to a single path). Note:
  // trash is NOT here — it delegates to deleteFile (already normalized),
  // so listing it too would double-normalize.
  const OPFS_PATH_METHODS = ['readFile', 'writeFile', 'appendFile', 'deleteFile', 'mkdir', 'rmdir', 'readdir', 'stat', 'getUri'];

  function wrapOpfsWithFullPath(store) {
    const wrapped = Object.create(store); // passthrough for the rest (watchAndStatAll, startWatch, stopWatch, addListener, rescan, setTimes, trash, ...)
    for (const m of OPFS_PATH_METHODS) {
      if (typeof store[m] !== 'function') continue;
      wrapped[m] = (opts) => store[m](Object.assign({}, opts, { path: fullPath(opts) }));
    }
    // rename/copy — normalize both sides (mirrors HttpFilesystem:348-350, 367-369)
    if (typeof store.rename === 'function') {
      wrapped.rename = (opts) => store.rename(Object.assign({}, opts, {
        from: fullPath({ path: opts.from, directory: opts.directory }),
        to:   fullPath({ path: opts.to,   directory: opts.toDirectory || opts.directory }),
      }));
    }
    if (typeof store.copy === 'function') {
      wrapped.copy = (opts) => store.copy(Object.assign({}, opts, {
        from: fullPath({ path: opts.from, directory: opts.directory }),
        to:   fullPath({ path: opts.to,   directory: opts.toDirectory || opts.directory }),
      }));
    }
    return wrapped;
  }

  // ── Filesystem dispatcher (local ↔ server ↔ folder) ──────────────────────
  // window.__owVaultType is set by boot.js (mobile) at call-time — evaluated
  // per-call, not once at load-time. boot.js runs AFTER this script (see
  // index.html loading order), so by the time Obsidian actually calls
  // Filesystem.readFile etc., boot.js has already set __owVaultType. See
  // docs/plans/opfs-wire.md §3 (Architecture diagram, "תובנת-מפתח").
  //
  // 'folder' vaults re-use the same OpfsStore as 'local' (OPFS) vaults — just
  // with a pluggable getRoot that returns the picked FileSystemDirectoryHandle
  // (window.__owFolderRoot, set by boot.js's permission-gated verify step)
  // instead of navigator.storage.getDirectory()/vaults/<id>. See
  // docs/plans/folder-vault.md §3ה. `isFolder: true` additionally gates
  // OpfsStore's external-change watch (docs/plans/folder-watch.md §2) —
  // 'local' (OPFS) vaults must stay a watch no-op (DoD#4).
  function fsBackend() {
    const t = window.__owVaultType;
    if (t === 'local' || t === 'folder') {
      if (!window.__owLocalFs) {
        const getRoot = t === 'folder' ? (async () => window.__owFolderRoot) : undefined;
        window.__owLocalFs = wrapOpfsWithFullPath(
          window.__owOpfsStore.makeStore(window.__owVaultId || getVaultId(), { getRoot, isFolder: t === 'folder' }));
      }
      return window.__owLocalFs;
    }
    return HttpFilesystem;
  }
  const Filesystem = new Proxy({}, {
    get: function (_t, prop) {
      const b = fsBackend();
      const v = b[prop];
      // readFile — EISDIR at the vault root (docs/plans/
      // electron-shim-foundation.md §3.3): the desktop-only
      // `Vault.readRaw("")` empty-vault probe reads the vault root AS A
      // FILE, and branches specifically on error CODE ("ENOENT" → vault
      // discarded entirely, `this.vault=null,this.openVaultChooser(!0)`;
      // anything else → treated as a harmless non-issue and ignored). A
      // real filesystem answers "read a directory as a file" with EISDIR,
      // not ENOENT — both backends' readFile would otherwise surface
      // whatever their own 404/ENOENT path produces, which wrongly nukes a
      // perfectly good, non-empty vault. Intercepted HERE (the Proxy's own
      // get trap), not inside either backend, so it protects local AND
      // folder AND server vaults with one check regardless of which
      // backend fsBackend() picks — see vault-root-path.js for why
      // `path === ''` alone doesn't catch every shape this can arrive in.
      if (prop === 'readFile') {
        return function (opts) {
          const p = fullPath(opts || {});
          if (window.__owVaultRootPath && window.__owVaultRootPath.isVaultRootPath(p)) {
            return Promise.reject(capError('EISDIR', 'illegal operation on a directory, read'));
          }
          return v.call(b, opts);
        };
      }
      // bind is mandatory, not optional (avigail fix): OpfsStore.trash does
      // `return this.deleteFile(opts)` (opfs-store.js:331) — it relies on
      // `this`. Without bind, a destructured call (`const {trash}=Filesystem`)
      // would break. HttpFilesystem doesn't need `this` (it calls
      // HttpFilesystem.deleteFile explicitly) but bind is harmless there too.
      return typeof v === 'function' ? v.bind(b) : v;
    },
  });

  // ── Stubs for non-critical plugins ────────────────────────────────────

  function noop() { return Promise.resolve({}); }

  const Device = {
    getInfo: () => Promise.resolve({
      name: 'obsidian-web',
      model: 'Browser',
      platform: 'android',
      operatingSystem: 'android',
      osVersion: '12',
      manufacturer: 'obsidian-web',
      isVirtual: true,
    }),
    getId: () => Promise.resolve({ identifier: 'obsidian-web-id' }),
    getLanguageCode: () => Promise.resolve({ value: navigator.language || 'en' }),
  };

  // NB: must use the *native* writeText/readText we captured at IIFE init,
  // not `navigator.clipboard.*`, since app.js replaces those with thin wrappers
  // that call right back into this shim (see infinite-recursion note at the top).
  const Clipboard = {
    write: ({ string }) =>
      _nativeClipboardWriteText
        ? _nativeClipboardWriteText(string || '').then(() => ({}))
        : Promise.reject(new Error('clipboard.writeText unavailable')),
    read: () =>
      _nativeClipboardReadText
        ? _nativeClipboardReadText().then((value) => ({ type: 'text/plain', value }))
        : Promise.reject(new Error('clipboard.readText unavailable')),
  };

  const Preferences = {
    get: ({ key }) => Promise.resolve({ value: localStorage.getItem('cap:' + key) }),
    set: ({ key, value }) => { localStorage.setItem('cap:' + key, value); return Promise.resolve({}); },
    remove: ({ key }) => { localStorage.removeItem('cap:' + key); return Promise.resolve({}); },
    clear: () => { /* leave localStorage alone */ return Promise.resolve({}); },
    keys: () => Promise.resolve({ keys: [] }),
  };

  const App = {
    // version — read lazily (inside the function body, not at module-eval
    // time) from window.__owObsidianVersion, the single source of truth
    // written by scripts/update-obsidian-mobile.js (docs/plans/
    // electron-shim-foundation.md §3.0). The '1.12.7' fallback only matters
    // if obsidian-version.js somehow failed to load before this is called.
    getInfo:              () => Promise.resolve({ name: 'Obsidian', id: 'md.obsidian', build: '0', version: (window.__owObsidianVersion || '1.12.7') }),
    getState:             () => Promise.resolve({ isActive: true }),
    getLaunchUrl:         () => Promise.resolve(null),
    addListener:          (opts) => Promise.resolve({ remove: noop }),
    removeAllListeners:   noop,
    exitApp:              noop,
    minimizeApp:          noop,
    setQuickActions:      noop,
    getFonts:             () => Promise.resolve({ fonts: [] }),
    takeScreenshot:       () => Promise.resolve({ base64String: '' }),
    isInstalledFromStore: () => Promise.resolve({ isFromStore: false }),
    async requestUrl(opts) {
      const { url, method, contentType, headers, body, binary } = opts;

      // ── Selective server-proxy for Obsidian-infra hosts ────────────────────
      // GitHub / obsidian.md release + community-plugin downloads either lack
      // CORS or 302-redirect to a non-CORS CDN, so a direct browser fetch fails.
      // Route ONLY those hosts through /api/proxy-request (server follows
      // redirects, no CORS restriction). Everything else — CouchDB/LiveSync,
      // the user's own hosts — stays a DIRECT fetch, so the server is never in
      // the sync data path (preserves the direct-fetch sync architecture).
      let __owHost = '';
      try { __owHost = new URL(url, location.href).hostname; } catch (_) {}
      if (/(^|\.)(github\.com|githubusercontent\.com|obsidian\.md)$/.test(__owHost)) {
        const pr = await fetch('/api/proxy-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // body/binary pass straight through: the proxy decodes
          // binary?base64:utf8 (matches Obsidian's requestUrl body contract).
          body: JSON.stringify({
            url, method: method || 'GET', headers: headers || {},
            contentType, body: body != null ? body : undefined, binary: !!binary,
          }),
        });
        const j = await pr.json().catch(() => ({}));
        if (!pr.ok) throw capError(j.code || 'EIO', j.error || 'proxy-request failed: ' + url);
        // proxy returns {status, headers, body(base64)} — the exact shape Obsidian expects.
        return { status: j.status, headers: j.headers || {}, body: j.body || '' };
      }

      const reqHeaders = Object.assign({}, headers || {});
      // case-insensitive check — a mixed-case user header (e.g. 'Content-type')
      // must not be duplicated (Avigail finding).
      const hasCT = Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-type');
      if (contentType && !hasCT) reqHeaders['Content-Type'] = contentType;
      let reqBody;
      if (body == null) reqBody = undefined;
      else if (binary) reqBody = base64ToArrayBuffer(body);  // Obsidian sent base64
      else reqBody = body;                                    // string passthrough

      const res = await fetch(url, {
        method: method || 'GET',
        headers: reqHeaders,
        body: reqBody,
        credentials: 'omit',   // ‏native requestUrl ‏לא ‏שולח cookies; ‏auth ‏עובר ‏ב-Authorization header.
                             // ‏`include` ‏שובר ‏endpoints ‏עם wildcard CORS (GitHub) — ‏אומת ‏ש-LiveSync→CouchDB
                             // ‏משתמש ‏ב-basic-auth (‏לא cookies), ‏אז omit ‏בטוח. ‏ראה §6.
      });
      const respHeaders = {};
      res.headers.forEach((v, k) => { respHeaders[k] = v; });
      const respBuffer = await res.arrayBuffer();
      return { status: res.status, headers: respHeaders, body: arrayBufferToBase64(respBuffer) };
    },
    setBackgroundColor:   noop,
  };

  const SplashScreen = {
    hide: noop,
    show: noop,
  };

  const StatusBar = {
    setStyle: noop,
    setBackgroundColor: noop,
    show: noop,
    hide: noop,
    getInfo: () => Promise.resolve({ visible: false, style: 'DARK', color: '#000000', overlays: false }),
  };

  const Keyboard = {
    show: noop,
    hide: noop,
    addListener: (event, cb) => Promise.resolve({ remove: noop }),
    removeAllListeners: noop,
    setAccessoryBarVisible: noop,
    setScroll: noop,
    setResizeMode: noop,
    getResizeMode: () => Promise.resolve({ mode: 'none' }),
  };

  const KeepAwake = {
    keepAwake: noop,
    allowSleep: noop,
    isKeptAwake: () => Promise.resolve({ isKeptAwake: false }),
  };

  const Haptics = {
    impact: noop,
    notification: noop,
    vibrate: noop,
    selectionStart: noop,
    selectionChanged: noop,
    selectionEnd: noop,
  };

  const Browser = {
    open: ({ url }) => { window.open(url, '_blank', 'noopener'); return Promise.resolve({}); },
    close: noop,
    addListener: (event, cb) => Promise.resolve({ remove: noop }),
    removeAllListeners: noop,
  };

  const SecureStorage = {
    get: ({ key }) => Promise.resolve({ value: localStorage.getItem('sec:' + key) }),
    set: ({ key, value }) => { localStorage.setItem('sec:' + key, value); return Promise.resolve({}); },
    remove: ({ key }) => { localStorage.removeItem('sec:' + key); return Promise.resolve({}); },
    getPlatformSupportLevel: () => Promise.resolve({ value: 'none' }),
    isKeyExists: ({ key }) => Promise.resolve({ value: localStorage.getItem('sec:' + key) !== null }),
  };

  const RateApp = {
    requestReview: noop,
  };

  // ── Plugin registry ───────────────────────────────────────────────────

  const plugins = {
    Filesystem,
    Device,
    Clipboard,
    Preferences,
    App,
    SplashScreen,
    StatusBar,
    Keyboard,
    KeepAwake,
    Haptics,
    Browser,
    SecureStorage,
    RateApp,
  };

  // ── Android bridge (MUST be set before native-bridge.js runs) ────────────
  //
  // The mobile app.js checks `window.androidBridge` at module level to decide
  // the platform (not window.Capacitor.getPlatform).  If androidBridge exists,
  // getPlatformId() returns 'android', Em becomes true, and Capacitor code paths
  // are active.
  //
  // We implement the postMessage protocol so native-bridge.js routes all plugin
  // calls through androidBridge → our HTTP implementations → fromNative callback.
  //
  // Call flow:
  //   app.js plugin call
  //   → native-bridge cap.nativePromise / cap.toNative
  //   → androidBridge.postMessage(JSON.stringify({callbackId, pluginId, methodName, options}))
  //   → our router (below) → plugins[pluginId][methodName](options)
  //   → window.Capacitor.fromNative({callbackId, success, data|error})
  //   → resolves/rejects the original Promise in app.js

  function routeNativeCall(callDataJson) {
    let callData;
    try { callData = JSON.parse(callDataJson); } catch (_) { return; }

    const { callbackId, pluginId, methodName, options } = callData;

    function respond(success, dataOrError) {
      const cap = window.Capacitor;
      if (cap && typeof cap.fromNative === 'function') {
        cap.fromNative({
          callbackId,
          pluginId,
          methodName,
          success,
          data:  success ? dataOrError : undefined,
          error: success ? undefined : { message: dataOrError && dataOrError.message || String(dataOrError), code: dataOrError && dataOrError.code },
          save: false,
        });
      }
    }

    const plugin = plugins[pluginId];
    if (!plugin) {
      console.warn('[capacitor-shim] unknown plugin:', pluginId);
      respond(false, { message: 'Plugin not available: ' + pluginId });
      return;
    }
    const method = plugin[methodName];
    if (typeof method !== 'function') {
      // Silently return empty for unknown methods (e.g. optional API calls)
      respond(true, {});
      return;
    }

    Promise.resolve()
      .then(() => method.call(plugin, options || {}))
      .then((data) => respond(true, data || {}))
      .catch((err) => respond(false, err));
  }

  // Set androidBridge BEFORE native-bridge.js so getPlatformId() returns 'android'.
  if (!window.androidBridge) {
    window.androidBridge = { postMessage: routeNativeCall };
  }

  // ── Post-native-bridge overrides ──────────────────────────────────────
  // After native-bridge.js runs we patch a few more things for robustness.

  function patchCapacitor() {
    const cap = window.Capacitor;
    if (!cap) return;

    // Belt-and-suspenders: also override nativePromise in case app.js
    // calls it directly instead of via the bridge protocol.
    const _origNP = cap.nativePromise;
    cap.nativePromise = (pluginName, methodName, options) => {
      const plugin = plugins[pluginName];
      if (!plugin) return _origNP ? _origNP(pluginName, methodName, options) : Promise.resolve({});
      const method = plugin[methodName];
      if (typeof method !== 'function') return Promise.resolve({});
      return Promise.resolve().then(() => method.call(plugin, options || {}));
    };

    // ── nativeCallback override (docs/plans/folder-watch.md §3א חלק 2) ──────
    // Capacitor's registerPlugin Proxy (app.js) calls this DIRECTLY (in-memory
    // JS reference — not via the postToNative/androidBridge JSON bridge) for
    // any method whose PluginHeaders entry declares rtype:'callback' (see
    // `cm()` below) — forwarding BOTH args (options, callback). Without this
    // override, app.js falls through to native-bridge.js's own
    // `cap.nativeCallback`, which round-trips through `cap.toNative()` →
    // postToNative → our routeNativeCall (single-arg, one-shot resolve —
    // wrong shape for a persistent event-listener callback) and additionally
    // never forwards the real callback function reference at all (only
    // options are JSON-serialized). This mirrors the nativePromise override
    // above, just for the 2-arg (options, callback) rtype.
    const _origNC = cap.nativeCallback;
    cap.nativeCallback = (pluginName, methodName, options, callback) => {
      const plugin = plugins[pluginName];
      if (!plugin) return _origNC ? _origNC(pluginName, methodName, options, callback) : undefined;
      const method = plugin[methodName];
      if (typeof method !== 'function') return _origNC ? _origNC(pluginName, methodName, options, callback) : undefined;
      // spike §0.1 empirical finding (real Obsidian, not self-test): the
      // registerPlugin Proxy's addListenerFunction forwards `{eventName}` as
      // the options object (`c.nativeCallback(plugin, 'addListener',
      // {eventName:'change'}, cb)`), NOT the bare eventName string. Our
      // plugin methods' existing contract (HttpFilesystem.addListener,
      // OpfsStore.addListener) takes a plain eventName STRING as their first
      // arg — matches 33 folder-refresh self-test assertions + the merged
      // opfs-store self-test, so unwrap here instead of changing that
      // contract.
      if (methodName === 'addListener' && options && typeof options.eventName === 'string') {
        return method.call(plugin, options.eventName, callback);
      }
      return method.call(plugin, options || {}, callback);
    };

    cap.isPluginAvailable = (name) => name in plugins;

    // convertFileSrc: large binary files (>5MB) fetched via HTTP URL
    cap.convertFileSrc = (fileUri) => {
      if (fileUri.startsWith('http')) return fileUri;
      const id = getVaultId();
      return '/api/fs/read?' + (id ? 'vault=' + encodeURIComponent(id) + '&' : '') +
        'path=' + encodeURIComponent(fileUri.replace(/^file:\/\//, ''));
    };

    // Expose plugins map
    if (!cap.Plugins) cap.Plugins = {};
    Object.assign(cap.Plugins, plugins);

    // ── PluginHeaders ────────────────────────────────────────────────────────
    // Capacitor's registerPlugin() Proxy checks c.PluginHeaders to decide which
    // methods to route to nativePromise. Without headers, every method call
    // throws "not implemented on android". We declare all methods we implement
    // (plus stubs) so the Proxy routes them to our nativePromise override.
    // rtype 'promise' = single-arg (options obj) → nativePromise
    // rtype 'callback' = two-arg (options, callback) → nativeCallback
    function pm(name) { return { name, rtype: 'promise' }; }
    // docs/plans/folder-watch.md §3א חלק 1 — addListener needs the real
    // (options, callback) 2-arg shape, not the single-arg promise shape.
    function cm(name) { return { name, rtype: 'callback' }; }

    cap.PluginHeaders = [
      {
        name: 'App',
        methods: [
          pm('getInfo'), pm('getState'), pm('getLaunchUrl'),
          pm('addListener'), pm('removeAllListeners'),
          pm('exitApp'), pm('minimizeApp'),
          pm('getFonts'), pm('takeScreenshot'),
          pm('isInstalledFromStore'), pm('requestUrl'),
          pm('setBackgroundColor'), pm('setQuickActions'),
        ],
      },
      {
        name: 'Filesystem',
        methods: [
          pm('readFile'), pm('writeFile'), pm('appendFile'),
          pm('deleteFile'), pm('mkdir'), pm('rmdir'),
          pm('readdir'), pm('stat'), pm('rename'), pm('copy'),
          pm('getUri'), pm('startWatch'), pm('stopWatch'),
          pm('watchAndStatAll'), cm('addListener'),
          pm('requestPermissions'), pm('requestPerms'), pm('checkPerms'),
          pm('choose'), pm('trash'), pm('setTimes'),
          pm('verifyIcloud'), pm('open'),
        ],
      },
      {
        name: 'Device',
        methods: [pm('getInfo'), pm('getId'), pm('getLanguageCode')],
      },
      {
        name: 'SplashScreen',
        methods: [pm('hide'), pm('show')],
      },
      {
        name: 'Clipboard',
        methods: [pm('read'), pm('write')],
      },
      {
        name: 'Haptics',
        methods: [
          pm('impact'), pm('notification'), pm('vibrate'),
          pm('selectionStart'), pm('selectionChanged'), pm('selectionEnd'),
        ],
      },
      {
        name: 'Keyboard',
        methods: [
          pm('show'), pm('hide'), pm('addListener'),
          pm('removeAllListeners'), pm('setAccessoryBarVisible'),
          pm('setScroll'), pm('setResizeMode'), pm('getResizeMode'),
        ],
      },
      {
        name: 'Browser',
        methods: [pm('open'), pm('close'), pm('addListener'), pm('removeAllListeners')],
      },
      {
        name: 'Preferences',
        methods: [pm('get'), pm('set'), pm('remove'), pm('clear'), pm('keys')],
      },
      {
        name: 'KeepAwake',
        methods: [pm('keepAwake'), pm('allowSleep'), pm('isKeptAwake')],
      },
      {
        name: 'SecureStorage',
        methods: [
          pm('get'), pm('set'), pm('remove'),
          pm('getPlatformSupportLevel'), pm('isKeyExists'),
        ],
      },
      {
        name: 'StatusBar',
        methods: [
          pm('setStyle'), pm('setBackgroundColor'),
          pm('show'), pm('hide'), pm('getInfo'),
        ],
      },
      {
        name: 'RateApp',
        methods: [pm('requestReview')],
      },
    ];
  }

  // Run immediately (in case native-bridge already ran) and also after DOMContentLoaded
  patchCapacitor();
  document.addEventListener('DOMContentLoaded', patchCapacitor, { once: true });

  console.log('[capacitor-shim] androidBridge installed — platform=android');
})(window);
