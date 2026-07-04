#!/usr/bin/env bash
# Build the web app, compile the macOS Swift shell, and assemble Lumisong.app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$SCRIPT_DIR/build/Lumisong.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

cd "$REPO_ROOT/web"
npm run build

"$SCRIPT_DIR/sync-web.sh"

cd "$SCRIPT_DIR"
swift build -c release --package-path "$SCRIPT_DIR"
BIN_PATH="$(swift build -c release --package-path "$SCRIPT_DIR" --show-bin-path)"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$BIN_PATH/LumisongMac" "$MACOS_DIR/LumisongMac"
cp "$SCRIPT_DIR/Resources/Info.plist" "$CONTENTS_DIR/Info.plist"
cp -R "$SCRIPT_DIR/LumisongMac/WebContent" "$RESOURCES_DIR/WebContent"

chmod +x "$MACOS_DIR/LumisongMac"
echo "[build-app] built $APP_DIR"
