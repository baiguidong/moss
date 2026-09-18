#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
SOURCE_ENV="${1:-$ENV_FILE}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -f "$ENV_EXAMPLE" ]] || die "missing $ENV_EXAMPLE"
for command_name in jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required"
done

read_file_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n -E "s/^${key}=//p" "$file" | tail -n 1 \
    | sed -E 's/[[:space:]]+#.*$//; s/^"//; s/"$//'
}

read_value() {
  local key="$1" value="${!1-}"
  [[ -n "$value" ]] || value="$(read_file_value "$SOURCE_ENV" "$key")"
  [[ -n "$value" ]] || value="$(read_file_value "$ENV_EXAMPLE" "$key")"
  printf '%s' "$value"
}

set_env() {
  local key="$1" value="$2" escaped
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *[[:space:]]* ]] \
    || die "$key may not contain whitespace"
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

apply_setting() {
  local key="$1" fallback="$2" value
  value="$(read_value "$key")"
  [[ -n "$value" ]] || value="$fallback"
  set_env "$key" "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 "$ENV_EXAMPLE" "$ENV_FILE"
fi

apply_setting COMPOSE_PROJECT_NAME moss-server
apply_setting MOSS_REGISTRY ghcr.io
apply_setting MOSS_REGISTRY_USERNAME ''
apply_setting MOSS_SERVER_IMAGE ghcr.io/baiguidong/moss-server:latest
apply_setting MOSS_RUNTIME_IMAGE ghcr.io/baiguidong/moss-runtime:latest
apply_setting NGINX_IMAGE docker.m.daocloud.io/library/nginx:alpine
apply_setting MOSS_SERVER_HOME /root/.moss/server
apply_setting MOSS_HTTPS_PORT 443
apply_setting MOSS_ADMIN_USERNAME admin
apply_setting MOSS_ADMIN_PASSWORD password
apply_setting TZ Asia/Shanghai

public_host="$(read_value MOSS_PUBLIC_HOST)"
if [[ -z "$public_host" || "$public_host" == auto ]]; then
  public_host="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  public_host="${public_host:-127.0.0.1}"
fi
[[ "$public_host" =~ ^([A-Za-z0-9._-]+|[0-9A-Fa-f:]+)$ ]] \
  || die 'MOSS_PUBLIC_HOST must be an IP address or hostname without a URL scheme'
set_env MOSS_PUBLIC_HOST "$public_host"

server_home="$(read_value MOSS_SERVER_HOME)"
[[ "$server_home" == /* ]] || die 'MOSS_SERVER_HOME must be an absolute path'
https_port="$(read_value MOSS_HTTPS_PORT)"
[[ "$https_port" =~ ^[0-9]+$ ]] && ((https_port >= 1 && https_port <= 65535)) \
  || die 'MOSS_HTTPS_PORT must be between 1 and 65535'

if [[ "$public_host" == *:* ]]; then
  public_authority="[$public_host]"
  certificate_san="IP:$public_host"
elif [[ "$public_host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
  public_authority="$public_host"
  certificate_san="IP:$public_host"
else
  public_authority="$public_host"
  certificate_san="DNS:$public_host"
fi
public_url="https://${public_authority}"
[[ "$https_port" == 443 ]] || public_url="${public_url}:${https_port}"

install -d -m 0700 "$server_home" "$server_home/var/lib" \
  "$server_home/var/run" "$server_home/var/log" "$ROOT_DIR/tls"

config_path="$server_home/server.json"
if [[ -f "$config_path" ]]; then
  jq -e 'type == "object"' "$config_path" >/dev/null \
    || die "existing server config is not a valid JSON object: $config_path"
  jq --arg publicUrl "$public_url" \
    '.server = ((.server // {}) + {host: "0.0.0.0", port: 43127, publicUrl: $publicUrl})' \
    "$config_path" > "$config_path.new"
else
  jq -n \
    --arg publicUrl "$public_url" \
    --arg username "$(read_value MOSS_ADMIN_USERNAME)" \
    --arg password "$(read_value MOSS_ADMIN_PASSWORD)" \
    --arg root "$server_home" \
    '{
      server: {host: "0.0.0.0", port: 43127, publicUrl: $publicUrl},
      auth: {mode: "local", tokenTtlSec: 3600},
      bootstrapAdmin: {username: $username, password: $password},
      storage: {
        rootDir: $root,
        dbPath: ($root + "/var/lib/moss-server.db"),
        dataDir: ($root + "/var/lib"),
        runDir: ($root + "/var/run"),
        logDir: ($root + "/var/log")
      },
      runtimeDefaults: {idleTimeoutMs: 600000, maxSessions: 32},
      docker: {stopTimeoutSec: 10, labels: {}},
      recovery: {
        startupPolicy: "reattach-or-resume",
        heartbeatTimeoutMs: 30000,
        reattachProbeTimeoutMs: 3000,
        resumeOnMissingRuntime: true
      },
      logging: {level: "info"},
      apps: {}
    }' > "$config_path.new"
fi
mv "$config_path.new" "$config_path"

settings_path="$server_home/settings.json"
runtime_image="$(read_value MOSS_RUNTIME_IMAGE)"
if [[ -f "$settings_path" ]]; then
  jq -e 'type == "object"' "$settings_path" >/dev/null \
    || die "existing settings are not a valid JSON object: $settings_path"
  jq --arg image "$runtime_image" \
    '.serverRuntime = ((.serverRuntime // {}) + {dockerImage: $image})
     | del(.serverRuntime.backend, .serverRuntime.defaultProfileMode, .serverRuntime.allowedProfileModes)' \
    "$settings_path" > "$settings_path.new"
else
  jq -n --arg image "$runtime_image" \
    '{serverRuntime: {dockerImage: $image}}' > "$settings_path.new"
fi
mv "$settings_path.new" "$settings_path"

cert_path="$ROOT_DIR/tls/server.crt"
key_path="$ROOT_DIR/tls/server.key"
cert_host_path="$ROOT_DIR/tls/public-host"
cert_host=''
[[ ! -f "$cert_host_path" ]] || cert_host="$(<"$cert_host_path")"
if [[ ! -f "$cert_path" || ! -f "$key_path" || "$cert_host" != "$public_host" ]]; then
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 \
    -subj "/CN=$public_host" -addext "subjectAltName=$certificate_san" \
    -keyout "$key_path" -out "$cert_path" >/dev/null 2>&1
  printf '%s\n' "$public_host" > "$cert_host_path"
fi

chmod 0600 "$ENV_FILE" "$config_path" "$settings_path" "$key_path" "$cert_host_path"
chmod 0644 "$cert_path"
printf 'Moss Server configuration: %s\n' "$config_path"
printf 'Moss Server URL: %s\n' "$public_url"
printf 'Self-signed certificate: %s\n' "$cert_path"
