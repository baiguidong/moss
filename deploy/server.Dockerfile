# --- 第一阶段：构建 (Build) ---
FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun run build:node

# --- 第二阶段：运行 (Runtime) ---
FROM node:20-slim AS runner

# 安装 Docker CLI (以便 Moss Server 能够控制宿主机的 Docker)
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb-release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# 下载 Nexus cluster 二进制（自包含 Python 打包产物）
ARG NEXUS_VERSION=0.9.43
RUN mkdir -p /root/.moss/nexus/bin \
    && ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then NEXUS_ARCH="x64"; elif [ "$ARCH" = "arm64" ]; then NEXUS_ARCH="arm64"; else NEXUS_ARCH="$ARCH"; fi \
    && curl -fSL -o /tmp/nexus.zip "https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com/v${NEXUS_VERSION}/nexus-cluster-linux-${NEXUS_ARCH}.zip" \
    && unzip -o /tmp/nexus.zip -d /tmp/nexus-extracted \
    && mv /tmp/nexus-extracted/nexusd /root/.moss/nexus/bin/nexusd \
    && chmod +x /root/.moss/nexus/bin/nexusd \
    && echo "${NEXUS_VERSION}" > /root/.moss/nexus/bin/.nexus-bin-ready \
    && rm -rf /tmp/nexus.zip /tmp/nexus-extracted

WORKDIR /app

# 从构建阶段复制必要的文件和编译产物
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/src ./src
COPY --from=builder /app/admin/dist ./admin/dist

# 暴露端口（仅 Moss Server，Nexus 12012 仅限容器内部访问）
EXPOSE 43127

# 使用标准的 node 启动编译后的文件
CMD ["node", "bin/moss-server.mjs", "start"]
