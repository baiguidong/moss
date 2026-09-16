#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"
SOURCE_ENV="${1:-${ENV_FILE}}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -f "${ENV_EXAMPLE}" ]] || die "missing ${ENV_EXAMPLE}"
command -v jq >/dev/null 2>&1 || die "jq is required"

read_file_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n -E "s/^${key}=//p" "$file" | tail -n 1 \
    | sed -E 's/[[:space:]]+#.*$//; s/^"//; s/"$//'
}

read_value() {
  local key="$1" value="${!1-}"
  if [[ -z "$value" ]]; then
    value="$(read_file_value "$SOURCE_ENV" "$key")"
  fi
  if [[ -z "$value" ]]; then
    value="$(read_file_value "$ENV_EXAMPLE" "$key")"
  fi
  printf '%s' "$value"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

read_secret() {
  local key="$1" value
  value="$(read_value "$key")"
  if [[ -z "$value" || "$value" == "change-me" || "$value" == "CHANGE_ME" ]]; then
    value="$(random_secret)"
  fi
  [[ "$value" =~ ^[A-Za-z0-9._~-]{8,}$ ]] \
    || die "$key must be at least 8 characters and use only letters, numbers, dot, underscore, tilde, or dash"
  printf '%s' "$value"
}

validate_env_value() {
  local key="$1" value="$2"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *[[:space:]]* ]] \
    || die "$key may not contain whitespace"
}

validate_port() {
  local key="$1" value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1 && value <= 65535)) \
    || die "$key must be a port between 1 and 65535"
}

validate_http_url() {
  local key="$1" value="$2"
  [[ "$value" =~ ^https?://[^[:space:]\"\\#]+$ ]] || die "$key must be an http(s) URL without spaces or fragments"
}

validate_ws_url() {
  local key="$1" value="$2"
  [[ "$value" =~ ^wss?://[^[:space:]\"\\#]+$ ]] || die "$key must be a ws(s) URL without spaces or fragments"
}

detected_host="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
detected_host="${detected_host:-127.0.0.1}"

public_host="$(read_value PUBLIC_HOST)"
[[ -n "$public_host" && "$public_host" != "auto" ]] || public_host="$detected_host"
[[ "$public_host" =~ ^([A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\])$ ]] \
  || die "PUBLIC_HOST must be an IP address or hostname without a URL scheme"

data_dir="$(read_value DATA_DIR)"
openim_bind_ip="$(read_value OPENIM_BIND_IP)"
openim_admin_bind_ip="$(read_value OPENIM_ADMIN_BIND_IP)"

mongo_image="$(read_value MONGO_IMAGE)"
redis_image="$(read_value REDIS_IMAGE)"
etcd_image="$(read_value ETCD_IMAGE)"
kafka_image="$(read_value KAFKA_IMAGE)"
minio_image="$(read_value MINIO_IMAGE)"
openim_server_image="$(read_value OPENIM_SERVER_IMAGE)"
openim_chat_image="$(read_value OPENIM_CHAT_IMAGE)"
openim_web_image="$(read_value OPENIM_WEB_FRONT_IMAGE)"
openim_admin_image="$(read_value OPENIM_ADMIN_FRONT_IMAGE)"

openim_api_port="$(read_value OPENIM_API_PORT)"
openim_ws_port="$(read_value OPENIM_MSG_GATEWAY_PORT)"
chat_api_port="$(read_value CHAT_API_PORT)"
admin_api_port="$(read_value ADMIN_API_PORT)"
web_port="$(read_value OPENIM_WEB_FRONT_PORT)"
admin_front_port="$(read_value OPENIM_ADMIN_FRONT_PORT)"
minio_port="$(read_value MINIO_PORT)"
minio_console_port="$(read_value MINIO_CONSOLE_PORT)"

for key in OPENIM_API_PORT OPENIM_MSG_GATEWAY_PORT CHAT_API_PORT ADMIN_API_PORT \
  OPENIM_WEB_FRONT_PORT OPENIM_ADMIN_FRONT_PORT MINIO_PORT MINIO_CONSOLE_PORT; do
  validate_port "$key" "${!key:-$(read_value "$key")}"
done

ports=("$openim_api_port" "$openim_ws_port" "$chat_api_port" "$admin_api_port" \
  "$web_port" "$admin_front_port" "$minio_port" "$minio_console_port")
for ((i = 0; i < ${#ports[@]}; i++)); do
  for ((j = i + 1; j < ${#ports[@]}; j++)); do
    [[ "${ports[i]}" != "${ports[j]}" ]] || die "host ports must be unique: ${ports[i]} is used more than once"
  done
done

mongo_root_password="$(read_secret MONGO_ROOT_PASSWORD)"
mongo_password="$(read_secret MONGO_PASSWORD)"
redis_password="$(read_secret REDIS_PASSWORD)"
minio_secret="$(read_secret MINIO_SECRET_ACCESS_KEY)"
openim_secret="$(read_secret OPENIM_SECRET)"
moss_webhook_secret="$(read_secret MOSS_WEBHOOK_SECRET)"
(( ${#moss_webhook_secret} >= 16 )) || die "MOSS_WEBHOOK_SECRET must be at least 16 characters"

openim_api_url="$(read_value OPENIM_API_URL)"
openim_ws_url="$(read_value OPENIM_WS_URL)"
openim_chat_url="$(read_value OPENIM_CHAT_URL)"
minio_external_address="$(read_value MINIO_EXTERNAL_ADDRESS)"
openim_api_url="${openim_api_url:-http://${public_host}:${openim_api_port}}"
openim_ws_url="${openim_ws_url:-ws://${public_host}:${openim_ws_port}}"
openim_chat_url="${openim_chat_url:-http://${public_host}:${chat_api_port}}"
minio_external_address="${minio_external_address:-http://${public_host}:${minio_port}}"
validate_http_url OPENIM_API_URL "$openim_api_url"
validate_ws_url OPENIM_WS_URL "$openim_ws_url"
validate_http_url OPENIM_CHAT_URL "$openim_chat_url"
validate_http_url MINIO_EXTERNAL_ADDRESS "$minio_external_address"

moss_server_url="$(read_value MOSS_SERVER_URL)"
moss_server_url="${moss_server_url%/}"
validate_http_url MOSS_SERVER_URL "$moss_server_url"
[[ "$moss_server_url" =~ ^https?://[^/]+$ ]] || die "MOSS_SERVER_URL must not include a path"

moss_callback_url="$(read_value MOSS_CALLBACK_URL)"
if [[ -z "$moss_callback_url" ]]; then
  moss_callback_url="$moss_server_url"
  moss_callback_url="${moss_callback_url/127.0.0.1/host.docker.internal}"
  moss_callback_url="${moss_callback_url/localhost/host.docker.internal}"
fi
moss_callback_url="${moss_callback_url%/}"
validate_http_url MOSS_CALLBACK_URL "$moss_callback_url"

write_moss_settings="$(read_value WRITE_MOSS_SETTINGS)"
[[ "$write_moss_settings" == "0" || "$write_moss_settings" == "1" ]] \
  || die "WRITE_MOSS_SETTINGS must be 0 or 1"
moss_settings_file="$(read_value MOSS_SETTINGS_FILE)"
if [[ -z "$moss_settings_file" ]]; then
  moss_server_home="${MOSS_SERVER_HOME:-${MOSS_INSTALL_DIR:-}}"
  if [[ -z "$moss_server_home" && -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    moss_user_home="$(getent passwd "$SUDO_USER" 2>/dev/null | awk -F: 'NR == 1 {print $6}')"
    [[ -n "$moss_user_home" ]] && moss_server_home="${moss_user_home%/}/.moss/server"
  fi
  moss_server_home="${moss_server_home:-${HOME:-/root}/.moss/server}"
  moss_settings_file="${moss_server_home%/}/settings.json"
fi
[[ "$moss_settings_file" == /* ]] || die "MOSS_SETTINGS_FILE must be an absolute path"
moss_service_name="$(read_value MOSS_SERVICE_NAME)"
[[ "$moss_service_name" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "invalid MOSS_SERVICE_NAME"

validate_env_value DATA_DIR "$data_dir"
validate_env_value OPENIM_BIND_IP "$openim_bind_ip"
validate_env_value OPENIM_ADMIN_BIND_IP "$openim_admin_bind_ip"
validate_env_value MOSS_SETTINGS_FILE "$moss_settings_file"

resolved_data_dir="$data_dir"
[[ "$resolved_data_dir" == /* ]] || resolved_data_dir="${ROOT_DIR}/${resolved_data_dir}"
mkdir -p "${ROOT_DIR}/config" "$resolved_data_dir"
umask 077

cat > "$ENV_FILE" <<EOF
MONGO_IMAGE=${mongo_image}
REDIS_IMAGE=${redis_image}
ETCD_IMAGE=${etcd_image}
KAFKA_IMAGE=${kafka_image}
MINIO_IMAGE=${minio_image}
OPENIM_SERVER_IMAGE=${openim_server_image}
OPENIM_CHAT_IMAGE=${openim_chat_image}
OPENIM_WEB_FRONT_IMAGE=${openim_web_image}
OPENIM_ADMIN_FRONT_IMAGE=${openim_admin_image}

DATA_DIR=${data_dir}
PUBLIC_HOST=${public_host}
OPENIM_BIND_IP=${openim_bind_ip}
OPENIM_ADMIN_BIND_IP=${openim_admin_bind_ip}
MONGO_ADDRESS=mongo:27017
MONGO_USERNAME=openIM
MONGO_ROOT_PASSWORD=${mongo_root_password}
MONGO_PASSWORD=${mongo_password}
KAFKA_ADDRESS=kafka:9094
KAFKA_USERNAME=
KAFKA_PASSWORD=
ETCD_ADDRESS=etcd:2379
ETCD_USERNAME=
ETCD_PASSWORD=
REDIS_ADDRESS=redis:6379
REDIS_PASSWORD=${redis_password}
MINIO_INTERNAL_ADDRESS=minio:9000
MINIO_EXTERNAL_ADDRESS=${minio_external_address}
MINIO_ACCESS_KEY_ID=openim
MINIO_SECRET_ACCESS_KEY=${minio_secret}
MINIO_PORT=${minio_port}
MINIO_CONSOLE_PORT=${minio_console_port}
OPENIM_SECRET=${openim_secret}
OPENIM_API_PORT=${openim_api_port}
OPENIM_MSG_GATEWAY_PORT=${openim_ws_port}
CHAT_API_PORT=${chat_api_port}
ADMIN_API_PORT=${admin_api_port}
OPENIM_WEB_FRONT_PORT=${web_port}
OPENIM_ADMIN_FRONT_PORT=${admin_front_port}
OPENIM_API_URL=${openim_api_url}
OPENIM_WS_URL=${openim_ws_url}
OPENIM_CHAT_URL=${openim_chat_url}
API_URL=http://openim-server:10002
LOG_IS_STDOUT=true
LOG_LEVEL=3
GRAFANA_URL=
MOSS_SERVER_URL=${moss_server_url}
MOSS_CALLBACK_URL=${moss_callback_url}
MOSS_WEBHOOK_SECRET=${moss_webhook_secret}
MOSS_SETTINGS_FILE=${moss_settings_file}
MOSS_SERVICE_NAME=${moss_service_name}
WRITE_MOSS_SETTINGS=${write_moss_settings}
EOF

callback_url="${moss_callback_url}/api/v1/im/openim-callback/${moss_webhook_secret}"
escaped_callback_url="$(printf '%s' "$callback_url" | sed 's/[\\&|\"]/\\&/g')"
sed "s|__MOSS_CALLBACK_URL__|${escaped_callback_url}|" \
  "${ROOT_DIR}/config/webhooks.yml.template" > "${ROOT_DIR}/config/webhooks.yml"

jq -n \
  --arg apiUrl "$openim_api_url" \
  --arg wsUrl "$openim_ws_url" \
  --arg chatUrl "$openim_chat_url" \
  --arg secret "$openim_secret" \
  --arg webhookSecret "$moss_webhook_secret" \
  '{openIM: {
    configured: true,
    enabled: true,
    instanceId: "default",
    apiUrl: $apiUrl,
    wsUrl: $wsUrl,
    chatUrl: $chatUrl,
    adminUserId: "imAdmin",
    secret: $secret,
    webhookSecret: $webhookSecret,
    requestTimeoutMs: 15000
  }}' > "${ROOT_DIR}/config/moss-system-settings.json"

if [[ "$write_moss_settings" == "1" ]]; then
  settings_dir="$(dirname "$moss_settings_file")"
  mkdir -p "$settings_dir"
  settings_tmp="$(mktemp "${settings_dir}/.settings.json.XXXXXX")"
  existing_owner=""
  if [[ -f "$moss_settings_file" ]]; then
    jq -e 'type == "object"' "$moss_settings_file" >/dev/null \
      || die "existing Moss settings is not a valid JSON object: $moss_settings_file"
    existing_owner="$(stat -c '%u:%g' "$moss_settings_file" 2>/dev/null || true)"
    jq --slurpfile generated "${ROOT_DIR}/config/moss-system-settings.json" \
      '. + {openIM: $generated[0].openIM}' "$moss_settings_file" > "$settings_tmp"
  else
    jq -n --slurpfile generated "${ROOT_DIR}/config/moss-system-settings.json" \
      '{openIM: $generated[0].openIM}' > "$settings_tmp"
  fi
  chmod 600 "$settings_tmp"
  if [[ -z "$existing_owner" && -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    existing_owner="$(id -u "$SUDO_USER"):$(id -g "$SUDO_USER")"
  fi
  [[ -z "$existing_owner" ]] || chown "$existing_owner" "$settings_tmp"
  mv -f "$settings_tmp" "$moss_settings_file"
fi

chmod 600 "$ENV_FILE" "${ROOT_DIR}/config/webhooks.yml" \
  "${ROOT_DIR}/config/moss-system-settings.json"

printf 'OpenIM configuration: %s\n' "$ENV_FILE"
printf 'Webhook configuration: %s\n' "${ROOT_DIR}/config/webhooks.yml"
if [[ "$write_moss_settings" == "1" ]]; then
  printf 'Moss settings updated: %s\n' "$moss_settings_file"
else
  printf 'Moss settings payload: %s\n' "${ROOT_DIR}/config/moss-system-settings.json"
fi
