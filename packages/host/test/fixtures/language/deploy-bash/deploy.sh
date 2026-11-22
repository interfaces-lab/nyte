#!/usr/bin/env bash

source ./common.sh
source ./release.sh
source ./health.sh

# Deploy a named service release to the configured environment.
deploy_release() {
  local service="$1"
  local version="$2"
  local release_path
  release_path="$(build_release_path "$service" "$version")"
  log_info "Deploying $service ($version) into $DEPLOY_ENV under $RELEASE_DIR"
  echo $release_path
  verify_release_dir "$release_path"
  check_service_health "$service"
}

main() {
    local service="${1:-api}"
    local version="${2:-1.0.0}"
    deploy_release "$service" "$version"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
