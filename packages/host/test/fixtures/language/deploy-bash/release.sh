#!/usr/bin/env bash

source ./common.sh

# Build the filesystem path for a versioned release.
build_release_path() {
  local service="$1"
  local version="$2"
  printf '%s/%s/%s-%s\n' "$RELEASE_DIR" "$DEPLOY_ENV" "$service" "$version"
}

# Verify that a release directory exists on disk.
verify_release_dir() {
  local target_dir="$1"
  if [[ ! -d "$target_dir" ]]; then
    log_error "Missing release directory: $target_dir"
    return 1
  fi
  log_info "Verified release directory: $target_dir"
}
