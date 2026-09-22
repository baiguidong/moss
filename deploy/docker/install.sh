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
readonly DAEMON_CONFIG_FILE="/etc/docker/daemon.json"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_PATH="${SCRIPT_DIR}/${ARCHIVE_NAME}"
COMPOSE_BINARY_PATH="${SCRIPT_DIR}/${COMPOSE_BINARY_NAME}"
DOCKER_DATA_ROOT="${DOCKER_DATA_ROOT:-/data/docker}"
MIGRATE_DOCKER_DATA="${MIGRATE_DOCKER_DATA:-0}"
TMP_DIR=""
MIGRATION_SOURCE=""

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

directory_has_entries() (
    local entries
    [[ -d "$1" ]] || return 1
    shopt -s dotglob nullglob
    entries=("$1"/*)
    (( ${#entries[@]} > 0 ))
)

data_roots_are_same() {
    local first="$1"
    local second="$2"

    [[ "${first%/}" == "${second%/}" ]] && return 0
    [[ -e "${first}" && -e "${second}" && "${first}" -ef "${second}" ]]
}

create_data_root() {
    local parent
    parent="$(dirname -- "${DOCKER_DATA_ROOT}")"
    if [[ ! -d "${parent}" ]]; then
        install -d -m 0755 "${parent}"
    fi
    install -d -m 0711 "${DOCKER_DATA_ROOT}"
}

data_root_from_arguments() {
    sed -nE 's#.*--data-root(=|[[:space:]]+)([^[:space:]]+).*#\2#p' <<<"$1"
}

daemon_config_data_root() {
    local contents
    [[ -r "${DAEMON_CONFIG_FILE}" ]] || return 0
    contents="$(<"${DAEMON_CONFIG_FILE}")"
    if [[ "${contents}" =~ \"data-root\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
    elif [[ "${contents}" == *'"data-root"'* ]]; then
        die "Cannot parse data-root in ${DAEMON_CONFIG_FILE}; use a JSON string value or remove that key before installing."
    fi
}

detect_current_data_root() {
    local docker_cli root service_arguments configured_root="$1"

    docker_cli="$(command -v docker 2>/dev/null || true)"
    if [[ -n "${docker_cli}" ]]; then
        root="$("${docker_cli}" info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
        if [[ "${root}" == /* ]]; then
            printf '%s\n' "${root%/}"
            return 0
        fi
    fi

    service_arguments="$(systemctl show --property=ExecStart --value docker.service 2>/dev/null || true)"
    root="$(data_root_from_arguments "${service_arguments}")"
    if [[ "${root}" == /* ]]; then
        printf '%s\n' "${root%/}"
        return 0
    fi

    if [[ "${configured_root}" == /* ]]; then
        printf '%s\n' "${configured_root%/}"
        return 0
    fi

    if directory_has_entries /var/lib/docker; then
        printf '%s\n' /var/lib/docker
    fi
}

cleanup() {
    if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
        rm -rf -- "${TMP_DIR}"
    fi
}
trap cleanup EXIT

if [[ "$#" -ne 0 ]]; then
    die "This installer does not accept arguments. Run: sudo ./install.sh"
fi

while [[ "${DOCKER_DATA_ROOT}" != "/" && "${DOCKER_DATA_ROOT}" == */ ]]; do
    DOCKER_DATA_ROOT="${DOCKER_DATA_ROOT%/}"
done
[[ "${DOCKER_DATA_ROOT}" =~ ^/([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$ ]] || \
    die "DOCKER_DATA_ROOT must be an absolute path without spaces (default: /data/docker)."
IFS=/ read -r -a data_root_segments <<<"${DOCKER_DATA_ROOT#/}"
for segment in "${data_root_segments[@]}"; do
    [[ "${segment}" != "." && "${segment}" != ".." ]] || \
        die "DOCKER_DATA_ROOT must not contain '.' or '..' path segments."
done
[[ "${MIGRATE_DOCKER_DATA}" == "0" || "${MIGRATE_DOCKER_DATA}" == "1" ]] || \
    die "MIGRATE_DOCKER_DATA must be 0 or 1."

if [[ "${EUID}" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || die "Run this script as root (sudo is not installed)."
    exec sudo -- env \
        "DOCKER_DATA_ROOT=${DOCKER_DATA_ROOT}" \
        "MIGRATE_DOCKER_DATA=${MIGRATE_DOCKER_DATA}" \
        "${SCRIPT_DIR}/$(basename -- "$0")"
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
    cp getent groupadd install ip iptables mktemp ps sed sha256sum systemctl tar uname
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

configured_data_root="$(daemon_config_data_root)"
if [[ -n "${configured_data_root}" ]] && ! data_roots_are_same "${configured_data_root}" "${DOCKER_DATA_ROOT}"; then
    die "${DAEMON_CONFIG_FILE} sets data-root to ${configured_data_root}, but DOCKER_DATA_ROOT is ${DOCKER_DATA_ROOT}. Update or remove that JSON setting first."
fi

current_data_root="$(detect_current_data_root "${configured_data_root}")"
if [[ -n "${current_data_root}" ]] \
    && ! data_roots_are_same "${current_data_root}" "${DOCKER_DATA_ROOT}" \
    && directory_has_entries "${current_data_root}"; then
    if [[ "${MIGRATE_DOCKER_DATA}" != "1" ]]; then
        die "Docker currently stores data in ${current_data_root}. Re-run with MIGRATE_DOCKER_DATA=1 to copy it to ${DOCKER_DATA_ROOT}, or set DOCKER_DATA_ROOT=${current_data_root} to keep the existing location."
    fi
    if directory_has_entries "${DOCKER_DATA_ROOT}"; then
        die "Migration target ${DOCKER_DATA_ROOT} is not empty. Refusing to merge two Docker data roots."
    fi
    case "${DOCKER_DATA_ROOT}/" in
        "${current_data_root}/"*) die "Docker data migration target must not be inside its source directory." ;;
    esac
    case "${current_data_root}/" in
        "${DOCKER_DATA_ROOT}/"*) die "Docker data migration source must not be inside its target directory." ;;
    esac
    MIGRATION_SOURCE="${current_data_root}"
fi

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

data_root_flag="--data-root=${DOCKER_DATA_ROOT}"
if [[ -n "${configured_data_root}" ]]; then
    # Avoid specifying the same option in both daemon.json and command-line flags.
    data_root_flag=""
fi

cat > "${TMP_DIR}/docker.service" <<UNIT
[Unit]
Description=Docker Application Container Engine
Documentation=https://docs.docker.com
After=network-online.target nss-lookup.target
Wants=network-online.target
RequiresMountsFor=${DOCKER_DATA_ROOT}
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=notify
NotifyAccess=all
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/local/bin/dockerd --host=unix:///run/docker.sock${data_root_flag:+ ${data_root_flag}}
ExecReload=/bin/kill -s HUP \$MAINPID
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

if "${TMP_DIR}/docker/docker" info >/dev/null 2>&1; then
    die "A Docker daemon is still running outside docker.service. Stop it before installing or migrating data."
fi

if [[ -n "${MIGRATION_SOURCE}" ]]; then
    if directory_has_entries "${DOCKER_DATA_ROOT}"; then
        die "Migration target ${DOCKER_DATA_ROOT} became non-empty. The source was not modified."
    fi
    log "Copying Docker data from ${MIGRATION_SOURCE} to ${DOCKER_DATA_ROOT}..."
    create_data_root
    if ! cp -a -- "${MIGRATION_SOURCE}/." "${DOCKER_DATA_ROOT}/"; then
        die "Docker data migration failed. The original data remains at ${MIGRATION_SOURCE}."
    fi
elif [[ ! -d "${DOCKER_DATA_ROOT}" ]]; then
    log "Creating Docker data root at ${DOCKER_DATA_ROOT}..."
    create_data_root
fi

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
reported_data_root="$("${BIN_DIR}/docker" info --format '{{.DockerRootDir}}')"
reported_data_root="${reported_data_root%/}"
data_roots_are_same "${reported_data_root}" "${DOCKER_DATA_ROOT}" || \
    die "Docker started with data root ${reported_data_root}, expected ${DOCKER_DATA_ROOT}."

log "Docker ${server_version} is installed, running, and enabled at boot."
log "Docker Compose ${compose_version} is installed."
log "Docker data root: ${reported_data_root}"
if [[ -n "${MIGRATION_SOURCE}" ]]; then
    log "Migration completed. Original data remains at ${MIGRATION_SOURCE}; remove it only after verification."
fi
log "Use 'sudo docker info' to inspect the daemon."
