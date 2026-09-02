ARG BASE_IMAGE=public.ecr.aws/ubuntu/ubuntu:24.04
FROM ${BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=22.23.1
ARG SHARP_VERSION=0.34.5
ARG TARGETARCH

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    SHELL=/bin/bash \
    TERM=xterm-256color \
    USE_BUILTIN_RIPGREP=0 \
    NODE_PATH=/opt/moss-runtime/node_modules

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    file \
    git \
    jq \
    less \
    libnss-wrapper \
    libseccomp2 \
    locales \
    make \
    netcat-openbsd \
    openssh-client \
    pkg-config \
    procps \
    python3 \
    python3-pip \
    ripgrep \
    rsync \
    socat \
    sudo \
    tini \
    unzip \
    xz-utils \
    zip \
  && locale-gen C.UTF-8 \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
  case "$arch" in \
    amd64) node_arch="x64" ;; \
    arm64) node_arch="arm64" ;; \
    *) echo "Unsupported TARGETARCH: $arch" >&2; exit 1 ;; \
  esac; \
  node_dist="node-v${NODE_VERSION}-linux-${node_arch}"; \
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${node_dist}.tar.xz"; \
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
  grep "  ${node_dist}.tar.xz\$" SHASUMS256.txt | sha256sum -c -; \
  mkdir -p /opt/node; \
  tar -xJf "${node_dist}.tar.xz" -C /opt/node --strip-components=1; \
  rm "${node_dist}.tar.xz" SHASUMS256.txt; \
  ln -sf /opt/node/bin/node /usr/local/bin/node; \
  ln -sf /opt/node/bin/npm /usr/local/bin/npm; \
  ln -sf /opt/node/bin/npx /usr/local/bin/npx; \
  node --version; \
  npm --version

RUN set -eux; \
  npm install --prefix /opt/moss-runtime --omit=dev --include=optional "sharp@${SHARP_VERSION}"; \
  npm cache clean --force

COPY docker/runtime/entrypoint.sh /usr/local/bin/moss-runtime-entrypoint
RUN chmod +x /usr/local/bin/moss-runtime-entrypoint

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/moss-runtime-entrypoint"]
CMD ["bash"]
