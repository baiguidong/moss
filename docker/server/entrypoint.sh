#!/bin/sh
set -eu
umask 077

server_home="${MOSS_SERVER_HOME:-/var/lib/moss-server}"
asset_root="${MOSS_SERVER_ASSET_ROOT:-$server_home/container-app}"

install -d -m 0700 \
  "$server_home" \
  "$server_home/var/lib" \
  "$server_home/var/run" \
  "$server_home/var/log"

# Session containers are siblings launched through the host Docker socket. Keep
# a current image-owned copy of the application inside the shared host mount,
# separate from persistent configuration and any legacy host installation.
staging="${asset_root}.container-new"
install -d -m 0700 "$(dirname -- "$asset_root")"
rm -rf "$staging"
cp -a /opt/moss/app "$staging"
rm -rf "$asset_root"
mv "$staging" "$asset_root"

for resource in skills assistants; do
  if [ -d "/opt/moss/app/resources/$resource" ]; then
    install -d -m 0700 "$server_home/$resource"
    cp -an "/opt/moss/app/resources/$resource/." "$server_home/$resource/"
  fi
done

exec /opt/moss/node/bin/node /opt/moss/app/bin/moss-server.mjs "$@"
