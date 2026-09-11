#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$ROOT/deploy.sh" "$ROOT/install.sh" "$ROOT/ragflowctl" "$ROOT/scripts/"*.sh
python3 - "$ROOT/mcp-extended/server.py" <<'PY'
import ast
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
PY

RAGFLOW_ENV_FILE=env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose --project-directory "$ROOT" --env-file "$ROOT/env.example" \
  -f "$ROOT/docker-compose.yml" --profile extended-mcp --profile moss-rag-mcp config --quiet
rendered_config="$(RAGFLOW_ENV_FILE=env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose \
  --project-directory "$ROOT" --env-file "$ROOT/env.example" -f "$ROOT/docker-compose.yml" config)"
grep -Fq 'DEFAULT_SUPERUSER_PASSWORD: CHANGE_ME' <<<"$rendered_config" || {
  echo "RAGFlow admin password is not mapped to DEFAULT_SUPERUSER_PASSWORD." >&2
  exit 1
}
RAGFLOW_ENV_FILE=env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose \
  --project-directory "$ROOT" --env-file "$ROOT/env.example" -f "$ROOT/docker-compose.yml" \
  --profile extended-mcp --profile moss-rag-mcp config --format json \
  | python3 -c 'import json, sys
services = json.load(sys.stdin)["services"]
assert "MYSQL_USER" not in services["mysql"].get("environment", {}), "MySQL received MYSQL_USER"
for name in ("ragflow-mcp-extended", "moss-rag-mcp"):
    env = services[name].get("environment", {})
    assert "MYSQL_PASSWORD" not in env, f"{name} received MYSQL_PASSWORD"
    assert "MINIO_PASSWORD" not in env, f"{name} received MINIO_PASSWORD"'
RAGFLOW_ENV_FILE=env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose --project-directory "$ROOT" --env-file "$ROOT/env.example" \
  -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.native-mcp.yml" \
  --profile extended-mcp --profile moss-rag-mcp config --quiet
RAGFLOW_ENV_FILE=env.example RAGFLOW_MCP_BIND_IP=127.0.0.1 docker compose --project-directory "$ROOT" --env-file "$ROOT/env.example" \
  -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.gpu.yml" \
  -f "$ROOT/docker-compose.native-mcp.yml" --profile extended-mcp --profile moss-rag-mcp config --quiet

if grep -RInE \
  --exclude='README.md' --exclude='validate.sh' \
  'codeload\.github\.com|git clone|/Users/|10\.0\.1\.180' "$ROOT"; then
  echo "Deployment package contains a repository or machine-specific dependency." >&2
  exit 1
fi

echo "RAGFlow deployment package validation passed."
