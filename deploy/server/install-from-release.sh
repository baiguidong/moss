#!/usr/bin/env bash
# The Release workflow replaces @VERSION@ before attaching this file.
set -Eeuo pipefail

VERSION="${MOSS_RELEASE_VERSION:-@VERSION@}"
REPOSITORY="${MOSS_RELEASE_REPOSITORY:-baiguidong/moss}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo 'ERROR: download install-moss-server.sh from a Moss GitHub Release.' >&2
  exit 1
}
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'ERROR: published Moss images require Linux x86_64.' >&2
  exit 1
}
[[ "$EUID" -eq 0 ]] || { echo 'ERROR: run this script with sudo.' >&2; exit 1; }
for command_name in curl tar sha256sum docker jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: $command_name is required." >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || { echo 'ERROR: Docker Compose v2 is required.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'ERROR: Docker Engine is not running.' >&2; exit 1; }

archive="moss-server-compose-$VERSION.tar.gz"
release_url="https://github.com/$REPOSITORY/releases/download/v$VERSION"
stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT
curl --fail --location --retry 3 --output "$stage_dir/$archive" "$release_url/$archive"
curl --fail --location --retry 3 --output "$stage_dir/$archive.sha256" "$release_url/$archive.sha256"
(cd "$stage_dir" && sha256sum --check "$archive.sha256")
tar -tzf "$stage_dir/$archive" | awk '
  /^moss-server\/$/ { next }
  /^moss-server\/([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\/?$/ { next }
  { print "ERROR: unexpected path in deployment archive: " $0 > "/dev/stderr"; exit 1 }
'
tar -xzf "$stage_dir/$archive" -C "$stage_dir"
for name in server runtime webui; do
  image="$(sed -n "s/^MOSS_$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')_IMAGE=//p" "$stage_dir/moss-server/.env.example")"
  [[ "$image" == "ghcr.io/${REPOSITORY%%/*}/moss-$name:$VERSION" ]] || {
    echo "ERROR: deployment package does not pin moss-$name to $VERSION." >&2
    exit 1
  }
done
grep -Fxq 'MOSS_WEB_ENABLED=1' "$stage_dir/moss-server/.env.example" || {
  echo 'ERROR: deployment package does not enable WebUI.' >&2
  exit 1
}
image_prefix="ghcr.io/${REPOSITORY%%/*}"
export MOSS_SERVER_IMAGE="$image_prefix/moss-server:$VERSION"
export MOSS_RUNTIME_IMAGE="$image_prefix/moss-runtime:$VERSION"
export MOSS_WEB_IMAGE="$image_prefix/moss-webui:$VERSION"
export MOSS_WEB_ENABLED=1 MOSS_WEB_DEPLOY_MODE=cloud
bash "$stage_dir/moss-server/install.sh"
