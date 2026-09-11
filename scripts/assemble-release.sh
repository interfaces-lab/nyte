#!/bin/sh
# Assemble an already-built binary. No build, signing, or release upload occurs here.
set -eu
if [ "$#" -ne 3 ]; then
	echo "Usage: assemble-release.sh <binary> <output-directory> <target>" >&2
	exit 1
fi
binary=$1
output=$2
target=$3
case "$target" in
	darwin-arm64 | darwin-x64 | linux-arm64 | linux-x64) ;;
	*) echo "Unsupported release target: ${target}" >&2; exit 1 ;;
esac
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=$(node -e '
const cli = require(process.argv[1]);
const tui = require(process.argv[2]);
if (cli.version !== tui.version || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(cli.version)) {
  throw new Error("CLI and TUI must have the same valid release version.");
}
process.stdout.write(cli.version);
' "${repo}/packages/cli/package.json" "${repo}/packages/tui/package.json")
name="nyte-v${version}-${target}"
mkdir -p "$output"
stage=$(mktemp -d "${output}/.nyte-package.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp "$binary" "${stage}/nyte"
chmod 755 "${stage}/nyte"
cp -R "${repo}/packages/cli/docs" "${stage}/docs"
printf '%s\n' "$version" >"${stage}/VERSION"
# COPYFILE_DISABLE keeps macOS tar from adding AppleDouble ._ entries.
COPYFILE_DISABLE=1 tar -czf "${output}/${name}.tar.gz" -C "$stage" nyte docs VERSION
(cd "$output" && shasum -a 256 "${name}.tar.gz" >"${name}.tar.gz.sha256")
echo "Staged ${output}/${name}.tar.gz and checksum"
