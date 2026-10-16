#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/common.sh"
[[ "$(env_value MOSS_WEB_DEPLOY_MODE)" == cloud ]] || die 'This command requires MOSS_WEB_DEPLOY_MODE=cloud'
case "${1:-list}" in
  list) compose exec -T web-gateway node /opt/moss/cloud/cli.mjs list ;;
  stop) [[ $# == 2 ]] || die 'Usage: webui.sh stop <environment-id>'; compose exec -T web-gateway node /opt/moss/cloud/cli.mjs stop "$2" ;;
  upgrade)
    [[ $# == 3 && "$3" =~ ^[A-Za-z0-9][A-Za-z0-9._:/@-]*$ ]] || die 'Usage: webui.sh upgrade <environment-id> <image>'
    docker image inspect "$3" >/dev/null 2>&1 || docker pull "$3"
    compose exec -T web-gateway node /opt/moss/cloud/cli.mjs upgrade "$2" "$3"
    ;;
  *) die 'Usage: webui.sh list | stop <environment-id> | upgrade <environment-id> <image>' ;;
esac
