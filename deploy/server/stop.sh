#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/.env" ]] || { echo 'Moss Server is not configured; run start.sh first' >&2; exit 1; }

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/common.sh"
compose --profile cloud --profile cloud-init down
