#!/usr/bin/env bash

SERVER_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SERVER_ROOT/.env"
COMPOSE_FILE="$SERVER_ROOT/compose.yaml"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

env_value() {
  sed -n -E "s/^${1}=//p" "$ENV_FILE" | tail -n 1
}

ensure_integration_network() {
  local network
  network="$(env_value MOSS_INTEGRATION_NETWORK)"
  if ! docker network inspect "$network" >/dev/null 2>&1; then
    log "Creating shared Moss integration network"
    docker network create --driver bridge "$network" >/dev/null
  fi
}

compose() {
  docker compose --project-directory "$SERVER_ROOT" --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" "$@"
}

show_failure_logs() {
  compose ps || true
  compose logs --tail=160 mysql server nginx || true
}

wait_for_server() {
  local port status container
  port="$(env_value MOSS_HTTPS_PORT)"
  log 'Waiting for Moss Server HTTPS endpoint'
  for _ in $(seq 1 60); do
    container="$(compose ps -a -q server)"
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    case "$status" in
      healthy)
        curl --insecure --fail --silent --max-time 5 \
          "https://127.0.0.1:${port}/readyz" >/dev/null && return 0
        ;;
      exited|dead)
        show_failure_logs
        die 'Moss Server stopped before becoming healthy'
        ;;
    esac
    sleep 2
  done
  show_failure_logs
  die 'Moss Server did not become healthy within 2 minutes'
}
