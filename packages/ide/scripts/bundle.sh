#!/bin/sh
# Builds a release Nyte IDE.app into build/. Pass "debug" for a debug build.
set -eu
cd "$(dirname "$0")/.."
configuration="${1:-release}"
swift build -c "$configuration" 2>&1 | grep -E "error:|warning:|Build complete|Build failed" | sed -E 's/\x1b\[[0-9;]*m//g' | sort -u
binary="$(swift build -c "$configuration" --show-bin-path)/NyteIDE"
app="build/Nyte IDE.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/NyteIDE"
[ "$configuration" = release ] && strip -x "$app/Contents/MacOS/NyteIDE"
cp Resources/Info.plist "$app/Contents/Info.plist"
codesign --force --sign - "$app" >/dev/null 2>&1
echo "$app  $(du -sh "$app" | cut -f1)"
