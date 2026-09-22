#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$ROOT/"*.sh "$ROOT/ragflowctl" "$ROOT/scripts/"*.sh
grep -Fq 'INSTALL_DIR="${RAGFLOW_INSTALL_DIR:-/data/moss-ragflow}"' "$ROOT/install.sh"
grep -Fq 'INSTALL_DIR="${RAGFLOW_INSTALL_DIR:-/data/moss-ragflow}"' "$ROOT/ragflowctl"
python3 - "$ROOT/mcp-extended/server.py" <<'PY'
import ast
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
PY

if [[ "${SKIP_COMPOSE_VALIDATION:-0}" != "1" ]]; then
RAGFLOW_ENV_FILE=.env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" \
  -f "$ROOT/docker-compose.yml" --profile extended-mcp --profile moss-rag-mcp config --quiet
rendered_config="$(RAGFLOW_ENV_FILE=.env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose \
  --project-directory "$ROOT" --env-file "$ROOT/.env.example" -f "$ROOT/docker-compose.yml" config)"
grep -Fq 'DEFAULT_SUPERUSER_PASSWORD: CHANGE_ME' <<<"$rendered_config" || {
  echo "RAGFlow admin password is not mapped to DEFAULT_SUPERUSER_PASSWORD." >&2
  exit 1
}
RAGFLOW_ENV_FILE=.env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose \
  --project-directory "$ROOT" --env-file "$ROOT/.env.example" -f "$ROOT/docker-compose.yml" \
  --profile extended-mcp --profile moss-rag-mcp config --format json \
  | python3 -c 'import json, sys
services = json.load(sys.stdin)["services"]
assert "MYSQL_USER" not in services["mysql"].get("environment", {}), "MySQL received MYSQL_USER"
assert "moss-integration" in services["ragflow"]["networks"], "RAGFlow is not on the Moss integration network"
assert "moss-ragflow" in services["ragflow"]["networks"]["moss-integration"]["aliases"], "RAGFlow DNS alias is missing"
assert "moss-integration" in services["moss-rag-mcp"]["networks"], "Moss RAG MCP is not on the integration network"
for name in ("ragflow-mcp-extended", "moss-rag-mcp"):
    env = services[name].get("environment", {})
    assert "MYSQL_PASSWORD" not in env, f"{name} received MYSQL_PASSWORD"
    assert "MINIO_PASSWORD" not in env, f"{name} received MINIO_PASSWORD"'
RAGFLOW_ENV_FILE=.env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" \
  -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.native-mcp.yml" \
  --profile extended-mcp --profile moss-rag-mcp config --quiet
RAGFLOW_ENV_FILE=.env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" \
  -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.gpu.yml" \
  -f "$ROOT/docker-compose.native-mcp.yml" --profile extended-mcp --profile moss-rag-mcp config --quiet
fi

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
printf '%s\n' '{"server":{"port":43127},"preserved":true}' > "$test_root/server.json"
MOSS_SERVER_CONFIG="$test_root/server.json" \
ADMIN_DEFAULT_PASSWORD=test-admin-password \
MOSS_RAGFLOW_GATEWAY_TOKEN=0123456789abcdef0123456789abcdef \
  "$ROOT/scripts/configure-moss.sh" "$ROOT/.env.example" >/dev/null
jq -e '
  .server.port == 43127
  and .preserved == true
  and .ragflow.enabled == true
  and .ragflow.baseUrl == "http://moss-ragflow:9380"
  and .ragflow.adminUrl == "http://moss-ragflow:9381"
  and .ragflow.adminPassword == "test-admin-password"
  and .ragflow.gatewayToken == "0123456789abcdef0123456789abcdef"
' "$test_root/server.json" >/dev/null

if grep -RInE \
  --exclude='README.md' --exclude='validate.sh' --exclude-dir='dist' --exclude-dir='images' \
  'codeload\.github\.com|git clone|/Users/|10\.0\.1\.180' "$ROOT"; then
  echo "Deployment package contains a repository or machine-specific dependency." >&2
  exit 1
fi

echo "RAGFlow deployment package validation passed."
