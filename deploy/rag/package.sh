#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-${RAGFLOW_PACKAGE_VERSION:-$(date +%Y%m%d-%H%M%S)}}"
OUTPUT_DIR="${2:-${RAGFLOW_PACKAGE_OUTPUT_DIR:-$SCRIPT_DIR/dist}}"
PACKAGE_ROOT=moss-ragflow

[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "ERROR: version may contain only letters, numbers, dots, underscores, and dashes" >&2
  exit 2
}

files=(
  README.md
  MOSS_RAG_MCP_DESIGN.md
  .env.example
  docker-compose.yml
  docker-compose.gpu.yml
  docker-compose.native-mcp.yml
  install.sh
  package.sh
  ragflowctl
  start.sh
  stop.sh
  config
  mcp-extended
  scripts
)

for file in "${files[@]}"; do
  [[ -e "$SCRIPT_DIR/$file" ]] || {
    echo "ERROR: required package input is missing: $file" >&2
    exit 1
  }
done

SKIP_COMPOSE_VALIDATION=1 "$SCRIPT_DIR/scripts/validate.sh"

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
archive="$OUTPUT_DIR/moss-ragflow-$VERSION.tar.gz"
checksum="$archive.sha256"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/$PACKAGE_ROOT"
for file in "${files[@]}"; do
  cp -a "$SCRIPT_DIR/$file" "$tmp_dir/$PACKAGE_ROOT/"
done
find "$tmp_dir/$PACKAGE_ROOT" -type f \( -name '._*' -o -name '*.pyc' \) -delete
find "$tmp_dir/$PACKAGE_ROOT" -type d -name '__pycache__' -prune -exec rm -rf {} +
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$tmp_dir/$PACKAGE_ROOT"
fi
chmod 0755 "$tmp_dir/$PACKAGE_ROOT/"*.sh "$tmp_dir/$PACKAGE_ROOT/scripts/"*.sh

COPYFILE_DISABLE=1 tar --no-xattrs \
  --exclude "$PACKAGE_ROOT/dist" \
  --exclude "$PACKAGE_ROOT/dist/*" \
  -czf "$archive" -C "$tmp_dir" "$PACKAGE_ROOT"
archive_entries="$(tar -tzf "$archive")"
if grep -Eq '(^|/)dist(/|$)|(\.tar(\.(gz|zst))?|\.tgz)$' <<<"$archive_entries"; then
  rm -f "$archive"
  echo "ERROR: package contains dist or a nested archive" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$checksum")")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$archive")" > "$(basename "$checksum")")
else
  echo "ERROR: sha256sum or shasum is required" >&2
  exit 1
fi

printf 'Package:  %s\nChecksum: %s\n' "$archive" "$checksum"
