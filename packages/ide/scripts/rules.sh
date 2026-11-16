#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node="$(command -v node || mise which node 2>/dev/null || /opt/homebrew/bin/mise which node 2>/dev/null || true)"
[ -n "$node" ] || { echo "rules.sh: node is needed to run the rules check" >&2; exit 1; }
"$node" scripts/check-rules.mjs "$@"
