#!/bin/bash

# ---------------------------------------------------------
# Moss 服务关闭脚本
# 功能:
# 1. 检查 Moss Server 运行状态
# 2. 优雅关闭 Moss Server 进程
# 3. 清理相关资源
# ---------------------------------------------------------

# 基础路径配置
BASE_DIR=$(pwd)
LOG_DIR="$BASE_DIR/logs"
LOG_FILE="$LOG_DIR/moss-server.log"

echo "=== Moss 关闭流程开始 ==="

# 检查是否在运行
if ! pgrep -f "moss-server.mjs" > /dev/null; then
    echo "Moss Server 未在运行中。"
    exit 0
fi

# 获取进程信息
PIDS=$(pgrep -f "moss-server.mjs")
echo "发现 Moss Server 进程: $PIDS"

# 优雅关闭 - 先发送 SIGTERM
echo "正在发送 SIGTERM 信号..."
pkill -TERM -f "moss-server.mjs"

# 等待进程退出
WAIT_COUNT=0
MAX_WAIT=10

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if ! pgrep -f "moss-server.mjs" > /dev/null; then
        echo "Moss Server 已成功关闭。"
        echo "-----------------------------------------------"
        echo "关闭时间: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "日志文件: $LOG_FILE"
        echo "-----------------------------------------------"
        exit 0
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    echo "等待进程退出... ($WAIT_COUNT/$MAX_WAIT)"
done

# 如果进程还在，强制关闭
if pgrep -f "moss-server.mjs" > /dev/null; then
    echo "进程未响应 SIGTERM，正在强制关闭..."
    pkill -9 -f "moss-server.mjs"
    sleep 1

    if ! pgrep -f "moss-server.mjs" > /dev/null; then
        echo "Moss Server 已强制关闭。"
    else
        echo "错误: 无法关闭 Moss Server，请手动检查。"
        exit 1
    fi
fi

echo "-----------------------------------------------"
echo "关闭时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "日志文件: $LOG_FILE"
echo "-----------------------------------------------"
