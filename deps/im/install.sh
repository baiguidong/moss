#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${1:-$SCRIPT_DIR}"
INSTALL_DIR="${OPENIM_INSTALL_DIR:-/opt/moss-openim}"
PULL_IMAGES="${PULL_IMAGES:-1}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "run as root"
[[ "$(uname -s)" == "Linux" ]] || die "the installer requires Linux"
[[ "$PULL_IMAGES" == "0" || "$PULL_IMAGES" == "1" ]] || die "PULL_IMAGES must be 0 or 1"

missing_commands=()
for command in curl jq; do
  command -v "$command" >/dev/null || missing_commands+=("$command")
done
if ((${#missing_commands[@]})); then
  log "Installing host utilities"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl jq
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates curl jq
  elif command -v yum >/dev/null 2>&1; then
    yum install -y ca-certificates curl jq
  else
    die "missing commands: ${missing_commands[*]}"
  fi
fi

required=(
  README.md
  .env.example
  compose.yaml
  configure.sh
  install.sh
  package.sh
  start.sh
  stop.sh
  config/webhooks.yml.template
  scripts/common.sh
  scripts/validate.sh
)
for file in "${required[@]}"; do
  [[ -e "$STAGE_DIR/$file" ]] || die "required deployment file is missing: $file"
done

log "Installing deployment files under $INSTALL_DIR"
install -d -m 0755 "$INSTALL_DIR" "$INSTALL_DIR/config" "$INSTALL_DIR/scripts"
stage_real="$(cd "$STAGE_DIR" && pwd -P)"
install_real="$(cd "$INSTALL_DIR" && pwd -P)"
if [[ "$stage_real" != "$install_real" ]]; then
  install -m 0644 "$STAGE_DIR/.env.example" "$INSTALL_DIR/.env.example"
  install -m 0644 "$STAGE_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
  install -m 0644 "$STAGE_DIR/README.md" "$INSTALL_DIR/README.md"
  install -m 0644 "$STAGE_DIR/config/webhooks.yml.template" \
    "$INSTALL_DIR/config/webhooks.yml.template"
  install -m 0644 "$STAGE_DIR/scripts/common.sh" "$INSTALL_DIR/scripts/common.sh"
  install -m 0755 "$STAGE_DIR/scripts/validate.sh" "$INSTALL_DIR/scripts/validate.sh"
  for file in configure.sh install.sh package.sh start.sh stop.sh; do
    install -m 0755 "$STAGE_DIR/$file" "$INSTALL_DIR/$file"
  done
fi
rm -f "$INSTALL_DIR/update.sh" "$INSTALL_DIR/logs.sh" "$INSTALL_DIR/status.sh"
find "$INSTALL_DIR" -type f -name '._*' -delete

log "Writing OpenIM and Moss configuration"
"$INSTALL_DIR/configure.sh" "$INSTALL_DIR/.env"

# shellcheck disable=SC1091
source "$INSTALL_DIR/scripts/common.sh"

log "Validating Compose configuration"
compose config --quiet

if [[ "$(env_value WRITE_MOSS_SETTINGS)" == "1" ]] && command -v systemctl >/dev/null 2>&1; then
  moss_service="$(env_value MOSS_SERVICE_NAME)"
  [[ "$moss_service" == *.service ]] || moss_service="${moss_service}.service"
  if systemctl is-active --quiet "$moss_service"; then
    log "Restarting Moss Server to load OpenIM settings"
    systemctl restart "$moss_service"
  fi
fi

if [[ -n "${MOSS_ADMIN_TOKEN:-}" ]]; then
  log "Applying OpenIM settings through the live Moss API"
  curl --fail --silent --show-error --max-time 15 \
    -X PATCH -H "Authorization: Bearer ${MOSS_ADMIN_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data-binary "@$INSTALL_DIR/config/moss-system-settings.json" \
    "$(env_value MOSS_SERVER_URL)/api/v1/settings/system" >/dev/null
fi

if [[ "$PULL_IMAGES" == "1" ]]; then
  log "Pulling OpenIM images"
  compose pull
fi

log "Starting OpenIM"
if ! compose up -d --remove-orphans; then
  show_failure_logs
  die "failed to start OpenIM"
fi
wait_for_services
verify_installation
compose ps

printf '\nOpenIM is ready.\n'
printf 'Install directory: %s\n' "$INSTALL_DIR"
printf 'Runtime settings:  %s\n' "$INSTALL_DIR/.env"
printf 'Moss Server:       %s\n' "$(env_value MOSS_SERVER_URL)"
printf 'Start:             %s/start.sh\n' "$INSTALL_DIR"
printf 'Stop:              %s/stop.sh\n' "$INSTALL_DIR"
