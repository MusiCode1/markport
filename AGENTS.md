# AGENTS.md — Markport

> Conventions for anyone (human or coding agent) changing this repo.
> Tool-neutral; `CLAUDE.md` just imports this file.
> **Start with `README.md`** for what the project is and how to run it.

## What this project is

Runs Obsidian's own renderer in a regular browser — no Electron — by shimming the
Electron/Capacitor/Node APIs it expects. There is **one runtime core**
(`src/client-mobile/`) with a **swappable backend**:

| Layer | Status | Storage |
|-------|--------|---------|
| serverless | primary | OPFS in the browser + folder vaults (File System Access API) |
| server | supported | real files via `/api/fs` |

See `docs/architecture.md` for the full picture.

## Conventions — required

- **Node 18+ or Bun — depends on the package.** Most packages' scripts invoke `node`
  (`src/client-mobile` tests, `src/runtime-server/server`, the Cloudflare deployment's
  build script). `src/sync-server` is the one package that runs on `bun`
  (`bun index.js` / `bun test`). The maintainer's own dev environment symlinks `node`
  to `bun`, which is a local habit, not a repo-wide requirement — don't assume `bun`
  works for every package.
- **`vendor/` is gitignored.** It holds Obsidian's own bundle, generated locally by
  `scripts/update-obsidian-*.js`, and is never committed. This repository does not
  contain or distribute that bundle — each user downloads Obsidian themselves via the
  setup scripts. The public live demo deployment *does* serve the bundle to visitors'
  browsers (see `build-assets.sh`), which is a separate thing from this repo.
- **The bundle is minified.** Anchor any patch or edit to a **pattern / symbol
  shape**, never to a line number — line numbers move on every Obsidian release.
  See `scripts/patch-obsidian-mobile.js`, which documents this in-body.
- **No personal data in this repo.** Personal vault names, machine paths, run logs,
  and internal planning notes do not belong here.

## Layout

| What | Where |
|------|-------|
| Architecture and rationale | `docs/architecture.md` |
| Writing a system plugin | `docs/system-plugin-dev-guide.md` |
| Runtime (the browser side) | `src/client-mobile/` |
| Node backend (optional) | `src/runtime-server/` |
| Pull-sync server | `src/sync-server/` |
| Cloudflare deployment | `src/deployments/cloudflare/` |

## Before you touch the bundle

`vendor/obsidian-mobile/app.js` is Obsidian's proprietary code. As of
`docs/plans/zero-patches.md`, we apply **zero** build-time patches to the
**local** copy — the extracted bundle is byte-identical to Obsidian's own
APK. `scripts/patch-obsidian-mobile.js` still exists as infrastructure
(an empty `PATCHES` list) for a future Obsidian version that might need one;
keep that list as small as possible, and prefer a runtime shim over a patch
whenever the same result is reachable through a platform API.

**Precedent**: `docs/plans/runtime-platform-descriptors.md` replaced 3 of the
4 patches that used to exist with a runtime shim
(`src/client-mobile/platform-bridge.js`, which intercepts
`Object.defineProperty` to capture Obsidian's own `Platform` object instead
of rewriting app.js's byte-for-byte source); `docs/plans/zero-patches.md`
removed the 4th and last one (`vault-profile-on-desktop-layout`) outright,
once measurement showed `platform-bridge.js`'s existing `isDesktopApp`
locking already covers what it used to patch. Read both before adding a new
patch.
