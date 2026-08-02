/**
 * seed-example-vault.js — seed-on-boot of demo content (Welcome.md,
 * Features/*.md) into an empty OPFS (local) vault, on CF static hosting
 * where there is no server to seed content through /api/*.
 *
 * No DOM deps beyond the global `fetch` (available under node:test/bun test
 * AND in the browser) — runs under node:test and inside the browser via a
 * plain <script> tag (attaches to window.__owSeedExampleVault).
 *
 * `store` is an OpfsStore instance (storage/opfs-store.js makeStore(vaultId))
 * — only `stat({path})` / `writeFile({path,data,encoding})` are used, so a
 * fake with the same shape works fine in tests.
 *
 * finding 1 (docs/plans/cf-mobile-seed.md §3ג): the demo template's
 * `.obsidian/community-plugins.json` lists `['dataview','templater-obsidian']`
 * — seeding it verbatim would OVERWRITE the community-plugins.json that
 * seedSystemPlugins just wrote (`['obsidian-web-layout']`), un-enabling the
 * layout switcher. finding 3: dataview/templater-obsidian aren't bundled on
 * this deployment, so seeding them would cause load errors anyway. The fix:
 * seed ONLY vault content, skip the entire `.obsidian/` subtree — plugin/
 * layout config stays exclusively owned by seedSystemPlugins.
 *
 * opts.force (docs/plans/demo-origin-split.md §4 Commit 3): skips the
 * idempotent stat-gate below and re-writes every template file — used by
 * boot.js's re-seed-on-content-change block when window.__owDemoContent (a
 * hash of the deployed template) no longer matches what this vault was last
 * seeded with. The `.obsidian/` skip above still applies under force — it is
 * NOT reopened by this option (finding 1 stays in force; plugin/layout config
 * remains seedSystemPlugins' exclusively). Only paths present in the
 * template are touched; anything the visitor created on their own (not a
 * template path) is never written to or deleted, force or not.
 *
 * opts.cacheBust (calev-heavy NO-GO on the Commit-3 phase verify, NBug1 —
 * reports/obsidian-web/demo-origin-split-commit3-calev.md): a STILL-
 * CONTROLLING PREVIOUS service worker instance (sw.js) caches static GETs —
 * including this file — cache-first, keyed only by URL, under its OWN
 * build's cache namespace. Right after a redeploy, that old SW can still be
 * the one intercepting this fetch (new-SW takeover lags a navigation), so a
 * fixed '/example-vault.json' URL can silently return the PREVIOUS build's
 * content even though the caller already knows (via window.__owDemoContent)
 * that a new one shipped — the visitor's edits then get overwritten with
 * stale content, and the mismatch-key gets stamped as "resolved" regardless.
 * When given (boot.js's re-seed block passes its own freshly-read
 * window.__owDemoContent), it's appended as a query string — cache-first
 * matching is per-exact-URL, so a new query string can only ever be a cache
 * MISS (old SW's cache has no entry for it, new SW hasn't cached it yet
 * either) → a real network fetch, regardless of which SW instance handles
 * it. Omitted (first-visit seed, no known hash yet) → same fixed URL as
 * before, unchanged behavior.
 *
 * Return value (same NBug report, NBug2): resolves `true` only when template
 * files were actually written, `false` on every skip/no-op path (gate hit,
 * missing/failed fetch). Callers (boot.js) use this to decide whether it's
 * safe to mark the attempt as done (write the ow-demo-content sentinel) — a
 * silent skip must NOT be mistaken for success, or the retry the brief
 * requires ("במקרה כישלון אל תעדכן את המפתח") never happens.
 */
(function () {
  'use strict';

  async function seedExampleVault(store, opts) {
    const force = !!(opts && opts.force);
    if (!force) {
      let already = false;
      try { await store.stat({ path: 'Welcome.md' }); already = true; } catch (_) {}   // idempotent gate
      if (already) return false;
    }

    const url = (opts && opts.cacheBust)
      ? '/example-vault.json?v=' + encodeURIComponent(opts.cacheBust)
      : '/example-vault.json';
    const files = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!files) return false;   // מקומי (אין example-vault.json) / רשת נכשלה → דלג

    for (const [path, content] of files) {
      if (path.indexOf('.obsidian/') === 0 || path.indexOf('/.obsidian/') !== -1) continue;   // דלג על config (finding 1+3), גם ב-force
      // writeFile יוצר תיקיות-אב recursive (אומת opfs-store.js:18, Features/*)
      await store.writeFile({ path: path, data: content, encoding: 'utf8' });
    }
    return true;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { seedExampleVault };
  } else if (typeof window !== 'undefined') {
    window.__owSeedExampleVault = { seedExampleVault };
  }
})();
