#!/bin/sh
# `pnpm install:tui`: puts the nyte built from this checkout where your terminal runs it.
set -eu
cd "$(dirname "$0")/.."
# A nightly version, as `install:desktop` stamps, so the build follows the nightly channel and sorts above the installed one.
run=$(date -u +%H%M%S | sed 's/^0*//')
version=${NYTE_RELEASE_VERSION:-$(GITHUB_RUN_NUMBER="${run:-1}" node scripts/release-version.mjs resolve --nightly | sed 's/^version=//')}
NYTE_RELEASE_VERSION="$version" pnpm exec turbo build --filter=@nyte-ai/tui
folder="$HOME/.nyte/bin"
staged="$folder/.nyte-$$"
mkdir -p "$folder"
cp packages/tui/dist/nyte-tailnet "$staged"
chmod 755 "$staged"
mv -f "$staged" "$folder/nyte-tailnet"
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
