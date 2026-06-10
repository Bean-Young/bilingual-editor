#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Bilingual Editor"
EXECUTABLE_NAME="BilingualEditor"
PACKAGE_DIR="$ROOT_DIR/macos"
RELEASE_DIR="$ROOT_DIR/release"
APP_BUNDLE="$RELEASE_DIR/$APP_NAME.app"
DMG_PATH="$RELEASE_DIR/Bilingual-Editor-macOS.dmg"
ZIP_PATH="$RELEASE_DIR/Bilingual-Editor-macOS.zip"
BUILD_DIR="$ROOT_DIR/.build/macos"
OBJECTIVE_C_SOURCE="$PACKAGE_DIR/Sources/BilingualEditor/main.m"
MACOS_DEPLOYMENT_TARGET="${MACOS_DEPLOYMENT_TARGET:-13.0}"

cd "$ROOT_DIR"

echo "==> Building web app"
npm run build

echo "==> Building macOS wrapper"
mkdir -p "$BUILD_DIR"
clang \
  -fobjc-arc \
  -mmacosx-version-min="$MACOS_DEPLOYMENT_TARGET" \
  -framework Cocoa \
  -framework WebKit \
  "$OBJECTIVE_C_SOURCE" \
  -o "$BUILD_DIR/$EXECUTABLE_NAME"

echo "==> Staging app bundle"
rm -rf "$APP_BUNDLE" "$DMG_PATH" "$ZIP_PATH"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources/Web"
cp "$BUILD_DIR/$EXECUTABLE_NAME" "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
cp -R "$ROOT_DIR/dist/." "$APP_BUNDLE/Contents/Resources/Web/"

cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$EXECUTABLE_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>app.bilingual-editor.desktop</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

echo "==> Ad-hoc signing app bundle"
/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE"

echo "==> Creating zip"
ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

echo "==> Creating dmg"
if hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$APP_BUNDLE" \
    -ov \
    -format UDZO \
    "$DMG_PATH"; then
  echo "$DMG_PATH"
else
  echo "Warning: could not create DMG. The zip artifact is still ready: $ZIP_PATH" >&2
fi

echo "==> Done"
echo "$APP_BUNDLE"
echo "$ZIP_PATH"
if [[ -f "$DMG_PATH" ]]; then
  echo "$DMG_PATH"
fi
