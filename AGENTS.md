# AGENTS.md — obsidian-web

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

- **bun, not node.** Run the servers and tests with `bun`. (`src/runtime-server/`
  still has node-flavoured scripts; that inconsistency is known.)
- **`vendor/` is gitignored.** It holds Obsidian's own bundle, generated locally by
  `scripts/update-obsidian-*.js`. It is never committed and never redistributed —
  each user downloads Obsidian themselves.
- **The bundle is minified.** Anchor any patch or edit to a **pattern / symbol
  shape**, never to a line number — line numbers move on every Obsidian release.
  See `scripts/patch-obsidian-mobile.js`, which documents this in-body.
- **No personal data in this repo.** Personal vault names, machine paths, run logs,
  and internal planning notes do not belong here.

## Layout

| What | Where |
|------|-------|
| Architecture and rationale | `docs/architecture.md` |
| Reverse-engineering notes, solved issues | `docs/investigations.md` |
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
