#!/bin/bash
# The production bash tool owns this process. Files survive cancellation as evidence.
set -eu
mkdir -p evidence
printf '%s\n' "$$" > evidence/pid
trap 'printf "terminated\n" >> evidence/lifetime; exit 143' TERM INT HUP
trap 'printf "exited\n" >> evidence/lifetime' EXIT
printf 'started\n' >> evidence/lifetime
while [ ! -f evidence/release ]; do
  printf 'heartbeat\n' >> evidence/heartbeat
  printf 'QA tool heartbeat\n'
  sleep 0.1
done
printf 'released\n' >> evidence/lifetime
printf 'QA tool completed\n'
