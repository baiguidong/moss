#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_ROOT/common.sh"
[[ "$(env_value MOSS_WEB_ENABLED)" == 1 ]] || exit 0

set_owner_value() {
  local key="$1" value="$2"
  [[ "$value" =~ ^[A-Za-z0-9_-]+$ ]] || die "Invalid $key returned by authentication service"
  # IDs contain no sed metacharacters. configure.sh already created both keys.
  sed -i.bak "s/^${key}=.*/${key}=${value}/" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
}

owner_id="$(env_value MOSS_WEB_OWNER_ID)"
if [[ -z "$owner_id" ]]; then
  log 'Binding single-user WebUI to the configured administrator'
  # Credentials travel on stdin, never in process arguments or logs. The existing
  # auth service resolves the account; an arbitrary first Web login cannot claim it.
  identity="$(printf '%s\n%s\n' "$(env_value MOSS_ADMIN_USERNAME)" "$(env_value MOSS_ADMIN_PASSWORD)" \
    | jq -Rn '{username:input,password:input}' \
    | compose exec -T server /opt/moss/node/bin/node --input-type=module -e '
      let data = ""; for await (const chunk of process.stdin) data += chunk;
      const base = "http://127.0.0.1:43127/api/v1/auth";
      const login = await fetch(base + "/login", { method: "POST", headers: {"content-type":"application/json"}, body:data, signal:AbortSignal.timeout(10000) });
      if (!login.ok) throw new Error("Administrator login failed. Set MOSS_WEB_OWNER_ID explicitly or use current administrator credentials.");
      const token = (await login.json()).access_token;
      const me = await fetch(base + "/me", {headers:{authorization:"Bearer " + token},signal:AbortSignal.timeout(10000)});
      if (!me.ok) throw new Error("Cannot resolve WebUI owner");
      const identity = await me.json();
      console.log(JSON.stringify({userId:identity.user.id,orgId:identity.organization?.id}));
    ')"
  owner_id="$(jq -er '.userId | select(type == "string" and length > 0)' <<<"$identity")"
  set_owner_value MOSS_WEB_OWNER_ID "$owner_id"
  owner_org="$(jq -r '.orgId // empty' <<<"$identity")"
  [[ -z "$owner_org" ]] || set_owner_value MOSS_WEB_OWNER_ORG_ID "$owner_org"
fi

container="$(compose ps --all --quiet webui)"
if [[ -n "$container" ]]; then
  actual_env="$(docker inspect --format '{{json .Config.Env}}' "$container")"
  jq -e --arg owner "MOSS_WEB_OWNER_ID=$owner_id" \
    --arg org "MOSS_WEB_OWNER_ORG_ID=$(env_value MOSS_WEB_OWNER_ORG_ID)" \
    --arg origin "MOSS_WEB_ORIGIN=$(env_value MOSS_WEB_ORIGIN)" \
    'index($owner) != null and index($org) != null and index($origin) != null
     and index("MOSS_WEB_AUTH_SERVER=http://server:43127") != null' \
    <<<"$actual_env" >/dev/null \
    || die 'Existing WebUI owner/origin differs. Plan an environment migration before replacing its container.'
fi

log 'Starting WebUI while retaining its existing Linux system layer'
compose up -d --no-deps --no-recreate --wait --wait-timeout 120 webui
compose up -d --no-deps --wait --wait-timeout 60 webui-proxy
printf 'Moss WebUI: %s (owner %s)\n' "$(env_value MOSS_WEB_ORIGIN)" "$owner_id"
printf 'WebUI image updates are not applied by replacing an existing personal container.\n'
