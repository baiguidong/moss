#!/usr/bin/env bash
set -euo pipefail

RELEASE_TAG="${MOSS_RELEASE_TAG:-@@MOSS_RELEASE_TAG@@}"
REPOSITORY="${MOSS_REPOSITORY:-@@MOSS_REPOSITORY@@}"
INSTALL_DIR="${MOSS_INSTALL_DIR:-}"
SERVICE_NAME="${MOSS_SERVICE_NAME:-moss-server}"
PORT="${MOSS_PORT:-}"
ADVERTISED_HOST="${MOSS_ADVERTISED_HOST:-}"
ADMIN_USERNAME="${MOSS_ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${MOSS_ADMIN_PASSWORD:-}"
NON_INTERACTIVE="${MOSS_NON_INTERACTIVE:-0}"
INSTALLER_REFRESHED="${MOSS_INSTALLER_REFRESHED:-0}"
INSTALL_LOCK_FD=9
OFFLINE=0
UPGRADE=0

log() { printf '[moss-server] %s\n' "$*"; }
die() { printf '[moss-server] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install-server.sh [options]

Options:
  --offline                 Read the server and runtime archives beside this script.
  --upgrade                 Upgrade an existing installation to the latest release.
  --install-dir PATH        Installation root (default: <service-user-home>/.moss/server).
  --service-name NAME       systemd service name (default: moss-server).
  --port PORT               HTTP port for a new installation (default: 43127).
  --non-interactive         Use defaults and MOSS_* environment variables.
  -h, --help                Show this help.

Configuration environment variables:
  MOSS_INSTALL_USER, MOSS_INSTALL_DIR, MOSS_SERVICE_NAME, MOSS_PORT,
  MOSS_ADVERTISED_HOST, MOSS_ADMIN_USERNAME, MOSS_ADMIN_PASSWORD,
  MOSS_DOWNLOAD_BASE, MOSS_INSTALLER_URL, MOSS_REPOSITORY.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --offline) OFFLINE=1 ;;
    --upgrade) UPGRADE=1 ;;
    --install-dir)
      [ "$#" -ge 2 ] || die "--install-dir requires a path"
      INSTALL_DIR="$2"
      shift
      ;;
    --service-name)
      [ "$#" -ge 2 ] || die "--service-name requires a name"
      SERVICE_NAME="$2"
      shift
      ;;
    --port)
      [ "$#" -ge 2 ] || die "--port requires a value"
      PORT="$2"
      shift
      ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || die "run as root (for example: curl ... | sudo bash)"
[ "$(uname -s)" = Linux ] || die "only Linux is supported"
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  *) die "only x86_64/amd64 is currently supported" ;;
esac

VERSION="${RELEASE_TAG#v}"
SEMVER_PATTERN='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*)|([0-9]*[A-Za-z-][0-9A-Za-z-]*))(\.((0|[1-9][0-9]*)|([0-9]*[A-Za-z-][0-9A-Za-z-]*)))*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
[[ "$RELEASE_TAG" == v* && "$VERSION" =~ $SEMVER_PATTERN ]] \
  || die "invalid or unstamped release tag: $RELEASE_TAG"
case "$REPOSITORY" in
  *[!A-Za-z0-9_./-]*|*/*/*|/*|*/|'') die "invalid or unstamped GitHub repository: $REPOSITORY" ;;
  */*) ;;
  *) die "invalid or unstamped GitHub repository: $REPOSITORY" ;;
esac
case "$SERVICE_NAME" in
  ''|*[!A-Za-z0-9_.@-]*) die "invalid systemd service name: $SERVICE_NAME" ;;
esac

for command_name in curl docker find flock getent install realpath stat systemctl tar; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required"
done
if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_COMMAND=(sha256sum -c)
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM_COMMAND=(shasum -a 256 -c)
else
  die "sha256sum or shasum is required"
fi

INSTALL_USER="${MOSS_INSTALL_USER:-${SUDO_USER:-root}}"
PASSWD_ENTRY="$(getent passwd "$INSTALL_USER" || true)"
[ -n "$PASSWD_ENTRY" ] || die "install user does not exist: $INSTALL_USER"
INSTALL_USER_HOME="$(printf '%s\n' "$PASSWD_ENTRY" | awk -F: 'NR == 1 { print $6 }')"
INSTALL_USER_GROUP="$(id -gn "$INSTALL_USER")"
case "$INSTALL_USER_HOME" in
  /*) ;;
  *) die "install user has no absolute home directory: $INSTALL_USER" ;;
esac
case "$INSTALL_USER_HOME" in
  *[[:space:]]*) die "install user home must not contain whitespace" ;;
esac
case "$INSTALL_USER_HOME" in
  *[!A-Za-z0-9_./-]*) die "install user home contains unsupported characters" ;;
esac

DEFAULT_INSTALL_DIR="${INSTALL_USER_HOME%/}/.moss/server"
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
case "$INSTALL_DIR" in
  /*) ;;
  *) die "install directory must be absolute" ;;
esac
case "$INSTALL_DIR" in
  *[[:space:]]*) die "install directory must not contain whitespace" ;;
esac
case "$INSTALL_DIR" in
  *[!A-Za-z0-9_./-]*) die "install directory contains unsupported characters" ;;
esac
[ ! -L "$INSTALL_DIR" ] || die "install directory must not be a symbolic link"
INSTALL_DIR="$(realpath -m -- "$INSTALL_DIR")"
DEFAULT_INSTALL_DIR="$(realpath -m -- "$DEFAULT_INSTALL_DIR")"
[ "$INSTALL_DIR" != / ] || die "refusing to install into /"
USING_DEFAULT_INSTALL_DIR=0
[ "$INSTALL_DIR" != "$DEFAULT_INSTALL_DIR" ] || USING_DEFAULT_INSTALL_DIR=1
DEFAULT_MOSS_HOME="${INSTALL_USER_HOME%/}/.moss"
[ -d "$DEFAULT_MOSS_HOME" ] && DEFAULT_MOSS_HOME_PREEXISTED=1 \
  || DEFAULT_MOSS_HOME_PREEXISTED=0

LOCK_DIR="${MOSS_INSTALL_LOCK_DIR:-/run}"
case "$LOCK_DIR" in
  /*) ;;
  *) die "install lock directory must be absolute" ;;
esac
[ -d "$LOCK_DIR" ] || die "install lock directory is missing: $LOCK_DIR"
[ ! -L "$LOCK_DIR" ] || die "install lock directory must not be a symbolic link"
LOCK_PATH="$LOCK_DIR/moss-server-install.lock"
[ ! -L "$LOCK_PATH" ] || die "install lock must not be a symbolic link"
if [ "$INSTALLER_REFRESHED" = 1 ] && flock -n 9 2>/dev/null; then
  : # The refreshed child inherited the lock from this installer version.
else
  exec 9>>"$LOCK_PATH"
  flock -n "$INSTALL_LOCK_FD" || die "another Moss Server installation is already running"
  export MOSS_INSTALL_LOCK_FD="$INSTALL_LOCK_FD"
fi

MARKER_PATH="$INSTALL_DIR/.moss-server-install"
CONFIG_PATH="$INSTALL_DIR/server.json"
[ -d "$INSTALL_DIR" ] && INSTALL_DIR_PREEXISTED=1 || INSTALL_DIR_PREEXISTED=0
[ ! -L "$MARKER_PATH" ] || die "install marker must not be a symbolic link"
[ ! -L "$CONFIG_PATH" ] || die "server config must not be a symbolic link"
EXISTING_INSTALL=0
if [ -f "$MARKER_PATH" ] || [ -f "$CONFIG_PATH" ]; then
  EXISTING_INSTALL=1
  EXISTING_OWNER="$(stat -c %U "$INSTALL_DIR")"
  if [ -z "${MOSS_INSTALL_USER:-}" ] && [ -n "$EXISTING_OWNER" ]; then
    INSTALL_USER="$EXISTING_OWNER"
    PASSWD_ENTRY="$(getent passwd "$INSTALL_USER" || true)"
    [ -n "$PASSWD_ENTRY" ] || die "existing install user does not exist: $INSTALL_USER"
    INSTALL_USER_HOME="$(printf '%s\n' "$PASSWD_ENTRY" | awk -F: 'NR == 1 { print $6 }')"
    INSTALL_USER_GROUP="$(id -gn "$INSTALL_USER")"
    case "$INSTALL_USER_HOME" in
      /*) ;;
      *) die "install user has no absolute home directory: $INSTALL_USER" ;;
    esac
    case "$INSTALL_USER_HOME" in
      *[[:space:]]*) die "install user home must not contain whitespace" ;;
    esac
    case "$INSTALL_USER_HOME" in
      *[!A-Za-z0-9_./-]*) die "install user home contains unsupported characters" ;;
    esac
  fi
fi
if [ "$EXISTING_INSTALL" = 1 ] && [ ! -f "$MARKER_PATH" ]; then
  die "existing server config is not managed by this installer: $CONFIG_PATH"
fi
if [ "$EXISTING_INSTALL" = 0 ] && [ "$INSTALL_DIR_PREEXISTED" = 1 ] \
  && find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  die "install directory is not empty and is not managed by this installer: $INSTALL_DIR"
fi
for relative_path in releases var var/lib var/run var/log skills assistants; do
  [ ! -L "$INSTALL_DIR/$relative_path" ] \
    || die "managed directory must not be a symbolic link: $INSTALL_DIR/$relative_path"
done
for relative_path in current bin admin adapters; do
  if { [ -e "$INSTALL_DIR/$relative_path" ] || [ -L "$INSTALL_DIR/$relative_path" ]; } \
    && [ ! -L "$INSTALL_DIR/$relative_path" ]; then
    die "managed link has an unexpected type: $INSTALL_DIR/$relative_path"
  fi
done
for relative_path in skills assistants; do
  if [ -d "$INSTALL_DIR/$relative_path" ] \
    && find "$INSTALL_DIR/$relative_path" -type l -print -quit | grep -q .; then
    die "managed resource directory must not contain symbolic links: $INSTALL_DIR/$relative_path"
  fi
done
[ ! -L "$INSTALL_DIR/install-server.sh" ] \
  || die "installed updater must not be a symbolic link"
PREVIOUS_RUNTIME_IMAGE=""
if [ -f "$MARKER_PATH" ]; then
  MARKER_REPOSITORY="$(awk -F= '$1 == "repository" { print substr($0, index($0, "=") + 1); exit }' "$MARKER_PATH")"
  MARKER_SERVICE_NAME="$(awk -F= '$1 == "service_name" { print substr($0, index($0, "=") + 1); exit }' "$MARKER_PATH")"
  PREVIOUS_RUNTIME_IMAGE="$(awk -F= '$1 == "runtime_image" { print substr($0, index($0, "=") + 1); exit }' "$MARKER_PATH")"
  if [ -n "$MARKER_REPOSITORY" ] && [ "$MARKER_REPOSITORY" != "$REPOSITORY" ]; then
    die "installation belongs to $MARKER_REPOSITORY, not $REPOSITORY"
  fi
  if [ -n "$MARKER_SERVICE_NAME" ] && [ "$MARKER_SERVICE_NAME" != "$SERVICE_NAME" ]; then
    die "installation is managed by $MARKER_SERVICE_NAME.service, not $SERVICE_NAME.service"
  fi
fi
[ "$UPGRADE" = 0 ] || [ "$EXISTING_INSTALL" = 1 ] \
  || die "no existing Moss Server installation found in $INSTALL_DIR"

if [ "$UPGRADE" = 1 ] && [ "$OFFLINE" = 0 ] && [ "$INSTALLER_REFRESHED" != 1 ]; then
  LATEST_INSTALLER_URL="${MOSS_INSTALLER_URL:-https://github.com/$REPOSITORY/releases/latest/download/install-server.sh}"
  LATEST_INSTALLER="$(mktemp)"
  log "Downloading the latest installer"
  if ! curl --fail --location --retry 3 --connect-timeout 20 \
    -o "$LATEST_INSTALLER" "$LATEST_INSTALLER_URL"; then
    rm -f "$LATEST_INSTALLER"
    die "could not download the latest installer"
  fi
  set +e
  MOSS_INSTALLER_REFRESHED=1 \
  MOSS_INSTALL_USER="$INSTALL_USER" \
  MOSS_INSTALL_DIR="$INSTALL_DIR" \
  MOSS_SERVICE_NAME="$SERVICE_NAME" \
  MOSS_REPOSITORY="$REPOSITORY" \
  MOSS_DOWNLOAD_BASE="${MOSS_DOWNLOAD_BASE:-}" \
  MOSS_INSTALLER_URL="${MOSS_INSTALLER_URL:-}" \
  MOSS_INSTALL_LOCK_FD="$INSTALL_LOCK_FD" \
    bash "$LATEST_INSTALLER" --upgrade --non-interactive
  STATUS=$?
  set -e
  rm -f "$LATEST_INSTALLER"
  exit "$STATUS"
fi

INSTALLED_TAG=""
INSTALLED_TARGET=""
if [ -L "$INSTALL_DIR/current" ]; then
  INSTALLED_TARGET="$(readlink -f "$INSTALL_DIR/current" 2>/dev/null || true)"
  INSTALLED_TAG="${INSTALLED_TARGET##*/}"
fi
case "$INSTALLED_TARGET" in
  ''|"$INSTALL_DIR"/releases/*) ;;
  *) die "current release points outside the managed releases directory" ;;
esac
EXISTING_UNIT_ENV=""
if systemctl cat "$SERVICE_NAME.service" >/dev/null 2>&1; then
  [ "$EXISTING_INSTALL" = 1 ] \
    || die "$SERVICE_NAME.service already exists and is not managed by this installer"
  EXISTING_UNIT_ENV="$(systemctl cat "$SERVICE_NAME.service" \
    | awk -F= '$1 == "EnvironmentFile" { print substr($0, index($0, "=") + 1); exit }')"
  if [ "$EXISTING_UNIT_ENV" != "$INSTALL_DIR/moss-server.env" ]; then
    die "$SERVICE_NAME.service belongs to another installation: $EXISTING_UNIT_ENV"
  fi
fi

if [ "$EXISTING_INSTALL" = 1 ] && [ "$INSTALLED_TAG" = "$RELEASE_TAG" ]; then
  INSTALLED_NODE="$INSTALL_DIR/current/node/bin/node"
  INSTALLED_PORT=""
  if [ -x "$INSTALLED_NODE" ] && [ -f "$CONFIG_PATH" ]; then
    INSTALLED_PORT="$($INSTALLED_NODE -p \
      "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).server.port" \
      "$CONFIG_PATH" 2>/dev/null || true)"
  fi
  if systemctl is-active --quiet "$SERVICE_NAME.service" \
    && [[ "$INSTALLED_PORT" =~ ^[0-9]+$ ]] \
    && [ -n "$PREVIOUS_RUNTIME_IMAGE" ] \
    && docker image inspect "$PREVIOUS_RUNTIME_IMAGE" >/dev/null 2>&1 \
    && curl --fail --silent "http://127.0.0.1:$INSTALLED_PORT/healthz" >/dev/null; then
    log "Moss Server $RELEASE_TAG is already installed and healthy; no changes needed"
    exit 0
  fi
  log "Moss Server $RELEASE_TAG is not healthy; reinstalling the release"
fi

ARCHIVE_NAME="moss-server-$VERSION-linux-$ARCH.tar.gz"
RUNTIME_ARCHIVE_NAME="moss-runtime-$VERSION-linux-$ARCH.tar.gz"
RUNTIME_TAG_VERSION="${VERSION//+/_}"
RUNTIME_IMAGE="moss-runtime:$RUNTIME_TAG_VERSION-$ARCH"
CHECKSUM_NAME="SHA256SUMS-server"
WORK_DIR="$(mktemp -d)"
RUNTIME_IMAGE_BACKUP_TAG=""
RUNTIME_IMAGE_MUTATED=0
INSTALL_DIR_PREPARED=0
rollback_runtime_image() {
  [ "$RUNTIME_IMAGE_MUTATED" = 1 ] || return 0
  if ! docker info >/dev/null 2>&1; then
    log "ERROR: Docker is unavailable; runtime image rollback could not run"
    return 1
  fi

  docker image rm "$RUNTIME_IMAGE" >/dev/null 2>&1 || true
  if [ -n "$RUNTIME_IMAGE_BACKUP_TAG" ]; then
    if ! docker tag "$RUNTIME_IMAGE_BACKUP_TAG" "$RUNTIME_IMAGE" >/dev/null 2>&1; then
      log "ERROR: could not restore $RUNTIME_IMAGE; backup retained as $RUNTIME_IMAGE_BACKUP_TAG"
      return 1
    fi
    docker image rm "$RUNTIME_IMAGE_BACKUP_TAG" >/dev/null 2>&1 || true
    RUNTIME_IMAGE_BACKUP_TAG=""
  elif docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1; then
    log "ERROR: could not remove failed runtime image $RUNTIME_IMAGE"
    return 1
  fi
  RUNTIME_IMAGE_MUTATED=0
}
cleanup_work_dir() {
  local status="${1:-0}"
  if [ -n "${NEW_RELEASE_DIR:-}" ]; then
    rm -rf "$NEW_RELEASE_DIR"
  fi
  if [ "$status" -ne 0 ]; then
    rollback_runtime_image || true
  elif [ -n "$RUNTIME_IMAGE_BACKUP_TAG" ]; then
    docker image rm "$RUNTIME_IMAGE_BACKUP_TAG" >/dev/null 2>&1 || true
    RUNTIME_IMAGE_BACKUP_TAG=""
  fi
  if [ "$status" -ne 0 ] && [ "$EXISTING_INSTALL" = 0 ] \
    && [ "$INSTALL_DIR_PREPARED" = 1 ] \
    && [ "${TRANSACTION_ACTIVE:-0}" = 0 ]; then
    if [ -d "$INSTALL_DIR" ]; then
      find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + || true
    fi
    [ "$INSTALL_DIR_PREEXISTED" = 1 ] || rmdir "$INSTALL_DIR" 2>/dev/null || true
    if [ "$USING_DEFAULT_INSTALL_DIR" = 1 ] \
      && [ "$DEFAULT_MOSS_HOME_PREEXISTED" = 0 ]; then
      rmdir "$DEFAULT_MOSS_HOME" 2>/dev/null || true
    fi
  fi
  rm -rf "$WORK_DIR"
}
cleanup() {
  local status=$?
  cleanup_work_dir "$status"
  exit "$status"
}
trap cleanup EXIT

if [ "$OFFLINE" = 1 ]; then
  SCRIPT_PATH="${BASH_SOURCE[0]:-}"
  [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ] \
    || die "--offline must be run from the install-server.sh file"
  SOURCE_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  for filename in "$ARCHIVE_NAME" "$RUNTIME_ARCHIVE_NAME" "$CHECKSUM_NAME"; do
    [ -f "$SOURCE_DIR/$filename" ] || die "missing offline asset: $filename"
  done
  cp "$SCRIPT_PATH" "$WORK_DIR/install-server.sh"
else
  SOURCE_DIR="$WORK_DIR/download"
  mkdir -p "$SOURCE_DIR"
  DOWNLOAD_BASE="${MOSS_DOWNLOAD_BASE:-https://github.com/$REPOSITORY/releases/download/$RELEASE_TAG}"
  DOWNLOAD_BASE="${DOWNLOAD_BASE%/}"
  step=1
  for filename in install-server.sh "$CHECKSUM_NAME" "$ARCHIVE_NAME" "$RUNTIME_ARCHIVE_NAME"; do
    log "Downloading [$step/4] $filename"
    curl --fail --location --retry 3 --connect-timeout 20 \
      -o "$SOURCE_DIR/$filename" "$DOWNLOAD_BASE/$filename"
    step=$((step + 1))
  done
  cp "$SOURCE_DIR/install-server.sh" "$WORK_DIR/install-server.sh"
fi

EXPECTED_RELEASE_LINE="$(printf 'RELEASE_TAG=\"${MOSS_RELEASE_TAG:-%s}\"' "$RELEASE_TAG")"
grep -Fq "$EXPECTED_RELEASE_LINE" "$WORK_DIR/install-server.sh" \
  || die "installer does not match release $RELEASE_TAG"
verify_asset() {
  local filename="$1" checksum_file="$WORK_DIR/$1.sha256"
  awk -v filename="$filename" \
    '$2 == filename || $2 == "*" filename { print }' \
    "$SOURCE_DIR/$CHECKSUM_NAME" > "$checksum_file"
  [ -s "$checksum_file" ] || die "checksum does not contain $filename"
  (cd "$SOURCE_DIR" && "${CHECKSUM_COMMAND[@]}" "$checksum_file")
}
verify_asset "$ARCHIVE_NAME"
verify_asset "$RUNTIME_ARCHIVE_NAME"

if tar -tzf "$SOURCE_DIR/$ARCHIVE_NAME" \
  | awk '$0 !~ /^moss-server\// || $0 ~ /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad ? 0 : 1 }'; then
  die "server archive contains an unsafe path"
fi
if tar -tvzf "$SOURCE_DIR/$ARCHIVE_NAME" \
  | awk 'substr($0, 1, 1) == "l" || substr($0, 1, 1) == "h" { found=1 } END { exit found ? 0 : 1 }'; then
  die "server archive must not contain links"
fi
tar --no-same-owner --no-same-permissions \
  -xzf "$SOURCE_DIR/$ARCHIVE_NAME" -C "$WORK_DIR"
PACKAGE_ROOT="$WORK_DIR/moss-server"
if find "$PACKAGE_ROOT" -type l -print -quit | grep -q .; then
  die "server archive must not contain symbolic links"
fi
NODE_BINARY="$PACKAGE_ROOT/node/bin/node"
[ -x "$NODE_BINARY" ] || die "server package does not contain Node.js"
[ "$($NODE_BINARY -p 'process.versions.node.split(`.`)[0]')" -eq 22 ] \
  || die "server package must contain Node.js 22"
"$NODE_BINARY" --no-warnings -e "require('node:sqlite')"
test -f "$PACKAGE_ROOT/app/bin/moss-server.mjs" || die "server entrypoint is missing"
test -f "$PACKAGE_ROOT/app/bin/moss-session-runner.mjs" || die "session runner is missing"
test -f "$PACKAGE_ROOT/app/adapters/feishu.mjs" || die "Feishu adapter is missing"
test -f "$PACKAGE_ROOT/app/admin/dist/index.html" || die "admin frontend is missing"
[ "$(cat "$PACKAGE_ROOT/VERSION")" = "$VERSION" ] \
  || die "server package version does not match release $RELEASE_TAG"

docker info >/dev/null 2>&1 || die "Docker daemon is not available"
DOCKER_VERSION="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
DOCKER_MAJOR="${DOCKER_VERSION%%.*}"
DOCKER_REST="${DOCKER_VERSION#*.}"
DOCKER_MINOR="${DOCKER_REST%%.*}"
if [ -z "$DOCKER_VERSION" ] || [ "${DOCKER_MAJOR:-0}" -lt 20 ] \
  || { [ "$DOCKER_MAJOR" -eq 20 ] && [ "${DOCKER_MINOR:-0}" -lt 10 ]; }; then
  die "Docker 20.10 or newer is required; found ${DOCKER_VERSION:-unknown}"
fi
DOCKER_SOCKET=/var/run/docker.sock
[ -S "$DOCKER_SOCKET" ] || die "Docker socket is unavailable: $DOCKER_SOCKET"
DOCKER_GROUP_ID="$(stat -c %g "$DOCKER_SOCKET")"
DOCKER_GROUP_ENTRY="$(getent group "$DOCKER_GROUP_ID" || true)"
[ -n "$DOCKER_GROUP_ENTRY" ] || die "Docker socket group does not exist: $DOCKER_GROUP_ID"
DOCKER_GROUP="${DOCKER_GROUP_ENTRY%%:*}"

if docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1; then
  runtime_image_backup="moss-runtime-install-backup:$RUNTIME_TAG_VERSION-$ARCH-$$"
  docker tag "$RUNTIME_IMAGE" "$runtime_image_backup"
  RUNTIME_IMAGE_BACKUP_TAG="$runtime_image_backup"
  RUNTIME_IMAGE_MUTATED=1
  docker image rm "$RUNTIME_IMAGE" >/dev/null
fi
log "Loading Docker runtime image: $RUNTIME_IMAGE"
RUNTIME_IMAGE_MUTATED=1
docker load -i "$SOURCE_DIR/$RUNTIME_ARCHIVE_NAME" >/dev/null
docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1 \
  || die "runtime archive did not load $RUNTIME_IMAGE"
docker run --rm "$RUNTIME_IMAGE" node --no-warnings -e \
  "require('node:sqlite'); require('sharp')" >/dev/null
docker run --rm \
  --user "$(id -u "$INSTALL_USER"):$(id -g "$INSTALL_USER")" \
  -e HOME=/tmp/moss-home \
  "$RUNTIME_IMAGE" node --version >/dev/null

prompt_value() {
  local variable="$1" label="$2" default_value="$3" secret="${4:-0}"
  local current="${!variable:-}" answer=''
  [ -z "$current" ] || return 0
  if [ "$NON_INTERACTIVE" = 1 ] || [ ! -r /dev/tty ]; then
    printf -v "$variable" '%s' "$default_value"
    return 0
  fi
  if [ "$secret" = 1 ]; then
    printf '%s' "$label" > /dev/tty
    IFS= read -r -s answer < /dev/tty || true
    printf '\n' > /dev/tty
  else
    printf '%s [%s]: ' "$label" "$default_value" > /dev/tty
    IFS= read -r answer < /dev/tty || true
  fi
  printf -v "$variable" '%s' "${answer:-$default_value}"
}

GENERATED_PASSWORD=0
if [ "$EXISTING_INSTALL" = 0 ]; then
  DEFAULT_HOST="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
  DEFAULT_HOST="${DEFAULT_HOST:-127.0.0.1}"
  prompt_value PORT 'Service port' '43127'
  prompt_value ADVERTISED_HOST 'Public server address' "$DEFAULT_HOST"
  prompt_value ADMIN_USERNAME 'Administrator username' 'admin'
  prompt_value ADMIN_PASSWORD 'Administrator password (blank generates one): ' '' 1
  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$($NODE_BINARY -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
    GENERATED_PASSWORD=1
  fi
else
  PORT="$($NODE_BINARY -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).server.port" "$CONFIG_PATH")"
  ADVERTISED_HOST="$($NODE_BINARY -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).server.advertisedHost || ''" "$CONFIG_PATH")"
fi

case "$PORT" in
  ''|*[!0-9]*) die "port must be numeric" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "port must be between 1 and 65535"
if [ "$EXISTING_INSTALL" = 0 ] && command -v ss >/dev/null 2>&1 \
  && ss -ltn | awk '{ print $4 }' | grep -Eq "(^|:)$PORT$"; then
  die "port $PORT is already in use"
fi

log "Service user: $INSTALL_USER"
log "Install directory: $INSTALL_DIR"
log "Service: $SERVICE_NAME.service"
log "Port: $PORT"

INSTALL_DIR_PREPARED=1
if [ "$USING_DEFAULT_INSTALL_DIR" = 1 ]; then
  if [ "$DEFAULT_MOSS_HOME_PREEXISTED" = 0 ]; then
    install -d -m 0700 -o "$INSTALL_USER" -g "$INSTALL_USER_GROUP" \
      "$DEFAULT_MOSS_HOME"
  fi
fi
install -d -m 0700 -o "$INSTALL_USER" -g "$INSTALL_USER_GROUP" \
  "$INSTALL_DIR" "$INSTALL_DIR/releases" "$INSTALL_DIR/var/lib" \
  "$INSTALL_DIR/var/run" "$INSTALL_DIR/var/log"

RELEASE_DIR="$INSTALL_DIR/releases/$RELEASE_TAG"
NEW_RELEASE_DIR="$INSTALL_DIR/releases/.$RELEASE_TAG.new.$$"
REPLACED_RELEASE_DIR="$INSTALL_DIR/releases/.$RELEASE_TAG.replaced.$$"
PREVIOUS_TARGET="$(readlink -f "$INSTALL_DIR/current" 2>/dev/null || true)"
SETTINGS_PATH="$INSTALL_DIR/settings.json"
SETTINGS_EXISTED=0
SETTINGS_BACKUP="$WORK_DIR/settings.json.backup"
CONFIG_EXISTED=0
CONFIG_BACKUP="$WORK_DIR/server.json.backup"
if [ -f "$CONFIG_PATH" ]; then
  CONFIG_EXISTED=1
  cp -a "$CONFIG_PATH" "$CONFIG_BACKUP"
fi
if [ -f "$SETTINGS_PATH" ]; then
  SETTINGS_EXISTED=1
  cp -a "$SETTINGS_PATH" "$SETTINGS_BACKUP"
fi
rm -rf "$NEW_RELEASE_DIR"
cp -a "$PACKAGE_ROOT" "$NEW_RELEASE_DIR"
chown -R "$INSTALL_USER:$INSTALL_USER_GROUP" "$NEW_RELEASE_DIR"

ENV_PATH="$INSTALL_DIR/moss-server.env"
UNIT_PATH="/etc/systemd/system/$SERVICE_NAME.service"
UNINSTALL_PATH="$INSTALL_DIR/uninstall-server.sh"
[ ! -L "$SETTINGS_PATH" ] || die "server settings must not be a symbolic link"
[ ! -L "$ENV_PATH" ] || die "service environment file must not be a symbolic link"
[ ! -L "$UNIT_PATH" ] || die "systemd unit must not be a symbolic link"
[ ! -L "$UNINSTALL_PATH" ] || die "uninstaller must not be a symbolic link"
ENV_EXISTED=0
UNIT_EXISTED=0
UNINSTALL_EXISTED=0
MARKER_EXISTED=0
SERVICE_WAS_ACTIVE=0
UNIT_WAS_ENABLED=0
ENV_BACKUP="$WORK_DIR/moss-server.env.backup"
UNIT_BACKUP="$WORK_DIR/moss-server.service.backup"
UNINSTALL_BACKUP="$WORK_DIR/uninstall-server.sh.backup"
MARKER_BACKUP="$WORK_DIR/moss-server-install.backup"
if [ -f "$ENV_PATH" ]; then
  ENV_EXISTED=1
  cp -a "$ENV_PATH" "$ENV_BACKUP"
fi
if [ -f "$UNIT_PATH" ]; then
  UNIT_EXISTED=1
  cp -a "$UNIT_PATH" "$UNIT_BACKUP"
fi
if [ -f "$UNINSTALL_PATH" ]; then
  UNINSTALL_EXISTED=1
  cp -a "$UNINSTALL_PATH" "$UNINSTALL_BACKUP"
fi
if [ -f "$MARKER_PATH" ]; then
  MARKER_EXISTED=1
  cp -a "$MARKER_PATH" "$MARKER_BACKUP"
fi
if systemctl is-active --quiet "$SERVICE_NAME.service"; then
  SERVICE_WAS_ACTIVE=1
fi
if systemctl is-enabled --quiet "$SERVICE_NAME.service"; then
  UNIT_WAS_ENABLED=1
fi
TRANSACTION_ACTIVE=0
RELEASE_INSTALLED=0
RELEASE_REPLACED=0
restore_previous_release() {
  local restore_status=0
  systemctl stop "$SERVICE_NAME.service" >/dev/null 2>&1 || true

  if [ "$SETTINGS_EXISTED" = 1 ]; then
    cp -a "$SETTINGS_BACKUP" "$SETTINGS_PATH" || restore_status=1
  else
    rm -f "$SETTINGS_PATH" || restore_status=1
  fi
  if [ "$CONFIG_EXISTED" = 1 ]; then
    cp -a "$CONFIG_BACKUP" "$CONFIG_PATH" || restore_status=1
  else
    rm -f "$CONFIG_PATH" || restore_status=1
  fi
  if [ "$ENV_EXISTED" = 1 ]; then
    cp -a "$ENV_BACKUP" "$ENV_PATH" || restore_status=1
  else
    rm -f "$ENV_PATH" || restore_status=1
  fi
  if [ "$UNIT_EXISTED" = 1 ]; then
    cp -a "$UNIT_BACKUP" "$UNIT_PATH" || restore_status=1
  else
    rm -f "$UNIT_PATH" || restore_status=1
  fi
  if [ "$UNINSTALL_EXISTED" = 1 ]; then
    cp -a "$UNINSTALL_BACKUP" "$UNINSTALL_PATH" || restore_status=1
  else
    rm -f "$UNINSTALL_PATH" || restore_status=1
  fi
  if [ "$MARKER_EXISTED" = 1 ]; then
    cp -a "$MARKER_BACKUP" "$MARKER_PATH" || restore_status=1
  else
    rm -f "$MARKER_PATH" || restore_status=1
  fi

  if [ "$RELEASE_INSTALLED" = 1 ]; then
    rm -rf "$RELEASE_DIR" || restore_status=1
  fi
  if [ "$RELEASE_REPLACED" = 1 ] && [ -d "$REPLACED_RELEASE_DIR" ]; then
    mv "$REPLACED_RELEASE_DIR" "$RELEASE_DIR" || restore_status=1
  fi

  if [ -n "$PREVIOUS_TARGET" ] && [ -d "$PREVIOUS_TARGET" ]; then
    ln -sfn "$PREVIOUS_TARGET" "$INSTALL_DIR/.current.rollback" \
      && mv -Tf "$INSTALL_DIR/.current.rollback" "$INSTALL_DIR/current" \
      || restore_status=1
    for link_name in bin admin adapters; do
      ln -sfn "current/app/$link_name" "$INSTALL_DIR/.$link_name.rollback" \
        && mv -Tf "$INSTALL_DIR/.$link_name.rollback" "$INSTALL_DIR/$link_name" \
        || restore_status=1
    done
  else
    rm -f "$INSTALL_DIR/current" || restore_status=1
    for link_name in bin admin adapters; do
      [ ! -L "$INSTALL_DIR/$link_name" ] \
        || rm -f "$INSTALL_DIR/$link_name" \
        || restore_status=1
    done
  fi

  systemctl daemon-reload >/dev/null 2>&1 || restore_status=1
  if [ "$UNIT_WAS_ENABLED" = 1 ]; then
    systemctl enable "$SERVICE_NAME.service" >/dev/null 2>&1 || restore_status=1
  else
    systemctl disable "$SERVICE_NAME.service" >/dev/null 2>&1 || true
  fi
  if [ -n "$PREVIOUS_TARGET" ] && [ -d "$PREVIOUS_TARGET" ] \
    && [ "$SERVICE_WAS_ACTIVE" = 1 ]; then
    systemctl reset-failed "$SERVICE_NAME.service" >/dev/null 2>&1 || true
    systemctl restart "$SERVICE_NAME.service" >/dev/null 2>&1 || restore_status=1
    if [ "$restore_status" = 0 ]; then
      local restored=0
      for _ in $(seq 1 30); do
        if curl --fail --silent "http://127.0.0.1:$PORT/healthz" >/dev/null; then
          restored=1
          break
        fi
        sleep 1
      done
      [ "$restored" = 1 ] || restore_status=1
    fi
  elif [ "$EXISTING_INSTALL" = 0 ]; then
    find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + \
      || restore_status=1
    if [ "$INSTALL_DIR_PREEXISTED" = 0 ]; then
      rmdir "$INSTALL_DIR" 2>/dev/null || true
    fi
    if [ "$USING_DEFAULT_INSTALL_DIR" = 1 ] \
      && [ "$DEFAULT_MOSS_HOME_PREEXISTED" = 0 ]; then
      rmdir "$DEFAULT_MOSS_HOME" 2>/dev/null || true
    fi
  fi
  return "$restore_status"
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$TRANSACTION_ACTIVE" = 1 ]; then
    log "Installation failed; restoring the previous release"
    if ! rollback_runtime_image; then
      log "ERROR: automatic runtime image rollback failed"
    fi
    if ! restore_previous_release; then
      log "ERROR: automatic rollback failed; inspect $SERVICE_NAME.service"
    fi
  fi
  cleanup_work_dir "$status"
  exit "$status"
}
trap cleanup EXIT

TRANSACTION_ACTIVE=1
if systemctl cat "$SERVICE_NAME.service" >/dev/null 2>&1; then
  systemctl stop "$SERVICE_NAME.service" || true
fi
if [ -e "$RELEASE_DIR" ]; then
  rm -rf "$REPLACED_RELEASE_DIR"
  mv "$RELEASE_DIR" "$REPLACED_RELEASE_DIR"
  RELEASE_REPLACED=1
fi
mv "$NEW_RELEASE_DIR" "$RELEASE_DIR"
RELEASE_INSTALLED=1

if [ "$EXISTING_INSTALL" = 0 ]; then
  CONFIG_PATH="$CONFIG_PATH" INSTALL_DIR="$INSTALL_DIR" PORT="$PORT" \
  ADVERTISED_HOST="$ADVERTISED_HOST" ADMIN_USERNAME="$ADMIN_USERNAME" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD" "$NODE_BINARY" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.INSTALL_DIR
const config = {
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT),
    advertisedHost: process.env.ADVERTISED_HOST,
  },
  auth: { mode: 'local', tokenTtlSec: 3600 },
  bootstrapAdmin: {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  },
  storage: {
    rootDir: root,
    dbPath: path.join(root, 'var', 'lib', 'moss-server.db'),
    dataDir: path.join(root, 'var', 'lib'),
    runDir: path.join(root, 'var', 'run'),
    logDir: path.join(root, 'var', 'log'),
  },
  runtimeDefaults: { idleTimeoutMs: 600000, maxSessions: 32 },
  docker: { stopTimeoutSec: 10, labels: {} },
  recovery: {
    startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30000,
    reattachProbeTimeoutMs: 3000,
    resumeOnMissingRuntime: true,
  },
  logging: { level: 'info' },
  apps: {},
}
fs.writeFileSync(process.env.CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
NODE
fi

SETTINGS_PATH="$SETTINGS_PATH" RUNTIME_IMAGE="$RUNTIME_IMAGE" \
PREVIOUS_RUNTIME_IMAGE="$PREVIOUS_RUNTIME_IMAGE" EXISTING_INSTALL="$EXISTING_INSTALL" \
"$NODE_BINARY" <<'NODE'
const fs = require('node:fs')
const path = process.env.SETTINGS_PATH
let settings = {}
if (fs.existsSync(path)) {
  settings = JSON.parse(fs.readFileSync(path, 'utf8'))
}
const current = settings.serverRuntime && typeof settings.serverRuntime === 'object'
  ? settings.serverRuntime
  : {}
const firstInstall = process.env.EXISTING_INSTALL === '0'
const previousImage = process.env.PREVIOUS_RUNTIME_IMAGE || ''
const currentImage = typeof current.dockerImage === 'string' ? current.dockerImage : ''
const installerManagesImage = firstInstall || !currentImage || currentImage === previousImage
settings.serverRuntime = {
  ...current,
  backend: firstInstall ? 'docker' : (current.backend || 'docker'),
  dockerImage: installerManagesImage ? process.env.RUNTIME_IMAGE : currentImage,
  defaultProfileMode: current.defaultProfileMode || 'session',
  allowedProfileModes: Array.isArray(current.allowedProfileModes)
    ? current.allowedProfileModes
    : ['session', 'user'],
}
fs.writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
NODE

chmod 0600 "$CONFIG_PATH" "$SETTINGS_PATH"
chown "$INSTALL_USER:$INSTALL_USER_GROUP" "$CONFIG_PATH" "$SETTINGS_PATH"

cat > "$ENV_PATH" <<EOF
HOME=$INSTALL_USER_HOME
MOSS_SERVER_HOME=$INSTALL_DIR
MOSS_HOME=$INSTALL_DIR
MOSS_CONFIG_DIR=$INSTALL_DIR
MOSS_SERVER_CONFIG=$CONFIG_PATH
MOSS_NODE_PATH=$INSTALL_DIR/current/node/bin/node
MOSS_HIDE_BOOTSTRAP_SECRETS=1
NODE_ENV=production
EOF
chmod 0600 "$ENV_PATH"

ln -sfn "releases/$RELEASE_TAG" "$INSTALL_DIR/.current.new"
mv -Tf "$INSTALL_DIR/.current.new" "$INSTALL_DIR/current"
for link_name in bin admin adapters; do
  ln -sfn "current/app/$link_name" "$INSTALL_DIR/.$link_name.new"
  mv -Tf "$INSTALL_DIR/.$link_name.new" "$INSTALL_DIR/$link_name"
done

cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Moss Server ($SERVICE_NAME)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$INSTALL_USER
Group=$INSTALL_USER_GROUP
SupplementaryGroups=$DOCKER_GROUP
WorkingDirectory=$INSTALL_DIR/current/app
EnvironmentFile=$ENV_PATH
ExecStart=$INSTALL_DIR/current/node/bin/node $INSTALL_DIR/current/app/bin/moss-server.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

cat > "$UNINSTALL_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[ "\$(id -u)" -eq 0 ] || { echo 'run as root' >&2; exit 1; }
systemctl disable --now '$SERVICE_NAME.service' 2>/dev/null || true
rm -f '$UNIT_PATH'
systemctl daemon-reload
if [ "\${1:-}" = --purge ]; then
  rm -rf '$INSTALL_DIR'
  echo 'Moss Server program, configuration, and data removed.'
else
  rm -rf '$INSTALL_DIR/current' '$INSTALL_DIR/releases' \
    '$INSTALL_DIR/bin' '$INSTALL_DIR/admin' '$INSTALL_DIR/adapters'
  echo 'Moss Server program removed; configuration and data retained in $INSTALL_DIR.'
fi
EOF
chmod 0755 "$UNINSTALL_PATH"
chown -R "$INSTALL_USER:$INSTALL_USER_GROUP" "$INSTALL_DIR"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service" >/dev/null
if ! systemctl restart "$SERVICE_NAME.service"; then
  die "service failed to start"
fi

HEALTH_URL="http://127.0.0.1:$PORT/healthz"
HEALTHY=0
for _ in $(seq 1 30); do
  if curl --fail --silent "$HEALTH_URL" >/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 1
done
if [ "$HEALTHY" != 1 ]; then
  systemctl status "$SERVICE_NAME.service" --no-pager >&2 || true
  journalctl -u "$SERVICE_NAME.service" -n 50 --no-pager >&2 || true
  die "health check failed: $HEALTH_URL"
fi

for resource in skills assistants; do
  if [ -d "$RELEASE_DIR/app/resources/$resource" ]; then
    if [ -d "$INSTALL_DIR/$resource" ] \
      && find "$INSTALL_DIR/$resource" -type l -print -quit | grep -q .; then
      die "managed resource directory must not contain symbolic links: $INSTALL_DIR/$resource"
    fi
    install -d -m 0700 -o "$INSTALL_USER" -g "$INSTALL_USER_GROUP" "$INSTALL_DIR/$resource"
    cp -an "$RELEASE_DIR/app/resources/$resource/." "$INSTALL_DIR/$resource/"
    chown -R "$INSTALL_USER:$INSTALL_USER_GROUP" "$INSTALL_DIR/$resource"
  fi
done

CONFIG_PATH="$CONFIG_PATH" "$INSTALL_DIR/current/node/bin/node" <<'NODE'
const fs = require('node:fs')
const path = process.env.CONFIG_PATH
const config = JSON.parse(fs.readFileSync(path, 'utf8'))
if (config.bootstrapAdmin && typeof config.bootstrapAdmin === 'object') {
  delete config.bootstrapAdmin.password
}
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
NODE

install -m 0755 -o "$INSTALL_USER" -g "$INSTALL_USER_GROUP" \
  "$WORK_DIR/install-server.sh" "$INSTALL_DIR/install-server.sh"
cat > "$MARKER_PATH" <<EOF
release_tag=$RELEASE_TAG
repository=$REPOSITORY
service_name=$SERVICE_NAME
runtime_image=$RUNTIME_IMAGE
EOF
chmod 0600 "$MARKER_PATH" "$CONFIG_PATH" "$SETTINGS_PATH"
chown "$INSTALL_USER:$INSTALL_USER_GROUP" "$MARKER_PATH" "$CONFIG_PATH" "$SETTINGS_PATH"
rm -rf "$REPLACED_RELEASE_DIR"
TRANSACTION_ACTIVE=0

log "Installed Moss Server $RELEASE_TAG"
log "Docker runtime: $RUNTIME_IMAGE"
log "Admin: http://${ADVERTISED_HOST:-127.0.0.1}:$PORT/admin/"
log "Status: systemctl status $SERVICE_NAME"
if [ "$GENERATED_PASSWORD" = 1 ]; then
  log "Administrator username: $ADMIN_USERNAME"
  log "Administrator password: $ADMIN_PASSWORD"
fi
