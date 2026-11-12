#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$ROOT_DIR/.env" ]] || { echo 'LiteLLM is not configured; run configure.sh first' >&2; exit 1; }
docker compose --env-file "$ROOT_DIR/.env" -f "$ROOT_DIR/compose.yaml" up -d --remove-orphans
docker compose --env-file "$ROOT_DIR/.env" -f "$ROOT_DIR/compose.yaml" ps
