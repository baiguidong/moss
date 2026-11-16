#!/usr/bin/env bash

SERVER_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SERVER_ROOT/.env"
COMPOSE_FILE="$SERVER_ROOT/compose.yaml"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

env_value() {
  sed -n -E "s/^${1}=//p" "$ENV_FILE" | tail -n 1
}

set_env_value() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
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
  local command=(docker compose --project-directory "$SERVER_ROOT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  "${command[@]}" "$@"
}

show_failure_logs() {
  compose ps || true
  compose logs --tail=160 mysql new-api new-api-database-init new-api-oidc-init redis server web-gateway nginx || true
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

wait_for_new_api() {
  log 'Waiting for New API'
  for _ in $(seq 1 60); do
    if curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/status \
      | jq -e '.success == true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  show_failure_logs
  die 'New API did not become healthy within 2 minutes'
}

ensure_new_api_admin_key() {
  [[ "$(env_value MOSS_NEW_API_ENABLED)" == 1 ]] || return 0
  [[ -n "$(env_value MOSS_NEW_API_API_KEY)" ]] && return 0

  local username password setup login admin_token token_name token_id key_response api_key
  username="$(env_value NEW_API_ADMIN_USERNAME)"
  password="$(env_value NEW_API_ADMIN_PASSWORD)"
  [[ -n "$username" && -n "$password" ]] || die 'New API is enabled but administrator credentials are missing'
  wait_for_new_api

  setup="$(curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/setup)" \
    || die 'New API setup status could not be read while creating the Moss gateway key'
  if [[ "$(jq -r '.data.status // false' <<<"$setup")" != true ]]; then
    curl --fail --silent --max-time 10 -X POST http://127.0.0.1:3000/api/setup \
      -H 'Content-Type: application/json' \
      --data "$(jq -nc --arg u "$username" --arg p "$password" '{username:$u,password:$p,confirmPassword:$p,SelfUseModeEnabled:false,DemoSiteEnabled:false}')" >/dev/null \
      || die 'New API administrator initialization failed while creating the Moss gateway key'
  fi

  login="$(curl --fail --silent --max-time 10 -X POST http://127.0.0.1:3000/api/user/login \
    -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg u "$username" --arg p "$password" '{username:$u,password:$p}')")" \
    || die 'New API administrator login failed while creating the Moss gateway key'
  admin_token="$(jq -r '.data.access_token // .access_token // empty' <<<"$login")"
  [[ -n "$admin_token" ]] || die 'New API administrator login returned no access token'

  token_name='moss-server-admin'
  curl --fail --silent --max-time 10 -X POST http://127.0.0.1:3000/api/token/ \
    -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' \
    --data '{"name":"moss-server-admin","unlimited_quota":true,"allow_user_quota_query":true,"expired_time":-1,"group":"default","model_limits_enabled":false,"model_limits":""}' >/dev/null \
    || die 'New API administrator token creation failed'
  token_id="$(curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/token/?p=1\&size=100 \
    -H "Authorization: Bearer $admin_token" \
    | jq -r --arg name "$token_name" '.data.items[]? | select(.name == $name) | .id' | head -n 1)"
  [[ -n "$token_id" ]] || die 'New API administrator token was not returned'
  key_response="$(curl --fail --silent --max-time 10 -X POST "http://127.0.0.1:3000/api/token/${token_id}/key" \
    -H "Authorization: Bearer $admin_token")" \
    || die 'New API administrator token key creation failed'
  api_key="$(jq -r '.data.key // .key // empty' <<<"$key_response")"
  [[ -n "$api_key" ]] || die 'New API administrator token key was not returned'
  set_env_value MOSS_NEW_API_API_KEY "$api_key"
  log 'Configured Moss Server gateway key for New API'
}

wait_for_new_api_oidc_init() {
  local container state exit_code
  log 'Waiting for New API OIDC configuration'
  for _ in $(seq 1 60); do
    container="$(compose ps -a -q new-api-oidc-init)"
    if [[ -n "$container" ]]; then
      state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
      case "$state" in
        exited|dead)
          exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null || true)"
          if [[ "$exit_code" == 0 ]]; then
            return 0
          fi
          show_failure_logs
          die "New API OIDC initialization failed (exit code ${exit_code:-unknown})"
          ;;
      esac
    fi
    sleep 2
  done
  show_failure_logs
  die 'New API OIDC initialization did not finish within 2 minutes'
}
