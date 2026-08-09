// obsidian-web — Cloudflare deployment (browser file system / OPFS only).
//
// Vaults live ENTIRELY in the browser (OPFS). There is NO server-side vault
// storage here: the previous Durable Object `VaultDO` (which stored vault
// files server-side and handled /api/fs/*) has been removed on purpose — this
// deployment is client-only. The vault, its files, and all FS operations
// happen in the browser via the OpfsStore engine.
//
// /api/proxy-request IS handled here (Worker edge route + Cache API — see
// proxy-worker.js) so community-plugin downloads work: GitHub/obsidian.md
// don't send CORS headers, so the browser can't fetch them directly.
//
// FOLLOW-UP (per "add the other options later"): port the Node server's
//   • /api/system-plugins        (seed manifest)
//   • /api/system-plugin-file    (seed bytes — src/runtime-server/server/api/system-plugin-files.js)
// to Worker routes. Not needed today — cf-mobile-seed already ships a static
// fallback (public/system-plugins/*) for both. Recommended env for CF:
// SYSTEM_PLUGINS_SEED_DISABLED="obsidian-livesync" (LiveSync pre-installed
// but disabled).

import { handleProxy } from './proxy-worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/proxy-request' && request.method === 'POST') {
      return handleProxy(request, ctx);
    }
    // '/github/<owner>/<repo>[/<note>]' joins the SPA-fallback list: it is the
    // shareable form of a vault URL (boot.js clones the repository on arrival
    // and hands off to /vault/<id>). This deployment is the one that makes
    // that worth having — '/vault/<id>' pasted to someone else resolves to a
    // vault id that only ever existed in the sender's browser.
    if (request.method === 'GET' &&
        (url.pathname === '/starter' ||
         url.pathname.startsWith('/vault/') ||
         url.pathname.startsWith('/github/'))) {
      // fetch את ה-root shell '/' (200) — לא '/index.html' (finding 2: html_handling
      // עלול להחזיר 307 מ-'/index.html' ל-'/' ולאבד את ה-deep-link). fetch של '/'
      // מחזיר את ה-shell כ-200; ה-URL בדפדפן נשאר /vault/<id> (זו לא הפניה, זה גוף),
      // ו-boot קורא את location.pathname האמיתי. (אומת ע"י אביגיל: 200, לא 307.)
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }
    // Everything else: the static app bundle. Vault storage is OPFS in the
    // browser, not the server.
    return env.ASSETS.fetch(request);
  },
};
