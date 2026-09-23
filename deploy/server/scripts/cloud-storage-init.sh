#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
server_home="$(env_value MOSS_SERVER_HOME)"
config="$server_home/server.json"
jq -e '.cloudStorage.enabled == true' "$config" >/dev/null || exit 0
cloud_cli() { compose exec -T server /opt/moss/node/bin/node /opt/moss/app/bin/moss-server.mjs cloud-storage "$@"; }
if [[ "$(jq -r '.cloudStorage.endpoint' "$config")" == http://silo:9000 ]]; then
  export CLOUD_BUCKET
  CLOUD_BUCKET="$(jq -r '.cloudStorage.bucket' "$config")"
  [[ "$CLOUD_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die 'Invalid bucket name'
  [[ "${PULL_IMAGES:-1}" == 0 ]] || compose --profile cloud --profile cloud-init pull silo silo-init
  compose --profile cloud up -d --wait --wait-timeout 180 silo
  init_dir="$server_home/var/run/cloud-init"
  install -d -m 0700 "$init_dir"
  trap 'rm -f "$init_dir/credentials"' EXIT
  cloud_cli init-credentials > "$init_dir/credentials"
  chmod 0600 "$init_dir/credentials"
  compose --profile cloud-init run --rm --no-deps silo-init
fi
cloud_cli probe
