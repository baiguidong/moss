FROM node:22.14.0-slim
# 安装 Docker CLI + LibreOffice 依赖
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip \
    # LibreOffice 依赖
    libxinerama1 \
    libcairo2 \
    libcups2 \
    libxrandr2 \
    libxdamage1 \
    libxtst6 \
    libgtk-3-0 \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libice6 \
    libxrender1 \
    libfontconfig1 \
    libdbus-1-3 \
    libxi6 \
    # LibreOffice 26.2 需要 OpenSSL 3 和 NSS
    libssl3 \
    libnss3 \
    libnspr4 \
    # LibreOffice looks for libssl3.so, but Debian provides libssl.so.3
    && ln -sf /lib/x86_64-linux-gnu/libssl.so.3 /lib/x86_64-linux-gnu/libssl3.so \
    && ln -sf /lib/x86_64-linux-gnu/libcrypto.so.3 /lib/x86_64-linux-gnu/libcrypto3.so \
    && rm -rf /var/lib/apt/lists/*

# 安装 Docker CLI (使用重试 + 国内镜像备用)
RUN for i in 1 2 3; do \
        if curl -fsSL --connect-timeout 30 https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg 2>/dev/null; then \
            echo "Downloaded Docker GPG key from official source"; \
            break; \
        elif curl -fsSL --connect-timeout 30 https://mirrors.aliyun.com/docker-ce/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg 2>/dev/null; then \
            echo "Downloaded Docker GPG key from Aliyun mirror"; \
            break; \
        else \
            echo "Retry $i: Failed to download Docker GPG key, waiting..."; \
            sleep 5; \
        fi; \
    done \
    && if [ ! -f /usr/share/keyrings/docker-archive-keyring.gpg ]; then \
        echo "ERROR: Failed to download Docker GPG key from all sources"; \
        exit 1; \
    fi \
    && DISTRO_CODENAME=$(/usr/bin/lsb_release -cs) \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian ${DISTRO_CODENAME} stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# 下载 scode
# 安装 LibreOffice 和 PDF 工具 (直接从 apt 安装，确保依赖完整)
RUN apt-get update \
    && apt-get install -y libreoffice-writer libreoffice-core poppler-utils fonts-noto-cjk --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV LIBREOFFICE_BIN=/usr/bin/soffice


WORKDIR /app

# 复制本地构建产物
COPY bin/scode bin/
COPY bin/wiki bin/
COPY bin/moss-server.mjs ./bin/
COPY bin/direct-connect-session-runner.mjs ./bin/
COPY admin/dist/ ./admin/dist/
COPY assistants/ ./assistants/

# 复制 wiki (从 Go 构建阶段)
RUN chmod +x ./bin/wiki
RUN chmod +x ./bin/scode


EXPOSE 43127

CMD ["node", "bin/moss-server.mjs", "start"]