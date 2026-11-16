#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node="$(command -v node || mise which node 2>/dev/null || /opt/homebrew/bin/mise which node 2>/dev/null || true)"
[ -n "$node" ] || { echo "design.sh: node is needed to run the design check" >&2; exit 1; }
"$node" scripts/check-design.mjs "$@"
