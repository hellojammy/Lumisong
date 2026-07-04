#!/usr/bin/env bash
# 将 web/dist 同步到 iOS Bundle 的 WebContent 目录。
# 用法：先在 web/ 下 `npm run build`，再运行本脚本。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$REPO_ROOT/web/dist"
DEST="$SCRIPT_DIR/Lumisong/WebContent"

if [[ ! -d "$DIST" ]]; then
  echo "[sync-web] 未找到 $DIST，请先在 web/ 执行 npm run build" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$DIST/." "$DEST/"
echo "[sync-web] 已同步 web/dist → $DEST"
