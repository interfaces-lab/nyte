#!/bin/sh
set -eu
if [ "$#" -eq 0 ]; then
	echo "Usage: ask.sh <prompt>" >&2
	exit 2
fi
exec nyte --print -- "$@"
