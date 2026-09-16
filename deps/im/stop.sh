#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${OPENIM_INSTALL_DIR:-/opt/moss-openim}"
if [[ ! -f "$SCRIPT_DIR/.env" && "$SCRIPT_DIR" != "$INSTALL_DIR" && -x "$INSTALL_DIR/stop.sh" ]]; then
  exec "$INSTALL_DIR/stop.sh"
fi
[[ -f "$SCRIPT_DIR/.env" ]] || { echo "OpenIM is not installed; run install.sh first" >&2; exit 1; }

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/common.sh"
compose down
