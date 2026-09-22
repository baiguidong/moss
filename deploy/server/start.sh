#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker_config=''
cleanup() {
  [[ -z "$docker_config" ]] || rm -rf "$docker_config"
}
trap cleanup EXIT

for command_name in curl docker jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 \
    || { echo "ERROR: $command_name is required" >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 \
  || { echo 'ERROR: Docker Compose v2 is required' >&2; exit 1; }

if command -v systemctl >/dev/null 2>&1 \
  && systemctl is-active --quiet moss-server.service; then
  echo 'ERROR: legacy moss-server.service is active; stop and disable it before starting Compose' >&2
  exit 1
fi

"$SCRIPT_DIR/configure.sh" "$SCRIPT_DIR/.env"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/common.sh"
ensure_integration_network

if [[ "${PULL_IMAGES:-1}" == 1 ]]; then
  registry_token="${MOSS_REGISTRY_TOKEN:-}"
  registry_username="${MOSS_REGISTRY_USERNAME:-$(env_value MOSS_REGISTRY_USERNAME)}"
  if [[ -n "$registry_token" ]]; then
    [[ -n "$registry_username" ]] \
      || die 'MOSS_REGISTRY_USERNAME is required with MOSS_REGISTRY_TOKEN'
    docker_config="$(mktemp -d)"
    export DOCKER_CONFIG="$docker_config"
    printf '%s' "$registry_token" | docker login "$(env_value MOSS_REGISTRY)" \
      --username "$registry_username" --password-stdin
  fi
  log 'Pulling Moss Server, runtime, and Nginx images'
  compose pull
  docker pull "$(env_value MOSS_RUNTIME_IMAGE)"
fi

log 'Starting Moss Server with HTTPS'
if ! compose up -d --remove-orphans; then
  show_failure_logs
  die 'failed to start Moss Server'
fi
wait_for_server

server_home="$(env_value MOSS_SERVER_HOME)"
config_path="$server_home/server.json"
show_bootstrap_credentials=0
jq -e '.bootstrapAdmin.password | type == "string" and length > 0' \
  "$config_path" >/dev/null 2>&1 && show_bootstrap_credentials=1
jq 'del(.bootstrapAdmin.password)' "$config_path" > "$config_path.new"
mv "$config_path.new" "$config_path"
chmod 0600 "$config_path"

compose ps
printf '\nMoss Server is ready at https://%s' "$(env_value MOSS_PUBLIC_HOST)"
[[ "$(env_value MOSS_HTTPS_PORT)" == 443 ]] || printf ':%s' "$(env_value MOSS_HTTPS_PORT)"
printf '/admin/\n'
if [[ "$show_bootstrap_credentials" == 1 ]]; then
  printf 'Administrator: %s/%s (change it after first login)\n' \
    "$(env_value MOSS_ADMIN_USERNAME)" "$(env_value MOSS_ADMIN_PASSWORD)"
fi
