#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$ROOT/"*.sh "$ROOT/scripts/"*.sh

for required in .env.example compose.yaml nginx.conf configure.sh install.sh upgrade.sh \
  package.sh start.sh stop.sh scripts/common.sh scripts/validate.sh scripts/cloud-storage-init.sh scripts/silo-init.sh; do
  [[ -f "$ROOT/$required" ]] || { echo "ERROR: missing $required" >&2; exit 1; }
done

for command_name in jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 \
    || { echo "ERROR: $command_name is required" >&2; exit 1; }
done

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  rendered_config="$(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" \
    -f "$ROOT/compose.yaml" --profile cloud --profile cloud-init config --format json)"
  jq -e '
    .networks["moss-integration"].name == "moss-integrations"
    and .networks["moss-db"].internal == true
    and (.services.mysql.ports // [] | length) == 0
    and (.services.mysql.networks | keys) == ["moss-db"]
    and (.services.server.networks | has("moss-db"))
    and (.services.server.environment | has("MYSQL_ROOT_PASSWORD") | not)
    and .services.server.depends_on.mysql.condition == "service_healthy"
    and (.services.mysql.volumes | any(.target == "/var/lib/mysql"))
    and .networks["moss-storage"].internal == true
    and (.services.silo.ports // [] | length) == 0
    and (.services["silo-init"].ports // [] | length) == 0
    and .services.silo.image == "docker.1ms.run/pgsty/silo:RELEASE.2026-08-06T00-00-00Z"
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
   and .bootstrapAdmin.password == "password"
   and .database.driver == "mysql"
   and .database.host == "mysql"
   and .database.database == "moss"
   and .database.passwordEnv == "MOSS_DB_PASSWORD"
   and (.storage | has("dbPath") | not)' \
  "$test_root/home/server.json" >/dev/null
jq -e \
  '.openIM.secret == "preserve-me"
   and .serverRuntime.dockerImage == "ghcr.io/example/private-runtime:test"' \
  "$test_root/home/settings.json" >/dev/null
openssl x509 -in "$test_root/deployment/tls/server.crt" -noout -text \
  | grep -Fq 'IP Address:10.0.1.181'

# Reconfiguration must retain credentials and all cloud storage overrides.
first_password="$(sed -n 's/^SILO_ROOT_PASSWORD=//p' "$test_root/deployment/.env")"
jq -e '.cloudStorage.endpoint == "http://silo:9000" and .cloudStorage.enabled == true' "$test_root/home/server.json" >/dev/null
jq '.cloudStorage = {enabled:false,endpoint:"https://external.example",bucket:"custom",region:"custom-region",quotaBytes:123456789}' "$test_root/home/server.json" > "$test_root/home/config.new"
mv "$test_root/home/config.new" "$test_root/home/server.json"
"$test_root/deployment/configure.sh" >/dev/null
[[ "$first_password" == "$(sed -n 's/^SILO_ROOT_PASSWORD=//p' "$test_root/deployment/.env")" ]]
jq -e '.cloudStorage.enabled == false and .cloudStorage.endpoint == "https://external.example" and .cloudStorage.quotaBytes == 123456789' "$test_root/home/server.json" >/dev/null

mkdir -p "$test_root/upgrade"
cp "$ROOT/.env.example" "$test_root/upgrade/.env"
cp "$ROOT/upgrade.sh" "$test_root/upgrade/upgrade.sh"
printf '%s\n' '#!/usr/bin/env bash' '[[ "${PULL_IMAGES:-}" == 1 ]]' \
  > "$test_root/upgrade/start.sh"
chmod 0755 "$test_root/upgrade/upgrade.sh" "$test_root/upgrade/start.sh"
"$test_root/upgrade/upgrade.sh" 1.2.3 >/dev/null
grep -Fxq 'MINIO_IMAGE=docker.1ms.run/pgsty/silo:RELEASE.2026-08-06T00-00-00Z' "$test_root/upgrade/.env"
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
