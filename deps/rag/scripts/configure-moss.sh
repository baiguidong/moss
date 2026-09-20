#!/usr/bin/env bash

set -Eeuo pipefail

ENV_FILE="${1:?Usage: configure-moss.sh RAGFLOW_ENV_FILE}"
[[ -f "$ENV_FILE" ]] || { echo "ERROR: RAGFlow environment file not found: $ENV_FILE" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required" >&2; exit 1; }

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

setting() {
  local key="$1" fallback="${2-}" value="${!1-}"
  [[ -n "$value" ]] || value="$(env_value "$key")"
  [[ -n "$value" ]] || value="$fallback"
  printf '%s' "$value"
}

write_moss_config="$(setting WRITE_MOSS_CONFIG 1)"
[[ "$write_moss_config" == "0" || "$write_moss_config" == "1" ]] \
  || { echo "ERROR: WRITE_MOSS_CONFIG must be 0 or 1" >&2; exit 1; }
[[ "$write_moss_config" == "1" ]] || exit 0

moss_server_home="$(setting MOSS_SERVER_HOME /data/moss-server)"
moss_server_config="$(setting MOSS_SERVER_CONFIG "$moss_server_home/server.json")"
[[ "$moss_server_config" == /* ]] \
  || { echo "ERROR: MOSS_SERVER_CONFIG must be an absolute path" >&2; exit 1; }
[[ -f "$moss_server_config" ]] || {
  echo "ERROR: Moss Server config not found: $moss_server_config (start Moss Server first or set WRITE_MOSS_CONFIG=0)" >&2
  exit 1
}

enabled_value="$(setting ENABLE_MOSS_RAG_MCP 1)"
case "$enabled_value" in
  1) enabled=true ;;
  0) enabled=false ;;
  *) echo "ERROR: ENABLE_MOSS_RAG_MCP must be 0 or 1" >&2; exit 1 ;;
esac

base_url="$(setting MOSS_RAGFLOW_BASE_URL http://moss-ragflow:9380)"
admin_url="$(setting MOSS_RAGFLOW_ADMIN_URL http://moss-ragflow:9381)"
admin_email="$(setting RAGFLOW_ADMIN_EMAIL admin@ragflow.io)"
admin_password="$(setting ADMIN_DEFAULT_PASSWORD)"
gateway_token="$(setting MOSS_RAGFLOW_GATEWAY_TOKEN)"
user_domain="$(setting MOSS_RAGFLOW_USER_DOMAIN ragflow.com)"
password_length="$(setting MOSS_RAGFLOW_PASSWORD_LENGTH 6)"
request_timeout_ms="$(setting MOSS_RAGFLOW_REQUEST_TIMEOUT_MS 15000)"

[[ "$base_url" =~ ^https?://[^[:space:]]+$ ]] \
  || { echo "ERROR: invalid MOSS_RAGFLOW_BASE_URL: $base_url" >&2; exit 1; }
[[ "$admin_url" =~ ^https?://[^[:space:]]+$ ]] \
  || { echo "ERROR: invalid MOSS_RAGFLOW_ADMIN_URL: $admin_url" >&2; exit 1; }
[[ -n "$admin_password" ]] \
  || { echo "ERROR: ADMIN_DEFAULT_PASSWORD is required" >&2; exit 1; }
[[ ${#gateway_token} -ge 32 ]] \
  || { echo "ERROR: MOSS_RAGFLOW_GATEWAY_TOKEN must be at least 32 characters" >&2; exit 1; }
[[ "$password_length" =~ ^[0-9]+$ ]] && ((password_length >= 6 && password_length <= 64)) \
  || { echo "ERROR: MOSS_RAGFLOW_PASSWORD_LENGTH must be between 6 and 64" >&2; exit 1; }
[[ "$request_timeout_ms" =~ ^[0-9]+$ ]] && ((request_timeout_ms >= 1000)) \
  || { echo "ERROR: MOSS_RAGFLOW_REQUEST_TIMEOUT_MS must be at least 1000" >&2; exit 1; }

config_dir="$(dirname "$moss_server_config")"
install -d -m 0700 "$config_dir"
config_tmp="$(mktemp "$config_dir/.server.json.XXXXXX")"
trap 'rm -f "$config_tmp"' EXIT

jq -e 'type == "object"' "$moss_server_config" >/dev/null \
  || { echo "ERROR: existing Moss Server config is not a JSON object: $moss_server_config" >&2; exit 1; }
existing_owner="$(stat -c '%u:%g' "$moss_server_config" 2>/dev/null || true)"

jq \
  --argjson enabled "$enabled" \
  --arg baseUrl "$base_url" \
  --arg adminUrl "$admin_url" \
  --arg adminEmail "$admin_email" \
  --arg adminPassword "$admin_password" \
  --arg gatewayToken "$gateway_token" \
  --arg userDomain "$user_domain" \
  --argjson passwordLength "$password_length" \
  --argjson requestTimeoutMs "$request_timeout_ms" \
  '.ragflow = ((.ragflow // {}) + {
    enabled: $enabled,
    instanceId: "default",
    baseUrl: $baseUrl,
    adminUrl: $adminUrl,
    adminEmail: $adminEmail,
    adminPassword: $adminPassword,
    gatewayToken: $gatewayToken,
    userDomain: $userDomain,
    passwordLength: $passwordLength,
    requestTimeoutMs: $requestTimeoutMs
  })' "$moss_server_config" > "$config_tmp"

chmod 0600 "$config_tmp"
[[ -z "$existing_owner" ]] || chown "$existing_owner" "$config_tmp"
mv -f "$config_tmp" "$moss_server_config"
trap - EXIT

printf 'Moss Server RAGFlow configuration updated: %s\n' "$moss_server_config"
