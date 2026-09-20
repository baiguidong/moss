ARG BASE_IMAGE=debian:bookworm-slim
FROM ${BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
ARG MOSS_VERSION=dev

LABEL org.opencontainers.image.title="Moss Server" \
      org.opencontainers.image.description="Moss Server container image" \
      org.opencontainers.image.version="$MOSS_VERSION"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    docker.io \
    tini \
  && rm -rf /var/lib/apt/lists/*

COPY dist/server-image/moss-server /opt/moss
COPY docker/server/entrypoint.sh /usr/local/bin/moss-server-entrypoint

RUN chmod +x /usr/local/bin/moss-server-entrypoint \
  && /opt/moss/node/bin/node --no-warnings -e "require('node:sqlite')"

ENV MOSS_IMAGE_VERSION="$MOSS_VERSION" \
    MOSS_SERVER_HOME=/var/lib/moss-server \
    MOSS_SERVER_ASSET_ROOT=/var/lib/moss-server/container-app \
    MOSS_HOME=/var/lib/moss-server \
    MOSS_CONFIG_DIR=/var/lib/moss-server \
    MOSS_SERVER_CONFIG=/var/lib/moss-server/server.json \
    MOSS_NODE_PATH=/opt/moss/node/bin/node \
    MOSS_HIDE_BOOTSTRAP_SECRETS=1 \
    NODE_ENV=production

WORKDIR /opt/moss/app
EXPOSE 43127

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/moss-server-entrypoint"]
