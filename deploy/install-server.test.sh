#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT_DIR/deploy/install-server.sh"
PACKAGE_SCRIPT="$ROOT_DIR/deploy/package-server.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1" needle="$2"
  [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

stamp_installer() {
  local tag="$1" output="$2"
  sed \
    -e "s|@@MOSS_RELEASE_TAG@@|$tag|g" \
    -e 's|@@MOSS_REPOSITORY@@|baiguidong/moss|g' \
    "$INSTALLER" > "$output"
  chmod +x "$output"
}

run_installer_with_mocks() {
  local script="$1"
  shift
  local mock_bin="$TMP_ROOT/mock-bin"
  mkdir -p "$mock_bin"
  for command_name in curl find install tar; do
    ln -sf "$(command -v "$command_name")" "$mock_bin/$command_name"
  done
  cat > "$mock_bin/id" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = -u ]; then
  printf '0\n'
  exit 0
fi
exec /usr/bin/id "$@"
EOF
  cat > "$mock_bin/getent" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = passwd ]; then
  printf '%s:x:%s:%s::%s:/bin/bash\n' '${USER}' '$(id -u)' '$(id -g)' '${HOME}'
  exit 0
fi
exit 1
EOF
  cat > "$mock_bin/realpath" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${@: -1}"
EOF
  cat > "$mock_bin/stat" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = -c ] && [ "\${2:-}" = %U ]; then
  printf '%s\n' '${USER}'
  exit 0
fi
exec /usr/bin/stat "\$@"
EOF
  cat > "$mock_bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$mock_bin/docker" <<'EOF'
#!/usr/bin/env bash
[ -z "${MOCK_DOCKER_LOG:-}" ] || printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
exit 1
EOF
  cat > "$mock_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  cat > "$mock_bin/uname" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -s) printf 'Linux\n' ;;
  -m) printf 'x86_64\n' ;;
  *) exec /usr/bin/uname "$@" ;;
esac
EOF
  chmod +x "$mock_bin/id" "$mock_bin/getent" "$mock_bin/realpath" \
    "$mock_bin/stat" "$mock_bin/docker" "$mock_bin/flock" \
    "$mock_bin/systemctl" "$mock_bin/uname"
  env PATH="$mock_bin:$PATH" "$@" "$script" --offline --non-interactive 2>&1
}

valid_installer="$TMP_ROOT/install-valid.sh"
stamp_installer v1.2.3 "$valid_installer"
docker_log="$TMP_ROOT/docker.log"
: > "$docker_log"
output="$(MOSS_INSTALL_DIR="$TMP_ROOT/missing" \
  MOSS_SERVICE_NAME=moss-server-review \
  run_installer_with_mocks "$valid_installer" \
  MOSS_INSTALL_USER="$(id -un)" MOSS_INSTALL_LOCK_DIR="$TMP_ROOT" \
  MOCK_DOCKER_LOG="$docker_log" || true)"
assert_contains "$output" 'missing offline asset'
[ ! -s "$docker_log" ] \
  || fail 'preflight failure must not remove an existing runtime image'

for invalid_tag in v../../tmp/x v1..2 latest; do
  invalid_installer="$TMP_ROOT/install-invalid-${invalid_tag//\//_}.sh"
  stamp_installer "$invalid_tag" "$invalid_installer"
  output="$(run_installer_with_mocks "$invalid_installer" \
    MOSS_INSTALL_USER="$(id -un)" MOSS_INSTALL_LOCK_DIR="$TMP_ROOT" || true)"
  assert_contains "$output" 'invalid or unstamped release tag'
done

occupied="$TMP_ROOT/occupied"
mkdir -p "$occupied"
touch "$occupied/keep"
output="$(MOSS_INSTALL_DIR="$occupied" \
  MOSS_SERVICE_NAME=moss-server-review \
  run_installer_with_mocks "$valid_installer" \
  MOSS_INSTALL_USER="$(id -un)" MOSS_INSTALL_LOCK_DIR="$TMP_ROOT" || true)"
assert_contains "$output" 'install directory is not empty and is not managed'

managed="$TMP_ROOT/managed"
mkdir -p "$managed"
printf '%s\n' \
  'release_tag=v1.2.2' \
  'repository=baiguidong/moss' \
  'service_name=moss-server-review' \
  'runtime_image=moss-runtime:1.2.2-amd64' \
  > "$managed/.moss-server-install"
printf '{}\n' > "$managed/server.json"
ln -s "$TMP_ROOT/outside" "$managed/skills"
output="$(MOSS_INSTALL_DIR="$managed" \
  MOSS_SERVICE_NAME=moss-server-review \
  run_installer_with_mocks "$valid_installer" \
  MOSS_INSTALL_USER="$(id -un)" MOSS_INSTALL_LOCK_DIR="$TMP_ROOT" || true)"
assert_contains "$output" 'managed directory must not be a symbolic link'

for valid_version in 1.2.3 1.2.3-rc.1 1.2.3+build.4; do
  output="$($PACKAGE_SCRIPT "$valid_version" unsupported "$TMP_ROOT/out" 2>&1 || true)"
  assert_contains "$output" 'Unsupported architecture'
done

for invalid_version in ../bad 1..2 01.2.3 1.2.3/evil; do
  output="$($PACKAGE_SCRIPT "$invalid_version" amd64 "$TMP_ROOT/out" 2>&1 || true)"
  assert_contains "$output" 'Invalid version'
done

printf 'Server installer validation tests passed.\n'
