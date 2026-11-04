#!/bin/sh
# `pnpm package` in packages/tui. Builds packages/tui/dist/nyte and stages release artifacts in dist/.
# Produces dist/<name>.tar.gz plus a .sha256 beside it, where
# <name> is nyte-v<version>-<os>-<arch>.
#
# Upload the pair with:
#   gh release create vX.Y.Z --target main dist/*.tar.gz dist/*.sha256
set -eu
cd "$(dirname "$0")/.."

target=$(node scripts/release-targets.mjs host)

# Under Turbo, package depends on build, so packages/tui/dist/nyte is already current.
if [ -z "${TURBO_HASH:-}" ]; then
	pnpm --filter @nyte-ai/tui build
fi
sh scripts/assemble-release.sh packages/tui/dist/nyte dist "$target"
sh scripts/install-nyte.sh
