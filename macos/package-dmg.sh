#!/usr/bin/env bash
# Build Lumisong.app and package a shareable DMG (ad-hoc signed, arm64).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Lumisong"
APP_PATH="$SCRIPT_DIR/build/${APP_NAME}.app"
BUILD_DIR="$SCRIPT_DIR/build"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SCRIPT_DIR/Resources/Info.plist" 2>/dev/null || echo '0.1.0')"
DMG_NAME="${APP_NAME}-${VERSION}-macos-arm64.dmg"
DMG_PATH="$BUILD_DIR/$DMG_NAME"

echo "[package-dmg] building app…"
"$SCRIPT_DIR/build-app.sh"

echo "[package-dmg] ad-hoc signing app bundle…"
codesign --force --deep --sign - "$APP_PATH"

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/lumisong-dmg.XXXXXX")"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

cp -R "$APP_PATH" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

cat > "$STAGING/安装说明.txt" <<'EOF'
Lumisong · 鸣光

系统要求：macOS 13+，Apple 芯片 (M 系列)

安装：
1. 将 Lumisong 拖到「应用程序」文件夹
2. 首次打开若提示无法验证开发者：
   - 右键 Lumisong → 打开 → 再点「打开」
   - 或在「系统设置 → 隐私与安全性」中允许

若从网盘/聊天工具下载后提示已损坏，可在终端执行：
xattr -cr /Applications/Lumisong.app

功能：上传或录制音频，生成三维声音可视化。
EOF

rm -f "$DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

echo "[package-dmg] done: $DMG_PATH"
ls -lh "$DMG_PATH"
