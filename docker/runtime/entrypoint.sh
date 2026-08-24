#!/usr/bin/env bash
set -euo pipefail

uid="$(id -u)"
gid="$(id -g)"
home_dir="${HOME:-/tmp}"

if ! getent passwd "${uid}" >/dev/null 2>&1; then
  passwd_file="/tmp/passwd.nss-wrapper"
  group_file="/tmp/group.nss-wrapper"
  cp /etc/passwd "${passwd_file}"
  cp /etc/group "${group_file}"

  if ! getent group "${gid}" >/dev/null 2>&1; then
    echo "moss-runtime:x:${gid}:" >> "${group_file}"
  fi
  echo "moss-runtime:x:${uid}:${gid}:Moss Runtime:${home_dir}:/bin/bash" >> "${passwd_file}"

  nss_wrapper="$(find /usr/lib -name libnss_wrapper.so -print -quit)"
  if [[ -n "${nss_wrapper}" ]]; then
    export NSS_WRAPPER_PASSWD="${passwd_file}"
    export NSS_WRAPPER_GROUP="${group_file}"
    export LD_PRELOAD="${nss_wrapper}${LD_PRELOAD:+:${LD_PRELOAD}}"
  fi
fi

mkdir -p "${home_dir}" 2>/dev/null || true
exec "$@"
