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
#   bash scripts/guard-deploy-target.sh <main|demo|gdd> [artifact-dir]
#
# artifact-dir defaults to .tmp/deployments/cloudflare/public (relative to the
# repo root, same default build-assets.sh writes to). Exit 0 = artifact
# matches the target. Exit 1 = mismatch (or bad usage), explicit message.
#
# ⚠️ Anchor strings — do NOT guess (avigail finding 4). A search for
# `"enabled":true` alone false-positives on the MAIN artifact too:
# deploy-config.json's obsidian-web-layout plugin entry
# (`"obsidian-web-layout":{"install":true,"enabled":true}`) is injected via
# JSON.stringify into every build, whatever the profile. Each anchor MUST
# include its key name.
#
# The profile is DERIVED from the artifact (exactly one anchor can match,
# since a profile enables demoVault or defaultRepo and never both) and then
# compared to the requested target. Deriving-then-comparing, rather than one
# boolean per target, is what makes every wrong pairing an error instead of
# only the two the demo/main split originally had: before `gdd` existed a
# two-way boolean was total, and adding a third profile to it would have let
# a gdd artifact — which has demoVault.enabled=false — sail through the
# 'main' check as if it were the production build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MAIN_DIR="$(cd "$CF_DIR/../../.." && pwd)"

TARGET="${1:-}"
ARTIFACT_DIR="${2:-$MAIN_DIR/.tmp/deployments/cloudflare/public}"
DEMO_ANCHOR='"demoVault":{"enabled":true'
GDD_ANCHOR='"defaultRepo":{"enabled":true'
INDEX_HTML="$ARTIFACT_DIR/index.html"

if [[ "$TARGET" != "main" && "$TARGET" != "demo" && "$TARGET" != "gdd" ]]; then
  echo ""
  echo "ERROR: guard-deploy-target.sh requires a target argument: 'main', 'demo' or 'gdd' (got: '${TARGET}')."
  echo "Usage: bash scripts/guard-deploy-target.sh <main|demo|gdd> [artifact-dir]"
  exit 1
fi

if [[ ! -f "$INDEX_HTML" ]]; then
  echo ""
  echo "ERROR: $INDEX_HTML not found — build the artifact first (npm run build / npm run build:demo / npm run build:gdd)."
  exit 1
fi

# Which profile is this artifact? gdd is tested first only for determinism —
# the two anchors are mutually exclusive in every committed config.
ARTIFACT_PROFILE=main
if grep -qF "$GDD_ANCHOR" "$INDEX_HTML"; then
  ARTIFACT_PROFILE=gdd
elif grep -qF "$DEMO_ANCHOR" "$INDEX_HTML"; then
  ARTIFACT_PROFILE=demo
fi

if [[ "$ARTIFACT_PROFILE" != "$TARGET" ]]; then
  echo ""
  echo "ERROR: refusing to deploy a '${ARTIFACT_PROFILE}' artifact to the '${TARGET}' target."
  echo "       ($INDEX_HTML carries the ${ARTIFACT_PROFILE} profile's injected config.)"
  case "$TARGET" in
    main) echo "Rebuild with plain 'npm run build' before deploying to main/production." ;;
    demo) echo "Rebuild with 'npm run build:demo' before deploying to the demo target." ;;
    gdd)  echo "Rebuild with 'npm run build:gdd' before deploying to the gdd target." ;;
  esac
  exit 1
fi

echo "  guard: artifact matches target '$TARGET' — OK"
