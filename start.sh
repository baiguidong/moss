#!/bin/bash

# ---------------------------------------------------------
# Moss 部署与启动脚本
# 功能:
# 1. 自动加载 Docker 镜像
# 2. 检查并按需安装指定的 Node.js 版本
# 3. 启动后台服务并记录日志
# ---------------------------------------------------------

# 基础路径配置
BASE_DIR=$(pwd)
LOG_DIR="$BASE_DIR/logs"
LOG_FILE="$LOG_DIR/moss-server.log"
NODE_PACKAGE="node-v24.15.0-linux-x64.tar.xz"
DOCKER_IMAGE_PACKAGE="my-moss-runtime.tar.gz"
MIN_NODE_MAJOR=20

# 设置 Moss 环境变量
export MOSS_SERVER_CONFIG="$BASE_DIR/server.json"

mkdir -p "$LOG_DIR"

echo "=== Moss 部署启动流程开始 ==="

# 1. 加载 Docker 镜像
if [ -f "$DOCKER_IMAGE_PACKAGE" ]; then
    IMAGE_NAME="my-moss-runtime:v1"
    if docker image inspect "$IMAGE_NAME" &> /dev/null; then
        echo "[1/3] 镜像 $IMAGE_NAME 已存在，跳过加载。"
    else
        echo "[1/3] 检测到 Docker 镜像包，正在加载..."
        docker load -i "$DOCKER_IMAGE_PACKAGE"
        echo "镜像加载完成。"
    fi
else
    echo "[1/3] 警告: 未发现 $DOCKER_IMAGE_PACKAGE，跳过镜像加载。"
fi

# 2. 检查 Node.js 环境
echo "[2/3] 检查 Node.js 环境..."

INSTALL_LOCAL_NODE=false
# 先检查自带 Node 是否已安装
if [ -f "$BASE_DIR/deps/node/bin/node" ]; then
    echo "自带 Node.js 已安装，跳过检查系统版本。"
    NODE_BIN="$BASE_DIR/deps/node/bin/node"
else
    if ! command -v node &> /dev/null; then
        echo "系统未安装 Node.js，准备使用自带安装包。"
        INSTALL_LOCAL_NODE=true
    else
        # 检查版本
        CURRENT_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_VERSION" -lt "$MIN_NODE_MAJOR" ]; then
            echo "系统 Node 版本过低 ($CURRENT_VERSION)，要求 v$MIN_NODE_MAJOR+，准备使用自带安装包。"
            INSTALL_LOCAL_NODE=true
        else
            echo "系统 Node 版本符合要求: $(node -v)"
            NODE_BIN=$(command -v node)
        fi
    fi
fi

if [ "$INSTALL_LOCAL_NODE" = true ]; then
    if [ -f "$NODE_PACKAGE" ]; then
        echo "正在部署自带 Node.js v24.15.0..."
        mkdir -p "$BASE_DIR/deps/node"
        # 解压时使用 --strip-components=1 保持目录结构简洁
        tar -xJf "$NODE_PACKAGE" -C "$BASE_DIR/deps/node" --strip-components=1
        NODE_BIN="$BASE_DIR/deps/node/bin/node"
        echo "自带 Node.js 部署完成。"
    else
        echo "错误: 系统 Node 不满足要求，且未发现安装包 $NODE_PACKAGE"
        exit 1
    fi
fi

# 将自带 Node 路径加入环境变量，确保子进程也能用到正确的 Node
export PATH="$BASE_DIR/deps/node/bin:$PATH"

# 再次验证当前进程看到的 node
echo "当前环境使用的 Node: $(node -v)"

# 3. 启动 Moss Server
echo "[3/3] 正在启动 Moss Server..."

if [ ! -f "bin/moss-server.mjs" ]; then
    echo "错误: 找不到 bin/moss-server.mjs，请确认运行路径。"
    exit 1
fi

# 检查是否已在运行
if pgrep -f "moss-server.mjs" > /dev/null; then
    echo "警告: Moss Server 已经在运行中，正在尝试重新启动..."
    pkill -f "moss-server.mjs"
    sleep 2
fi

nohup "$NODE_BIN" bin/moss-server.mjs > "$LOG_FILE" 2>&1 &

PID=$!
echo "-----------------------------------------------"
echo "Moss Server 启动成功！"
echo "PID: $PID"
echo "Node 路径: $NODE_BIN"
echo "配置文件: $MOSS_SERVER_CONFIG"
echo "日志输出: tail -f $LOG_FILE"
echo "-----------------------------------------------"
