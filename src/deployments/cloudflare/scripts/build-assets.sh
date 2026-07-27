#!/usr/bin/env bash
# Build static assets for the CF Worker deployment — MOBILE runtime.
#
# Reads from:  src/client-mobile/ (our mobile client) + vendor/obsidian-mobile/
#              (extracted mobile bundle — self-contained: app.js/worker.js/
#              i18n/lib all live inside it, no dependency on vendor/obsidian-desktop).
# Writes to:   .tmp/deployments/cloudflare/public/ (deployment artifacts)
#
# Run from the cloudflare/ directory:
#   bash scripts/build-assets.sh
#
# Or via npm:
#   npm run build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# MAIN_DIR is the repo root, three levels up from src/deployments/cloudflare/.
MAIN_DIR="$(cd "$CF_DIR/../../.." && pwd)"
PUBLIC_DIR="$MAIN_DIR/.tmp/deployments/cloudflare/public"

echo "obsidian-web CF — building assets (mobile)"
echo "  main project : $MAIN_DIR"
echo "  output       : $PUBLIC_DIR"

# ── Verify vendor/obsidian-mobile/ exists ──────────────────────────────────
if [[ ! -f "$MAIN_DIR/vendor/obsidian-mobile/app.js" ]]; then
  echo ""
  echo "ERROR: vendor/obsidian-mobile/ directory not found or incomplete."
  echo "Run first: node $MAIN_DIR/scripts/update-obsidian-mobile.js"
  exit 1
fi

# ── deploy-config (docs/plans/deploy-config.md §3) — single source of truth
# for which system plugins ship/are-enabled and for window.__owConfigInjected
# below. Committed to the repo (not gitignored), so it is always present at
# build time — unlike vendor/, no existence-fallback needed here.
CONFIG_PATH="$MAIN_DIR/src/config/deploy-config.json"
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo ""
  echo "ERROR: $CONFIG_PATH not found — required for deploy config (plugins + injected config)."
  exit 1
fi

# ── Clean and recreate public/ ─────────────────────────────────────────────
rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR"

# ── Copy client-mobile shims and boot script ───────────────────────────────
echo "  copying client-mobile/..."
cp -r "$MAIN_DIR/src/client-mobile" "$PUBLIC_DIR/client-mobile"

# ── Copy obsidian-mobile renderer ──────────────────────────────────────────
echo "  copying obsidian-mobile/..."
cp -r "$MAIN_DIR/vendor/obsidian-mobile" "$PUBLIC_DIR/obsidian-mobile"

# ── Mirror resource dirs at root level (app.js fetches /i18n/*, /lib/*, …)
# obsidian-mobile is self-contained (independent of vendor/obsidian — see
# docs/plans/cf-mobile-serve.md §0) but only ships i18n/ + lib/ (no public/
# or sandbox/ — the [[ -d ]] guard below absorbs that, it is not a bug).
echo "  copying resource dirs..."
for dir in i18n lib public sandbox; do
  if [[ -d "$MAIN_DIR/vendor/obsidian-mobile/$dir" ]]; then
    cp -r "$MAIN_DIR/vendor/obsidian-mobile/$dir" "$PUBLIC_DIR/$dir"
  fi
done

# Worker scripts served at root (critical for metadata indexer — app.js does
# `new Worker("worker.js")`, resolved against the document's base URL / root).
cp "$MAIN_DIR/vendor/obsidian-mobile/worker.js" "$PUBLIC_DIR/worker.js"
if [[ -f "$MAIN_DIR/vendor/obsidian-mobile/sim.js" ]]; then
  cp "$MAIN_DIR/vendor/obsidian-mobile/sim.js" "$PUBLIC_DIR/sim.js"
fi

# ── index.html: mobile entry point, served at / ────────────────────────────
# No vault=demo injection, no starter.html — the mobile boot.js renders its
# own native no-vault screen when there is no VAULT_ID (opfs-ux). Seeding of
# demo/example content is a later slice (cf-mobile-seed).
echo "  copying index.html..."
cp "$MAIN_DIR/src/client-mobile/index.html" "$PUBLIC_DIR/index.html"

# PWA web manifest at the root (scope "/"); icons ride along under
# public/client-mobile/icons/ via the client-mobile copy above.
cp "$MAIN_DIR/src/client-mobile/manifest.webmanifest" "$PUBLIC_DIR/manifest.webmanifest"

# Replace ?v=<anything> on /client-mobile/ script tags with a build timestamp
# so browsers always pick up updated files after a new deploy.
BUST=$(date +%s)
echo "  cache buster: $BUST"
sed -i "s|/client-mobile/\([^\"]*\)?v=[^\"&]*\"|/client-mobile/\1?v=${BUST}\"|g" "$PUBLIC_DIR/index.html"

# ── deploy-config inject (docs/plans/deploy-config.md §3ב) — replaces the
# <!-- OW_CONFIG_INJECT --> marker (see index.html comment) with a literal
# <script>window.__owConfigInjected={...}</script> holding the full parsed
# config.json. Must precede the deploy-config.js tag — it already does in the
# source index.html, this step only substitutes the marker in place. Uses
# node -e (not sed) because the JSON payload can contain characters that
# would need escaping in a sed replacement.
echo "  injecting deploy-config (window.__owConfigInjected)..."
CONFIG_PATH="$CONFIG_PATH" HTML_PATH="$PUBLIC_DIR/index.html" node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8"));
  const html = fs.readFileSync(process.env.HTML_PATH, "utf8");
  const marker = "<!-- OW_CONFIG_INJECT -->";
  if (!html.includes(marker)) {
    throw new Error("OW_CONFIG_INJECT marker not found in " + process.env.HTML_PATH);
  }
  const snippet = "<script>window.__owConfigInjected=" + JSON.stringify(config) + "</script>";
  fs.writeFileSync(process.env.HTML_PATH, html.replace(marker, snippet));
'

# ── client-only signals inject (docs/plans/client-only-resilience.md §3.2 +
# §3.4) — replaces <!-- OW_BACKEND_INJECT --> with window.__owBackend='none'
# AND window.__owVersion=<src/config/version.json>, a channel SEPARATE from
# __owConfigInjected above on purpose (see index.html comment: that one is
# deepMerge'd + byte-verified by two test suites against the shared
# deploy-config.json — folding either flag into it would land it on
# runtime-server too). boot.js reads __owBackend to short-circuit an
# unrecognized deep-link to a human message with ZERO /api/fs network request
# (DoD#4), instead of the raw "Error: ... (HTTP 404)" it fetches today; it
# reads __owVersion to display "obsidian-web <version> · Obsidian 1.12.7" on
# the onboarding footer (DoD#8). runtime-server never replaces this marker →
# both stay undefined there — __owBackend defaults to "has a backend"
# (unchanged), __owVersion missing means "hide our version, show only
# Obsidian's" (boot.js handles this explicitly, see installVersionDisplay).
#
# ⚠️ Bare command, NOT inside `if` — same lesson already documented at the
# LiveSync step below (`if node ...; then` swallows exit(1) under `set -e`).
# A missing marker must fail the build LOUDLY (DoD#11), never silently ship a
# client-only build without these globals.
VERSION_PATH="$MAIN_DIR/src/config/version.json"
if [[ ! -f "$VERSION_PATH" ]]; then
  echo ""
  echo "ERROR: $VERSION_PATH not found — required for window.__owVersion."
  exit 1
fi
echo "  injecting client-only signals (window.__owBackend, window.__owVersion)..."
VERSION_PATH="$VERSION_PATH" HTML_PATH="$PUBLIC_DIR/index.html" node -e '
  const fs = require("fs");
  const version = JSON.parse(fs.readFileSync(process.env.VERSION_PATH, "utf8")).version;
  const html = fs.readFileSync(process.env.HTML_PATH, "utf8");
  const marker = "<!-- OW_BACKEND_INJECT -->";
  if (!html.includes(marker)) {
    throw new Error("OW_BACKEND_INJECT marker not found in " + process.env.HTML_PATH);
  }
  const snippet = "<script>window.__owBackend=\"none\";window.__owVersion=" + JSON.stringify(version) + ";</script>";
  fs.writeFileSync(process.env.HTML_PATH, html.replace(marker, snippet));
'

# ── Service Worker (offline + asset-cache — docs/plans/service-worker-offline.md
# §3ד) — copied to the public root so its scope covers the whole app. BUST is
# the same timestamp already used for ?v= above, so a new deploy = a new SW
# cache (CACHE='ow-sw-'+BUILD_ID inside sw.js). Note: sw.js is served from the
# root, not under /client-mobile/, so the sed above (which only targets
# /client-mobile/...?v= tags in index.html) does not touch it.
echo "  installing sw.js (BUILD_ID=${BUST})..."
cp "$MAIN_DIR/src/client-mobile/sw.js" "$PUBLIC_DIR/sw.js"
sed -i "s/__OW_BUILD__/${BUST}/g" "$PUBLIC_DIR/sw.js"   # BUST = ה-timestamp שכבר משמש ל-?v=

# ── system plugins (layout-switcher + LiveSync) → static (docs/plans/cf-mobile-seed.md §3א, cf-preinstall-livesync §3) ──
# CF static hosting has no /api/system-plugins — seed-system-plugins.js falls
# back to fetching these static files when the API route 404s.
echo "  building system-plugins/ (static)..."

# config.plugins.*.install/enabled (docs/plans/deploy-config.md §3ג) — `install`
# gates whether the plugin ships at all (files + manifest entry); `enabled`
# becomes the manifest's `enabled` flag, which seed-system-plugins.js reads to
# decide installed-but-disabled vs auto-enabled-on-seed. Defaults in
# src/config/deploy-config.json mirror the old hardcoded values 1:1 (install:
# true/true, enabled: false/true) — zero regression when the file is unchanged.
LAYOUT_INSTALL=$(node -p "require('$CONFIG_PATH').plugins['obsidian-web-layout'].install")
LAYOUT_ENABLED=$(node -p "require('$CONFIG_PATH').plugins['obsidian-web-layout'].enabled")
LS_INSTALL=$(node -p "require('$CONFIG_PATH').plugins['obsidian-livesync'].install")
LS_ENABLED=$(node -p "require('$CONFIG_PATH').plugins['obsidian-livesync'].enabled")

# system-plugins/ — layout-switcher, gated by config.plugins.obsidian-web-layout.install
LAYOUT_VER=""
if [[ "$LAYOUT_INSTALL" == "true" ]]; then
  mkdir -p "$PUBLIC_DIR/system-plugins/obsidian-web-layout"
  cp "$MAIN_DIR/src/plugins/obsidian-web-layout/"* "$PUBLIC_DIR/system-plugins/obsidian-web-layout/"
  LAYOUT_VER=$(node -p "require('$MAIN_DIR/src/plugins/obsidian-web-layout/manifest.json').version")
else
  echo "  config: plugins.obsidian-web-layout.install=false — skipping layout-switcher"
fi

# LiveSync — gated by config.plugins.obsidian-livesync.install. finding 1: `if node ...; then` בולע exit(1) → set -e לא מפיל.
LS_PIN="${SEED_LIVESYNC_VERSION:-}"      # ריק=latest; נעילת-גרסה אופציונלית
LS_VERSION=""; LS_FILES=""              # finding 3: init לפני set -u
if [[ "$LS_INSTALL" == "true" ]]; then
  if node "$MAIN_DIR/scripts/install-livesync.js" ${LS_PIN:+--version "$LS_PIN"}; then
    LS_SRC="$MAIN_DIR/vendor/plugins/obsidian-livesync"
    if [[ -f "$LS_SRC/main.js" && -f "$LS_SRC/manifest.json" ]]; then
      DEST="$PUBLIC_DIR/system-plugins/obsidian-livesync"; mkdir -p "$DEST"
      cp "$LS_SRC/main.js" "$LS_SRC/manifest.json" "$DEST/"          # finding 4: מפורש, לא *.json (מדלג data.json)
      LS_FILES='["main.js","manifest.json"]'
      if [[ -f "$LS_SRC/styles.css" ]]; then cp "$LS_SRC/styles.css" "$DEST/"; LS_FILES='["main.js","manifest.json","styles.css"]'; fi
      LS_VERSION=$(node -p "require('$LS_SRC/manifest.json').version")
    fi
  else
    echo "  WARN: obsidian-livesync download failed — skipping preinstall (build continues, layout-switcher only)"
  fi
else
  echo "  config: plugins.obsidian-livesync.install=false — skipping LiveSync"
fi

# manifest.json — finding 2: env מיוצא inline לפני node -e (אחרת process.env undefined → abort)
LAYOUT_VER="$LAYOUT_VER" LAYOUT_ENABLED="$LAYOUT_ENABLED" LS_VERSION="$LS_VERSION" LS_FILES="$LS_FILES" LS_ENABLED="$LS_ENABLED" OUT="$PUBLIC_DIR/system-plugins/manifest.json" node -e '
  const fs=require("fs");
  const plugins=[];
  if (process.env.LAYOUT_VER) plugins.push({id:"obsidian-web-layout",version:process.env.LAYOUT_VER,files:["main.js","manifest.json"],enabled:process.env.LAYOUT_ENABLED === "true"});
  if (process.env.LS_VERSION) plugins.push({id:"obsidian-livesync",version:process.env.LS_VERSION,files:JSON.parse(process.env.LS_FILES),enabled:process.env.LS_ENABLED === "true"});
  fs.writeFileSync(process.env.OUT, JSON.stringify({plugins}));
'

# ── example vault content → static JSON (docs/plans/cf-mobile-seed.md §3א) ──
# template.js (cf/) exports TEMPLATE_FILES but imports plugins-generated.js,
# which is only generated by the (retired) cf-mobile-serve build step —
# orphan import (cf-mobile-seed finding 2). Stub it with an empty Map so
# template.js loads standalone; the example notes themselves (Welcome.md,
# Features/*) live directly in TEMPLATE_FILES, not in PLUGIN_FILES.
echo "  building example-vault.json (static)..."
echo 'export const PLUGIN_FILES = new Map();' > "$MAIN_DIR/src/deployments/cloudflare/plugins-generated.js"
node -e "import('$MAIN_DIR/src/deployments/cloudflare/template.js').then(m=>{require('fs').writeFileSync('$PUBLIC_DIR/example-vault.json', JSON.stringify([...m.TEMPLATE_FILES]))})"
rm "$MAIN_DIR/src/deployments/cloudflare/plugins-generated.js"

# ── Summary ────────────────────────────────────────────────────────────────
FILE_COUNT=$(find "$PUBLIC_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$PUBLIC_DIR" 2>/dev/null | cut -f1)

echo ""
echo "Done."
echo "  files : $FILE_COUNT"
echo "  size  : $TOTAL_SIZE"
echo ""
echo "Next:"
echo "  wrangler deploy          # deploy to Cloudflare"
echo "  wrangler dev              # local dev"
