#!/usr/bin/env bash
# Sync web/dist into the macOS app resource directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$REPO_ROOT/web/dist"
DEST="$SCRIPT_DIR/LumisongMac/WebContent"

if [[ ! -d "$DIST" ]]; then
  echo "[sync-web] missing $DIST; run npm run build in web first" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$DIST/." "$DEST/"
echo "[sync-web] synced web/dist -> $DEST"
