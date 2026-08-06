/**
 * hash-store.js — IndexedDB persistence for the pull-sync engine (
 * brief server-sync-pull.md §2/§3א/§3ג). Pattern copied from
 * `folder-handle-store.js` (window-attached IIFE, one DB per purpose,
 * Promise-wrapped indexedDB callbacks) — browser-only (indexedDB isn't
 * available under bun test), so this module is exercised by the browser
 * integration harness, not node:test.
 *
 * One IndexedDB database per vault, `'ow-sync:' + vaultId`, holding two
 * independent object stores:
 *
 *  - `synced`  — per-path `lastSyncedHash` (brief §3ב's `S`): the hash a path
 *    had the last time run-pull.js wrote it to OPFS. `get/upsert/all/remove`
 *    (exact API named in brief §2).
 *  - `cache`   — the hash-cache from brief §3א finding 5: key = `path + '|' +
 *    mtime + '|' + size` → hash. Lets local-manifest.js skip re-reading +
 *    re-hashing a file whose (mtime,size) haven't changed since the last
 *    scan (hashing the whole vault on every "Sync now" would defeat the
 *    point of hash-based sync — brief §6 risk).
 */
(function () {
  'use strict';

  function dbNameFor(vaultId) { return 'ow-sync:' + vaultId; }
  var SYNCED_STORE = 'synced';
  var CACHE_STORE = 'cache';
  var DB_VERSION = 1;

  function openDb(vaultId) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(dbNameFor(vaultId), DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(SYNCED_STORE)) db.createObjectStore(SYNCED_STORE);
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txGet(db, storeName, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readonly');
      var req = tx.objectStore(storeName).get(key);
      req.onsuccess = function () { resolve(req.result); }; // undefined if absent (⊥)
      req.onerror = function () { reject(req.error); };
    });
  }

  function txPut(db, storeName, key, value) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function txDelete(db, storeName, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  // {[key]: value} — used by `all()` to build syncedHashes for decide-pull.js.
  function txGetAllAsMap(db, storeName) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readonly');
      var store = tx.objectStore(storeName);
      var out = {};
      var cursorReq = store.openCursor();
      cursorReq.onsuccess = function () {
        var cursor = cursorReq.result;
        if (cursor) {
          out[cursor.key] = cursor.value;
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      cursorReq.onerror = function () { reject(cursorReq.error); };
    });
  }

  function makeStore(vaultId) {
    var dbPromise = null;
    function getDb() {
      if (!dbPromise) dbPromise = openDb(vaultId);
      return dbPromise;
    }

    return {
      // lastSyncedHash API (brief §2 — exact names: get/upsert/all/remove)
      get: async function (path) {
        var db = await getDb();
        return txGet(db, SYNCED_STORE, path);
      },
      upsert: async function (path, hash) {
        var db = await getDb();
        return txPut(db, SYNCED_STORE, path, hash);
      },
      all: async function () {
        var db = await getDb();
        return txGetAllAsMap(db, SYNCED_STORE);
      },
      remove: async function (path) {
        var db = await getDb();
        return txDelete(db, SYNCED_STORE, path);
      },

      // hash-cache API (brief §3א finding 5) — local-manifest.js's internal use.
      getCached: async function (cacheKey) {
        var db = await getDb();
        return txGet(db, CACHE_STORE, cacheKey);
      },
      upsertCached: async function (cacheKey, hash) {
        var db = await getDb();
        return txPut(db, CACHE_STORE, cacheKey, hash);
      },
    };
  }

  window.__owSyncHashStore = { makeStore: makeStore };
})();
