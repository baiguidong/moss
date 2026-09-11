#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$SCRIPT_DIR/ragflowctl" ]]; then
  exec "$SCRIPT_DIR/ragflowctl" start
elif command -v ragflowctl >/dev/null 2>&1; then
  exec ragflowctl start
fi
echo "ragflowctl not found; run install.sh first" >&2
exit 1
