#!/usr/bin/env bash

set -Eeuo pipefail

readonly DOCKER_VERSION="29.8.1"
readonly ARCHIVE_NAME="docker-${DOCKER_VERSION}.tgz"
readonly ARCHIVE_SHA256="d8db66739d2e28d4933786d73e918d9be643a67fbd835db1bf740d650a259e70"
readonly COMPOSE_VERSION="5.5.1"
readonly COMPOSE_BINARY_NAME="docker-compose-linux-x86_64"
readonly COMPOSE_SHA256="db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576"
readonly BIN_DIR="/usr/local/bin"
readonly CLI_PLUGIN_DIR="/usr/local/lib/docker/cli-plugins"
readonly SERVICE_FILE="/etc/systemd/system/docker.service"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_PATH="${SCRIPT_DIR}/${ARCHIVE_NAME}"
COMPOSE_BINARY_PATH="${SCRIPT_DIR}/${COMPOSE_BINARY_NAME}"
TMP_DIR=""

log() {
    printf '[docker-install] %s\n' "$*"
}

die() {
    printf '[docker-install] ERROR: %s\n' "$*" >&2
    exit 1
}

verify_checksum() {
    local file_path="$1"
    local expected_checksum="$2"
    local checksum_output actual_checksum

    log "Verifying $(basename -- "${file_path}")..."
    checksum_output="$(sha256sum -- "${file_path}")"
    actual_checksum="${checksum_output%% *}"
    [[ "${actual_checksum}" == "${expected_checksum}" ]] || \
        die "SHA-256 mismatch for $(basename -- "${file_path}"); the file may be incomplete or modified."
}

cleanup() {
    if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
        rm -rf -- "${TMP_DIR}"
    fi
}
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || die "Run this script as root (sudo is not installed)."
    exec sudo -- "${SCRIPT_DIR}/$(basename -- "$0")" "$@"
fi

if [[ "$#" -ne 0 ]]; then
    die "This installer does not accept arguments. Run: sudo ./install.sh"
fi

[[ -r /etc/os-release ]] || die "Cannot identify the operating system."
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "This package supports Ubuntu only (detected: ${ID:-unknown})."

case "$(uname -m)" in
    x86_64 | amd64) ;;
    *) die "This package requires an amd64/x86_64 server (detected: $(uname -m))." ;;
esac

[[ -d /run/systemd/system ]] || die "systemd is not running as PID 1."
[[ -d /sys/fs/cgroup ]] || die "Linux cgroups are not available."

required_commands=(
    getent groupadd install ip iptables mktemp ps sha256sum systemctl tar uname
)
missing_commands=()
for command_name in "${required_commands[@]}"; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        missing_commands+=("${command_name}")
    fi
done
if (( ${#missing_commands[@]} > 0 )); then
    die "Missing required commands: ${missing_commands[*]}. Install the corresponding Ubuntu packages before going offline."
fi

[[ -f "${ARCHIVE_PATH}" ]] || die "Archive not found next to install.sh: ${ARCHIVE_NAME}"
[[ -f "${COMPOSE_BINARY_PATH}" ]] || die "Compose binary not found next to install.sh: ${COMPOSE_BINARY_NAME}"

verify_checksum "${ARCHIVE_PATH}" "${ARCHIVE_SHA256}"
verify_checksum "${COMPOSE_BINARY_PATH}" "${COMPOSE_SHA256}"

TMP_DIR="$(mktemp -d)"
tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"

docker_binaries=(
    containerd containerd-shim-runc-v2 ctr docker docker-init docker-proxy dockerd runc
)
for binary_name in "${docker_binaries[@]}"; do
    [[ -f "${TMP_DIR}/docker/${binary_name}" ]] || \
        die "Required binary is missing from the archive: ${binary_name}"
done

install -d -m 0755 "${BIN_DIR}" "${CLI_PLUGIN_DIR}" /etc/systemd/system

if ! getent group docker >/dev/null 2>&1; then
    log "Creating the docker system group..."
    groupadd --system docker
fi

cat > "${TMP_DIR}/docker.service" <<'UNIT'
[Unit]
Description=Docker Application Container Engine
Documentation=https://docs.docker.com
After=network-online.target nss-lookup.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=notify
NotifyAccess=all
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/local/bin/dockerd --host=unix:///run/docker.sock
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutStartSec=0
Restart=always
RestartSec=2
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
Delegate=yes
KillMode=process
OOMScoreAdjust=-500

[Install]
WantedBy=multi-user.target
UNIT

if systemctl is-active --quiet docker.service; then
    log "Stopping the existing Docker service..."
    systemctl stop docker.service
fi

# A package-managed socket unit would conflict with the standalone daemon socket.
systemctl disable --now docker.socket >/dev/null 2>&1 || true

log "Installing Docker ${DOCKER_VERSION} binaries into ${BIN_DIR}..."
for binary_name in "${docker_binaries[@]}"; do
    install -m 0755 "${TMP_DIR}/docker/${binary_name}" "${BIN_DIR}/${binary_name}"
done
log "Installing Docker Compose ${COMPOSE_VERSION}..."
install -m 0755 "${COMPOSE_BINARY_PATH}" "${CLI_PLUGIN_DIR}/docker-compose"
install -m 0644 "${TMP_DIR}/docker.service" "${SERVICE_FILE}"

log "Enabling and starting Docker..."
systemctl daemon-reload
systemctl enable docker.service >/dev/null
if ! systemctl restart docker.service; then
    systemctl --no-pager --full status docker.service || true
    command -v journalctl >/dev/null 2>&1 && \
        journalctl --no-pager -n 50 -u docker.service || true
    die "Docker failed to start. See the service log above."
fi

systemctl is-active --quiet docker.service || die "Docker service is not active after installation."
server_version="$("${BIN_DIR}/docker" version --format '{{.Server.Version}}')"
[[ "${server_version}" == "${DOCKER_VERSION}" ]] || \
    die "Docker started, but reported unexpected server version: ${server_version}"
compose_version="$("${BIN_DIR}/docker" compose version --short)"
compose_version="${compose_version#v}"
[[ "${compose_version}" == "${COMPOSE_VERSION}" ]] || \
    die "Docker Compose reported unexpected version: ${compose_version}"

log "Docker ${server_version} is installed, running, and enabled at boot."
log "Docker Compose ${compose_version} is installed."
log "Use 'sudo docker info' to inspect the daemon."
