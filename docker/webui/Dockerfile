ARG NODE_IMAGE=node:22.22.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
ARG BUN_VERSION=1.3.10
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN set -eu; case "$(dpkg --print-architecture)" in amd64) bun_arch=x64;; arm64) bun_arch=aarch64;; *) exit 1;; esac; \
    curl -fL --retry 3 "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip" -o /tmp/bun.zip; \
    unzip /tmp/bun.zip -d /tmp; mv "/tmp/bun-linux-${bun_arch}/bun" /usr/local/bin/bun; rm /tmp/bun.zip
WORKDIR /opt/moss
COPY package.json bun.lock ./
COPY patches ./patches
COPY vendor ./vendor
COPY scripts ./scripts
RUN bun install --frozen-lockfile
COPY ui/package.json ui/bun.lock ./ui/
RUN cd ui && bun install --frozen-lockfile --ignore-scripts && node node_modules/electron/install.js
COPY src ./src
COPY shared ./shared
COPY packages ./packages
COPY tsconfig.json ./
COPY ui ./ui
RUN mkdir -p bin && cd ui && node scripts/build-direct.mjs && node scripts/build-renderer.mjs \
    && node node_modules/@electron/rebuild/lib/cli.js -f -w node-pty \
    && node scripts/prepare-web-image.mjs /opt/moss-release

FROM ${NODE_IMAGE}
ARG MOSS_VERSION=dev
LABEL org.opencontainers.image.title="Moss WebUI" \
      org.opencontainers.image.description="Single-user Moss Host with shared browser UI and local Linux execution" \
      org.opencontainers.image.version="$MOSS_VERSION"
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini bash ca-certificates curl git python3 python3-pip python3-venv ripgrep sudo \
    libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libdrm2 libx11-xcb1 libatk-bridge2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && usermod -l moss -d /home/moss -m node \
    && printf 'moss ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/moss \
    && chmod 0440 /etc/sudoers.d/moss
COPY --from=build /opt/moss-release /opt/moss
COPY docker/webui/entrypoint.sh /usr/local/bin/moss-web-entrypoint
RUN chmod +x /usr/local/bin/moss-web-entrypoint \
    && ELECTRON_RUN_AS_NODE=1 /opt/moss/ui/node_modules/electron/dist/electron --version
ENV MOSS_WEB_MODE=1 MOSS_WEB_HOST=0.0.0.0 MOSS_WEB_PORT=43128 \
    MOSS_HOME=/home/moss/.moss MOSS_CONFIG_DIR=/home/moss/.moss \
    MOSS_WEB_NODE_PATH=/usr/local/bin/node MOSS_WEB_PYTHON_PATH=/usr/bin/python3 \
    NODE_ENV=production LANG=C.UTF-8 SHELL=/bin/bash USE_BUILTIN_RIPGREP=0
USER moss
WORKDIR /opt/moss/ui
EXPOSE 43128
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl --fail --silent http://127.0.0.1:43128/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/moss-web-entrypoint"]
