#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:?usage: prepare-image-context.sh VERSION ARCH OUTPUT_DIR}"
ARCH="${2:?usage: prepare-image-context.sh VERSION ARCH OUTPUT_DIR}"
OUTPUT_DIR="${3:?usage: prepare-image-context.sh VERSION ARCH OUTPUT_DIR}"

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
  arm64) NODE_ARCH=arm64 ;;
  *)
    echo "Unsupported architecture: $ARCH (expected amd64 or arm64)" >&2
    exit 1
    ;;
esac

for command_name in bun curl npm tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required" >&2
    exit 1
  }
done

OUTPUT_NAME="$(basename "$OUTPUT_DIR")"
[[ -n "$OUTPUT_NAME" && "$OUTPUT_NAME" != . && "$OUTPUT_NAME" != .. && "$OUTPUT_NAME" != / ]] || {
  echo "Invalid output directory: $OUTPUT_DIR" >&2
  exit 1
}
mkdir -p "$(dirname "$OUTPUT_DIR")" "$BUILD_CACHE"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT_DIR")" && pwd)/$OUTPUT_NAME"
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
  "$APP_ROOT/admin" \
  "$APP_ROOT/resources" \
  "$NODE_ROOT/bin"
install -m 0644 "$ROOT_DIR/bin/moss-server.mjs" "$APP_ROOT/bin/moss-server.mjs"
install -m 0644 "$ROOT_DIR/bin/moss-session-runner.mjs" "$APP_ROOT/bin/moss-session-runner.mjs"
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
# native packages with the selected Linux packages.
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
  "@img/sharp-linux-$NODE_ARCH@$SHARP_VERSION" \
  "$APP_ROOT/node_modules/@img/sharp-linux-$NODE_ARCH"
extract_npm_package \
  "@img/sharp-libvips-linux-$NODE_ARCH@$SHARP_LIBVIPS_VERSION" \
  "$APP_ROOT/node_modules/@img/sharp-libvips-linux-$NODE_ARCH"
# Runtime code loads these packages directly; npm's command shims are unused
# and would introduce symbolic links into the Server image.
rm -rf "$APP_ROOT/node_modules/.bin"

printf '%s\n' "$VERSION" > "$PACKAGE_ROOT/VERSION"
printf '%s\n' "$NODE_VERSION" > "$PACKAGE_ROOT/NODE_VERSION"

test -x "$NODE_ROOT/bin/node"
test -f "$APP_ROOT/bin/moss-server.mjs"
test -f "$APP_ROOT/bin/moss-session-runner.mjs"
test ! -e "$APP_ROOT/apps"
test -f "$APP_ROOT/admin/dist/index.html"
test -f "$APP_ROOT/node_modules/@img/sharp-linux-$NODE_ARCH/lib/sharp-linux-$NODE_ARCH.node"

if [ "$(uname -s)" = Linux ] && { { [ "$ARCH" = amd64 ] && [ "$(uname -m)" = x86_64 ]; } || { [ "$ARCH" = arm64 ] && [ "$(uname -m)" = aarch64 ]; }; }; then
  "$NODE_ROOT/bin/node" --no-warnings -e "require('node:sqlite')"
  (
    cd "$APP_ROOT"
    "$NODE_ROOT/bin/node" --input-type=module -e "import sharp from 'sharp'; await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000' } }).png().toBuffer()"
  )
fi

if find "$PACKAGE_ROOT" -type l -print -quit | grep -q .; then
  echo "Server image context must not contain symbolic links" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
mv "$PACKAGE_ROOT" "$OUTPUT_DIR/moss-server"
echo "$OUTPUT_DIR/moss-server"
