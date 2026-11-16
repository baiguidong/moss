#!/usr/bin/env bash
set -Eeuo pipefail

base="${NEW_API_INTERNAL_URL:-http://new-api:3000}"
admin_user="${NEW_API_ADMIN_USERNAME:-admin}"
admin_password="${NEW_API_ADMIN_PASSWORD:-}"
client_id="${MOSS_OIDC_NEW_API_CLIENT_ID:-new-api}"
client_secret="${MOSS_OIDC_NEW_API_CLIENT_SECRET:-}"
issuer="${MOSS_OIDC_ISSUER:-${MOSS_PUBLIC_URL:-}}"
oidc_internal="${MOSS_OIDC_INTERNAL_URL:-http://server:43127}"
new_api_public="${MOSS_NEW_API_PUBLIC_BASE_URL:-http://localhost:3000}"

if [[ -z "$admin_password" ]]; then
  # Existing installations may already be initialized and intentionally keep
  # the administrator password outside Compose. The database reconciler below
  # still enforces the Moss-owned quota defaults.
  echo 'New API administrator password is not configured; keeping existing OIDC settings.'
  exit 0
fi
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
  local payload
  if [[ "$value" == true || "$value" == false ]]; then
    payload="$(jq -nc --arg k "$key" --argjson v "$value" '{key:$k,value:$v}')"
  else
    payload="$(jq -nc --arg k "$key" --arg v "$value" '{key:$k,value:$v}')"
  fi
  curl -fsS -X PUT "$base/api/option/" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$payload" >/dev/null
}

set_option ServerAddress "$new_api_public"
set_option oidc.enabled true
set_option oidc.display_name Moss
set_option oidc.client_id "$client_id"
set_option oidc.client_secret "$client_secret"
set_option oidc.well_known "${issuer%/}/.well-known/openid-configuration"
set_option oidc.authorization_endpoint "${issuer%/}/oidc/authorize"
# New API performs the code exchange server-side. Use the private Moss address
# for back-channel calls so a self-signed public certificate is not required.
set_option oidc.token_endpoint "${oidc_internal%/}/oidc/token"
set_option oidc.user_info_endpoint "${oidc_internal%/}/oidc/userinfo"
# Moss is the user/credit authority. New API must not grant a sign-up bonus.
set_option QuotaForNewUser 0
set_option QuotaForInvitee 0
set_option QuotaForInviter 0

# New API can finish its first-run option migration just after /api/status
# becomes healthy. Re-assert the switch and verify the persisted value so a
# fresh deployment cannot silently fall back to its native-only login page.
for _ in $(seq 1 10); do
  enabled="$(curl -fsS "$base/api/option/" -H "Authorization: Bearer $token" \
    | jq -r '.data[]? | select(.key == "oidc.enabled") | .value' | head -n 1)"
  if [[ "$enabled" == true ]]; then
    echo 'New API OIDC configuration is ready.'
    exit 0
  fi
  set_option oidc.enabled true
  sleep 1
done
echo 'New API OIDC option did not persist as enabled.' >&2
exit 1
