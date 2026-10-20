#!/bin/sh
# `pnpm install:nyte`: puts the nyte built from this checkout where your terminal runs it.
set -eu
cd "$(dirname "$0")/.."
folder="$HOME/.nyte/bin"
staged="$folder/.nyte-$$"
mkdir -p "$folder"
cp packages/tui/dist/nyte "$staged"
chmod 755 "$staged"
mv -f "$staged" "$folder/nyte"
echo "Installed nyte $(cat packages/tui/dist/nyte.version) at $folder/nyte"
found=$(command -v nyte || true)
if [ "$found" = "" ]; then
	echo "Add ~/.nyte/bin to your PATH: export PATH=\"\$HOME/.nyte/bin:\$PATH\"" >&2
elif [ "$found" != "$folder/nyte" ]; then
	echo "Your terminal runs $found first. Put ~/.nyte/bin before it on your PATH." >&2
fi
