/**
 * decide-pull.js — pure decision function for the pull-sync engine (
 * brief server-sync-pull.md §3ב). Content-hash based (not mtime): given the
 * remote manifest, the local per-file hashes, and the last-synced-hash store,
 * decide per remote path whether to `download`, `skip`, or `conflictSkip`.
 *
 * No I/O here — network/OPFS/IndexedDB all live in the sibling adapters
 * (remote-client.js / local-manifest.js / hash-store.js). This module is
 * exercised directly by node:test (bun test), no browser needed.
 *
 * Inputs:
 *   remoteEntries — [{path, size, hash}] from RemoteClient.manifest().entries
 *   localHashes   — {[path]: {hash, size}} from local-manifest's
 *                   watchAndStatAll() output (⊥ = key absent)
 *   syncedHashes  — {[path]: hash} from hashStore.all() (lastSyncedHash per
 *                   path; ⊥ = key absent — path never synced before)
 *
 * Output: [{path, decision, size, hash}] — one entry per remote path, in the
 * same order as remoteEntries. `hash`/`size` are the REMOTE (R) values —
 * run-pull.js needs R to fetch the right blob and to upsert into hashStore
 * after a successful download.
 *
 * Decision table (L=localHash, R=remoteHash, S=lastSyncedHash; ⊥=absent):
 *   1. L == R                        → skip         (already in sync)
 *   2. L == ⊥                        → download      (server file, no local copy)
 *   3. L != R, S == ⊥                → conflictSkip  (never synced — can't tell if local diverged)
 *   4. L != R, L == S, R != S        → download      (local untouched, server changed — safe overwrite)
 *   5. L != R, L != S, R == S        → skip           (local diverged, server didn't — push is v2)
 *   6. L != R, L != S, R != S        → conflictSkip   (both sides changed — never overwrite silently)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.__owSyncDecidePull = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function decidePull(remoteEntries, localHashes, syncedHashes) {
    var local = localHashes || {};
    var synced = syncedHashes || {};
    var decisions = [];

    for (var i = 0; i < remoteEntries.length; i++) {
      var entry = remoteEntries[i];
      var path = entry.path;
      var R = entry.hash;
      var localEntry = Object.prototype.hasOwnProperty.call(local, path) ? local[path] : undefined;
      var L = localEntry ? localEntry.hash : undefined; // ⊥ if no local entry
      var S = Object.prototype.hasOwnProperty.call(synced, path) ? synced[path] : undefined; // ⊥ if never synced

      var decision;
      if (L === R) {
        decision = 'skip'; // row 1
      } else if (L === undefined) {
        decision = 'download'; // row 2
      } else if (S === undefined) {
        decision = 'conflictSkip'; // row 3
      } else if (L === S && R !== S) {
        decision = 'download'; // row 4
      } else if (L !== S && R === S) {
        decision = 'skip'; // row 5
      } else {
        decision = 'conflictSkip'; // row 6 (L != S, R != S)
      }

      decisions.push({ path: path, decision: decision, size: entry.size, hash: R });
    }

    return decisions;
  }

  return { decidePull: decidePull };
});
