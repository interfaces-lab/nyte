#!/bin/sh
# `pnpm package` in packages/tui. Builds bin/nyte and stages release artifacts in dist/.
# Produces dist/<name>.tar.gz plus a .sha256 beside it, where
# <name> is nyte-v<version>-<os>-<arch>.
#
# Upload the pair with:
#   gh release create vX.Y.Z --target main dist/*.tar.gz dist/*.sha256
set -eu
cd "$(dirname "$0")/.."

platform="$(uname -s)-$(uname -m)"
case "$platform" in
	Darwin-arm64) target=darwin-arm64 ;;
	Darwin-x86_64) target=darwin-x64 ;;
	Linux-x86_64) target=linux-x64 ;;
	Linux-aarch64) target=linux-arm64 ;;
	*)
		echo "No packaging target for ${platform}." >&2
		exit 1
		;;
esac

# Under Turbo, package depends on build, so bin/nyte is already current.
if [ -z "${TURBO_HASH:-}" ]; then
	pnpm --filter @nyte-ai/tui build
fi
sh scripts/assemble-release.sh bin/nyte dist "$target"
