# obsidian-web - Cloudflare deployment (mobile runtime, browser file system / OPFS)

**Client-only, mobile runtime.** Serves `src/client-mobile/` + `vendor/obsidian-mobile/`
(not the desktop client/renderer). Vaults live entirely in the browser via **OPFS**
(Origin Private File System). There is **no server-side vault storage** - the
previous server-side in-memory vault store (internally named `VaultDO`) has been
**removed**.

## What the Worker does now
- Serves the **static app bundle** (`env.ASSETS`) for everything except
  `/api/proxy-request` and the `/starter`/`/vault/*` SPA-fallback routes. See `index.js`.
- `/` runs `boot.js`'s entry-routing first: if the browser already has a
  `mobile-selected-vault` from a previous visit, it **auto-resumes that vault**
  at `/vault/<id>` - a returning visitor's vault opens automatically, the chooser is
  never shown. A visitor with no remembered vault is redirected to `/starter` (clean
  build) or, on the **demo profile** (`OW_PROFILE=demo`),
  straight into the fixed-id demo vault at `/vault/<demoId>/Welcome` - created/seeded
  with `template.js`'s example content on first open, zero clicks. There is no
  visitor-facing "try the demo" button anymore (removed - the demo now has its own
  origin, so the button's original purpose of letting a *main-site* visitor reach the
  demo no longer applies); on the clean/main profile `/starter` renders **Obsidian's
  native mobile onboarding screen** ("Create a vault" / "Use my existing vault") with
  no vault pre-opened and no demo trace. Vault creation/writes/reads happen **entirely
  client-side** (OpfsStore engine); 0 dependency on `/api/*` for vault storage.
- `vendor/obsidian-mobile/` is self-contained (own `app.js`/`worker.js`/`i18n`/
  `lib`) - `build-assets.sh` copies it (and mirrors its resource dirs at the
  bundle root) without touching `vendor/obsidian-desktop` (desktop).
- **`POST /api/proxy-request`** - edge Worker proxy for outbound requests
  Obsidian makes that need CORS the origin doesn't send (GitHub/obsidian.md -
  community-plugin browse/install, releases). The client only routes
  `github.com`/`githubusercontent.com`/`obsidian.md` requests here
  (`capacitor-shim.js:802`); `proxy-worker.js`'s own allow-list is wider (adds
  `templater-unsplash-2.fly.dev` for a future/other client), but nothing in this
  deployment's client code sends that host through the proxy today - Templater's
  Unsplash requests are a direct browser `fetch`, not proxied.
  Handled entirely at the edge (`proxy-worker.js`) - **no origin server**, no
  server-side vault store, no Node process. Same allow-list + SSRF-safe manual-redirect
  handling as the Node reference (`src/runtime-server/server/api/proxy.js`), ported to the
  Worker `fetch`/`Request`/`Response` runtime (no `Buffer`, chunked
  base64 - see `proxy-worker.js` header comment).
  - **Cache**: immutable downloads (`raw.githubusercontent.com`,
    `releases.obsidian.md`, `*.githubusercontent.com` - covers the release
    CDN) are cached via `caches.default`, `Cache-Control: public,
    max-age=86400`. `api.github.com` (community-plugin/theme **lists**) is
    deliberately **excluded** - those responses change over time; caching them
    would serve a stale plugin list.
  - **`caches.default` is a no-op on `*.workers.dev`** - documented Cloudflare
    limitation. The proxy is fully functional there (every request just
    always misses cache and goes to origin); to get actual cache hits in
    production, serve the deployment behind a **custom domain** attached to the
    Pages project (a dashboard step - this repo holds no route config).

## System plugins - layout-switcher (enabled) + LiveSync (installed, disabled)
`build-assets.sh` builds `public/system-plugins/manifest.json` with **two**
entries, served statically (CF static hosting has no `/api/system-plugins` -
`seed-system-plugins.js` falls back to fetching this file when the API route
404s):
- **`obsidian-web-layout`** (`enabled:true`) - the desktop/mobile layout
  switcher, active by default.
- **`obsidian-livesync`** (`enabled:false`) - [Self-hosted
  LiveSync](https://github.com/vrtmrz/obsidian-livesync), downloaded at build
  time by `node scripts/install-livesync.js` (from the plugin's GitHub
  releases into `vendor/plugins/obsidian-livesync/`, cached under
  `.tmp/cache/livesync-releases/`) and copied into `public/system-plugins/`.
  It ships **installed but disabled** - the files land in every new vault's
  `.obsidian/plugins/obsidian-livesync/` on first visit, but `enabled:false`
  means `seed-system-plugins.js` does **not** add it to
  `.obsidian/community-plugins.json`, so it never auto-runs. The user enables
  it manually (Settings → Community plugins → toggle), then configures a
  CouchDB endpoint in the LiveSync settings tab. Pin a specific release with
  `SEED_LIVESYNC_VERSION=<tag>` before running the build; if the download
  fails (offline, GitHub outage), the build **warns and continues** with
  layout-switcher only - never hard-fails on a missing third-party download.

## Example / demo vault content (`template.js`) - wired, not a stub
`template.js` holds the **demo vault** - 11 example files (`Welcome.md`,
`How It Works.md`, `Features/*.md`, `.obsidian/*` config). It **is wired**: on
the demo profile (`OW_PROFILE=demo`), `boot.js` auto-opens a fixed-id local
(OPFS) vault at `/vault/<demoId>/Welcome` on every first visit (see "What the
Worker does now" above); the first time that vault is empty, it's seeded from
`template.js` (via the static `/example-vault.json` built by `build-assets.sh`
- see "Deploy" below) using `seed-example-vault.js`, and re-seeded whenever
`template.js`'s content changes on a later deploy (`window.__owDemoContent`
hash). `Welcome.md` links back to
the main deployment near the top of the note. On the main/default profile,
none of this runs - a visitor gets Obsidian's plain native onboarding chooser,
with no vault pre-opened and no demo trace. Do **not** delete `template.js`.

## What's included (finished)
- OPFS vault engine on the mobile runtime (create local vault, notes, nested
  folders, reload-persistence - all client-side, verified static/no-server).
- Native mobile onboarding/vault-chooser screen renders fully at `/starter` (reached from
  `/` when there's no remembered vault to auto-resume - see "What the Worker does now"
  above).
- Example vault + system-plugins seed to OPFS on first visit (`cf-mobile-seed`)
  - see "Example / demo vault content" above.
- **`POST /api/proxy-request`** - edge Worker proxy (`cf-worker-proxy`) with
  allow-list, SSRF-safe redirects, and Cache API for immutable downloads. See
  "What the Worker does now" above.
- **Per-IP rate-limiting on `/api/proxy-request`** (`client-only-resilience`
  §3.3) - an in-memory, isolate-lifetime counter (no KV/Durable Object): 30
  requests/minute per `CF-Connecting-IP`, 429 past the limit. Chosen because
  `caches.default` (see below) and Cloudflare's own WAF rate-limiting rules
  are **both** zone-only - unavailable on this deployment (no custom
  domain/route configured, see "Cache" below) - so "let Cloudflare handle it"
  isn't an option here. Not a precise quota
  (isolates recycle and the counter resets with them), but enough against
  gross abuse of the proxy as an open relay. Requests with no
  `CF-Connecting-IP` (never present in this deployment's own tests) bypass
  the limiter entirely - in production behind Cloudflare the header is
  always set.
- **LiveSync preinstalled, disabled** (`cf-preinstall-livesync`) -
  `obsidian-livesync` ships in every new vault's `.obsidian/plugins/`, off by
  default; the user opts in via Settings → Community plugins. See "System
  plugins" above.
- Native "**Create a vault**" button (mobile onboarding UI) works end-to-end:
  it used to call `Filesystem.mkdir()` and hit the non-existent `/api/fs/mkdir`
  here (always failing with "mkdir failed: ..."), since `window.__owVaultType`
  still defaulted to `'server'` at that point in boot. Fixed at two layers -
  a DOM click-interceptor (`boot.js`, `installCreateVaultInterceptor` -
  anchor on the function name, not a line range: it has grown since this
  paragraph was first written, per AGENTS.md "never to a line number")
  that routes the click straight to an OPFS/folder vault creation, and an
  FS-level safety net (`shims/capacitor-shim.js:291-313`) that catches the
  same case if the DOM interceptor is ever bypassed. Verified on this
  deployment and on the local dev server.

## Known gaps (follow-ups)
1. **Rate limiting is per-isolate, not a precise per-account quota.** The
   in-memory counter (see "What's included" above) resets whenever Cloudflare
   recycles the isolate - a determined attacker distributed across many
   isolates/IPs isn't meaningfully throttled. Moving to KV/Durable Objects
   would fix this but needs an account-level binding (out of scope for a
   code-only slice); the current approach is deliberately "enough against
   gross abuse," not a hard guarantee. The per-isolate counter map is capped
   at 10,000 distinct IPs and prunes expired entries opportunistically, so a
   burst of distinct attacker IPs can't grow it without bound within one
   isolate's lifetime - this bounds memory, it does not make the limiter
   precise. Past the cap, once opportunistic pruning has removed every
   entry it can, a new IP simply goes untracked for that one request rather
   than evicting an existing one - an earlier version evicted the oldest
   entry unconditionally, which could be a currently-throttled IP, handing
   an attacker a way to reset their own `429` by flooding enough new IPs
   through the same isolate. The window is fixed (not sliding), so a client
   can legitimately send close to double the per-minute limit across a
   window boundary; a `429` response includes `Retry-After: 60` either way.
2. Two font files referenced by `obsidian-mobile/app.css` ("Inter",
   `public/fonts/*.woff2`) 404 - `vendor/obsidian-mobile` never included a
   `public/` dir. Cosmetic only (`font-display: swap` → system font fallback);
   does not block rendering. Not a `vendor/obsidian-desktop` dependency (path is under
   `/obsidian-mobile/` already) - just an incomplete upstream extraction.
3. `/api/proxy-request` is verified via a **Bun integration test** against the
   real network (manifest fetch, release-asset redirect, SSRF, cache) - not
   `wrangler dev`, which doesn't produce results in the current dev sandbox
   (workerd hangs). The one thing that test *can't* cover is an actual
   community-plugin **install through a running Worker** (browser → `wrangler
   dev`/deployed Worker → GitHub) - deferred to a real `wrangler deploy` or a
   CF environment where `workerd` runs.

## Deploy - two profiles, one build

The **same** `build-assets.sh`/`index.js`/`template.js` produce two different
experiences, selected at BUILD time via `OW_PROFILE` - nothing branches at
runtime beyond reading the injected config, so the two artifacts can never
silently drift apart (`git diff` always shows the one line that changed).

| Profile | Command | Config file | Visitor experience |
|---|---|---|---|
| main (default) | `npm run build` | `src/config/deploy-config.json` | Clean vault-creation screen, no demo, no seeding |
| demo | `npm run build:demo` | `src/config/deploy-config.demo.json` | Auto-opens into a pre-seeded demo vault, re-seeds on template change, links back to the main deployment |

```
npm run build           # main profile → .tmp/deployments/cloudflare/public
npm run build:demo      # demo profile (OW_PROFILE=demo) → same output dir
npm run dev              # local emulation (wrangler pages dev) - does NOT publish anywhere
npm run deploy           # predeploy: rebuilds MAIN + guard, then publishes to --branch=main → obsidian-online.pages.dev
npm run deploy:demo      # predeploy:demo: rebuilds DEMO + guard, then publishes to --branch=demo → demo.obsidian-online.pages.dev
```
`npm run build`/`build:demo` need network access to GitHub (`api.github.com` +
release-asset CDN) to fetch the LiveSync plugin on a cold cache - see
"System plugins" above. It never blocks the build if unreachable (WARN +
continue, layout-switcher only).

**Where each one publishes** is written into the command itself - the
`--project-name` / `--branch` flags above, not a config file:

| Script | Target | URL |
|---|---|---|
| `npm run deploy` | `obsidian-online`, branch `main` (the project's **production** branch) | `obsidian-online.pages.dev` |
| `npm run deploy:demo` | `obsidian-online`, branch `demo` (a preview **branch alias**) | `demo.obsidian-online.pages.dev` |

One Cloudflare Pages project serves both. A branch alias always tracks the
latest deployment pushed to that branch name, and - unlike a git-integrated
project - `--branch` here is just a label on the upload, so no `demo` git
branch exists or is needed.

Cloudflare adds `X-Robots-Tag: noindex` to every preview deployment, which
would leave the demo unindexable. The demo build ships a `public/_headers`
with `X-Robots-Tag: index, follow`, which **overrides it** - measured on a
real deployment of this artifact (Pages Advanced mode, `_worker.js/` present),
not inferred from the docs. That is what makes one project sufficient instead
of two.

> Earlier revisions of this file said both scripts ran a bare `wrangler deploy`
> against a single `wrangler.toml` target. That was true, and it meant the two
> deployments overwrote each other - the guard below validated the *artifact*
> while nothing validated the *destination*. `wrangler.toml` was a Workers
> config that this Pages deployment never used; it has been removed.

**`OW_PROFILE=nope npm run build`** (any name that isn't a real
`deploy-config.<name>.json`) fails the build loudly (`exit 1`) rather than
silently falling back to the default config - a typo in the profile name
must never ship the wrong experience.

### The guard (`scripts/guard-deploy-target.sh`)

The one failure mode here that reaches real visitors without any test
noticing otherwise: the artifact itself is perfectly valid, it just got
uploaded to the **wrong target** (a demo build shipped to main, or vice
versa). `predeploy`/`predeploy:demo` run the guard automatically (npm's
built-in pre-hook convention) right after the matching build and right
before the upload - a mismatch aborts with `exit 1` and an explicit
message, and `wrangler pages deploy` never runs.

The guard checks *what is in the artifact*; the `--branch` flag in the script
fixes *where it goes*. Both halves are needed - the guard alone cannot tell
you that two scripts point at the same destination.

```
bash scripts/guard-deploy-target.sh main   # exit 0 iff the built artifact has NO demo config
bash scripts/guard-deploy-target.sh demo   # exit 0 iff the built artifact DOES have demo config
```

The anchor it checks for is `"demoVault":{"enabled":true` - **with the key
name**, not a bare `"enabled":true` (that string alone also appears in the
main artifact's injected config, via the `obsidian-web-layout` plugin entry
- a naive search would false-positive on every build).
