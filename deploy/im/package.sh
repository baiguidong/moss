#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-${OPENIM_PACKAGE_VERSION:-$(date +%Y%m%d-%H%M%S)}}"
OUTPUT_DIR="${2:-${OPENIM_PACKAGE_OUTPUT_DIR:-$SCRIPT_DIR/dist}}"
PACKAGE_ROOT=moss-openim

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] \
  || die "version may contain only letters, numbers, dots, underscores, and dashes"

files=(
  README.md
  .env.example
  compose.yaml
  configure.sh
  install.sh
  package.sh
  start.sh
  stop.sh
  config/webhooks.yml.template
  scripts/common.sh
  scripts/validate.sh
)
for file in "${files[@]}"; do
  [[ -e "$SCRIPT_DIR/$file" ]] || die "required package input is missing: $file"
done

"$SCRIPT_DIR/scripts/validate.sh"

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
archive="$OUTPUT_DIR/moss-openim-$VERSION.tar.gz"
checksum="$archive.sha256"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/$PACKAGE_ROOT/config" "$tmp_dir/$PACKAGE_ROOT/scripts"
for file in "${files[@]}"; do
  install -m 0644 "$SCRIPT_DIR/$file" "$tmp_dir/$PACKAGE_ROOT/$file"
done
chmod 0755 "$tmp_dir/$PACKAGE_ROOT/"*.sh
chmod 0755 "$tmp_dir/$PACKAGE_ROOT/scripts/"*.sh
find "$tmp_dir/$PACKAGE_ROOT" -type f -name '._*' -delete
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$tmp_dir/$PACKAGE_ROOT"
fi

tar_options=(-czf "$archive" -C "$tmp_dir" "$PACKAGE_ROOT")
tar_probe="$tmp_dir/no-xattrs-probe.tar"
if COPYFILE_DISABLE=1 tar --no-xattrs -cf "$tar_probe" -C "$tmp_dir" "$PACKAGE_ROOT" \
  >/dev/null 2>&1; then
  tar_options=(--no-xattrs -czf "$archive" -C "$tmp_dir" "$PACKAGE_ROOT")
fi
rm -f "$tar_probe"
COPYFILE_DISABLE=1 tar "${tar_options[@]}"

if gzip -dc "$archive" | LC_ALL=C grep -aE \
  'LIBARCHIVE\.xattr|SCHILY\.xattr|com\.apple\.' >/dev/null; then
  rm -f "$archive"
  die "package contains extended attributes or macOS metadata"
fi

archive_entries="$(tar -tzf "$archive")"
if grep -Eq '(^|/)(dist|data)(/|$)|(^|/)\.env$|config/(webhooks\.yml|moss-system-settings\.json)$|(\.tar(\.(gz|zst))?|\.tgz)$' \
  <<<"$archive_entries"; then
  rm -f "$archive"
  die "package contains runtime data, secrets, or a nested archive"
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$checksum")")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$archive")" > "$(basename "$checksum")")
else
  rm -f "$archive"
  die "sha256sum or shasum is required"
fi

printf 'Package:  %s\nChecksum: %s\n' "$archive" "$checksum"
