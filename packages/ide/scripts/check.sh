#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
swift build "$@" 2>&1 | grep -E "error:|warning:|Compiling|Build complete|Build failed" | grep -v "Compiling" | sed -E 's/\x1b\[[0-9;]*m//g' | sort -u
