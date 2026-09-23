#!/usr/bin/env bash
# Build the checkout and install its normal Compose package in a separate home.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="${1:-${MOSS_LOCAL_SERVER_HOME:-$HOME/moss-server-local}}"
[[ "$DEPLOY_DIR" == /* && "$DEPLOY_DIR" != / && "$DEPLOY_DIR" != "$REPO_DIR" ]] \
  || { echo 'Use an absolute deployment directory outside the checkout root' >&2; exit 1; }
for command_name in docker node bun npm curl jq openssl; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required" >&2; exit 1; }
done
docker compose version >/dev/null
ARCH="${MOSS_LOCAL_ARCH:-$(docker info --format '{{.Architecture}}')}"
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported Docker architecture: $ARCH" >&2; exit 1 ;;
esac
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version' "$REPO_DIR/package.json")"
IMAGE="${MOSS_LOCAL_SERVER_IMAGE:-moss-server:local-$ARCH}"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

"$SCRIPT_DIR/package.sh" "$VERSION-local" "$STAGE_DIR"
"$SCRIPT_DIR/prepare-image-context.sh" "$VERSION" "$ARCH" "$REPO_DIR/dist/server-image"
docker buildx build --platform "linux/$ARCH" \
  --build-arg "MOSS_VERSION=$VERSION-local" \
  --build-arg "BASE_IMAGE=${MOSS_SERVER_BASE_IMAGE:-debian:bookworm-slim}" \
  --build-arg "DOCKER_CLI_IMAGE=${MOSS_DOCKER_CLI_IMAGE:-docker:29.2.1-cli}" \
  --tag "$IMAGE" --load -f "$REPO_DIR/docker/server/Dockerfile" "$REPO_DIR"

install -d -m 0700 "$DEPLOY_DIR"
DEPLOY_DIR="$(cd "$DEPLOY_DIR" && pwd -P)"
tar -xzf "$STAGE_DIR/moss-server-compose-$VERSION-local.tar.gz" --strip-components=1 -C "$DEPLOY_DIR"

# Defaults apply only to a new installation. Rebuilds preserve its ports,
# dependency image references, credentials, and all persistent data.
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  export MOSS_PUBLIC_HOST="${MOSS_PUBLIC_HOST:-127.0.0.1}"
  export MOSS_HTTPS_PORT="${MOSS_HTTPS_PORT:-8443}"
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-moss-local}"
  export MOSS_INTEGRATION_NETWORK="${MOSS_INTEGRATION_NETWORK:-$COMPOSE_PROJECT_NAME-integrations}"
fi
export MOSS_SERVER_HOME="$DEPLOY_DIR" MOSS_SERVER_IMAGE="$IMAGE"
"$DEPLOY_DIR/configure.sh" >/dev/null

# Pull missing dependencies only. The Server image always comes from this build.
for key in MOSS_RUNTIME_IMAGE MYSQL_IMAGE NGINX_IMAGE MINIO_IMAGE SILO_MC_IMAGE; do
  reference="$(sed -n -E "s/^${key}=//p" "$DEPLOY_DIR/.env" | tail -n 1)"
  if ! docker image inspect "$reference" >/dev/null 2>&1; then docker pull "$reference"; fi
done
PULL_IMAGES=0 "$DEPLOY_DIR/start.sh"
printf '\nLocal deployment: %s\nRebuild: %s %s\n' "$DEPLOY_DIR" "$SCRIPT_DIR/local.sh" "$DEPLOY_DIR"
