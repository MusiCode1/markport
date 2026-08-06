/**
 * run-pull.js — pull-sync orchestrator (the pull-sync brief
 * §2/§3ד). Wires the other 4 sync/ modules together into one "Sync now"
 * flow: list (remote manifest) → hash (local manifest) → decide
 * (decide-pull.js) → download (blob → OPFS write → hash-store upsert).
 *
 * Config + auth (brief §3ה): `localStorage['ow-sync:'+vaultId]` =
 * `{baseUrl, token}`. No config for a vault → `getSyncConfig` returns null
 * → caller (boot.js) never shows the button / never calls run().
 *
 * mutex (brief §3ד): `syncStatus` cycles idle→listing→hashing→deciding→
 * downloading→finish→idle. A second run() while not idle is a no-op
 * (`{skipped:true, reason:'busy'}`), never queues/overlaps.
 *
 * v1 = OPFS-local vaults only (brief §3א round-3 finding): this module
 * itself doesn't re-check `window.__owVaultType` — the boot.js trigger does,
 * before ever calling run() (single guard point, brief §5 DoD#6).
 *
 * Browser-only — window-attached IIFE, no module system. Style: no `?.`/`??`.
 */
(function () {
  'use strict';

  // ArrayBuffer → base64, chunked (btoa blows the arg stack at ~65k bytes —
  // opfs-store.js:46-55 documents the same limit for its own private
  // `arrayBufferToBase64`, which is NOT exported — brief §3ג finding 1+2).
  // Anchored by symbol name (opfs-store.js's `arrayBufferToBase64`), not by
  // line range, per avigail's anchoring note.
  function arrayBufferToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var CHUNK = 0x8000;
    var s = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function configKeyFor(vaultId) { return 'ow-sync:' + vaultId; }

  // {baseUrl, token} | null — brief §3ה. No settings-UI in v1 (§2 "מחוץ") —
  // set via localStorage directly (devtools / a future settings command).
  function getSyncConfig(vaultId) {
    try {
      var raw = localStorage.getItem(configKeyFor(vaultId));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.baseUrl || !parsed.token) return null;
      return { baseUrl: parsed.baseUrl, token: parsed.token };
    } catch (_) {
      return null;
    }
  }

  function setSyncConfig(vaultId, cfg) {
    localStorage.setItem(configKeyFor(vaultId), JSON.stringify({ baseUrl: cfg.baseUrl, token: cfg.token }));
  }

  var syncStatus = 'idle'; // idle → listing → hashing → deciding → downloading → finish → idle

  function getStatus() { return syncStatus; }

  // Runs one pull-sync pass for `vaultId` against `{baseUrl, token}`.
  // Returns {downloaded, skipped, conflicts, total} on success, or
  // {skipped:true, reason:'busy'} if a run is already in flight (mutex,
  // brief §3ד — no queueing, just a no-op).
  async function runPull(vaultId, cfg) {
    if (syncStatus !== 'idle') return { skipped: true, reason: 'busy' };

    syncStatus = 'listing';
    try {
      var store = window.__owOpfsStore.makeStore(vaultId);
      var hashStore = window.__owSyncHashStore.makeStore(vaultId);
      var remote = window.__owSyncRemoteClient.RemoteClient({ baseUrl: cfg.baseUrl, token: cfg.token });

      var remoteManifest = await remote.manifest(); // may throw {code:'EAUTH'}

      syncStatus = 'hashing';
      var localManifest = await window.__owSyncLocalManifest.buildLocalManifest(store, vaultId, hashStore);

      syncStatus = 'deciding';
      var syncedHashes = await hashStore.all();
      var decisions = window.__owSyncDecidePull.decidePull(remoteManifest.entries, localManifest, syncedHashes);

      syncStatus = 'downloading';
      var downloaded = 0;
      var skipped = 0;
      var conflicts = 0;
      var conflictPaths = [];

      for (var i = 0; i < decisions.length; i++) {
        var d = decisions[i];
        if (d.decision === 'download') {
          var buf = await remote.blob(d.hash);
          var base64 = arrayBufferToBase64(buf);
          await store.writeFile({ path: d.path, data: base64 }); // binary — no `encoding` (brief §3ג)
          await hashStore.upsert(d.path, d.hash);
          downloaded++;
        } else if (d.decision === 'skip') {
          skipped++;
        } else { // conflictSkip
          conflicts++;
          conflictPaths.push(d.path);
        }
      }

      syncStatus = 'finish';
      return { downloaded: downloaded, skipped: skipped, conflicts: conflicts, total: decisions.length, conflictPaths: conflictPaths };
    } finally {
      syncStatus = 'idle';
    }
  }

  window.__owSyncRunPull = {
    run: runPull,
    getStatus: getStatus,
    getSyncConfig: getSyncConfig,
    setSyncConfig: setSyncConfig,
  };
})();
