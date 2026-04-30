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
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb-release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从构建阶段复制必要的文件和编译产物
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/src ./src

# 暴露端口
EXPOSE 43127

# 使用标准的 node 启动编译后的文件
CMD ["node", "bin/moss-server.mjs", "start"]
