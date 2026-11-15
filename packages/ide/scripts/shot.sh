#!/bin/sh
# Opens the built app on a folder, captures its window to a PNG, and quits it by PID.
# Usage: shot.sh <out.png> [folder] [seconds-to-settle] [dark|light]
set -eu
cd "$(dirname "$0")/.."
out="$1"; folder="${2:-$PWD}"; settle="${3:-2}"; mode="${4:-}"
app="build/Nyte IDE.app"
tools=".build/tools"; mkdir -p "$tools"
if [ ! -x "$tools/winid" ]; then
  cat > "$tools/winid.swift" <<'S'
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for window in list where (window[kCGWindowOwnerPID as String] as? Int32) == pid && (window[kCGWindowLayer as String] as? Int) == 0 {
    let bounds = window[kCGWindowBounds as String] as! [String: CGFloat]
    print(window[kCGWindowNumber as String] as! Int, Int(bounds["Width"]!), Int(bounds["Height"]!))
}
S
  swiftc -O "$tools/winid.swift" -o "$tools/winid" 2>/dev/null
fi
set -- "$folder"
[ -n "$mode" ] && set -- "$@" -appearance "$mode"
"$app/Contents/MacOS/NyteIDE" "$@" >/tmp/nyte-ide-run.log 2>&1 &
pid=$!
i=0
until [ -n "$("$tools/winid" "$pid" | head -1)" ]; do i=$((i+1)); [ $i -gt 60 ] && { kill "$pid"; echo "no window"; exit 1; }; sleep 0.25; done
sleep "$settle"
wid=$("$tools/winid" "$pid" | sort -k2 -n -r | head -1 | cut -d' ' -f1)
screencapture -x -o -l "$wid" "$out"
ps -o rss= -p "$pid" | awk '{printf "rss %.1f MB\n", $1/1024}'
kill "$pid"
echo "$out"
