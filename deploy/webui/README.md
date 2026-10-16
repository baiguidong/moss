# Moss 单用户 WebUI

同一份 React 界面通过 IPC 服务 Desktop，通过 HTTP/WebSocket 服务浏览器。Web 镜像运行完整的 Moss Host，Agent 和工具在容器内使用本地模式执行。Moss Server 可作为认证中心；本次不新增或删减 Server 的会话能力。

本版本覆盖统一接口与单用户浏览器闭环。一份部署对应一名用户；用户环境自动创建、系统盘快照恢复、跨节点调度属于后续阶段。

## 构建与运行

在仓库根目录执行：

```sh
bun run docker:build-webui
docker compose -f deploy/webui/compose.yaml up -d --wait
docker compose -f deploy/webui/compose.yaml exec webui cat /home/moss/.moss/web/access-token
```

打开 `http://localhost:43128`，使用上一条命令读取的访问密钥登录。密钥初次启动自动生成并保存在用户卷中，不输出到服务日志。默认仅监听部署主机的回环地址。

Dockerfile 从源码构建 UI、Agent 和 Linux 原生依赖，不依赖开发机上的 macOS/Windows 构建产物。基础镜像可通过 `NODE_IMAGE` 切换，例如 Docker Hub 无法访问时使用镜像源：

```sh
docker build -f docker/webui/Dockerfile \
  --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22.22.0-bookworm-slim \
  -t moss-webui:local .
```

镜像为构建平台的 CPU 架构；amd64/arm64 需要分别构建验证。导出离线部署包：

```sh
docker save -o moss-webui.tar moss-webui:local
# 目标机器
docker load -i moss-webui.tar
docker compose -f deploy/webui/compose.yaml up -d --wait
```

压缩为 `.tar.gz` 的镜像包同样可以直接用 `docker load -i 包文件.tar.gz` 导入。

## 使用 Moss Server 认证

配置以下部署环境变量，再启动 Compose：

```sh
export MOSS_WEB_AUTH_SERVER=https://moss-auth.example.com
export MOSS_WEB_OWNER_ID=实际用户ID
export MOSS_WEB_OWNER_ORG_ID=实际组织ID
export MOSS_WEB_ORIGIN=https://moss.example.com
docker compose -f deploy/webui/compose.yaml up -d --wait
```

登录页面使用账号密码。Host 只调用认证中心已有的 `/api/v1/auth/login` 和 `/api/v1/auth/me`，校验固定所有者后建立 HttpOnly Cookie 会话。上游令牌只保存在 Host 内存，定期复核；退出会关闭该登录会话的 WebSocket。认证中心不可用时，不自动降级为匿名访问。

`MOSS_WEB_OWNER_ID` 在认证中心模式必填，防止任意有效账号进入同一个实例。没有配置认证中心时，使用单用户访问密钥。访问密钥具有此环境的完整操作权限。

通过 HTTPS 反向代理发布时，必须将 `MOSS_WEB_ORIGIN` 设置为浏览器实际访问的完整 origin，并转发 WebSocket Upgrade。它用于验证 HTTP 写请求和 WebSocket 的来源；例如 `localhost` 和 `127.0.0.1` 是不同的 origin。反向代理在主机运行时可以继续使用默认回环绑定。

## 运行与数据

| 项目 | 行为 |
| --- | --- |
| 端口 | 43128；`/healthz` 在 Host 就绪后返回 200 |
| 数据 | `/home/moss` 独立数据卷；`MOSS_HOME=/home/moss/.moss` |
| 用户 | 非 root 的 moss 用户；该单用户环境内可以使用 sudo 安装工具 |
| Node/Python | 镜像提供；通过 `MOSS_WEB_NODE_PATH`、`MOSS_WEB_PYTHON_PATH` 接入受管运行时接口 |
| 图形环境 | 不创建 Moss 桌面窗口，不启动 Linux 桌面或 Xvfb；保留 Electron 二进制必需的动态库 |
| 请求 | 固定方法清单、协议版本、请求 ID 与持久化执行结果；断线重发同一请求不会再次执行 |
| 事件 | 有界事件缓存及重连快照；恢复会话和待确认请求 |
| 终端 | 浏览器新标签页，共用 PTY 启动逻辑；关闭标签页保留 shell，输入 `exit` 结束 |
| 上传 | HTTP 流，单文件上限 100 MB；上传后得到 Host 内路径 |
| 下载 | 认证 HTTP 接口，支持 Range；用户 HTML 强制附件下载，页面内 HTML 预览使用隔离 iframe |

Electron 使用容器内无窗口模式，容器入口使用 `--no-sandbox`；部署不需要 privileged、宿主机 Docker socket 或图形设备。用户运行的命令属于该专属环境，不能把它当作多人共享的进程内沙箱。

浏览器断线不停止任务。Host/容器停止会中断进程；重启后会话和文件继续存在，未能确认完成的请求会报告结果待核对，不会自动重放外部副作用。

`docker compose stop/start` 保留原容器的系统写层，apt 安装可继续使用。**删除/重建容器只挂回 `/home/moss`，不能恢复 apt 写入的系统目录。** 本阶段镜像不代替后续持久化系统盘方案；升级或重建前需要自行保存系统环境。`docker compose down -v` 会删除用户卷。

## 当前能力边界

已接入聊天、项目/会话、工具运行、问答/权限确认、文件读写与上传下载、通用文件预览、浏览器终端和状态重连。Desktop 使用相同客户端方法与业务处理器。

Electron 原生 App 窗口、嵌入 webview、桌面自动更新、原生电脑操控及依赖本机弹窗的安装流程尚未提供 Web 适配。后端明确拒绝这些网络调用，保留 Desktop 的原有实现。现有远程连接代码也继续保留，本阶段的浏览器验收集中在本地执行。

## 本地开发与验证

```sh
cd ui
bun run build:web
MOSS_HOME=/绝对路径/独立测试目录 bun run start:web
bun run test:web
```

`start:web` 未指定目录时使用 `~/.moss-web`，与日常 Desktop profile 分开。Linux 可指定上面的 Node/Python 路径；其他平台可使用现有受管运行时。

浏览器集成验证使用本地模型桩，覆盖登录、文件、断网去重、待确认请求跨刷新恢复与 PTY。需安装 Playwright 及 Chrome，在**独立测试 Host**上运行：

```sh
MOSS_WEB_TEST_TOKEN_FILE=/绝对路径/测试目录/web/access-token \
  node ui/scripts/test-web-smoke.mjs
```

脚本可通过 `PLAYWRIGHT_MODULE` 指定已安装的 Playwright 模块路径，通过 `MOSS_WEB_TEST_URL` 指定 Host 地址。验证容器时，将 `MOSS_WEB_TEST_MODEL_HOST` 设置为容器可访问测试机的地址，例如 Docker Desktop 的 `host.docker.internal`。脚本在该测试环境创建会话，临时替换模型设置并在结束后恢复；默认截图输出到 `output/webui-validation`。
