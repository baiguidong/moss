#!/usr/bin/env bash
# Deployment commands need Docker + Compose v2; no Node/Bun or source checkout.
set -Eeuo pipefail
umask 077
WEBUI_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'HELP'
Usage: ./manage.sh <command>
  install  Verify and load the bundled image, then start without replacing a container.
  load     Verify checksums and import the bundled offline image.
  start    Start/wait for the service; retain any existing container and system layer.
  stop     Stop the container, retaining its system layer and HOME volume.
  status   Show container/health status.
  logs     Show the latest 100 log lines.
  token    Print the standalone login token (not used with Moss Server auth).

Edit .env before first start to configure origin, port and authentication.
No command deletes volumes or upgrades/replaces an existing container.
HELP
}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
ensure_env() {
  if [[ ! -f "$WEBUI_ROOT/.env" ]]; then
    (set -o noclobber; cat "$WEBUI_ROOT/.env.example" > "$WEBUI_ROOT/.env")
    printf 'Created %s/.env from defaults.\n' "$WEBUI_ROOT"
  fi
}
compose() {
  docker compose --project-directory "$WEBUI_ROOT" --env-file "$WEBUI_ROOT/.env" \
    -f "$WEBUI_ROOT/compose.yaml" "$@"
}
load_image() {
  [[ -f "$WEBUI_ROOT/images/moss-webui.tar" && -f "$WEBUI_ROOT/SHA256SUMS" ]] \
    || die 'No offline image found. Use docker:package-webui to create a deployment package.'
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$WEBUI_ROOT" && sha256sum --check SHA256SUMS)
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$WEBUI_ROOT" && shasum -a 256 --check SHA256SUMS)
  else
    die 'sha256sum or shasum is required.'
  fi
  docker load --input "$WEBUI_ROOT/images/moss-webui.tar"
}
start_service() {
  # up without --no-recreate can silently discard apt installs after config/image changes.
  if ! compose up --detach --wait --wait-timeout 120 --pull never --no-build --no-recreate; then
    compose ps --all || true
    compose logs --tail 100 webui || true
    return 1
  fi
  printf 'Started. Existing containers are retained; image/config changes need a planned upgrade.\n'
}

[[ $# -le 1 ]] || { usage; exit 1; }
case "${1:---help}" in
  -h|--help|help) usage; exit 0 ;;
  install|load|start|stop|status|logs|token) ;;
  *) usage; exit 1 ;;
esac
command -v docker >/dev/null 2>&1 || die 'Docker is required.'
docker compose version >/dev/null
case "$1" in
  load) load_image ;;
  install) load_image; ensure_env; start_service ;;
  start) ensure_env; start_service ;;
  stop|status|logs|token)
    [[ -f "$WEBUI_ROOT/.env" ]] || die 'No .env found. Run start or install first.'
    case "$1" in
      stop) compose stop ;;
      status) compose ps --all ;;
      logs) compose logs --tail 100 webui ;;
      token) compose exec -T webui cat /home/moss/.moss/web/access-token ;;
    esac ;;
esac
