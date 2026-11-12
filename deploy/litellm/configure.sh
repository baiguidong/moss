#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE="$ROOT_DIR/.env.example"
SOURCE_ENV="${1:-$ENV_FILE}"
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ -f "$EXAMPLE" ]] || die "missing $EXAMPLE"
read_file(){ local f="$1" k="$2"; [[ -f "$f" ]] || return 0; sed -n -E "s/^${k}=//p" "$f" | tail -n 1 | sed -E 's/^"//;s/"$//'; }
read_value(){ local k="$1" v="${!1-}"; [[ -n "$v" ]] || v="$(read_file "$SOURCE_ENV" "$k")"; [[ -n "$v" ]] || v="$(read_file "$EXAMPLE" "$k")"; printf '%s' "$v"; }
random_secret(){ openssl rand -hex 32; }
[[ -f "$ENV_FILE" ]] || install -m 0600 "$EXAMPLE" "$ENV_FILE"
command -v openssl >/dev/null || die "openssl is required"
master="$(read_value LITELLM_MASTER_KEY)"; [[ "$master" == change-me || -z "$master" ]] && master="sk-$(random_secret)"
dbpass="$(read_value POSTGRES_PASSWORD)"; [[ "$dbpass" == change-me || -z "$dbpass" ]] && dbpass="$(random_secret)"
data="$(read_value DATA_DIR)"; mkdir -p "$data/postgres"
sed -i.bak -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=$master|" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$dbpass|" "$ENV_FILE"; rm -f "$ENV_FILE.bak"
public_url="$(read_value LITELLM_PUBLIC_BASE_URL)"
[[ -n "$public_url" ]] || { public_host="$(hostname -I 2>/dev/null | awk '{print $1}')"; public_url="http://${public_host:-127.0.0.1}:$(read_value LITELLM_PORT)"; printf 'LITELLM_PUBLIC_BASE_URL=%s\n' "$public_url" >> "$ENV_FILE"; }
grep -q '^MOSS_INTEGRATION_NETWORK=' "$ENV_FILE" || printf 'MOSS_INTEGRATION_NETWORK=moss-integrations\n' >> "$ENV_FILE"
docker network inspect "$(read_value MOSS_INTEGRATION_NETWORK)" >/dev/null 2>&1 || docker network create "$(read_value MOSS_INTEGRATION_NETWORK)" >/dev/null
docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml" config >/dev/null
printf 'Configured LiteLLM at %s\n' "$ROOT_DIR"
