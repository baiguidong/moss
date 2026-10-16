#!/bin/sh
set -eu
mkdir -p "$MOSS_HOME"
unset ELECTRON_RUN_AS_NODE
# Container isolation is provided by the runtime. No graphical desktop or Xvfb.
exec /opt/moss/ui/node_modules/electron/dist/electron --no-sandbox --ozone-platform=headless --disable-gpu /opt/moss/ui
