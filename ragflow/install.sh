#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${1:-$SCRIPT_DIR}"
INSTALL_DIR="${RAGFLOW_INSTALL_DIR:-/opt/moss-ragflow}"
ENV_FILE="$INSTALL_DIR/.env"
ENV_TEMPLATE="$STAGE_DIR/env.example"
[[ -f "$ENV_TEMPLATE" ]] || ENV_TEMPLATE="$STAGE_DIR/.env.example"
[[ -f "$ENV_TEMPLATE" ]] || { echo "ERROR: env.example is missing from $STAGE_DIR" >&2; exit 1; }
PULL_IMAGES="${PULL_IMAGES:-1}"
BUILD_EXTENDED_MCP="${BUILD_EXTENDED_MCP:-1}"
ALLOW_LOW_RESOURCES="${ALLOW_LOW_RESOURCES:-1}"
CHECK_ONLY="${CHECK_ONLY:-0}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
json_field() {
  printf '%s' "$1" | grep -Eo "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n1 \
    | sed -E "s/.*:[[:space:]]*\"([^\"]*)\".*/\1/"
}

[[ "$EUID" -eq 0 ]] || die "run as root"
[[ "$(uname -m)" == "x86_64" ]] || die "the bundled Infinity image currently requires Linux x86_64"
command -v docker >/dev/null || die "Docker Engine is required"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"

if ! command -v curl >/dev/null; then
  command -v apt-get >/dev/null || die "missing command: curl"
  log "Installing host prerequisites"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
fi

log "Installing deployment files under $INSTALL_DIR"
install -d -m 0755 "$INSTALL_DIR"
stage_real="$(cd "$STAGE_DIR" && pwd -P)"
install_real="$(cd "$INSTALL_DIR" && pwd -P)"
if [[ "$stage_real" != "$install_real" ]]; then
  install -m 0644 "$STAGE_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
  install -m 0644 "$STAGE_DIR/docker-compose.gpu.yml" "$INSTALL_DIR/docker-compose.gpu.yml"
  install -m 0644 "$STAGE_DIR/docker-compose.native-mcp.yml" "$INSTALL_DIR/docker-compose.native-mcp.yml"
  install -m 0644 "$ENV_TEMPLATE" "$INSTALL_DIR/env.example"
  install -m 0755 "$STAGE_DIR/install.sh" "$INSTALL_DIR/install.sh"
  install -m 0755 "$STAGE_DIR/ragflowctl" "$INSTALL_DIR/ragflowctl"
  install -m 0755 "$STAGE_DIR/start.sh" "$INSTALL_DIR/start.sh"
  install -m 0755 "$STAGE_DIR/stop.sh" "$INSTALL_DIR/stop.sh"
  rm -rf "$INSTALL_DIR/config" "$INSTALL_DIR/mcp-extended" "$INSTALL_DIR/scripts"
  cp -a "$STAGE_DIR/config" "$STAGE_DIR/mcp-extended" "$STAGE_DIR/scripts" "$INSTALL_DIR/"
fi
find "$INSTALL_DIR" -type f -name '._*' -delete
chmod 0755 "$INSTALL_DIR/scripts/"*.sh

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 "$INSTALL_DIR/env.example" "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
set_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
apply_setting() {
  local key="$1" fallback="$2" current override
  current="$(env_value "$key")"
  override="${!key-}"
  if [[ -n "$override" ]]; then
    set_env "$key" "$override"
  elif [[ -z "$current" ]]; then
    set_env "$key" "$fallback"
  fi
}
gen_secret() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
ensure_secret() {
  local key="$1" current
  current="$(env_value "$key")"
  if [[ -z "$current" || "$current" == "CHANGE_ME" ]]; then
    set_env "$key" "$(gen_secret)"
  fi
}

apply_setting COMPOSE_PROJECT_NAME ragflow
apply_setting RAGFLOW_DEVICE cpu
apply_setting WITH_LOCAL_MODELS 1
apply_setting ENABLE_NATIVE_MCP 1
apply_setting ENABLE_EXTENDED_MCP 1
apply_setting ENABLE_MOSS_RAG_MCP 1
apply_setting RAGFLOW_IMAGE swr.cn-north-4.myhuaweicloud.com/infiniflow/ragflow:v0.27.1
apply_setting INFINITY_IMAGE docker.1ms.run/infiniflow/infinity:v0.7.3-x64-v3
apply_setting MYSQL_IMAGE docker.1ms.run/library/mysql:8.0.40
apply_setting MINIO_IMAGE docker.1ms.run/pgsty/silo:RELEASE.2026-08-06T00-00-00Z
apply_setting REDIS_IMAGE docker.1ms.run/valkey/valkey:8
apply_setting OLLAMA_IMAGE docker.m.daocloud.io/ollama/ollama:0.33.3
apply_setting EXTENDED_MCP_IMAGE moss/ragflow-mcp-extended:0.1.0
apply_setting EXTENDED_MCP_PYTHON_IMAGE docker.m.daocloud.io/library/python:3.12-slim-bookworm
apply_setting RAGFLOW_BIND_IP 0.0.0.0
apply_setting SVR_WEB_HTTP_PORT 80
apply_setting SVR_MCP_PORT 9382
apply_setting EXTENDED_MCP_PORT 9385
apply_setting MOSS_RAG_MCP_PORT 9386
apply_setting EXTENDED_MCP_SCOPES read,write,agent
apply_setting EXTENDED_MCP_MAX_BASE64_MB 8
apply_setting EXTENDED_MCP_MAX_UPLOAD_MB 200
apply_setting MOSS_RAG_MCP_MOSS_SERVER_URL http://host.docker.internal:43127
apply_setting RAGFLOW_ADMIN_BIND_IP 127.0.0.1
apply_setting ADMIN_SVR_HTTP_PORT 9381
apply_setting RAGFLOW_ADMIN_EMAIL admin@ragflow.io
apply_setting RAGFLOW_ADMIN_NICKNAME admin
apply_setting OLLAMA_CHAT_MODEL qwen3:1.7b
apply_setting OLLAMA_EMBED_MODEL qwen3-embedding:0.6b
apply_setting TZ Asia/Shanghai
[[ -z "${HF_ENDPOINT-}" ]] || set_env HF_ENDPOINT "$HF_ENDPOINT"

device="$(env_value RAGFLOW_DEVICE)"
[[ "$device" == "cpu" || "$device" == "gpu" ]] || die "RAGFLOW_DEVICE must be cpu or gpu"
scopes="$(env_value EXTENDED_MCP_SCOPES)"
[[ "$scopes" =~ ^(read|write|agent|admin)(,(read|write|agent|admin))*$ ]] || die "invalid EXTENDED_MCP_SCOPES: $scopes"
for key in WITH_LOCAL_MODELS ENABLE_NATIVE_MCP ENABLE_EXTENDED_MCP ENABLE_MOSS_RAG_MCP; do
  value="$(env_value "$key")"
  [[ "$value" == "0" || "$value" == "1" ]] || die "$key must be 0 or 1"
done

bind_ip="${RAGFLOW_MCP_BIND_IP-}"
[[ -n "$bind_ip" ]] || bind_ip="$(env_value RAGFLOW_MCP_BIND_IP)"
if [[ -z "$bind_ip" || "$bind_ip" == "auto" ]]; then
  bind_ip="$(hostname -I | awk '{print $1}')"
fi
[[ "$bind_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid RAGFLOW_MCP_BIND_IP: $bind_ip"
set_env RAGFLOW_MCP_BIND_IP "$bind_ip"

public_url="${EXTENDED_MCP_PUBLIC_URL-}"
[[ -n "$public_url" ]] || public_url="$(env_value EXTENDED_MCP_PUBLIC_URL)"
if [[ -z "$public_url" ]]; then
  public_url="http://$bind_ip:$(env_value EXTENDED_MCP_PORT)"
fi
[[ "$public_url" =~ ^https?:// ]] || die "EXTENDED_MCP_PUBLIC_URL must use http or https"
set_env EXTENDED_MCP_PUBLIC_URL "$public_url"

moss_public_url="${MOSS_RAG_MCP_PUBLIC_URL-}"
[[ -n "$moss_public_url" ]] || moss_public_url="$(env_value MOSS_RAG_MCP_PUBLIC_URL)"
if [[ -z "$moss_public_url" ]]; then
  moss_public_url="http://$bind_ip:$(env_value MOSS_RAG_MCP_PORT)"
fi
[[ "$moss_public_url" =~ ^https?:// ]] || die "MOSS_RAG_MCP_PUBLIC_URL must use http or https"
set_env MOSS_RAG_MCP_PUBLIC_URL "$moss_public_url"

for key in MYSQL_PASSWORD MINIO_PASSWORD REDIS_PASSWORD ADMIN_DEFAULT_PASSWORD MOSS_RAGFLOW_GATEWAY_TOKEN; do
  ensure_secret "$key"
done

project_name="$(env_value COMPOSE_PROJECT_NAME)"
existing_workdir="$(docker inspect "${project_name}-mysql-1" \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)"
if [[ -n "$existing_workdir" ]]; then
  existing_workdir="$(readlink -f "$existing_workdir")"
  requested_workdir="$(readlink -f "$INSTALL_DIR")"
  if [[ "$existing_workdir" != "$requested_workdir" ]]; then
    die "Compose project '$project_name' is already managed from $existing_workdir; set RAGFLOW_INSTALL_DIR=$existing_workdir or choose another COMPOSE_PROJECT_NAME"
  fi
fi

compose_args=(docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$INSTALL_DIR/docker-compose.yml")
[[ "$device" == "gpu" ]] && compose_args+=(-f "$INSTALL_DIR/docker-compose.gpu.yml")
[[ "$(env_value ENABLE_NATIVE_MCP)" == "1" ]] && compose_args+=(-f "$INSTALL_DIR/docker-compose.native-mcp.yml")
compose_all_args=("${compose_args[@]}" --profile extended-mcp --profile moss-rag-mcp --profile local-models)
[[ "$(env_value ENABLE_EXTENDED_MCP)" == "1" ]] && compose_args+=(--profile extended-mcp)
[[ "$(env_value ENABLE_MOSS_RAG_MCP)" == "1" ]] && compose_args+=(--profile moss-rag-mcp)
[[ "$(env_value WITH_LOCAL_MODELS)" == "1" ]] && compose_args+=(--profile local-models)
compose() { "${compose_args[@]}" "$@"; }
compose_all() { "${compose_all_args[@]}" "$@"; }
remove_disabled_services() {
  local disabled=()
  [[ "$(env_value ENABLE_EXTENDED_MCP)" == "1" ]] || disabled+=(ragflow-mcp-extended)
  [[ "$(env_value ENABLE_MOSS_RAG_MCP)" == "1" ]] || disabled+=(moss-rag-mcp)
  [[ "$(env_value WITH_LOCAL_MODELS)" == "1" ]] || disabled+=(ollama)
  if ((${#disabled[@]})); then
    compose_all rm --stop --force "${disabled[@]}" >/dev/null
  fi
}

log "Validating the generated Compose configuration"
compose config --quiet
if [[ "$CHECK_ONLY" == "1" ]]; then
  echo "Configuration is valid: $INSTALL_DIR"
  exit 0
fi

install -m 0755 "$STAGE_DIR/ragflowctl" /usr/local/sbin/ragflowctl
install -m 0755 "$STAGE_DIR/ragflowctl" /usr/local/bin/ragflowctl

cpu_count="$(nproc)"
mem_gb="$(awk '/MemTotal/ {print int($2 / 1024 / 1024)}' /proc/meminfo)"
disk_gb="$(df --output=avail -BG "$INSTALL_DIR" | awk 'NR==2 {gsub(/G/, ""); print $1}')"
if ((cpu_count < 4 || mem_gb < 15 || disk_gb < 35)); then
  printf 'WARNING: detected %s CPU, %s GiB RAM, %s GiB free disk; recommended minimum is 4 CPU, 16 GiB RAM, 50 GiB disk.\n' \
    "$cpu_count" "$mem_gb" "$disk_gb" >&2
  [[ "$ALLOW_LOW_RESOURCES" == "1" ]] || die "set ALLOW_LOW_RESOURCES=1 to accept this host"
fi

if [[ "$device" == "gpu" ]]; then
  command -v nvidia-smi >/dev/null || die "GPU mode requires NVIDIA drivers and nvidia-smi"
fi

if [[ "$PULL_IMAGES" == "1" ]]; then
  log "Pulling public runtime images"
  compose pull --ignore-buildable
fi

if [[ "$(env_value ENABLE_EXTENDED_MCP)" == "1" || "$(env_value ENABLE_MOSS_RAG_MCP)" == "1" ]] && [[ "$BUILD_EXTENDED_MCP" == "1" ]]; then
  log "Building the custom Extended MCP image"
  if [[ "$PULL_IMAGES" == "1" ]]; then
    compose build --pull ragflow-mcp-extended
  else
    compose build ragflow-mcp-extended
  fi
elif [[ "$(env_value ENABLE_EXTENDED_MCP)" == "1" || "$(env_value ENABLE_MOSS_RAG_MCP)" == "1" ]]; then
  docker image inspect "$(env_value EXTENDED_MCP_IMAGE)" >/dev/null \
    || die "preloaded Extended MCP image not found: $(env_value EXTENDED_MCP_IMAGE)"
fi

log "Starting RAGFlow"
compose up -d --remove-orphans
remove_disabled_services

if [[ "$(env_value WITH_LOCAL_MODELS)" == "1" ]]; then
  log "Ensuring Ollama models are installed"
  for _ in $(seq 1 60); do
    compose exec -T ollama ollama list >/dev/null 2>&1 && break
    sleep 2
  done
  for model in "$(env_value OLLAMA_EMBED_MODEL)" "$(env_value OLLAMA_CHAT_MODEL)"; do
    if ! compose exec -T ollama ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$model"; then
      compose exec -T ollama ollama pull "$model"
    fi
  done
fi

log "Waiting for services"
web_bind="$(env_value RAGFLOW_BIND_IP)"
[[ "$web_bind" == "0.0.0.0" ]] && web_bind=127.0.0.1
ready=0
for _ in $(seq 1 120); do
  body="$(curl --fail --silent --max-time 5 "http://$web_bind:$(env_value SVR_WEB_HTTP_PORT)/api/v1/system/healthz" 2>/dev/null || true)"
  if [[ "$(json_field "$body" status)" == "ok" && "$(json_field "$body" db)" == "ok" \
     && "$(json_field "$body" doc_engine)" == "ok" && "$(json_field "$body" redis)" == "ok" \
     && "$(json_field "$body" storage)" == "ok" ]]; then
    ready=1
    break
  fi
  sleep 5
done
[[ "$ready" == "1" ]] || { compose logs --tail=160 ragflow; die "RAGFlow did not become healthy within 10 minutes"; }

wait_sidecar_health() {
  local port="$1" service="$2" auth_mode="$3" ready=0
  for _ in $(seq 1 60); do
    body="$(curl --fail --silent --max-time 5 "http://$bind_ip:$port/healthz" 2>/dev/null || true)"
    if [[ "$(json_field "$body" status)" == "ok" && "$(json_field "$body" service)" == "$service" \
       && "$(json_field "$body" auth_mode)" == "$auth_mode" ]]; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ "$ready" == "1" ]] || die "$service did not become healthy within 2 minutes"
}

wait_mcp_authentication() {
  local port="$1" label="$2" code=000
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$bind_ip:$port/mcp" || true)"
    [[ "$code" == "401" ]] && return 0
    sleep 2
  done
  die "$label expected unauthenticated HTTP 401, got $code"
}

if [[ "$(env_value ENABLE_NATIVE_MCP)" == "1" ]]; then
  wait_mcp_authentication "$(env_value SVR_MCP_PORT)" "native MCP"
fi
if [[ "$(env_value ENABLE_EXTENDED_MCP)" == "1" ]]; then
  wait_sidecar_health "$(env_value EXTENDED_MCP_PORT)" ragflow-mcp-extended direct
  wait_mcp_authentication "$(env_value EXTENDED_MCP_PORT)" "Extended MCP"
fi
if [[ "$(env_value ENABLE_MOSS_RAG_MCP)" == "1" ]]; then
  wait_sidecar_health "$(env_value MOSS_RAG_MCP_PORT)" moss-rag-mcp moss
  wait_mcp_authentication "$(env_value MOSS_RAG_MCP_PORT)" "Moss RAG MCP"
fi

printf '\nRAGFlow is ready.\nWeb:          http://%s:%s\n' "$bind_ip" "$(env_value SVR_WEB_HTTP_PORT)"
[[ "$(env_value ENABLE_NATIVE_MCP)" == "1" ]] && printf 'Native MCP:   http://%s:%s/mcp (RAGFlow API key)\n' "$bind_ip" "$(env_value SVR_MCP_PORT)"
[[ "$(env_value ENABLE_EXTENDED_MCP)" == "1" ]] && printf 'Extended MCP: http://%s:%s/mcp (RAGFlow API key)\n' "$bind_ip" "$(env_value EXTENDED_MCP_PORT)"
if [[ "$(env_value ENABLE_MOSS_RAG_MCP)" == "1" ]]; then
  printf 'Moss RAG MCP: http://%s:%s/mcp (current Moss login)\n' "$bind_ip" "$(env_value MOSS_RAG_MCP_PORT)"
  printf 'Moss Server:  %s (configured in %s)\n' "$(env_value MOSS_RAG_MCP_MOSS_SERVER_URL)" "$ENV_FILE"
fi
echo 'Operations:   ragflowctl status'
