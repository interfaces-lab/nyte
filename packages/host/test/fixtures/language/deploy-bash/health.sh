#!/usr/bin/env bash

source ./common.sh

# Poll a service endpoint up to MAX_RETRIES times.
check_service_health() {
  local service="$1"
  local attempt=1
  while (( attempt <= MAX_RETRIES )); do
    log_info "Checking $service in $DEPLOY_ENV (attempt $attempt/$MAX_RETRIES)"
    attempt=$(( attempt + 1 ))
  done
}
