/**
 * local-manifest.js — builds the local side of the pull-sync decision
 * (the pull-sync brief §2/§3א). Wraps `OpfsStore.
 * watchAndStatAll()` (contract verified by executor spike §0.1(3): returns
 * `{children:[{name,type,size,mtime}]}`, `name` = full relative path,
 * including directories as `type:'directory'`), filters to files, and
 * computes each file's sha-256 content hash.
 *
 * CRITICAL (brief §3א, avigail finding-4/finding-3 round 2): `OpfsStore.
 * readFile` in binary mode returns **base64** (opfs-store.js:284-298,
 * `arrayBufferToBase64(buf)`), not raw bytes. Hashing that base64 STRING
 * would never match the server's sha-256-of-raw-bytes (server hashes the
 * file on disk directly, see src/sync-server/manifest.js `hashFile`) — every
 * file would permanently disagree, falling into decide-pull's row 3/6
 * (conflictSkip), i.e. sync silently does nothing. So this module reads raw
 * bytes DIRECTLY from OPFS (bypassing OpfsStore entirely for this one
 * purpose), duplicating only the default root-resolution
 * (`navigator.storage.getDirectory()/vaults/<vaultId>`) that OpfsStore uses
 * for 'local' vaults specifically (brief §3א v1-scope note — this module is
 * only ever invoked when `window.__owVaultType === 'local'`, guarded by the
 * caller in boot.js; a 'folder'/'server' root would need a different
 * resolution this module does not implement, v2).
 *
 * hash-cache (brief §3א finding 5): key = `path + '|' + mtime + '|' + size`
 * → hash, stored in hash-store.js's `cache` object store. An unchanged file
 * (same mtime+size since the last scan) skips the read+hash round-trip
 * entirely — hashing the whole vault on every "Sync now" click would be slow
 * and defeat the point of a hash-based protocol (brief §6 risk).
 *
 * Browser-only (OPFS + SubtleCrypto) — window-attached IIFE, no module
 * system, mirrors opfs-store.js. Style: no `?.`/`??` (brief §3ו).
 */
(function () {
  'use strict';

  // Direct-from-OPFS raw byte read for vault `vaultId`, path `relPath` —
  // mirrors OpfsStore's default getRoot ('local' vaults only, see file
  // header). Does NOT go through OpfsStore.readFile (that returns base64).
  async function readRawBytes(vaultId, relPath) {
    var root = await navigator.storage.getDirectory();
    var vaults = await root.getDirectoryHandle('vaults', { create: false });
    var vaultDir = await vaults.getDirectoryHandle(vaultId, { create: false });
    var parts = String(relPath).split('/').filter(function (p) { return p.length > 0; });
    var name = parts.pop();
    var cur = vaultDir;
    for (var i = 0; i < parts.length; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: false });
    }
    var fh = await cur.getFileHandle(name, { create: false });
    var file = await fh.getFile();
    return file.arrayBuffer();
  }

  // ArrayBuffer -> lowercase hex sha-256 (SubtleCrypto — same algorithm the
  // sync-server uses via node's `crypto.createHash('sha256')`; identity
  // verified empirically, executor spike §0.1(2)).
  async function sha256Hex(buf) {
    var digest = await crypto.subtle.digest('SHA-256', buf);
    var bytes = new Uint8Array(digest);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += h.length === 1 ? '0' + h : h;
    }
    return hex;
  }

  // store = OpfsStore instance (window.__owOpfsStore.makeStore(vaultId)).
  // hashStore = window.__owSyncHashStore.makeStore(vaultId) (for the cache;
  // this module never touches hashStore's `synced` half — that's
  // decide-pull's `S`, read by run-pull.js via hashStore.all()).
  // Returns {[path]: {hash, size}} — local-manifest's `L` per brief §3ב.
  async function buildLocalManifest(store, vaultId, hashStore) {
    var listing = await store.watchAndStatAll();
    var children = (listing && listing.children) || [];
    var result = {};

    for (var i = 0; i < children.length; i++) {
      var entry = children[i];
      if (entry.type !== 'file') continue; // filter dirs — brief §3א

      var cacheKey = entry.name + '|' + entry.mtime + '|' + entry.size;
      var hash = await hashStore.getCached(cacheKey);
      if (hash === undefined) {
        var buf = await readRawBytes(vaultId, entry.name);
        hash = await sha256Hex(buf);
        await hashStore.upsertCached(cacheKey, hash);
      }
      result[entry.name] = { hash: hash, size: entry.size };
    }

    return result;
  }

  window.__owSyncLocalManifest = {
    buildLocalManifest: buildLocalManifest,
    sha256Hex: sha256Hex,
    readRawBytes: readRawBytes,
  };
})();
