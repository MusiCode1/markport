/**
 * deploy-config.js — deploy-time config loader (docs/plans/deploy-config.md).
 *
 * Loaded as a plain <script> tag in index.html, BEFORE boot.js (order is
 * critical — see index.html comment at the OW_CONFIG_INJECT marker). Exposes
 * `window.__owConfig` = deepMerge(DEFAULTS, window.__owConfigInjected || {}).
 *
 * The injected value lives on a SEPARATE variable (`__owConfigInjected`, not
 * `__owConfig` itself) so this merge is never circular:
 *   - CF build (build-assets.sh) replaces the `<!-- OW_CONFIG_INJECT -->`
 *     marker with `<script>window.__owConfigInjected={...}</script>` at
 *     build time, reading src/config/deploy-config.json via `node -p`.
 *   - Node server (runtime-server/server/index.js) does the same at
 *     serve-time — reads src/config/deploy-config.json once at startup
 *     (fs.readFileSync) and replaces the same marker in the served HTML.
 *   - Local/no-config case: the marker is never replaced → no
 *     `__owConfigInjected` script ran → `window.__owConfigInjected` is
 *     undefined → DEFAULTS alone become `window.__owConfig` (zero
 *     regression from today's hardcoded behavior).
 *
 * ES5 ONLY (brief §0 — avigail round-2 finding): this script must load and
 * run correctly before any other client script, so it cannot rely on
 * `?.`/`??` or any other syntax the mobile runtime's shims/polyfills might
 * not have set up yet. All config reads elsewhere in the codebase must use
 * the `(window.__owConfig && window.__owConfig.X)` guard pattern, not
 * optional chaining.
 */
(function () {
  'use strict';

  // Mirrors src/config/deploy-config.json — the DEFAULT profile (as opposed
  // to src/config/deploy-config.demo.json, selected at build time via
  // OW_PROFILE=demo, docs/plans/demo-origin-split.md §4 Commit 0) — kept as a
  // literal (not fetched) so config is available synchronously before
  // boot.js runs (brief §6 risk: an async fetch here would race boot.js's
  // synchronous reads).
  var DEFAULTS = {
    defaultVaultLocation: 'device',
    seedExampleContent: false,
    plugins: {
      'obsidian-livesync': { install: true, enabled: false },
      'obsidian-web-layout': { install: true, enabled: true }
    },
    layout: { default: 'auto', threshold: 900 },
    demoVault: { enabled: false, id: '0000demo0000demo' },
    branding: { name: 'Obsidian Web', themeColor: '#1e1e1e' }
  };

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
  }

  // Recursive plain-object merge — `override` wins key-by-key; nested plain
  // objects are merged recursively, everything else (arrays, primitives,
  // non-plain objects) is replaced wholesale by the override value.
  function deepMerge(base, override) {
    var out = {};
    var key;
    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
    }
    for (key in override) {
      if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
      var baseVal = base ? base[key] : undefined;
      var overrideVal = override[key];
      if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
        out[key] = deepMerge(baseVal, overrideVal);
      } else {
        out[key] = overrideVal;
      }
    }
    return out;
  }

  if (typeof window !== 'undefined') {
    var injected = (window.__owConfigInjected && typeof window.__owConfigInjected === 'object')
      ? window.__owConfigInjected
      : {};
    window.__owConfig = deepMerge(DEFAULTS, injected);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULTS: DEFAULTS, deepMerge: deepMerge };
  }
})();
