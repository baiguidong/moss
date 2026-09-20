#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
[[ -f "$ENV_FILE" ]] || {
  echo "ERROR: Moss Server is not installed under $SCRIPT_DIR" >&2
  exit 1
}
[[ "$#" -le 1 ]] || {
  echo "Usage: $0 [IMAGE_TAG]" >&2
  exit 2
}

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

set_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

with_tag() {
  local image="$1" tag="$2" repository last_component
  repository="${image%@*}"
  last_component="${repository##*/}"
  if [[ "$last_component" == *:* ]]; then
    repository="${repository%:*}"
  fi
  printf '%s:%s' "$repository" "$tag"
}

image_tag="${1:-${MOSS_VERSION:-}}"
if [[ -n "$image_tag" ]]; then
  image_tag="${image_tag#v}"
  [[ "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || {
    echo "ERROR: invalid image tag: $image_tag" >&2
    exit 2
  }
  for key in MOSS_SERVER_IMAGE MOSS_RUNTIME_IMAGE; do
    current="$(env_value "$key")"
    [[ -n "$current" ]] || { echo "ERROR: $key is missing from $ENV_FILE" >&2; exit 1; }
    set_env "$key" "$(with_tag "$current" "$image_tag")"
  done
  printf 'Moss Server and runtime image tag: %s\n' "$image_tag"
fi

export PULL_IMAGES=1
exec "$SCRIPT_DIR/start.sh"
