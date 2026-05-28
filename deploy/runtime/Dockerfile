# ---------------------------------------------------------
# 使用 Ubuntu 24.04 以支持最新的 GLIBC 2.39
# docker build -t my-moss-runtime:v1 -f deploy/runtime/Dockerfile .
# 可通过 --build-arg 指定 scode 版本:
# docker build -t my-moss-runtime:v1 --build-arg SCODE_VERSION=v0.1.9 -f deploy/runtime/Dockerfile .
# ---------------------------------------------------------

# Stage 1: build the Document Center wiki CLI (Go, no deps)
FROM golang:1.22-alpine AS wiki-builder
WORKDIR /src
COPY ./cli/wiki/go.mod ./
# go.sum intentionally absent — wiki CLI has zero external deps
COPY ./cli/wiki/*.go ./
COPY ./cli/wiki/client/*.go ./client/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/wiki .

# Stage 1b: build the Corp App (企业应用) CLI (Go, no deps)
FROM golang:1.22-alpine AS corpapp-builder
WORKDIR /src
COPY ./cli/corpapp/go.mod ./
# go.sum intentionally absent — corpapp CLI has zero external deps
COPY ./cli/corpapp/*.go ./
COPY ./cli/corpapp/client/*.go ./client/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/corpapp .

# Stage 2: runtime image
FROM ubuntu:24.04

# 设置非交互模式（防止安装过程弹出时区选择）
ENV DEBIAN_FRONTEND=noninteractive

# 1. 安装基础依赖和常用工具
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    git \
    python3 \
    bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. 安装 Node.js 20 (如果 scode 本身或其插件需要 Node 环境)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 从 GitHub 下载 scode 引擎并赋予执行权限
# 通过构建参数指定版本，默认为 v0.1.8
# 根据 TARGETARCH 自动选择对应架构的二进制文件
ARG SCODE_VERSION=v0.1.9
ARG TARGETARCH
RUN ARCH=$(echo ${TARGETARCH} | sed 's/amd64/x64/' | sed 's/arm64/arm64/') && \
    curl -fsSL https://github.com/sudoprivacy/sudocode/releases/download/${SCODE_VERSION}/scode-linux-${ARCH}.tar.gz | tar -xz -C /tmp && \
    mv /tmp/scode-linux-${ARCH}/scode /usr/local/bin/scode && \
    rm -rf /tmp/scode-linux-${ARCH} && \
    chmod +x /usr/local/bin/scode

# 4. 设置别名或链接，确保直接输入 scode 就能运行
RUN ln -s /usr/local/bin/scode /usr/bin/scode

# 5. Document Center wiki CLI (built in stage 1)
COPY --from=wiki-builder /out/wiki /usr/local/bin/wiki
RUN chmod +x /usr/local/bin/wiki

# 5b. Corp App (企业应用) CLI (built in stage 1b)
COPY --from=corpapp-builder /out/corpapp /usr/local/bin/corpapp
RUN chmod +x /usr/local/bin/corpapp

# 6. 设置工作目录（Moss 创建会话容器时通常会挂载这里）
WORKDIR /workspace

# 默认命令（仅用于测试）
CMD ["scode", "--help"]