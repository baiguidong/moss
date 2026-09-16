#!/usr/bin/env bash

set -Eeuo pipefail

readonly DOCKER_VERSION="29.8.1"
readonly DOCKER_ARCHIVE="docker-${DOCKER_VERSION}.tgz"
readonly DOCKER_SHA256="d8db66739d2e28d4933786d73e918d9be643a67fbd835db1bf740d650a259e70"
readonly COMPOSE_VERSION="5.5.1"
readonly COMPOSE_BINARY="docker-compose-linux-x86_64"
readonly COMPOSE_SHA256="db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576"
readonly INSTALL_SCRIPT="install.sh"
readonly PACKAGE_DIR_NAME="docker-offline"
readonly OUTPUT_DIR_NAME="dist"
readonly OUTPUT_ARCHIVE="docker.tar.gz"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/${OUTPUT_DIR_NAME}"
TMP_ARCHIVE="${OUTPUT_DIR}/.${OUTPUT_ARCHIVE}.tmp.$$"
STAGING_ROOT="${OUTPUT_DIR}/.${PACKAGE_DIR_NAME}.tmp.$$"
PACKAGE_DIR="${STAGING_ROOT}/${PACKAGE_DIR_NAME}"

log() {
    printf '[docker-package] %s\n' "$*"
}

die() {
    printf '[docker-package] ERROR: %s\n' "$*" >&2
    exit 1
}

sha256_file() {
    local file_path="$1"
    local checksum_output

    if command -v sha256sum >/dev/null 2>&1; then
        checksum_output="$(sha256sum -- "${file_path}")"
    elif command -v shasum >/dev/null 2>&1; then
        checksum_output="$(shasum -a 256 -- "${file_path}")"
    else
        die "Neither sha256sum nor shasum is available."
    fi
    printf '%s\n' "${checksum_output%% *}"
}

cleanup() {
    rm -f -- "${TMP_ARCHIVE}"
    rm -rf -- "${STAGING_ROOT}"
}
trap cleanup EXIT

if [[ "$#" -ne 0 ]]; then
    die "This packager does not accept arguments. Run: ./package.sh"
fi

for file_name in "${DOCKER_ARCHIVE}" "${COMPOSE_BINARY}" "${INSTALL_SCRIPT}"; do
    [[ -f "${SCRIPT_DIR}/${file_name}" ]] || die "Required file not found: ${file_name}"
done
[[ -x "${SCRIPT_DIR}/${INSTALL_SCRIPT}" ]] || die "${INSTALL_SCRIPT} is not executable."

actual_checksum="$(sha256_file "${SCRIPT_DIR}/${DOCKER_ARCHIVE}")"
[[ "${actual_checksum}" == "${DOCKER_SHA256}" ]] || \
    die "${DOCKER_ARCHIVE} is not the expected Docker ${DOCKER_VERSION} archive (SHA-256 mismatch)."
actual_checksum="$(sha256_file "${SCRIPT_DIR}/${COMPOSE_BINARY}")"
[[ "${actual_checksum}" == "${COMPOSE_SHA256}" ]] || \
    die "${COMPOSE_BINARY} is not the expected Docker Compose ${COMPOSE_VERSION} binary (SHA-256 mismatch)."

log "Creating ${OUTPUT_ARCHIVE}..."
mkdir -p -- "${OUTPUT_DIR}"
install -d -m 0755 "${PACKAGE_DIR}"
install -m 0644 "${SCRIPT_DIR}/${DOCKER_ARCHIVE}" "${PACKAGE_DIR}/${DOCKER_ARCHIVE}"
install -m 0755 "${SCRIPT_DIR}/${COMPOSE_BINARY}" "${PACKAGE_DIR}/${COMPOSE_BINARY}"
install -m 0755 "${SCRIPT_DIR}/${INSTALL_SCRIPT}" "${PACKAGE_DIR}/${INSTALL_SCRIPT}"
(
    cd "${STAGING_ROOT}"
    COPYFILE_DISABLE=1 tar \
        --no-xattrs \
        --format=ustar \
        --exclude='._*' \
        --exclude='*/._*' \
        --exclude='.DS_Store' \
        --exclude='*/.DS_Store' \
        --exclude='__MACOSX' \
        -czf "${TMP_ARCHIVE}" \
        "${PACKAGE_DIR_NAME}"
)

expected_entries="$(printf '%s\n' \
    "${PACKAGE_DIR_NAME}/" \
    "${PACKAGE_DIR_NAME}/${DOCKER_ARCHIVE}" \
    "${PACKAGE_DIR_NAME}/${COMPOSE_BINARY}" \
    "${PACKAGE_DIR_NAME}/${INSTALL_SCRIPT}" | LC_ALL=C sort)"
actual_entries="$(tar -tzf "${TMP_ARCHIVE}" | LC_ALL=C sort)"
[[ "${actual_entries}" == "${expected_entries}" ]] || \
    die "Unexpected files were added to ${OUTPUT_ARCHIVE}."

mv -f -- "${TMP_ARCHIVE}" "${OUTPUT_DIR}/${OUTPUT_ARCHIVE}"
log "Created ${OUTPUT_DIR}/${OUTPUT_ARCHIVE}"
log "Top-level directory: ${PACKAGE_DIR_NAME}/"
