#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
	echo "Usage: prompt-file.sh <prompt-file>" >&2
	exit 2
fi
exec nyte --print <"$1"
