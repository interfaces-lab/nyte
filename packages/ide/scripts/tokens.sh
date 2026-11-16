#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node="$(command -v node || mise which node 2>/dev/null || /opt/homebrew/bin/mise which node 2>/dev/null || true)"
if [ -z "$node" ]; then
  [ -f Sources/NyteUI/Tokens/Roles.generated.swift ] && exit 0
  echo "tokens.sh: node is needed once to generate the colour tables" >&2
  exit 1
fi
"$node" scripts/sync-tokens.mjs "$@"
