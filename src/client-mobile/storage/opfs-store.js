/**
 * OPFS-backed store for obsidian-web mobile runtime.
 *
 * Independent module — mirrors the async method surface + return shapes of
 * the `Filesystem` plugin in `src/client-mobile/shims/capacitor-shim.js`
 * (readFile/writeFile/mkdir/readdir/stat/rename/copy/deleteFile/
 * watchAndStatAll/…), but backs every operation with the browser's Origin
 * Private File System (OPFS) instead of the HTTP `/api/fs/*` API.
 *
 * Not wired into the app yet — that happens in slice `opfs-wire`. This
 * module is loaded + exercised standalone by `test/opfs-store.selftest.html`.
 *
 * Usage:
 *   const store = window.__owOpfsStore.makeStore('my-vault-id');
 *   await store.writeFile({ path: 'Notes/foo.md', data: 'hi', encoding: 'utf8' });
 *
 * Path convention: keys are vault-relative, `/`-separated. Root is `''` or
 * `'/'`. `writeFile`/`mkdir`/`appendFile` on a deep path auto-create missing
 * parent directories (mirrors the server's mkdir-on-write behavior — LiveSync
 * writes into empty vaults and must not fail on missing ancestors).
 *
 * CRITICAL CONTRACT — watchAndStatAll must return a FLAT list where every
 * entry's `name` is its FULL path relative to the vault root, and no entry
 * carries a `children` property. This mirrors the fix for the production bug
 * of 2026-05-12 (nested trees only populated their root level because
 * CapacitorAdapter does `for (const i of e.children) this.quickList("", i)`
 * without recursing).
 */
(function () {
  'use strict';

  // ── low-level OPFS helpers ──────────────────────────────────────────────
  // (root-resolution helpers — resolveParent/resolveDir/statKind — live
  // inside makeStore now, see "root pluggable" note there: they need access
  // to the per-store getVaultRoot, which for 'folder' vaults is the picked
  // FileSystemDirectoryHandle instead of OPFS's navigator.storage.getDirectory().)

  // base64 string → ArrayBuffer — same shape as capacitor-shim:78
  function base64ToArrayBuffer(b64) {
    const bin = atob(b64 || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  // ArrayBuffer → base64 (chunked — btoa blows the arg stack at ~65k), same
  // as capacitor-shim:86.
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  // A vault-root `.git` is repository plumbing, not vault content: it belongs
  // to git (storage/git-writer.js writes one for GitHub vaults, and any folder
  // the user picks may already be a checkout), and Obsidian has no use for it.
  // Excluded from the two RECURSIVE walks only — a real repository holds one
  // loose object per file version, so walking it would double (or worse) the
  // cost of every vault-open snapshot and every rescan, to build a listing
  // whose every entry is then ignored. Root-level only: a `.git` deeper in the
  // tree is a submodule's, and not ours to decide about.
  const VAULT_WALK_SKIP_AT_ROOT = { '.git': true };

  function capError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  function rethrowAsEnoent(e, message) {
    if (e && typeof e.code === 'string') throw e; // real capError (code is a string, e.g. 'ENOENT'); DOMException.code is numeric
    throw capError('ENOENT', message);
  }

  // ── store factory ────────────────────────────────────────────────────────

  // makeStore(vaultId, { getRoot, isFolder }) — `getRoot` is a pluggable
  // root-directory provider: `async ({ create }) => FileSystemDirectoryHandle`.
  // Default (no getRoot passed) reproduces the exact OPFS layout used before
  // this refactor — `navigator.storage.getDirectory()/vaults/<vaultId>` — so
  // existing (OPFS) callers are unaffected. A `folder` vault (real
  // directory picked via showDirectoryPicker) passes its own getRoot that
  // returns the picked handle directly (no `/vaults/<id>` nesting — the
  // handle itself IS the vault root). `isFolder: true` additionally gates
  // the external-change watch below (docs/plans/folder-watch.md §2, reused
  // from folder-refresh) — OPFS-backed `local` vaults can never change
  // behind our back (the browser is the only writer), so the watch must
  // stay a no-op there (DoD#4).
  function makeStore(vaultId, { getRoot, isFolder } = {}) {
    const getVaultRoot = getRoot || (async ({ create = false } = {}) => {
      const root = await navigator.storage.getDirectory();
      const vaults = await root.getDirectoryHandle('vaults', { create });
      return vaults.getDirectoryHandle(vaultId, { create });
    });

    // Walk to the parent directory handle of `relPath`, returns {parent, name}.
    // `create` applies to the vault root AND every intermediate segment —
    // i.e. create:true auto-creates the whole ancestor chain (mkdir-on-write).
    async function resolveParent(relPath, { create = false } = {}) {
      const dir = await getVaultRoot({ create });
      const parts = String(relPath).split('/').filter(Boolean);
      const name = parts.pop();
      let cur = dir;
      for (const part of parts) cur = await cur.getDirectoryHandle(part, { create });
      return { parent: cur, name };
    }

    // Walk to the directory handle AT `relPath` itself (used by readdir/stat-dir/
    // rmdir-target/copy-dir-dest). Root ('' or '/') resolves to the vault root.
    async function resolveDir(relPath, { create = false } = {}) {
      let cur = await getVaultRoot({ create });
      const parts = String(relPath || '').split('/').filter(Boolean);
      for (const part of parts) cur = await cur.getDirectoryHandle(part, { create });
      return cur;
    }

    // 'file' | 'directory' | null (root '' / '/' is always 'directory')
    async function statKind(relPath) {
      const normalized = String(relPath || '').replace(/^\/+|\/+$/g, '');
      if (normalized === '') return 'directory';
      try {
        const { parent, name } = await resolveParent(normalized, { create: false });
        try {
          await parent.getFileHandle(name, { create: false });
          return 'file';
        } catch (_) {
          try {
            await parent.getDirectoryHandle(name, { create: false });
            return 'directory';
          } catch (__) {
            return null;
          }
        }
      } catch (_) {
        return null;
      }
    }

    // low-level raw (ArrayBuffer) read/write, used internally by copy/rename
    // so they don't pay a redundant base64 round-trip.
    async function readFileRaw(relPath) {
      try {
        const { parent, name } = await resolveParent(relPath, { create: false });
        const fh = await parent.getFileHandle(name, { create: false });
        const file = await fh.getFile();
        return await file.arrayBuffer();
      } catch (e) {
        rethrowAsEnoent(e, 'readFile: not found: ' + relPath);
      }
    }

    async function writeFileRaw(relPath, arrayBuffer) {
      const { parent, name } = await resolveParent(relPath, { create: true });
      const fh = await parent.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(arrayBuffer);
      } finally {
        await w.close();
      }
    }

    async function copyPath(fromPath, toPath) {
      const kind = await statKind(fromPath);
      if (kind === null) throw capError('ENOENT', 'copy: source not found: ' + fromPath);
      if (kind === 'file') {
        const data = await readFileRaw(fromPath);
        await writeFileRaw(toPath, data);
      } else {
        await resolveDir(toPath, { create: true }); // ensure dest dir exists
        const srcDir = await resolveDir(fromPath, { create: false });
        for await (const [name, handle] of srcDir.entries()) {
          const childFrom = fromPath ? fromPath + '/' + name : name;
          const childTo = toPath ? toPath + '/' + name : name;
          if (handle.kind === 'directory') {
            await copyPath(childFrom, childTo);
          } else {
            const f = await handle.getFile();
            await writeFileRaw(childTo, await f.arrayBuffer());
          }
        }
      }
    }

    async function removePath(relPath) {
      const kind = await statKind(relPath);
      if (kind === null) throw capError('ENOENT', 'remove: not found: ' + relPath);
      try {
        const { parent, name } = await resolveParent(relPath, { create: false });
        await parent.removeEntry(name, { recursive: kind === 'directory' });
      } catch (e) {
        rethrowAsEnoent(e, 'remove failed: ' + relPath);
      }
    }

    // ── external-change watch (folder vaults only — docs/plans/folder-watch.md §2,
    // reused from slice/folder-refresh, which already verified DoD#3/4/5 there) ──
    // 'local' (OPFS) vaults can never change behind our back — the browser is
    // the only writer. 'folder' vaults (a real directory, opened via
    // showDirectoryPicker) CAN change externally (another app, a sync
    // client, another tab/device on the same directory). This store is the
    // only place that knows both `isFolder` and the real root handle, so the
    // watch lives here — gated by `isFolder` (DoD#4).
    //
    // The callback fed here is the one captured through `addListener('change',
    // cb)` below — NOT `startWatch` (a permanent no-op, see below; the bundle
    // registers its file-watcher listener through addListener — see
    // docs/plans/folder-watch.md §0/§3א for how the callback now actually
    // reaches here through the fixed Capacitor dispatch).
    let changeCb = null;
    let watchSetupPromise = null;   // idempotent guard — observe()/baseline runs once per addListener('change', ...)
    let activeObserver = null;      // FileSystemObserver instance, when the primary path is active (for stopWatch)
    let rescanBaseline = null;      // Map<relPath, {dir, size, mtime}> — rescan() fallback's comparison snapshot
    let __owSuppressWatch = 0;      // Date.now() deadline — self-write echo suppression (see markSelfWrite)

    // Widen the suppression window around our own writes so the resulting
    // FileSystemObserver record (or a later rescan() diff) isn't re-announced
    // as an "external" change. Not a synchronous flag: an empirical spike
    // (folder-refresh, against real Chromium — FileSystemObserver on OPFS)
    // showed records land ~300-800ms after the write's createWritable().close()
    // resolves — a hard "clear right after the op" flag would miss them.
    // 900ms leaves margin without masking a genuinely-fast external edit.
    const SELF_WRITE_SUPPRESS_MS = 900;
    function markSelfWrite() { __owSuppressWatch = Date.now() + SELF_WRITE_SUPPRESS_MS; }

    // Feed one changed path to the callback captured by addListener('change',
    // cb). vaultId-prefixed — the callback strips basePath (=vaultId) before
    // matching against the vault; an un-prefixed path gets mangled. `type` is
    // left for the bundle to decide — only `path` is fed in.
    function emitChange(relPath) {
      if (!changeCb) return;
      if (Date.now() < __owSuppressWatch) return; // our own write — swallow the echo
      // Same exclusion as the two walks above, and for the same reason: the
      // vault listing never contained `.git`, so announcing a change inside it
      // would point Obsidian at a path it does not know exists — and a single
      // `git checkout` would fire thousands of them.
      if (VAULT_WALK_SKIP_AT_ROOT[String(relPath).split('/')[0]]) return;
      changeCb({ path: vaultId + '/' + relPath });
    }

    // Walk `dirHandle` (mirrors watchAndStatAll's walk, see below) into a
    // flat Map<relPath, {dir, size, mtime}> — rescan()'s comparison baseline.
    async function snapshotTree(dirHandle) {
      const map = new Map();
      async function walk(handle, prefix) {
        for await (const [name, child] of handle.entries()) {
          if (!prefix && VAULT_WALK_SKIP_AT_ROOT[name]) continue;
          const relPath = prefix ? prefix + '/' + name : name;
          if (child.kind === 'directory') {
            map.set(relPath, { dir: true, size: 0, mtime: 0 });
            await walk(child, relPath);
          } else {
            const f = await child.getFile();
            map.set(relPath, { dir: false, size: f.size, mtime: f.lastModified });
          }
        }
      }
      await walk(dirHandle, '');
      return map;
    }

    // primary: FileSystemObserver (feature-detected) → watch the folder root
    // recursively, feed every record to emitChange. Runs once per
    // addListener('change', ...) call (idempotent via watchSetupPromise).
    // Unsupported → prepares rescan()'s baseline instead; the actual
    // fallback triggers (visibilitychange + button) live in boot.js, both
    // call store.rescan().
    function ensureFolderWatch() {
      if (!isFolder || !changeCb) return Promise.resolve();
      if (watchSetupPromise) return watchSetupPromise;
      watchSetupPromise = (async () => {
        let root;
        try {
          root = await getVaultRoot({ create: false });
        } catch (_) {
          watchSetupPromise = null; // handle not granted yet — allow a retry on the next addListener
          return;
        }
        if (typeof self !== 'undefined' && 'FileSystemObserver' in self) {
          activeObserver = new self.FileSystemObserver((records) => {
            for (const r of records) {
              const comps = (r && r.relativePathComponents) || [];
              if (comps.length) emitChange(comps.join('/'));
            }
          });
          await activeObserver.observe(root, { recursive: true });
        } else {
          rescanBaseline = await snapshotTree(root); // rescan() diffs against this from now on
        }
      })();
      return watchSetupPromise;
    }

    return {

      async readFile(opts) {
        const encoding = opts.encoding; // 'utf8' | undefined (binary = base64)
        try {
          const { parent, name } = await resolveParent(opts.path, { create: false });
          const fh = await parent.getFileHandle(name, { create: false });
          const file = await fh.getFile();
          if (encoding) {
            return { data: await file.text() };
          }
          const buf = await file.arrayBuffer();
          return { data: arrayBufferToBase64(buf) };
        } catch (e) {
          rethrowAsEnoent(e, 'readFile: not found: ' + opts.path);
        }
      },

      async writeFile(opts) {
        // self-write echo suppression (reused from folder-refresh): mark
        // BEFORE the mutation starts, not just after. An empirical spike
        // there (bun /tmp/spike-suppress.js against real Chromium) showed
        // FileSystemObserver's "appeared" record lands within a few ms of
        // getFileHandle({create:true})/createWritable() — often BEFORE
        // write()/close() even resolve — so marking only in a trailing
        // `finally` misses it. Marking again after close() extends the
        // window past completion for any trailing "modified" record too.
        markSelfWrite();
        const encoding = opts.encoding;
        const { parent, name } = await resolveParent(opts.path, { create: true });
        const fh = await parent.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        try {
          if (encoding) {
            await w.write(String(opts.data));
          } else {
            await w.write(base64ToArrayBuffer(opts.data));
          }
        } finally {
          await w.close();
          markSelfWrite();
        }
        return { uri: '' };
      },

      // appendFile: byte-exact `old ⧺ new` — this is the path LiveSync uses
      // for binary chunk writes. Creates the file (+ missing parents) if it
      // doesn't exist yet.
      async appendFile(opts) {
        markSelfWrite(); // self-write echo suppression — see writeFile's comment above
        const { parent, name } = await resolveParent(opts.path, { create: true });
        let existing = new Uint8Array(0);
        let fh;
        try {
          fh = await parent.getFileHandle(name, { create: false });
          const f = await fh.getFile();
          existing = new Uint8Array(await f.arrayBuffer());
        } catch (_) {
          fh = await parent.getFileHandle(name, { create: true });
        }
        const toAppend = new Uint8Array(base64ToArrayBuffer(opts.data));
        const combined = new Uint8Array(existing.length + toAppend.length);
        combined.set(existing, 0);
        combined.set(toAppend, existing.length);
        const w = await fh.createWritable();
        try {
          await w.write(combined.buffer);
        } finally {
          await w.close();
          markSelfWrite();
        }
        return {};
      },

      async deleteFile(opts) {
        try {
          const { parent, name } = await resolveParent(opts.path, { create: false });
          await parent.removeEntry(name);
        } catch (e) {
          rethrowAsEnoent(e, 'deleteFile: not found: ' + opts.path);
        }
        return {};
      },

      async mkdir(opts) {
        markSelfWrite(); // self-write echo suppression — see writeFile's comment above
        const dir = await getVaultRoot({ create: true });
        const parts = String(opts.path).split('/').filter(Boolean);
        let cur = dir;
        const lastIdx = parts.length - 1;
        for (let i = 0; i < parts.length; i++) {
          const createFlag = !!opts.recursive || i === lastIdx;
          cur = await cur.getDirectoryHandle(parts[i], { create: createFlag });
        }
        markSelfWrite();
        return {};
      },

      async rmdir(opts) {
        try {
          const { parent, name } = await resolveParent(opts.path, { create: false });
          await parent.removeEntry(name, { recursive: !!opts.recursive });
        } catch (e) {
          rethrowAsEnoent(e, 'rmdir failed: ' + opts.path);
        }
        return {};
      },

      async readdir(opts) {
        try {
          const dir = await resolveDir(opts.path, { create: false });
          const files = [];
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'directory') {
              files.push({ name, type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' });
            } else {
              const f = await handle.getFile();
              files.push({ name, type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified, uri: '' });
            }
          }
          return { files };
        } catch (e) {
          rethrowAsEnoent(e, 'readdir: not found: ' + opts.path);
        }
      },

      async stat(opts) {
        const normalized = String(opts.path || '').replace(/^\/+|\/+$/g, '');
        if (normalized === '') {
          return { type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' };
        }
        try {
          const { parent, name } = await resolveParent(normalized, { create: false });
          try {
            const fh = await parent.getFileHandle(name, { create: false });
            const f = await fh.getFile();
            return { type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified, uri: '' };
          } catch (_) {
            await parent.getDirectoryHandle(name, { create: false }); // throws if neither
            return { type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' };
          }
        } catch (e) {
          rethrowAsEnoent(e, 'stat: not found: ' + opts.path);
        }
      },

      // rename = copy + delete (OPFS has no atomic rename). Verify the
      // destination exists before removing the source so a failed copy
      // never loses data.
      async rename(opts) {
        const kind = await statKind(opts.from);
        if (kind === null) throw capError('ENOENT', 'rename: source not found: ' + opts.from);
        await copyPath(opts.from, opts.to);
        const destKind = await statKind(opts.to);
        if (destKind === null) throw capError('EIO', 'rename: copy to destination failed: ' + opts.to);
        await removePath(opts.from);
        return {};
      },

      async copy(opts) {
        await copyPath(opts.from, opts.to);
        return {};
      },

      async trash(opts) {
        // No real trash on OPFS — delegate to deleteFile (mirrors capacitor-shim).
        return this.deleteFile(opts);
      },

      async getUri(opts) {
        // Obsidian calls getUri({path:''}) at vault-open to build a base uri,
        // then string-concatenates <vaultId>/<relPath> onto it per-attachment
        // client-side (spike finding, folder-vault-blob-uri) — this must
        // never throw (mirrors HttpFilesystem.getUri).
        //
        // sw-vault-resources §3א: the base uri is now an **http** URL served
        // by the Service Worker's `/_owres/` handler (sw.js) straight out of
        // OPFS/folder-handle — one mechanism for every binary type (img/PDF/
        // video/audio), replacing the invented `ow-vault:` scheme the browser
        // blocked, and replacing per-file blob URLs (rejected — see brief §2,
        // "not one mechanism"). Obsidian's client-side concat produces the
        // expected double-id path `/_owres/<id>/<id>/<rel>`, normalized by
        // the SW handler.
        const rel = String(opts.path || '').replace(/^\/+|\/+$/g, '');
        return { uri: location.origin + '/_owres/' + vaultId + (rel ? '/' + rel : '/') };
      },

      // 'local' (OPFS) vaults can never change behind our back — startWatch
      // stays a permanent no-op there. 'folder' vaults CAN (docs/plans/
      // folder-watch.md) — but the bundle doesn't actually call startWatch to
      // register its change listener, it calls addListener('change', cb)
      // below — that's where the watch is actually wired.
      async startWatch() { return {}; },
      async stopWatch() {
        if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
        watchSetupPromise = null;
        rescanBaseline = null;
        return {};
      },
      async addListener(eventName, callback) {
        if (eventName === 'change') {
          changeCb = callback;
          if (isFolder) {
            try { await ensureFolderWatch(); }
            catch (e) { console.warn('[ow] folder watch setup failed', e); }
          }
        }
        return {
          remove() {
            if (changeCb === callback) changeCb = null;
          },
        };
      },

      // Fallback path (no FileSystemObserver) — walk + diff against the
      // baseline captured by ensureFolderWatch(), emit one change per
      // create/modify/delete, then adopt the new snapshot as the baseline.
      // Folder-only (DoD#4) — no-op on 'local'/'server' backends. Triggered
      // by boot.js on document visibilitychange + a manual refresh button;
      // safe to call at any time, including when the primary (observer)
      // path is active (cheap manual fallback either way).
      async rescan() {
        if (!isFolder) return { changed: 0 };
        let root;
        try { root = await getVaultRoot({ create: false }); }
        catch (_) { return { changed: 0 }; }
        const next = await snapshotTree(root);
        if (!rescanBaseline) { rescanBaseline = next; return { changed: 0 }; } // first call — just capture
        let changed = 0;
        for (const [relPath, meta] of next) {
          const prev = rescanBaseline.get(relPath);
          if (!prev || prev.dir !== meta.dir || prev.size !== meta.size || prev.mtime !== meta.mtime) {
            emitChange(relPath);
            changed++;
          }
        }
        for (const relPath of rescanBaseline.keys()) {
          if (!next.has(relPath)) { emitChange(relPath); changed++; }
        }
        rescanBaseline = next;
        return { changed };
      },

      async watchAndStatAll() {
        const children = [];
        async function walk(dirHandle, prefix) {
          for await (const [name, handle] of dirHandle.entries()) {
            if (!prefix && VAULT_WALK_SKIP_AT_ROOT[name]) continue;
            const relPath = prefix ? prefix + '/' + name : name;
            if (handle.kind === 'directory') {
              children.push({ name: relPath, type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' });
              await walk(handle, relPath);
            } else {
              const f = await handle.getFile();
              children.push({ name: relPath, type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified, uri: '' });
            }
          }
        }
        const dir = await getVaultRoot({ create: true });
        await walk(dir, '');
        return { children };
      },

      async setTimes() { return {}; },
      async verifyIcloud() { return {}; },
      async open() { return {}; },

      async checkPerms() { return { publicStorage: 'granted' }; },
      async requestPermissions() { return { publicStorage: 'granted' }; },
      async requestPerms() { return { publicStorage: 'granted' }; },
      async choose() { return null; },
    };
  }

  window.__owOpfsStore = { makeStore };
})();
