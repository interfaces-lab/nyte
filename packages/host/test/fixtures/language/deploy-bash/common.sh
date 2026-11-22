#!/usr/bin/env bash

export DEPLOY_ENV="${DEPLOY_ENV:-staging}"
export RELEASE_DIR="/srv/releases"
export MAX_RETRIES=3

# Print an informational message prefixed with the current environment.
log_info() {
  local message="$1"
  printf '[%s] %s\n' "$DEPLOY_ENV" "$message"
}

# Print an error message to standard error.
log_error() {
  local message="$1"
  printf '[%s] ERROR: %s\n' "$DEPLOY_ENV" "$message" >&2
}
