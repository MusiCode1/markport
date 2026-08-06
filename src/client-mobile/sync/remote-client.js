/**
 * remote-client.js — thin HTTP client over the sync-server's `/sync/v1`
 * protocol (the pull-sync brief §2/§3א; server side lives in
 * `src/sync-server/`, a separate slice/package).
 *
 * `manifest()` → {cursor, entries:[{path,size,hash}]}, `blob(hash)` → bytes
 * (ArrayBuffer). Every request carries `Authorization: Bearer <token>` (brief
 * §3ה). `commit`/`putBlob` are v2 stubs — the server itself 501s them
 * (src/sync-server/stubs-v2.js); kept here only so callers have a stable
 * shape to feature-detect against later, not because v1 calls them.
 *
 * Browser-only (fetch) — window-attached IIFE, no module system (mirrors
 * opfs-store.js / folder-handle-store.js). Style: no `?.`/`??` (brief §3ו) —
 * otherwise free to use async/await/const/arrow like its siblings.
 */
(function () {
  'use strict';

  function joinUrl(baseUrl, path) {
    var base = String(baseUrl || '').replace(/\/+$/, '');
    return base + path;
  }

  // 401 is surfaced with a stable `.code === 'EAUTH'` so callers (run-pull.js)
  // can show "אימות נכשל" without a retry-loop (brief §3ה) instead of a
  // generic network-error message.
  function authError(message) {
    var e = new Error(message);
    e.code = 'EAUTH';
    return e;
  }

  // baseUrl + token — per-vault config (brief §3ה, `localStorage['ow-sync:'+vaultId]`).
  function RemoteClient(opts) {
    var baseUrl = opts.baseUrl;
    var token = opts.token;

    function authHeaders() {
      return { Authorization: 'Bearer ' + token };
    }

    // GET /sync/v1/manifest → {cursor, entries:[{path,size,hash}]}. `cache:
    // 'no-store'` — a sync decision must always be based on the CURRENT
    // server state, never a browser-cached one (unlike blob(), below, whose
    // URLs are content-addressed and safe to let the browser cache).
    async function manifest() {
      var res = await fetch(joinUrl(baseUrl, '/sync/v1/manifest'), { headers: authHeaders(), cache: 'no-store' });
      if (res.status === 401) throw authError('sync manifest: authentication failed (401)');
      if (!res.ok) throw new Error('sync manifest: HTTP ' + res.status);
      return res.json();
    }

    // GET /sync/v1/blob/<hash> → ArrayBuffer (raw bytes, content-addressed —
    // brief §3ג: the caller base64-encodes these bytes itself before handing
    // them to OpfsStore.writeFile; this client never touches base64).
    // Deliberately no `cache: 'no-store'` here (unlike manifest() above) —
    // the server marks this route `Cache-Control: immutable` (content
    // addressed by hash, can never change under the same URL), so letting
    // the browser's HTTP cache serve repeat requests is correct and saves
    // bandwidth. NOTE: this means the browser cache is NOT auth-scoped — a
    // second RemoteClient with a different token hitting the same
    // already-cached hash gets the cached body without a fresh 401 check.
    // That's fine for content-addressed immutable data (whoever cached it
    // already had legitimate access to that exact content) but matters for
    // tests exercising 401 behavior (use an as-yet-unfetched hash).
    async function blob(hash) {
      var res = await fetch(joinUrl(baseUrl, '/sync/v1/blob/' + hash), { headers: authHeaders() });
      if (res.status === 401) throw authError('sync blob: authentication failed (401)');
      if (!res.ok) throw new Error('sync blob: HTTP ' + res.status + ' for hash ' + hash);
      return res.arrayBuffer();
    }

    // v2 (brief §2 "commit/putBlob — stubs ל-v2") — server itself returns 501
    // for these; v1 never calls them. Kept for shape-stability only.
    async function commit() {
      throw new Error('RemoteClient.commit: not implemented (v2, push)');
    }
    async function putBlob() {
      throw new Error('RemoteClient.putBlob: not implemented (v2, push)');
    }

    return { manifest: manifest, blob: blob, commit: commit, putBlob: putBlob };
  }

  window.__owSyncRemoteClient = { RemoteClient: RemoteClient };
})();
