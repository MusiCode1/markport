'use strict';

/**
 * Server-backed window.localStorage replacement.
 *
 * Why: Obsidian and its plugins store state in localStorage — most
 * importantly the safeStorage keychain tokens (see electron.js shim).
 * Browser localStorage is per-device AND per-origin, so secrets entered on
 * one PC don't roam to another, and http://nas:3005 vs the cloudflared URL
 * don't even share state on the same PC. This shim makes localStorage live
 * server-side (user-data/.localstorage.json) so it follows the vault,
 * matching real Electron semantics (one install = one shared store).
 *
 * Keys prefixed 'obsidian-web:' (layout mode, last vault id) are deliberately
 * device-local and keep using the native localStorage.
 *
 * Install contract: boot.js calls window.__owInstallRemoteLocalStorage()
 * BEFORE injecting Obsidian's scripts and waits for the returned promise.
 * On failure the native localStorage stays in place (old behavior).
 */
(function () {
  var LOCAL_PREFIX = 'obsidian-web:'; // stays per-device
  var FLUSH_DELAY_MS = 300;

  window.__owInstallRemoteLocalStorage = function () {
    var native = window.localStorage;

    return fetch('/api/localstorage')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (serverData) {
        var mem = {};
        Object.keys(serverData).forEach(function (k) { mem[k] = String(serverData[k]); });

        // One-time migration: keys already in this device's native storage
        // but missing on the server get uploaded, so the first PC that runs
        // this seeds the server store with its existing tokens/state.
        var seed = {};
        var seeded = 0;
        for (var i = 0; i < native.length; i++) {
          var k = native.key(i);
          if (k.indexOf(LOCAL_PREFIX) === 0) continue;
          if (!(k in mem)) {
            var v = native.getItem(k);
            mem[k] = v;
            seed[k] = v;
            seeded++;
          }
        }

        // ── Debounced write-through ──────────────────────────────────────
        var pending = {};      // key → value|null
        var hasPending = false;
        var timer = null;

        function queue(key, value) {
          pending[key] = value;
          hasPending = true;
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, FLUSH_DELAY_MS);
        }

        function flush() {
          if (!hasPending) return;
          var entries = pending;
          pending = {};
          hasPending = false;
          timer = null;
          fetch('/api/localstorage', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: entries }),
          }).catch(function (e) {
            console.warn('[obsidian-web] localStorage flush failed:', e && e.message);
          });
        }

        // Last-chance flush when the tab closes. keepalive lets the PUT
        // survive page unload (sendBeacon can't be used — it only POSTs).
        window.addEventListener('pagehide', function () {
          if (!hasPending) return;
          var entries = pending;
          pending = {};
          hasPending = false;
          try {
            fetch('/api/localstorage', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ entries: entries }),
              keepalive: true,
            });
          } catch (_) {}
        });

        // ── Storage-compatible facade ────────────────────────────────────
        var storageShim = {
          getItem: function (key) {
            key = String(key);
            if (key.indexOf(LOCAL_PREFIX) === 0) return native.getItem(key);
            return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
          },
          setItem: function (key, value) {
            key = String(key); value = String(value);
            if (key.indexOf(LOCAL_PREFIX) === 0) return native.setItem(key, value);
            mem[key] = value;
            queue(key, value);
          },
          removeItem: function (key) {
            key = String(key);
            if (key.indexOf(LOCAL_PREFIX) === 0) return native.removeItem(key);
            if (Object.prototype.hasOwnProperty.call(mem, key)) {
              delete mem[key];
              queue(key, null);
            }
          },
          clear: function () {
            Object.keys(mem).forEach(function (k) { queue(k, null); });
            mem = {};
            // Native obsidian-web: keys are intentionally kept.
          },
          key: function (n) {
            var keys = Object.keys(mem);
            return n >= 0 && n < keys.length ? keys[n] : null;
          },
        };
        Object.defineProperty(storageShim, 'length', {
          get: function () { return Object.keys(mem).length; },
        });

        // Proxy catches direct property access (localStorage.foo = 'x' /
        // localStorage['foo']) which some plugins use instead of setItem.
        var proxy = new Proxy(storageShim, {
          get: function (target, prop) {
            if (prop in target) {
              var v = target[prop];
              return typeof v === 'function' ? v.bind(target) : v;
            }
            if (typeof prop === 'symbol') return undefined;
            var item = target.getItem(prop);
            return item === null ? undefined : item;
          },
          set: function (target, prop, value) {
            if (typeof prop !== 'symbol') target.setItem(prop, value);
            return true;
          },
          deleteProperty: function (target, prop) {
            if (typeof prop !== 'symbol') target.removeItem(prop);
            return true;
          },
          has: function (target, prop) {
            return prop in target || target.getItem(prop) !== null;
          },
          ownKeys: function () {
            return Object.keys(mem);
          },
          getOwnPropertyDescriptor: function (target, prop) {
            if (typeof prop === 'symbol' || !(prop in mem)) return undefined;
            return { value: mem[prop], writable: true, enumerable: true, configurable: true };
          },
        });

        Object.defineProperty(window, 'localStorage', {
          value: proxy,
          configurable: true,
        });

        // Upload the migration seed after install so it can't race the map.
        if (seeded > 0) {
          Object.keys(seed).forEach(function (k) { queue(k, seed[k]); });
          console.log('[obsidian-web] remote localStorage: seeded ' + seeded + ' local keys to server');
        }

        console.log('[obsidian-web] remote localStorage installed (' + Object.keys(mem).length + ' keys)');
      });
  };
})();
