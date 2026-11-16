#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
swift build --product NyteShot 2>&1 | grep -E "error:|warning:|Build failed" | sed -E 's/\x1b\[[0-9;]*m//g' | sort -u || true
"$(swift build --show-bin-path)/NyteShot" "$@"
