#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?usage: package-server.sh VERSION ARCH OUTPUT_DIR}"
ARCH="${2:?usage: package-server.sh VERSION ARCH OUTPUT_DIR}"
OUTPUT_DIR="${3:?usage: package-server.sh VERSION ARCH OUTPUT_DIR}"

NODE_VERSION="${MOSS_SERVER_NODE_VERSION:-22.23.1}"
SHARP_VERSION="${SHARP_VERSION:-0.34.5}"
SHARP_LIBVIPS_VERSION="${SHARP_LIBVIPS_VERSION:-1.2.4}"
BUILD_CACHE="${MOSS_SERVER_BUILD_CACHE:-${HOME}/.cache/moss-server-build}"

SEMVER_PATTERN='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*)|([0-9]*[A-Za-z-][0-9A-Za-z-]*))(\.((0|[1-9][0-9]*)|([0-9]*[A-Za-z-][0-9A-Za-z-]*)))*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
[[ "$VERSION" =~ $SEMVER_PATTERN ]] || {
  echo "Invalid version: $VERSION" >&2
  exit 1
}

case "$ARCH" in
  amd64) NODE_ARCH=x64 ;;
  *)
    echo "Unsupported architecture: $ARCH (currently only amd64 is released)" >&2
    exit 1
    ;;
esac

for command_name in bun curl npm tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required" >&2
    exit 1
  }
done

mkdir -p "$OUTPUT_DIR" "$BUILD_CACHE"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
STAGE_ROOT="$(mktemp -d)"
PACK_ROOT="$(mktemp -d)"
trap 'rm -rf "$STAGE_ROOT" "$PACK_ROOT"' EXIT

PACKAGE_ROOT="$STAGE_ROOT/moss-server"
APP_ROOT="$PACKAGE_ROOT/app"
NODE_ROOT="$PACKAGE_ROOT/node"

echo "Building Moss Server"
(cd "$ROOT_DIR" && bun run build:server)

install -d \
  "$APP_ROOT/bin" \
  "$APP_ROOT/adapters" \
  "$APP_ROOT/admin" \
  "$APP_ROOT/resources" \
  "$NODE_ROOT/bin"
install -m 0644 "$ROOT_DIR/bin/moss-server.mjs" "$APP_ROOT/bin/moss-server.mjs"
install -m 0644 "$ROOT_DIR/bin/moss-session-runner.mjs" "$APP_ROOT/bin/moss-session-runner.mjs"
install -m 0644 "$ROOT_DIR/bin/adapters/feishu.mjs" "$APP_ROOT/adapters/feishu.mjs"
cp -a "$ROOT_DIR/admin/dist" "$APP_ROOT/admin/dist"

for resource in skills assistants; do
  if [ -d "$ROOT_DIR/$resource" ]; then
    cp -a "$ROOT_DIR/$resource" "$APP_ROOT/resources/$resource"
  fi
done

NODE_DIST="node-v$NODE_VERSION-linux-$NODE_ARCH"
NODE_ARCHIVE="$BUILD_CACHE/$NODE_DIST.tar.xz"
NODE_CHECKSUMS="$BUILD_CACHE/SHASUMS256-$NODE_VERSION.txt"
NODE_BASE_URL="https://nodejs.org/dist/v$NODE_VERSION"

if [ ! -s "$NODE_ARCHIVE" ]; then
  echo "Downloading Node.js v$NODE_VERSION for linux-$NODE_ARCH"
  curl --fail --location --retry 3 --connect-timeout 20 \
    -o "$NODE_ARCHIVE.part" "$NODE_BASE_URL/$NODE_DIST.tar.xz"
  mv "$NODE_ARCHIVE.part" "$NODE_ARCHIVE"
fi
curl --fail --location --retry 3 --connect-timeout 20 \
  -o "$NODE_CHECKSUMS.part" "$NODE_BASE_URL/SHASUMS256.txt"
mv "$NODE_CHECKSUMS.part" "$NODE_CHECKSUMS"
EXPECTED_NODE_SHA="$(awk -v file="$NODE_DIST.tar.xz" '$2 == file { print $1; exit }' "$NODE_CHECKSUMS")"
[ -n "$EXPECTED_NODE_SHA" ] || {
  echo "Node.js checksum is missing for $NODE_DIST.tar.xz" >&2
  exit 1
}

if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$EXPECTED_NODE_SHA" "$NODE_ARCHIVE" | sha256sum -c -
else
  ACTUAL_NODE_SHA="$(shasum -a 256 "$NODE_ARCHIVE" | awk '{ print $1 }')"
  [ "$ACTUAL_NODE_SHA" = "$EXPECTED_NODE_SHA" ] || {
    echo "Node.js checksum verification failed" >&2
    exit 1
  }
fi

tar -xJf "$NODE_ARCHIVE" -C "$PACK_ROOT"
install -m 0755 "$PACK_ROOT/$NODE_DIST/bin/node" "$NODE_ROOT/bin/node"

# Bun bundles sharp's JavaScript but leaves its platform-specific native addon
# as a dynamic require. Seed the portable dependencies, then replace any host
# native packages with the Linux x64 packages used by the release.
npm install \
  --prefix "$APP_ROOT" \
  --omit=dev \
  --ignore-scripts \
  --no-package-lock \
  --no-save \
  "sharp@$SHARP_VERSION" >/dev/null
rm -rf "$APP_ROOT/node_modules/@img/sharp-"* "$APP_ROOT/node_modules/@img/sharp-libvips-"*

extract_npm_package() {
  local spec="$1" destination="$2" package_dir archive
  package_dir="$(mktemp -d "$PACK_ROOT/npm.XXXXXX")"
  (cd "$package_dir" && npm pack --silent "$spec" >/dev/null)
  archive="$(find "$package_dir" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
  [ -n "$archive" ] || {
    echo "Could not download npm package: $spec" >&2
    exit 1
  }
  mkdir -p "$destination"
  tar -xzf "$archive" --strip-components=1 -C "$destination"
}

extract_npm_package \
  "@img/sharp-linux-x64@$SHARP_VERSION" \
  "$APP_ROOT/node_modules/@img/sharp-linux-x64"
extract_npm_package \
  "@img/sharp-libvips-linux-x64@$SHARP_LIBVIPS_VERSION" \
  "$APP_ROOT/node_modules/@img/sharp-libvips-linux-x64"

printf '%s\n' "$VERSION" > "$PACKAGE_ROOT/VERSION"
printf '%s\n' "$NODE_VERSION" > "$PACKAGE_ROOT/NODE_VERSION"

test -x "$NODE_ROOT/bin/node"
test -f "$APP_ROOT/bin/moss-server.mjs"
test -f "$APP_ROOT/bin/moss-session-runner.mjs"
test -f "$APP_ROOT/adapters/feishu.mjs"
test -f "$APP_ROOT/admin/dist/index.html"
test -f "$APP_ROOT/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node"

if [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]; then
  "$NODE_ROOT/bin/node" --no-warnings -e "require('node:sqlite')"
  (
    cd "$APP_ROOT"
    "$NODE_ROOT/bin/node" --input-type=module -e "import sharp from 'sharp'; await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000' } }).png().toBuffer()"
  )
fi

ARCHIVE_NAME="moss-server-$VERSION-linux-$ARCH.tar.gz"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$PACKAGE_ROOT"
fi
COPYFILE_DISABLE=1 tar --no-xattrs -C "$STAGE_ROOT" -czf "$ARCHIVE_PATH" moss-server

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$ARCHIVE_NAME" > SHA256SUMS-server)
else
  (cd "$OUTPUT_DIR" && shasum -a 256 "$ARCHIVE_NAME" > SHA256SUMS-server)
fi

echo "$ARCHIVE_PATH"
