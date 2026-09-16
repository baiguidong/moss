#!/usr/bin/env bash

set -Eeuo pipefail

IM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${IM_ROOT}/.env"
COMPOSE_FILE="${IM_ROOT}/compose.yaml"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

env_value() {
  sed -n -E "s/^${1}=//p" "$ENV_FILE" | tail -n 1
}

compose() {
  docker compose --project-directory "$IM_ROOT" --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" "$@"
}

show_failure_logs() {
  compose ps || true
  compose logs --tail=160 mongo redis etcd kafka minio openim-server openim-chat || true
}

wait_for_services() {
  local names=(mongo redis etcd kafka minio openim-server openim-chat)
  local all_healthy name status

  log "Waiting for OpenIM and all dependencies"
  for _ in $(seq 1 120); do
    all_healthy=1
    for name in "${names[@]}"; do
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
      case "$status" in
        healthy) ;;
        exited|dead)
          show_failure_logs
          die "$name stopped before becoming healthy"
          ;;
        *) all_healthy=0 ;;
      esac
    done
    [[ "$all_healthy" == "1" ]] && return 0
    sleep 5
  done

  show_failure_logs
  die "OpenIM did not become healthy within 10 minutes"
}

verify_openim_api() {
  local bind_ip probe_host port payload response
  bind_ip="$(env_value OPENIM_BIND_IP)"
  probe_host="$bind_ip"
  [[ "$probe_host" != "0.0.0.0" ]] || probe_host=127.0.0.1
  [[ "$probe_host" != "::" ]] || probe_host='[::1]'
  port="$(env_value OPENIM_API_PORT)"
  payload="$(jq -nc --arg secret "$(env_value OPENIM_SECRET)" \
    '{secret: $secret, userID: "imAdmin"}')"
  response="$(curl --fail --silent --show-error --max-time 10 \
    -H 'Content-Type: application/json' -H 'operationID: install-check' \
    --data "$payload" "http://${probe_host}:${port}/auth/get_admin_token")" \
    || die "the host cannot reach the OpenIM API"
  jq -e '.errCode == 0 and (.data.token | type == "string" and length > 0)' \
    >/dev/null <<<"$response" || die "OpenIM rejected its configured admin secret"
}

verify_moss_callback() {
  local skip callback_base webhook_secret health response
  skip="${SKIP_MOSS_CHECK:-0}"
  [[ "$skip" == "0" || "$skip" == "1" ]] || die "SKIP_MOSS_CHECK must be 0 or 1"
  if [[ "$skip" == "1" ]]; then
    printf 'WARNING: Moss health and webhook verification were skipped.\n' >&2
    return 0
  fi

  callback_base="$(env_value MOSS_CALLBACK_URL)"
  webhook_secret="$(env_value MOSS_WEBHOOK_SECRET)"
  health="$(docker exec openim-server wget -q -T 5 -O - "${callback_base}/healthz" 2>/dev/null || true)"
  jq -e '.ok == true and .ready == true' >/dev/null <<<"$health" \
    || die "OpenIM cannot reach a ready Moss Server at ${callback_base}"

  response="$(docker exec openim-server wget -q -T 5 -O - \
    --header='Content-Type: application/json' \
    --header='operationID: install-webhook-check' \
    --post-data='{"callbackCommand":"installProbe"}' \
    "${callback_base}/api/v1/im/openim-callback/${webhook_secret}/installProbe" 2>/dev/null || true)"
  jq -e '.errCode == 0 and .actionCode == 0' >/dev/null <<<"$response" \
    || die "Moss rejected the OpenIM webhook. If Moss was already running, restart it to load the settings written by install.sh"
}

verify_installation() {
  log "Verifying OpenIM API and Moss webhook"
  verify_openim_api
  verify_moss_callback
}
