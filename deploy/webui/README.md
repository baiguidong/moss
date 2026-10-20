# Moss 单用户 WebUI

同一份 React 界面通过 IPC 服务 Desktop，通过 HTTP/WebSocket 服务浏览器。Web 镜像运行完整的 Moss Host，Agent 和工具在容器内使用本地模式执行。Moss Server 可作为认证中心；本次不新增或删减 Server 的会话能力。

本目录提供独立单用户部署；同一镜像也提供统一云电脑门户，通过 [Server 部署](../server/README.md) 为每个账号自动创建并长期保留一个容器。系统盘灾难恢复与跨节点调度另行安排。

正式版优先使用 GitHub Release 的 `install-moss-server.sh`。它固定 Server、
WebUI 和 runtime 到同一个版本并默认启动云电脑门户。登录页提供同版本 Mac 和
Windows 桌面安装包的下载链接。下面的独立构建用于单独测试 WebUI；它不会生成
配套的 runtime 镜像。

## GitHub CLI 构建与发布（Linux AMD64）

正式构建运行在 GitHub 的 Linux AMD64 runner。本机只需要 GitHub CLI，不需要 Docker、Node 或 Bun。

```sh
gh workflow run build-release.yml --ref main \
  -f publish=true
gh run list --workflow build-release.yml --limit 5
gh run watch <run-id> --exit-status
gh run download <run-id> --dir artifacts
```

每次构建使用新的版本号。省略 `version` 时自动生成唯一预发布版本。`publish=false` 仅生成离线包，不推送 GHCR。工作流不启动部署主机上的服务。

产物包含：

- `ghcr.io/baiguidong/moss-webui:<version>`：经过浏览器测试的 Linux AMD64 镜像。
- `moss-webui-<version>-linux-amd64.tar.gz` 和 SHA256：内含镜像、Compose、配置示例、管理脚本及镜像元数据的离线包。
- `moss-server-compose-<version>.tar.gz` 和 SHA256：支持可选 WebUI 的 Server 一键部署包；其中 WebUI 镜像固定到本次版本。
- 验证截图与报告：登录、文件、工具执行、断线恢复、权限确认、终端、同容器重启。

`release.yml` 的正式版本发布也会调用此构建流程，将 WebUI 包加入完整 Release。独立构建仅发布指定版本；正式稳定版发布才更新 `latest`。Server 与 runtime 的现有构建和会话功能保持原有职责。

## 随 Moss Server 一键部署

解压上面的 Server Compose 包，在 Linux AMD64 主机执行：

```sh
cd moss-server
sudo env MOSS_PUBLIC_HOST=你的服务器IP MOSS_WEB_ENABLED=1 MOSS_WEB_DEPLOY_MODE=cloud bash install.sh
```

Server 管理界面仍为 `https://服务器IP/admin/`；WebUI 为 `https://服务器IP:8444/`。cloud 模式复用 Server 账号认证，每名用户首次登录创建专属 Linux 容器，后续回到同一容器，项目和聊天不会创建新电脑。

使用 `./webui.sh list` 查看环境，`./webui.sh stop <environment-id>` 停止空闲环境，`./webui.sh upgrade <environment-id> <image>` 在保留原容器与 apt 安装的前提下更新 Moss 程序。统一入口的网关持有 Docker socket，个人容器没有该权限。原固定用户部署继续使用 `MOSS_WEB_DEPLOY_MODE=single` 和 `MOSS_WEB_OWNER_ID`；不会自动迁移或删除其容器。

可用 `MOSS_WEB_HTTPS_PORT`、`MOSS_WEB_ORIGIN` 和 `MOSS_WEB_IMAGE` 覆盖 WebUI 端口、外部 origin 和镜像。私有 GHCR 镜像使用 Server 原有的 registry 登录配置，详见 [Server 部署说明](../server/README.md)。默认关闭 WebUI，保持已有 Server 部署行为。

## 独立离线部署

目标 Linux 主机需要 Docker 和 Compose v2；运行时不需要源码、Node 或 Bun：

```sh
sha256sum -c moss-webui-<version>-linux-amd64.tar.gz.sha256
tar -xzf moss-webui-<version>-linux-amd64.tar.gz
cd moss-webui
# 如需远程访问，先复制 .env.example 为 .env 并配置访问 origin/反向代理。
./manage.sh install
./manage.sh token
```

默认打开 `http://localhost:43128`，使用访问密钥登录。`manage.sh` 支持 `load`、`start`、`stop`、`status`、`logs`、`token`。`install` 会校验文件、导入镜像并启动服务；保留已有 `.env` 和运行容器。

首次生成的 `.env` 固定 Compose 项目名称，后续部署目录改变时仍使用同一个 HOME 卷。接入已有部署时必须保持原项目名称，避免创建一个看似空白的新卷。

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

`docker compose stop/start` 保留原容器的系统写层，apt 安装可继续使用。**删除/重建容器只挂回 `/home/moss`，不能恢复 apt 写入的系统目录。** 日常使用保留同一个容器；cloud 模式支持在原容器更新程序。独立 single 模式的管理脚本不自动替换容器，完整系统备份/恢复仍属后续工作。`docker compose down -v` 会删除用户卷。

## 当前能力边界

已接入聊天、项目/会话、工具运行、问答/权限确认、文件读写与上传下载、通用文件预览、浏览器终端和状态重连。Desktop 使用相同客户端方法与业务处理器。

Electron 原生 App 窗口、嵌入 webview、桌面自动更新、原生电脑操控及依赖本机弹窗的安装流程尚未提供 Web 适配。后端明确拒绝这些网络调用，保留 Desktop 的原有实现。现有远程连接代码也继续保留，本阶段的浏览器验收集中在本地执行。

## 开发与 CI 内部入口

以下源码命令供 Linux 构建机/CI 使用；日常发布优先使用上面的 `gh` 命令。

```sh
node scripts/docker-webui.mjs build --platform linux/amd64 --tag moss-webui:local
node scripts/docker-webui.mjs package --skip-build --platform linux/amd64 --tag moss-webui:local
node --test scripts/docker-webui.test.mjs
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


## 环境快照与独立运行

新安装由 `compose.managed.yaml` 启动一个控制器，再为固定本地所有者创建长期保留的云电脑容器。不需要 Server，`./manage.sh token` 显示访问密钥；密钥与控制器身份分别保存，轮换密钥不会创建新环境。不要删除 `moss-controller` 卷或其中的 installation ID。

设置中的“环境快照”和 `/?window=cloud-environment` 管理页提供创建、列表、删除和恢复。管理页在用户 Host 停止或损坏时仍可使用。每次创建默认**不勾选数据卷**：仅系统恢复保留当前 HOME；带数据卷恢复使用一个新 HOME 卷，旧资源保留 24 小时。自动保护与本次恢复范围相同，计入总额度。默认 5 个 / 20 GiB；Server 管理员可以集中设置，缺少配置或读取失败使用共用默认值。

恢复后自动任务暂停，旧标签页需要刷新，恢复前浏览器草稿可以手动复制文字。仅环境恢复要求快照与当前环境的实际 Moss 程序一致，否则拒绝对当前数据做未经确认的迁移。快照不包含运行中进程内存、外部服务或浏览器数据；自行运行的数据库应先正常停止。

快照归档存放在控制器独立的 `moss-snapshots` 卷，用户 Host 不挂载 Docker socket。普通非 Docker Web Host 仍可独立运行，但不提供环境快照。

旧版单容器部署继续使用 `compose.yaml`，`manage.sh start` 不会替换原容器。需要接管时，先把原容器中的 Moss 程序升级到支持快照的版本并完成当前工作；为控制器配置一个空闲端口和对应 origin，然后运行：

```sh
MOSS_WEB_MANAGED=1 ./manage.sh adopt <原容器完整ID>
```

接管保留原容器写层、HOME 卷和容器 ID，更新启动配置后重启，并建立明确的所有者记录。不要先登录新控制器创建空白环境；已有所有者环境时接管会拒绝覆盖。接管后使用新控制器地址访问；原容器旧端口由部署管理员关闭外部访问。非标准挂载、其他控制器管理的容器、旧程序不支持快照等情况会拒绝接管。
