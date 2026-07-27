/**
 * local-vault-registry.js
 *
 * Browser-side registry of "local" vaults (OPFS-backed, no server round-trip)
 * — as opposed to "server" vaults which live in the server's registry and
 * are served over /api/fs. Backed by localStorage so it persists across
 * reloads without any server involvement.
 *
 * Lives in `client-mobile/` — consumed exclusively by the mobile runtime
 * (index.html, new-local.html, capacitor-shim.js, boot.js,
 * folder-handle-store.js). The desktop runtime does not use `__owLocalVaults`
 * at all. Relocated here from `client/` in slice relocate-registry (epic
 * mobile-first) to decouple the mobile runtime from the desktop tree.
 *
 * See docs/plans/local-vaults-implementation.md → Phase 2a,
 * docs/plans/opfs-wire.md → §4 Commit 0.
 *
 * `create(name, opts)` accepts an optional `opts.id` (docs/plans/seed-demo.md
 * §3א) — a fixed id, used by the lazy Demo vault (ensureDemo, boot.js) so
 * repeated boots resolve to the SAME OPFS-backed vault instead of minting a
 * new one every time. Existing callers that omit `opts.id` are unaffected
 * (falls back to `uuid()`, today's behavior — brief §6 risk).
 *
 * No browser/DOM deps beyond `localStorage`/`crypto` (both global, not
 * `window.`-qualified, so a Node/bun test can polyfill them on `global`
 * before requiring this module — same pattern as bootstrap-lookup.js).
 * Attaches to window.__owLocalVaults in the browser; module.exports under
 * node:test/bun test.
 */
(function () {
  'use strict';

  var KEY = 'obsidian-web:local-vaults';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function save(map) {
    localStorage.setItem(KEY, JSON.stringify(map));
  }

  function uuid() {
    var arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  var api = {
    list: function () {
      var map = load();
      return Object.entries(map)
        .map(function (entry) { return { id: entry[0], name: entry[1].name, createdAt: entry[1].createdAt, type: entry[1].type || 'local' }; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
    },
    get: function (id) {
      var map = load();
      var v = map[id];
      if (!v) return null;
      return { name: v.name, createdAt: v.createdAt, type: v.type || 'local' };
    },
    has: function (id) {
      return !!this.get(id);
    },
    // opts.id (seed-demo §3א): fixed id, used by the lazy Demo vault so
    // repeated ensureDemo() calls resolve to the same vault instead of
    // minting a new uuid every time. Falls back to uuid() when omitted —
    // zero behavior change for existing callers (create-vault interceptor,
    // folder-vault flow), brief §6 risk.
    create: function (name, opts) {
      var map = load();
      var id = (opts && opts.id) || uuid();
      map[id] = { name: name || 'Untitled', createdAt: Date.now(), type: (opts && opts.type) || 'local' };
      save(map);
      return { id: id, name: map[id].name, type: map[id].type };
    },
    rename: function (id, name) {
      var map = load();
      if (!map[id]) return false;
      map[id].name = name;
      save(map);
      return true;
    },
    remove: function (id) {
      var map = load();
      if (!map[id]) return false;
      delete map[id];
      save(map);
      // Note: caller is responsible for deleting OPFS content too — this
      // milestone only clears the registry entry (see brief §9 Q2).
      return true;
    },
    // vaultPath(id, name) — docs/plans/electron-shim-foundation.md §3.4.
    // Two-argument signature ON PURPOSE, not "take a vault object": list()
    // returns {id,name,...} but get(id) does NOT return id back — a caller
    // tempted to write vaultPath(get(id)) would silently get
    // '/ow/undefined/Demo'. Callers must carry the id themselves (they
    // always already have it — it's how they looked the vault up).
    vaultPath: function (id, name) {
      return '/ow/' + id + '/' + (name || id);
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.__owLocalVaults = api;
  }
})();
