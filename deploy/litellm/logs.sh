#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker compose --env-file "$ROOT_DIR/.env" -f "$ROOT_DIR/compose.yaml" logs -f --tail=200 litellm
