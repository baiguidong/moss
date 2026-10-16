#!/usr/bin/env bash
set -Eeuo pipefail
WEBUI_SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$WEBUI_SOURCE_ROOT/scripts/docker-webui.mjs" package "$@"
