#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

target=$(node scripts/release-targets.mjs host)

if [ -z "${TURBO_HASH:-}" ]; then
	pnpm --filter @nyte-ai/tui build
fi
sh scripts/assemble-release.sh packages/tui/dist/nyte dist "$target"
