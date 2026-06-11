#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_DIR="$ROOT_DIR/macos/Assets"
SVG_PATH="$ASSET_DIR/AppIcon.svg"
ICONSET_DIR="$ASSET_DIR/AppIcon.iconset"
ICNS_PATH="$ASSET_DIR/AppIcon.icns"
TMP_DIR="$(mktemp -d /tmp/bilingual-icon.XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$ASSET_DIR"
rm -rf "$ICONSET_DIR" "$ICNS_PATH"
mkdir -p "$ICONSET_DIR"

qlmanage -t -s 1024 -o "$TMP_DIR" "$SVG_PATH" >/dev/null
BASE_PNG="$TMP_DIR/$(basename "$SVG_PATH").png"

if [[ ! -f "$BASE_PNG" ]]; then
  echo "Failed to render $SVG_PATH" >&2
  exit 1
fi

make_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$BASE_PNG" --out "$ICONSET_DIR/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH"
rm -rf "$ICONSET_DIR"

echo "$ICNS_PATH"
