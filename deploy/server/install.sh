#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${1:-$SCRIPT_DIR}"
INSTALL_DIR="${MOSS_SERVER_HOME:-}"
if [[ -z "$INSTALL_DIR" && -f "$SCRIPT_DIR/.env" ]]; then
  INSTALL_DIR="$(sed -n 's/^MOSS_SERVER_HOME=//p' "$SCRIPT_DIR/.env" | tail -1)"
fi
INSTALL_DIR="${INSTALL_DIR:-/data/moss-server}"
PULL_IMAGES="${PULL_IMAGES:-1}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "run as root"
[[ "$(uname -s)" == "Linux" ]] || die "the installer requires Linux"
[[ "$INSTALL_DIR" == /* ]] || die "MOSS_SERVER_HOME must be an absolute path"
[[ "$PULL_IMAGES" == "0" || "$PULL_IMAGES" == "1" ]] \
  || die "PULL_IMAGES must be 0 or 1"

required=(
  README.md
  .env.example
  compose.yaml
  configure.sh
  install.sh
  upgrade.sh
  package.sh
  start.sh
  stop.sh
  nginx.conf
  scripts/common.sh
  scripts/cloud-storage-init.sh
  scripts/silo-init.sh
  scripts/validate.sh
)
for file in "${required[@]}"; do
  [[ -e "$STAGE_DIR/$file" ]] || die "required deployment file is missing: $file"
done

log "Installing Moss Server deployment under $INSTALL_DIR"
install -d -m 0700 "$INSTALL_DIR" "$INSTALL_DIR/scripts"
stage_real="$(cd "$STAGE_DIR" && pwd -P)"
install_real="$(cd "$INSTALL_DIR" && pwd -P)"
if [[ "$stage_real" != "$install_real" ]]; then
  for file in README.md .env.example compose.yaml nginx.conf; do
    install -m 0644 "$STAGE_DIR/$file" "$INSTALL_DIR/$file"
  done
  for file in configure.sh install.sh upgrade.sh package.sh start.sh stop.sh; do
    install -m 0755 "$STAGE_DIR/$file" "$INSTALL_DIR/$file"
  done
  for script in cloud-storage-init.sh silo-init.sh; do
    install -m 0755 "$STAGE_DIR/scripts/$script" "$INSTALL_DIR/scripts/$script"
  done
  install -m 0755 "$STAGE_DIR/scripts/common.sh" "$INSTALL_DIR/scripts/common.sh"
  install -m 0755 "$STAGE_DIR/scripts/validate.sh" "$INSTALL_DIR/scripts/validate.sh"
  if [[ ! -f "$INSTALL_DIR/.env" && -f "$STAGE_DIR/.env" ]]; then
    install -m 0600 "$STAGE_DIR/.env" "$INSTALL_DIR/.env"
  fi
  if [[ ! -d "$INSTALL_DIR/tls" && -d "$STAGE_DIR/tls" ]]; then
    cp -a "$STAGE_DIR/tls" "$INSTALL_DIR/tls"
  fi
fi

log "Starting Moss Server"
PULL_IMAGES="$PULL_IMAGES" "$INSTALL_DIR/start.sh"

printf '\nMoss Server deployment installed.\n'
printf 'Install and data directory: %s\n' "$INSTALL_DIR"
printf 'Configuration:             %s/server.json\n' "$INSTALL_DIR"
printf 'Runtime settings:          %s/settings.json\n' "$INSTALL_DIR"
printf 'Upgrade:                   %s/upgrade.sh\n' "$INSTALL_DIR"
