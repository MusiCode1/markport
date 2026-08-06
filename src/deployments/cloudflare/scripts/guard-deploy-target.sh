#!/usr/bin/env bash
# guard-deploy-target.sh — pre-deploy safety check (docs/plans/
# demo-origin-split.md §4 Commit 5).
#
# Verifies the artifact currently sitting in .tmp/deployments/cloudflare/public
# matches the deploy TARGET you're about to publish to — the one failure mode
# in this slice that lands on real users without any test noticing: the
# artifact itself is perfectly valid, it just got uploaded to the wrong
# place (a demo build shipped to the main/production target, or vice versa).
#
# Usage:
#   bash scripts/guard-deploy-target.sh <main|demo> [artifact-dir]
#
# artifact-dir defaults to .tmp/deployments/cloudflare/public (relative to the
# repo root, same default build-assets.sh writes to). Exit 0 = artifact
# matches the target. Exit 1 = mismatch (or bad usage), explicit message.
#
# ⚠️ Anchor string — do NOT guess (avigail finding 4). A search for
# `"enabled":true` alone false-positives on the MAIN artifact too:
# deploy-config.json's obsidian-web-layout plugin entry
# (`"obsidian-web-layout":{"install":true,"enabled":true}`) is injected via
# JSON.stringify into every build, demo or not. The anchor MUST include the
# key name: `"demoVault":{"enabled":true`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MAIN_DIR="$(cd "$CF_DIR/../../.." && pwd)"

TARGET="${1:-}"
ARTIFACT_DIR="${2:-$MAIN_DIR/.tmp/deployments/cloudflare/public}"
ANCHOR='"demoVault":{"enabled":true'
INDEX_HTML="$ARTIFACT_DIR/index.html"

if [[ "$TARGET" != "main" && "$TARGET" != "demo" ]]; then
  echo ""
  echo "ERROR: guard-deploy-target.sh requires a target argument: 'main' or 'demo' (got: '${TARGET}')."
  echo "Usage: bash scripts/guard-deploy-target.sh <main|demo> [artifact-dir]"
  exit 1
fi

if [[ ! -f "$INDEX_HTML" ]]; then
  echo ""
  echo "ERROR: $INDEX_HTML not found — build the artifact first (npm run build / npm run build:demo)."
  exit 1
fi

IS_DEMO=false
if grep -qF "$ANCHOR" "$INDEX_HTML"; then
  IS_DEMO=true
fi

if [[ "$TARGET" == "demo" && "$IS_DEMO" != "true" ]]; then
  echo ""
  echo "ERROR: target is 'demo' but $INDEX_HTML has no demo config injected."
  echo "Did you forget OW_PROFILE=demo? Run 'npm run build:demo' before deploying to the demo target."
  exit 1
fi

if [[ "$TARGET" == "main" && "$IS_DEMO" == "true" ]]; then
  echo ""
  echo "ERROR: refusing to deploy a DEMO artifact ($INDEX_HTML has demoVault.enabled=true) to the 'main' target."
  echo "Rebuild without OW_PROFILE (plain 'npm run build') before deploying to main/production."
  exit 1
fi

echo "  guard: artifact matches target '$TARGET' — OK"
