#!/bin/sh
set -e

# The update scripts extract files to /app/.tmp/ then atomically rename() them
# into /app/vendor/. rename() across different filesystems raises EXDEV, and
# /app/.tmp (container layer) vs /app/vendor (Docker volume) are different
# devices. Fix: redirect .tmp into the vendor volume so both paths share the
# same filesystem and rename() succeeds.
mkdir -p /app/vendor/.tmp
rm -rf /app/.tmp
ln -sf /app/vendor/.tmp /app/.tmp

if [ ! -f /app/vendor/obsidian/app.js ]; then
  echo "[docker] Downloading Obsidian desktop renderer (first run — this takes ~30s)..."
  node scripts/update-obsidian.js
fi

if [ ! -f /app/vendor/obsidian-mobile/app.js ]; then
  echo "[docker] Downloading Obsidian mobile renderer (first run — this takes ~30s)..."
  node scripts/update-obsidian-mobile.js
fi

exec "$@"
