#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
configuration="${1:-release}"
build_path="${NYTE_BUILD_PATH:-.build}"
swift build -c "$configuration" --build-path "$build_path" --product NyteIDE 2>&1 | grep -E "error:|warning:|Build complete|Build failed" | sed -E 's/\x1b\[[0-9;]*m//g' | sort -u
binary="$(swift build -c "$configuration" --build-path "$build_path" --show-bin-path)/NyteIDE"
app="build/Nyte IDE.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/NyteIDE"
[ "$configuration" = release ] && strip -x "$app/Contents/MacOS/NyteIDE"
cp Resources/Info.plist "$app/Contents/Info.plist"
cp ../desktop/build/icon.icns "$app/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$app" >/dev/null 2>&1
echo "$app  $(du -sh "$app" | cut -f1)"
