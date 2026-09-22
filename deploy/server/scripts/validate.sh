#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$ROOT/"*.sh "$ROOT/scripts/"*.sh

for required in .env.example compose.yaml nginx.conf configure.sh install.sh upgrade.sh \
  package.sh start.sh stop.sh scripts/common.sh scripts/validate.sh; do
  [[ -f "$ROOT/$required" ]] || { echo "ERROR: missing $required" >&2; exit 1; }
done

for command_name in jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 \
    || { echo "ERROR: $command_name is required" >&2; exit 1; }
done

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  rendered_config="$(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" \
    -f "$ROOT/compose.yaml" config --format json)"
  jq -e '
    .networks["moss-integration"].name == "moss-integrations"
    and (.services.server.networks["moss-integration"].aliases | index("moss-server")) != null
  ' <<<"$rendered_config" >/dev/null
fi

grep -Fq 'proxy_set_header Upgrade $http_upgrade;' "$ROOT/nginx.conf"
grep -Fq 'ssl_certificate /etc/nginx/tls/server.crt;' "$ROOT/nginx.conf"
grep -Fq 'docker pull "$(env_value MOSS_RUNTIME_IMAGE)"' "$ROOT/start.sh"
grep -Fq 'MOSS_SERVER_HOME=/data/moss-server' "$ROOT/.env.example"
grep -Fq 'MOSS_INTEGRATION_NETWORK=moss-integrations' "$ROOT/.env.example"
grep -Fq 'apply_setting MOSS_SERVER_HOME /data/moss-server' "$ROOT/configure.sh"
grep -Fxq "apply_setting MOSS_SERVER_IMAGE ''" "$ROOT/configure.sh"
grep -Fxq "apply_setting MOSS_RUNTIME_IMAGE ''" "$ROOT/configure.sh"
grep -Fq 'INSTALL_DIR="${INSTALL_DIR:-/data/moss-server}"' "$ROOT/install.sh"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/deployment" "$test_root/home"
cp "$ROOT/.env.example" "$ROOT/configure.sh" "$test_root/deployment/"
printf '%s\n' '{"openIM":{"secret":"preserve-me"}}' > "$test_root/home/settings.json"
MOSS_SERVER_HOME="$test_root/home" \
MOSS_PUBLIC_HOST=10.0.1.181 \
MOSS_SERVER_IMAGE=ghcr.io/example/private-server:test \
MOSS_RUNTIME_IMAGE=ghcr.io/example/private-runtime:test \
  "$test_root/deployment/configure.sh" >/dev/null

jq -e \
  '.server.publicUrl == "https://10.0.1.181"
   and .bootstrapAdmin.username == "admin"
   and .bootstrapAdmin.password == "password"' \
  "$test_root/home/server.json" >/dev/null
jq -e \
  '.openIM.secret == "preserve-me"
   and .serverRuntime.dockerImage == "ghcr.io/example/private-runtime:test"' \
  "$test_root/home/settings.json" >/dev/null
openssl x509 -in "$test_root/deployment/tls/server.crt" -noout -text \
  | grep -Fq 'IP Address:10.0.1.181'

mkdir -p "$test_root/upgrade"
cp "$ROOT/.env.example" "$test_root/upgrade/.env"
cp "$ROOT/upgrade.sh" "$test_root/upgrade/upgrade.sh"
printf '%s\n' '#!/usr/bin/env bash' '[[ "${PULL_IMAGES:-}" == 1 ]]' \
  > "$test_root/upgrade/start.sh"
chmod 0755 "$test_root/upgrade/upgrade.sh" "$test_root/upgrade/start.sh"
"$test_root/upgrade/upgrade.sh" 1.2.3 >/dev/null
grep -Fxq 'MOSS_SERVER_IMAGE=ghcr.io/baiguidong/moss-server:1.2.3' \
  "$test_root/upgrade/.env"
grep -Fxq 'MOSS_RUNTIME_IMAGE=ghcr.io/baiguidong/moss-runtime:1.2.3' \
  "$test_root/upgrade/.env"

if grep -RInE --exclude='README.md' --exclude='validate.sh' \
  --exclude-dir='tls' '/Users/|git clone|curl.+github.com' "$ROOT"; then
  echo 'ERROR: deployment files contain a machine-specific path or repository download' >&2
  exit 1
fi

echo 'Moss Server Compose deployment validation passed.'
