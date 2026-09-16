#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${OPENIM_INSTALL_DIR:-/opt/moss-openim}"
if [[ ! -f "$SCRIPT_DIR/.env" && "$SCRIPT_DIR" != "$INSTALL_DIR" && -x "$INSTALL_DIR/start.sh" ]]; then
  exec "$INSTALL_DIR/start.sh"
fi
[[ -f "$SCRIPT_DIR/.env" ]] || { echo "OpenIM is not installed; run install.sh first" >&2; exit 1; }

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/common.sh"
if ! compose up -d --remove-orphans; then
  show_failure_logs
  die "failed to start OpenIM"
fi
wait_for_services
verify_installation
compose ps
