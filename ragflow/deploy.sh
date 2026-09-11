#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="${1:?Usage: ./deploy.sh user@server}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_STAGE="/tmp/moss-ragflow-${USER:-user}-$$"

cleanup() {
  ssh -o BatchMode=yes "$TARGET" "rm -rf '$REMOTE_STAGE'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[1/3] Checking SSH access to $TARGET"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" true

echo "[2/3] Uploading the self-contained deployment package"
ssh "$TARGET" "install -d -m 0700 '$REMOTE_STAGE'"
COPYFILE_DISABLE=1 scp -q -r \
  "$SCRIPT_DIR/env.example" \
  "$SCRIPT_DIR/docker-compose.yml" \
  "$SCRIPT_DIR/docker-compose.gpu.yml" \
  "$SCRIPT_DIR/docker-compose.native-mcp.yml" \
  "$SCRIPT_DIR/config" \
  "$SCRIPT_DIR/mcp-extended" \
  "$SCRIPT_DIR/scripts" \
  "$SCRIPT_DIR/install.sh" \
  "$SCRIPT_DIR/ragflowctl" \
  "$SCRIPT_DIR/start.sh" \
  "$SCRIPT_DIR/stop.sh" \
  "$TARGET:$REMOTE_STAGE/"

forward_vars=(
  RAGFLOW_INSTALL_DIR COMPOSE_PROJECT_NAME RAGFLOW_DEVICE WITH_LOCAL_MODELS
  ENABLE_NATIVE_MCP ENABLE_EXTENDED_MCP ENABLE_MOSS_RAG_MCP
  PULL_IMAGES BUILD_EXTENDED_MCP ALLOW_LOW_RESOURCES CHECK_ONLY
  RAGFLOW_IMAGE INFINITY_IMAGE MYSQL_IMAGE MINIO_IMAGE REDIS_IMAGE OLLAMA_IMAGE
  EXTENDED_MCP_IMAGE EXTENDED_MCP_PYTHON_IMAGE
  RAGFLOW_BIND_IP RAGFLOW_MCP_BIND_IP SVR_WEB_HTTP_PORT SVR_MCP_PORT
  EXTENDED_MCP_PORT EXTENDED_MCP_PUBLIC_URL EXTENDED_MCP_SCOPES
  EXTENDED_MCP_MAX_BASE64_MB EXTENDED_MCP_MAX_UPLOAD_MB
  MOSS_RAG_MCP_PORT MOSS_RAG_MCP_PUBLIC_URL MOSS_RAG_MCP_MOSS_SERVER_URL
  MOSS_RAGFLOW_GATEWAY_TOKEN
  RAGFLOW_ADMIN_BIND_IP ADMIN_SVR_HTTP_PORT
  OLLAMA_CHAT_MODEL OLLAMA_EMBED_MODEL HF_ENDPOINT TZ
)
remote_command=""
for key in "${forward_vars[@]}"; do
  if printenv "$key" >/dev/null 2>&1; then
    printf -v quoted '%q' "$(printenv "$key")"
    remote_command+="$key=$quoted "
  fi
done
printf -v quoted_installer '%q' "$REMOTE_STAGE/install.sh"
printf -v quoted_stage '%q' "$REMOTE_STAGE"
remote_command+="bash $quoted_installer $quoted_stage"

echo "[3/3] Installing public images and the custom MCP sidecar"
ssh "$TARGET" "$remote_command"

cat <<EOF

Deployment completed on $TARGET.
Run: ssh $TARGET ragflowctl status
EOF
