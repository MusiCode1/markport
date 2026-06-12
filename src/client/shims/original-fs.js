/**
 * Browser shim for Node's `original-fs` (and `fs`) module.
 *
 * Translates fs calls into HTTP requests against /api/fs/*. Implements
 * the subset of the API Obsidian actually uses, plus the matching
 * .promises namespace.
 *
 * Obsidian uses absolute paths from the vault's basePath. The server
 * sandboxes everything to the vault root; we strip the configured
 * vault base before sending paths over the wire.
 */
(function (global) {
  // The vault base path that Obsidian sees. Boot fills this in.
  let vaultBase = '/vault';
  let vaultId = '';

  function setVaultBase(p) {
    vaultBase = p;
  }

  function setVaultId(id) {
    vaultId = id || '';
  }

  function vaultQuery() {
    return vaultId ? 'vault=' + encodeURIComponent(vaultId) + '&' : '';
  }

  function toRelative(p) {
    if (typeof p !== 'string') throw new TypeError('path must be a string');
    // Strip the vault base if present so the server sees a relative path.
    if (p === vaultBase) return '';
    if (p.startsWith(vaultBase + '/')) return p.slice(vaultBase.length + 1);
    // Already relative - pass through.
    if (!p.startsWith('/')) return p;
    // Some absolute path outside the vault. The server will reject it,
    // but we let the request happen so the error surfaces naturally.
    return p.startsWith('/') ? p.slice(1) : p;
  }

  // ---- Bootstrap cache helpers -----------------------------------------
  //
  // window.__owBootstrapCache is populated by boot.js before app.js loads.
  // Shape: { electron: {...}, fs: { "rel/path": { content, mtime, size } } }
  // We serve reads from this cache and invalidate entries on writes/deletes.

  function getBootstrapEntry(p) {
    const cache = global.__owBootstrapCache;
    if (!cache || !cache.fs) return null;
    return cache.fs[toRelative(p)] || null;
  }

  function getBootstrapDir(p) {
    const cache = global.__owBootstrapCache;
    if (!cache || !cache.dirs) return null;
    return cache.dirs[toRelative(p)] || null;
  }

  function invalidateBootstrap(p) {
    const cache = global.__owBootstrapCache;
    if (cache && cache.fs) delete cache.fs[toRelative(p)];
    // Also invalidate parent dir listing so readdir re-fetches.
    if (cache && cache.dirs) {
      const rel = toRelative(p);
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      delete cache.dirs[parent];
    }
  }

  function makeStatsFromCache(entry) {
    const isDir = !!entry.isDirectory;
    return makeStats({
      isFile: entry.isFile !== undefined ? entry.isFile : !isDir,
      isDirectory: isDir,
      isSymbolicLink: !!entry.isSymbolicLink,
      size: entry.size || 0,
      mtime: entry.mtime || 0,
      ctime: entry.mtime || 0,
      atime: entry.mtime || 0,
      birthtime: entry.mtime || 0,
      mode: isDir ? 0o040755 : 0o100644,
    });
  }

  // Returns true if the bootstrap entry has readable text content.
  function bootstrapHasContent(entry) {
    return entry !== null && typeof entry.content === 'string';
  }

  function encodePath(p) {
    return encodeURIComponent(toRelative(p));
  }

  // Build a Stats-like object from the JSON the server returns.
  function makeStats(json) {
    return {
      size: json.size,
      mtime: new Date(json.mtime),
      ctime: new Date(json.ctime),
      atime: new Date(json.atime),
      birthtime: new Date(json.birthtime),
      mtimeMs: json.mtime,
      ctimeMs: json.ctime,
      atimeMs: json.atime,
      birthtimeMs: json.birthtime,
      mode: json.mode,
      isFile: () => json.isFile,
      isDirectory: () => json.isDirectory,
      isSymbolicLink: () => json.isSymbolicLink,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  function makeError(json, syscall, p) {
    const err = new Error(json.error || 'fs error');
    err.code = json.code || 'EUNKNOWN';
    err.syscall = syscall;
    err.path = p;
    return err;
  }

  // Populate fs stat cache for all entries in a dirs cache entry.
  // Called when serving a readdir from cache, so subsequent stat(path) calls
  // for files in this directory (including binaries) are answered from cache.
  function populateStatFromDir(dirPath, entries) {
    const cache = global.__owBootstrapCache;
    if (!cache || !cache.fs) return;
    const dirRel = toRelative(dirPath);
    for (const e of entries) {
      if (!e.mtime && !e.size) continue; // no stat info in entry
      const fileRel = dirRel ? dirRel + '/' + e.name : e.name;
      if (!cache.fs[fileRel]) {
        cache.fs[fileRel] = {
          mtime: e.mtime || 0,
          size: e.size || 0,
          isFile: e.isFile,
          isDirectory: e.isDirectory,
          isSymbolicLink: e.isSymbolicLink || false,
        };
      }
    }
  }

  // ---- async API (callback-style) ---------------------------------------

  function statAsync(p, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const cached = getBootstrapEntry(p);
    if (cached) { Promise.resolve().then(() => cb(null, makeStatsFromCache(cached))); return; }
    fetch('/api/fs/stat?' + vaultQuery() + 'path=' + encodePath(p))
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw makeError(json, 'stat', p);
        cb(null, makeStats(json));
      })
      .catch((err) => cb(err));
  }

  function readdirAsync(p, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const withFileTypes = opts && opts.withFileTypes;
    const cachedDir = getBootstrapDir(p);
    if (cachedDir) {
      // Lazily populate fs stat cache from dirs entries so subsequent
      // stat(path) calls for files in this directory are answered from cache.
      populateStatFromDir(p, cachedDir);
      Promise.resolve().then(() => {
        if (withFileTypes) {
          cb(null, cachedDir.map(e => ({
            name: e.name,
            isFile: () => e.isFile,
            isDirectory: () => e.isDirectory,
            isSymbolicLink: () => e.isSymbolicLink,
          })));
        } else {
          cb(null, cachedDir.map(e => e.name));
        }
      });
      return;
    }
    fetch('/api/fs/readdir?' + vaultQuery() + 'path=' + encodePath(p))
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw makeError(json, 'scandir', p);
        if (withFileTypes) {
          cb(null, json.map((e) => ({
            name: e.name,
            isFile: () => e.isFile,
            isDirectory: () => e.isDirectory,
            isSymbolicLink: () => e.isSymbolicLink,
          })));
        } else {
          cb(null, json.map((e) => e.name));
        }
      })
      .catch((err) => cb(err));
  }

  // The server returns the same JSON envelope for readFile too; if the
  // caller passed a directory, we want a proper ENOTDIR-like error so
  // Obsidian's existing try/catch handles it normally instead of
  // surfacing as an unhandled HTTP failure.

  function readFileAsync(p, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = undefined; }
    const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    const cached = getBootstrapEntry(p);
    if (bootstrapHasContent(cached)) {
      Promise.resolve().then(() => {
        cb(null, encoding ? cached.content : new TextEncoder().encode(cached.content));
      });
      return;
    }
    const url = '/api/fs/read?' + vaultQuery() + 'path=' + encodePath(p) + (encoding ? '&encoding=' + encoding : '');
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'read failed' }));
          throw makeError(json, 'open', p);
        }
        if (encoding) {
          const text = await r.text();
          cb(null, text);
        } else {
          const buf = await r.arrayBuffer();
          cb(null, new Uint8Array(buf));
        }
      })
      .catch((err) => cb(err));
  }

  function writeFileAsync(p, data, opts, cb) {
    // Only evict the file's cached content — the parent dir listing is still
    // valid (the file exists, just with new content or as a new file).
    // Evicting dirs is reserved for structural changes (unlink/rename).
    const _cache = global.__owBootstrapCache;
    if (_cache && _cache.fs) delete _cache.fs[toRelative(p)];
    if (typeof opts === 'function') { cb = opts; opts = undefined; }
    const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    const url = '/api/fs/write?' + vaultQuery() + 'path=' + encodePath(p) + (encoding ? '&encoding=' + encoding : '');
    // Always set Content-Type so express.raw() on the server parses the body.
    // The Fetch API does NOT set Content-Type automatically for binary bodies
    // (ArrayBuffer, TypedArray, polyfilled Buffer) — without it, body-parser's
    // type-is check returns false even for type:'*/*', leaving req.body as {}
    // and causing fsp.writeFile to throw "Received an instance of Object".
    fetch(url, { method: 'PUT', body: data == null ? '' : data, headers: { 'Content-Type': 'application/octet-stream' } })
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'write failed' }));
          throw makeError(json, 'open', p);
        }
        cb && cb(null);
      })
      .catch((err) => cb && cb(err));
  }

  function mkdirAsync(p, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    fetch('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: toRelative(p), recursive: opts && opts.recursive, vault: vaultId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'mkdir failed' }));
          throw makeError(json, 'mkdir', p);
        }
        cb && cb(null);
      })
      .catch((err) => cb && cb(err));
  }

  function unlinkAsync(p, cb) {
    invalidateBootstrap(p);
    fetch('/api/fs/unlink?' + vaultQuery() + 'path=' + encodePath(p), { method: 'DELETE' })
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'unlink failed' }));
          throw makeError(json, 'unlink', p);
        }
        cb && cb(null);
      })
      .catch((err) => cb && cb(err));
  }

  function renameAsync(oldPath, newPath, cb) {
    invalidateBootstrap(oldPath);
    invalidateBootstrap(newPath);
    fetch('/api/fs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: toRelative(oldPath), newPath: toRelative(newPath), vault: vaultId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'rename failed' }));
          throw makeError(json, 'rename', oldPath);
        }
        cb && cb(null);
      })
      .catch((err) => cb && cb(err));
  }

  function rmdirAsync(p, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const recursive = opts && opts.recursive ? '1' : '0';
    fetch('/api/fs/rmdir?' + vaultQuery() + 'path=' + encodePath(p) + '&recursive=' + recursive, { method: 'DELETE' })
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'rmdir failed' }));
          throw makeError(json, 'rmdir', p);
        }
        cb && cb(null);
      })
      .catch((err) => cb && cb(err));
  }

  function copyFileAsync(src, dest, flags, cb) {
    if (typeof flags === 'function') { cb = flags; flags = 0; }
    fetch('/api/fs/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: toRelative(src), dest: toRelative(dest), vault: vaultId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({ error: 'copy failed' }));
          throw makeError(json, 'copyfile', src);
        }
        cb && cb(null);
      })
      .catch((err) => cb && cb(err));
  }

  function accessAsync(p, mode, cb) {
    if (typeof mode === 'function') { cb = mode; mode = 0; }
    statAsync(p, (err) => cb(err || null));
  }

  // ---- sync API (uses XHR sync) -----------------------------------------

  function statSync(p) {
    const cached = getBootstrapEntry(p);
    if (cached) return makeStatsFromCache(cached);
    // silent404: Obsidian routinely stat()s paths that may not exist yet
    // (config files, plugins) and handles ENOENT via try/catch.  Suppress
    // the verbose URL in the error message to keep the console clean.
    const xhr = global.__owSyncRequest('GET', '/api/fs/stat?' + vaultQuery() + 'path=' + encodePath(p), undefined, { silent404: true });
    return makeStats(JSON.parse(xhr.responseText));
  }

  function readFileSync(p, opts) {
    const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    const cached = getBootstrapEntry(p);
    if (bootstrapHasContent(cached)) return encoding ? cached.content : new TextEncoder().encode(cached.content);
    const url = '/api/fs/read?' + vaultQuery() + 'path=' + encodePath(p) + (encoding ? '&encoding=' + encoding : '');
    // Use __owSyncRequest with silent404 so missing files throw a clean ENOENT.
    // Note: sync XHR binary reads are limited to Latin-1 (xhr.responseText
    // encoding). Multi-byte UTF-8 binary data may be corrupted on this path.
    // Text reads (encoding=utf8) are safe because the server sends UTF-8 and
    // the XHR decodes it as a JS string.
    const xhr = global.__owSyncRequest('GET', url, undefined, { silent404: true });
    if (encoding) return xhr.responseText;
    // Binary path - convert text to Uint8Array via overrideMimeType trick.
    const bytes = new Uint8Array(xhr.responseText.length);
    for (let i = 0; i < xhr.responseText.length; i++) {
      bytes[i] = xhr.responseText.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function existsSync(p) {
    try { statSync(p); return true; } catch (_) { return false; }
  }

  function writeFileSync(p, data, opts) {
    // Same as writeFileAsync: only evict fs content, not parent dir listing.
    const _cache = global.__owBootstrapCache;
    if (_cache && _cache.fs) delete _cache.fs[toRelative(p)];
    const encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    const url = '/api/fs/write?' + vaultQuery() + 'path=' + encodePath(p) + (encoding ? '&encoding=' + encoding : '');
    global.__owSyncRequest('PUT', url, data == null ? '' : data);
  }

  function unlinkSync(p) {
    invalidateBootstrap(p);
    global.__owSyncRequest('DELETE', '/api/fs/unlink?' + vaultQuery() + 'path=' + encodePath(p));
  }

  function mkdirSync(p, opts) {
    const recursive = !!(opts && opts.recursive);
    global.__owSyncJson('POST', '/api/fs/mkdir', { path: toRelative(p), recursive, vault: vaultId });
  }

  function readdirSync(p, opts) {
    const cachedDir = getBootstrapDir(p);
    if (cachedDir) {
      populateStatFromDir(p, cachedDir);
      const withFileTypes = opts && opts.withFileTypes;
      if (withFileTypes) {
        return cachedDir.map(e => ({
          name: e.name,
          isFile: () => e.isFile,
          isDirectory: () => e.isDirectory,
          isSymbolicLink: () => e.isSymbolicLink,
        }));
      }
      return cachedDir.map(e => e.name);
    }
    const xhr = global.__owSyncRequest('GET', '/api/fs/readdir?' + vaultQuery() + 'path=' + encodePath(p));
    const json = JSON.parse(xhr.responseText);
    const withFileTypes = opts && opts.withFileTypes;
    if (withFileTypes) {
      return json.map((e) => ({
        name: e.name,
        isFile: () => e.isFile,
        isDirectory: () => e.isDirectory,
        isSymbolicLink: () => e.isSymbolicLink,
      }));
    }
    return json.map((e) => e.name);
  }

  // ---- promises API ----------------------------------------------------

  function promisify(fn) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      return new Promise((resolve, reject) => {
        fn.apply(null, args.concat([(err, val) => err ? reject(err) : resolve(val)]));
      });
    };
  }

  const promises = {
    stat: promisify(statAsync),
    lstat: promisify(statAsync), // approximate
    readdir: promisify(readdirAsync),
    readFile: promisify(readFileAsync),
    writeFile: promisify(writeFileAsync),
    mkdir: promisify(mkdirAsync),
    unlink: promisify(unlinkAsync),
    rename: promisify(renameAsync),
    rmdir: promisify(rmdirAsync),
    rm: promisify(rmdirAsync),
    copyFile: promisify(copyFileAsync),
    access: promisify(accessAsync),
    realpath: async (p) => p, // identity is good enough for now
    appendFile: async (p, data, opts) => {
      // Simple read-modify-write.
      let existing = '';
      try { existing = await promises.readFile(p, 'utf8'); } catch (_) { /* new file */ }
      const next = existing + (typeof data === 'string' ? data : new TextDecoder().decode(data));
      return promises.writeFile(p, next, opts || 'utf8');
    },
    utimes: async () => { /* no-op for now */ },
  };

  // ---- fs.watch via WebSocket -----------------------------------------

  let watchSocket = null;
  const watchListeners = new Set();

  function ensureWatchSocket() {
    if (watchSocket && watchSocket.readyState <= 1) return watchSocket;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    watchSocket = new WebSocket(proto + '//' + location.host + '/api/watch' + (vaultId ? '?vault=' + encodeURIComponent(vaultId) : ''));
    watchSocket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'ready') return;
      console.log('[fs.watch] ws message:', msg.type, msg.path, '| listeners:', watchListeners.size);
      // Invalidate bootstrap cache for the changed path.
      // 'change' = content update: only evict the file from fs cache.
      //   Do NOT evict the parent dir listing — the file still exists there.
      // Structural events (add/unlink/addDir/unlinkDir/rename/reset): evict
      //   both the file and its parent dir listing so readdir re-fetches.
      if (msg.path) {
        const absPath = vaultBase + '/' + msg.path;
        if (msg.type === 'change') {
          const cache = global.__owBootstrapCache;
          if (cache && cache.fs) delete cache.fs[toRelative(absPath)];
        } else {
          invalidateBootstrap(absPath);
        }
      }
      for (const l of watchListeners) l(msg);
    };
    watchSocket.onclose = () => { watchSocket = null; };
    return watchSocket;
  }

  // fs.watch returns an FSWatcher (EventEmitter). Obsidian uses both
  // shapes: passing a callback as the 3rd arg AND chaining .on('change').on('error').
  // Our return value implements both.
  function watch(p, opts, listener) {
    if (typeof opts === 'function') { listener = opts; opts = {}; }
    ensureWatchSocket();
    const rel = toRelative(p).replace(/\\/g, '/');

    // Per-event-type listeners (for the .on() chain).
    const handlers = { change: new Set(), error: new Set(), rename: new Set(), close: new Set() };
    // The third-arg listener (Node fs.watch callback) receives ALL event types,
    // not just 'change'. Register it on both so rename events (add/delete/move)
    // reach it too.
    if (listener) {
      handlers.change.add(listener);
      handlers.rename.add(listener);
    }

    function emit(eventType, ...args) {
      for (const fn of handlers[eventType] || []) {
        try { fn(...args); } catch (e) { console.error('[fs.watch] handler error:', e); }
      }
    }

    const onMessage = (msg) => {
      if (!msg.path) return;
      // Filter: emit only events under the watched path.
      if (rel !== '' && msg.path !== rel && !msg.path.startsWith(rel + '/')) return;
      // Map chokidar event types to Node fs.watch's 'rename' / 'change'.
      // In Node.js fs.watch, the EventEmitter ALWAYS fires the 'change' event
      // regardless of rename vs. content change. The eventType string ('rename'
      // or 'change') is passed as the first argument to the callback so the
      // handler knows what happened. There is no separate 'rename' EventEmitter
      // event — Obsidian registers .on('change', fn) expecting all event types.
      const eventType = msg.type === 'change' ? 'change' : 'rename';
      const filename = rel === '' ? msg.path : msg.path.slice(rel.length + 1) || msg.path;
      emit('change', eventType, filename);
    };
    watchListeners.add(onMessage);

    const watcher = {
      on(eventType, fn) {
        if (handlers[eventType]) handlers[eventType].add(fn);
        return watcher;
      },
      off(eventType, fn) {
        if (handlers[eventType]) handlers[eventType].delete(fn);
        return watcher;
      },
      addListener(eventType, fn) { return watcher.on(eventType, fn); },
      removeListener(eventType, fn) { return watcher.off(eventType, fn); },
      removeAllListeners(eventType) {
        if (eventType && handlers[eventType]) handlers[eventType].clear();
        else for (const k in handlers) handlers[k].clear();
        return watcher;
      },
      close() {
        watchListeners.delete(onMessage);
        emit('close');
      },
      ref() { return watcher; },
      unref() { return watcher; },
    };
    return watcher;
  }

  // ---- module export ---------------------------------------------------

  const fsShim = {
    // async (callback) API
    stat: statAsync,
    lstat: statAsync,
    readdir: readdirAsync,
    readFile: readFileAsync,
    writeFile: writeFileAsync,
    mkdir: mkdirAsync,
    unlink: unlinkAsync,
    rename: renameAsync,
    rmdir: rmdirAsync,
    rm: rmdirAsync,
    copyFile: copyFileAsync,
    access: accessAsync,
    watch,
    // sync API
    statSync,
    lstatSync: statSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
    mkdirSync,
    readdirSync,
    existsSync,
    accessSync: (p) => { statSync(p); /* throws if missing */ },
    // constants
    constants: {
      F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
      O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2,
      O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024,
    },
    // promises namespace
    promises,
    // setTimes is what FileSystemAdapter calls to update mtime
    setTimes: function (p, atime, mtime, cb) {
      cb && cb(null);
    },
  };

  global.__owFs = fsShim;
  global.__owFs.setVaultBase = setVaultBase;
  global.__owFs.setVaultId = setVaultId;
})(window);
