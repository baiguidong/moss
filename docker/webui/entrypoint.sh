#!/bin/sh
set -eu
mkdir -p "$MOSS_HOME"
unset ELECTRON_RUN_AS_NODE
# Keep the container controllable if a program release fails to boot. The stable
# supervisor belongs to the runtime compatibility contract, not the Moss release.
child=
trap 'trap - TERM INT; if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; exit 0' TERM INT
while :; do
  cd /opt/moss/ui
  /opt/moss/ui/node_modules/electron/dist/electron --no-sandbox --ozone-platform=headless --disable-gpu /opt/moss/ui &
  child=$!
  wait "$child" || true
  child=
  sleep 2 &
  child=$!
  wait "$child" || true
  child=
done
