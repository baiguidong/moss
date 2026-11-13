#!/usr/bin/env bash
set -Eeuo pipefail

base="${NEW_API_INTERNAL_URL:-http://new-api:3000}"
admin_user="${NEW_API_ADMIN_USERNAME:-admin}"
admin_password="${NEW_API_ADMIN_PASSWORD:-}"
client_id="${MOSS_OIDC_NEW_API_CLIENT_ID:-new-api}"
client_secret="${MOSS_OIDC_NEW_API_CLIENT_SECRET:-}"
issuer="${MOSS_OIDC_ISSUER:-${MOSS_PUBLIC_URL:-}}"
new_api_public="${MOSS_NEW_API_PUBLIC_BASE_URL:-http://localhost:3000}"

[[ -n "$admin_password" ]] || { echo 'NEW_API_ADMIN_PASSWORD is required for OIDC initialization' >&2; exit 1; }
[[ -n "$client_secret" ]] || { echo 'MOSS_OIDC_NEW_API_CLIENT_SECRET is required for OIDC initialization' >&2; exit 1; }
for _ in $(seq 1 60); do
  curl -fsS "$base/api/status" >/dev/null 2>&1 && break
  sleep 2
done

setup="$(curl -fsS "$base/api/setup")"
if [[ "$(jq -r '.data.status // false' <<<"$setup")" != true ]]; then
  curl -fsS -X POST "$base/api/setup" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg u "$admin_user" --arg p "$admin_password" '{username:$u,password:$p,confirmPassword:$p,SelfUseModeEnabled:false,DemoSiteEnabled:false}')" >/dev/null
fi

login="$(curl -fsS -X POST "$base/api/user/login" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg u "$admin_user" --arg p "$admin_password" '{username:$u,password:$p}')")"
token="$(jq -r '.data.access_token // empty' <<<"$login")"
[[ -n "$token" ]] || { echo 'New API admin login failed; check NEW_API_ADMIN_USERNAME/PASSWORD' >&2; exit 1; }

set_option() {
  local key="$1" value="$2"
  curl -fsS -X PUT "$base/api/option/" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg k "$key" --arg v "$value" '{key:$k,value:$v}')" >/dev/null
}

set_option ServerAddress "$new_api_public"
set_option oidc.enabled true
set_option oidc.display_name Moss
set_option oidc.client_id "$client_id"
set_option oidc.client_secret "$client_secret"
set_option oidc.well_known "${issuer%/}/.well-known/openid-configuration"
set_option oidc.authorization_endpoint "${issuer%/}/oidc/authorize"
set_option oidc.token_endpoint "${base%/}/oidc/token"
set_option oidc.user_info_endpoint "${base%/}/oidc/userinfo"
echo 'New API OIDC configuration is ready.'
