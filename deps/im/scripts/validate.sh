#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$ROOT/"*.sh "$ROOT/scripts/"*.sh
grep -Fq 'INSTALL_DIR="${OPENIM_INSTALL_DIR:-/data/moss-openim}"' "$ROOT/install.sh"
grep -Fq 'INSTALL_DIR="${OPENIM_INSTALL_DIR:-/data/moss-openim}"' "$ROOT/start.sh"
grep -Fq 'INSTALL_DIR="${OPENIM_INSTALL_DIR:-/data/moss-openim}"' "$ROOT/stop.sh"

if grep -nE 'download\.docker\.com|docker-ce|containerd\.io|systemctl enable --now docker|docker info' \
  "$ROOT/install.sh"; then
  echo "ERROR: install.sh must not install or explicitly preflight Docker" >&2
  exit 1
fi

if grep -nE 'mage[[:space:]]+check' "$ROOT/compose.yaml"; then
  echo "ERROR: Compose health checks must not compile Magefiles at runtime" >&2
  exit 1
fi

for obsolete in update.sh logs.sh status.sh; do
  [[ ! -e "$ROOT/$obsolete" ]] || {
    echo "ERROR: obsolete operation is still present: $obsolete" >&2
    exit 1
  }
done

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" \
    -f "$ROOT/compose.yaml" config --quiet
fi

if grep -RInE --exclude='README.md' --exclude='validate.sh' --exclude='.env' \
  --exclude='webhooks.yml' --exclude='moss-system-settings.json' \
  --exclude-dir='dist' --exclude-dir='data' \
  '/Users/|git clone' "$ROOT"; then
  echo "ERROR: deployment package contains a repository or machine-specific dependency" >&2
  exit 1
fi

echo "OpenIM deployment package validation passed."
