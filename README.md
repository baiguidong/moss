# Moss - Claude Code Electron UI

Moss 是一个基于 Electron 的桌面客户端，它直接嵌入了 Anthropic 的 Claude Code Agent 逻辑，提供了可视化的聊天界面、工作区浏览以及生成式 Mini App 的运行环境。

## 文档

- [部署总览](deploy/README.md)
- [Moss Server API](server/API.md)
- [Moss Server Docker Compose 部署](deploy/server/README.md)
- [Agent Channel 与独立 IM App 改造计划](docs/agent-channel-app-migration-plan.md)
- [飞书 App 配置与完整权限清单](https://github.com/baiguidong/moss-apps/tree/main/apps/feishu)

服务端源码位于独立的 `server/` package，远程客户端位于
`src/remote/`，共享连接协议位于 `packages/direct-connect-protocol/`。

## Server Docker Compose 部署

目标机需要 Linux x86_64、Docker Engine、Docker Compose v2、`curl`、`jq`
和 `openssl`。Server、Nginx HTTPS 代理和 session runtime 均通过 Docker
运行。部署脚本、配置和持久化数据统一安装到 `/data/moss-server`：

```bash
cd deploy/server
sudo env \
  MOSS_PUBLIC_HOST=10.0.1.181 \
  MOSS_REGISTRY_USERNAME='<github-user>' \
  MOSS_REGISTRY_TOKEN='<read-packages-token>' \
  ./install.sh
```

默认持久化目录为 `/data/moss-server`，HTTPS 端口为 `443`。首次运行生成
匹配内网 IP 的自签证书；客户端需要信任 `/data/moss-server/tls/server.crt`。详细配置见
[部署文档](deploy/server/README.md)。

更新镜像时执行 `sudo /data/moss-server/upgrade.sh latest`；指定版本可将
`latest` 换成发布标签（例如 `1.2.3`）。

## 飞书 Adapter

Moss Desktop 可以配置企业自建应用机器人连接飞书手机端，并选择让 Adapter 运行在本机或长期在线的 Moss Server。飞书只作为个人私聊的文本入口：首次消息创建一条专用 Moss 会话，之后始终复用它，不会绑定或切换到普通桌面会话；Agent 完成后返回普通消息。

### 必须配置的权限

在飞书开发者后台只开通以下 3 项权限：

| 权限名称 | Scope | 用途 |
| --- | --- | --- |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收飞书私聊消息 |
| 以应用的身份发消息 | `im:message:send_as_bot` | 回复用户 |
| 获取与发送单聊、群组消息 | `im:message` | 使用消息发送接口 |

长连接只订阅 `im.message.receive_v1`，不需要资源权限、卡片权限、卡片回调、机器人菜单、群聊、通讯录、审批或日历权限。

权限、事件、回调和菜单修改后，需要创建并发布新的飞书应用版本，并确保应用可用范围包含目标用户。个人飞书账号如果没有企业自建应用或权限发布能力，需要由所在组织的飞书管理员完成授权。

飞书业务配置统一放在 `Apps -> 飞书 -> 打开`；App 管理页只保留启停、刷新、重启和日志。只有 `App ID` 和 `App Secret` 是长连接必填项，已保存密钥以掩码展示。`Encrypt Key`、`Verification Token` 和公网回调地址不用于当前长连接模式；允许的用户 ID 可留空并通过一次性配对码绑定手机端用户。保存后应看到“飞书长连接已就绪”，再生成配对码并在飞书私聊机器人发送该配对码。

`执行权限` 页只配置工具确认方式以及 Tool、Skill、Connector 白名单。飞书不提供会话查看、创建、切换、停止、卡片回复、手机端审批、人工接管或草稿审核。Server 托管时，需要交互确认的工具操作直接拒绝，不会向手机发送审批卡片。

### 配置与功能验收

- [ ] 企业自建应用已添加机器人能力，3 项 Scope 均已开通。
- [ ] 事件配置使用长连接，并只包含 `im.message.receive_v1`。
- [ ] 未配置机器人菜单或卡片回调。
- [ ] 已发布新版本，应用可用范围包含验收用户。
- [ ] Moss 显示“飞书长连接已就绪”，手机端已通过配对码完成配对。
- [ ] 连续消息进入同一个固定会话并收到普通文本回复。
- [ ] 手机端不存在查看、新建、切换、停止会话或审批操作。
- [ ] 重启 Moss 后 Adapter 自动重连，并恢复配对关系和固定会话映射。

详细配置步骤、权限用途、降级行为和飞书官方文档链接见独立仓库中的[飞书 App README](https://github.com/baiguidong/moss-apps/tree/main/apps/feishu)。

## App 市场与预装

官方 App 清单由 `https://baiguidong.github.io/moss-apps/v1/index.json` 提供，App ZIP 由
`baiguidong/moss-apps` 的 GitHub Releases 托管。桌面端可在“Apps → 应用市场”中查看详情、
安装、更新或选择历史版本；所有下载都会校验锁定的发布者签名与 SHA-256。

发布安装包中的预装 App 由 [`config/bundled-apps.lock.json`](config/bundled-apps.lock.json) 只记录 App ID 和固定版本。
CI 在打包 Moss 时从 `moss-apps` 发布索引解析该版本的 Release ZIP、SHA-256 和签名信息，下载并验证后打入安装包；不会在主仓库内编译 App 源码，也不会自动追随市场最新版。本地从源码执行 `dev` 或 `start` 时不会下载或自动安装这些 App，可像普通 App 一样从应用市场安装。

## 快速启动

### 1. 编译依赖 (重要)

由于程序采用了嵌入式架构，启动前需要先编译 Agent 的核心逻辑：

```bash
# 在仓库根目录执行，生成 electron-direct.mjs 和相关依赖
bun install
bun install --cwd admin
bun run build:node
```

只构建服务端与 Admin UI：

```bash
bun run --cwd server build
```

该命令会将 Agent 的核心逻辑打包成 Electron 可直接加载的模块。

### 2. 启动 UI

```bash
# 进入 ui 目录
cd ui

# 安装 UI 依赖 (仅首次需要)
bun install

# 启动程序 (会自动执行 vite build 并运行 electron)
bun run start
```

## 开发与部署

### 1. 构建核心 Agent 逻辑

```bash
# 生成 electron-direct.mjs 和相关依赖
bun run build:node
```

### 2. 应用打包 (EXE/DMG)

确保已执行上述二进制准备步骤，然后进入 `ui` 目录执行打包命令：

```bash
cd ui

# 打包 Windows x64 (exe)
bun run dist:win

# 打包 macOS Apple Silicon / arm64 (dmg + zip)
bun run dist:mac
```

生成的安装包将位于 `ui/dist/installers` 目录下。
打包命令会下载并校验内置 Node、Python（Windows 还包括 PortableGit），
并在生成安装包后实际运行 Node、Python、Sharp 和 ripgrep，检查连接器目录与
其他必需资源。当前桌面安装包不执行 macOS/Windows 代码签名或 macOS 公证。

### 3. Docker Runtime 镜像

服务端使用 Docker session runtime 镜像。镜像只提供 Ubuntu/Node/工具链环境；实际 Agent 入口由 Server 镜像复制到持久化目录，再只读挂载到会话容器中执行：

```bash
node $MOSS_SERVER_HOME/container-app/bin/moss-session-runner.mjs --stdio <manifest>
```

先准备 server runtime 产物：

```bash
bun run server:prepare
```

本地 Apple Silicon / Linux arm64 测试构建：

```bash
bun run docker:build-runtime -- --tag moss-runtime:latest --platform linux/arm64 --load
```

多平台发布镜像：

```bash
bun run docker:build-runtime -- \
  --tag your-registry/moss-runtime:latest \
  --platform linux/arm64,linux/amd64 \
  --push
```

默认基础镜像是 `public.ecr.aws/ubuntu/ubuntu:24.04`。如需切换镜像源：

```bash
bun run docker:build-runtime -- \
  --tag moss-runtime:latest \
  --platform linux/arm64 \
  --base-image ubuntu:24.04 \
  --load
```

Compose 部署只需修改 `/data/moss-server/.env` 中的 `MOSS_RUNTIME_IMAGE`；每次启动会把它同步到 `/data/moss-server/settings.json` 的派生字段 `serverRuntime.dockerImage`。新建 session 时，Server 读取该字段作为 Docker 运行时镜像：

```json
{
  "serverRuntime": {
    "dockerImage": "moss-runtime:latest"
  }
}
```

`$MOSS_SERVER_HOME/server.json` 只保留 server 启动、存储、session 数量上限、
Docker network/label/stop timeout 等基础配置。

服务端只支持 Docker 会话运行时。所有服务端 session 都使用
`var/lib/profiles/users/<userId>` 下的用户级 Memory；
同一用户的会话共享 Memory，但 workspace、transcript 和运行状态仍按 session
隔离。Docker 模式只挂载当前 session 目录和该用户的共享 profile 目录；显式传入
的外部 `cwd` 会作为工作目录单独挂载。

基础验证：

```bash
docker run --rm moss-runtime:latest node --version
docker run --rm moss-runtime:latest rg --version
docker run --rm moss-runtime:latest node -e "const sharp=require('sharp'); console.log(sharp.versions.sharp, sharp.versions.vips)"
docker run --rm --user 501:20 -e HOME=/tmp/moss-home moss-runtime:latest whoami
```

## 核心功能

- **可视化 Agent 对话**：直接连接本地 Agent，支持流式输出和思考过程展示。
- **工作区管理**：右侧面板实时展示当前工作区文件树，支持文件预览和变更监听。
- **Mini App 生成**：支持通过自然语言描述生成单文件 HTML 应用，并提供 Host API 访问宿主能力。
- **工作区隔离**：每个新会话创建独立工作区目录，不自动初始化 Git 仓库。
- **Server 内置窗口认证**：客户端通过隔离的 Moss 认证窗口、Authorization Code + PKCE 和本地回环 callback 登录 Moss Server，取得只展示一次的永久 API Key；不依赖系统浏览器，Server 默认可用且无需外部 OAuth 配置，客户端支持取消认证并使用加密凭据存储。

## 配置文件

桌面端配置存储在 `~/.moss/settings.json`，服务端配置存储在 `$MOSS_SERVER_HOME/settings.json`（Compose 默认是 `/data/moss-server/settings.json`）。模型配置统一写在 `models.text` 和 `models.image` 下；运行时需要传给模型进程时，再由程序注入 `MOSS_MODEL_BASE_URL` / `MOSS_MODEL_AUTH_TOKEN`。

### 配置示例

```json
{
  "bypassPermissions": true,
  "models": {
    "text": {
      "baseUrl": "https://model.example.com",
      "apiKey": "your-model-api-key",
      "model": "gpt-5.5",
      "maxTurns": 100,
      "thinking": {
        "mode": "disabled",
        "budgetTokens": 128000
      }
    },
    "image": {
      "provider": "openai",
      "baseUrl": "https://image.example.com",
      "apiKey": "your-image-api-key",
      "model": "gpt-image-2"
    }
  }
}
```

### 参数说明

- **models.text.model**: 指定文本模型名称。
- **models.text.baseUrl / models.text.apiKey**: 文本模型 API 地址和 key。
- **models.text.maxTurns**: 单次会话的最大轮数。
- **models.text.thinking**: 思考模式和 Token 预算。
- **models.image**: 图片模型 provider、API 地址、key 和模型名称。
- **bypassPermissions**: 是否跳过工具执行的权限确认（建议仅在受控环境下开启）。
- **env**: 仅保留非模型运行环境变量；模型 API 地址和 key 不再写在这里。

UI 的设置页面会以增量方式更新此文件，不会删除你手动添加的自定义 Key。

### 多实例数据隔离

Desktop 默认使用 `~/.moss`。为不同进程设置不同的 `MOSS_HOME`，可以在同一台机器上同时运行多个 Desktop：

```bash
# macOS
MOSS_HOME="$HOME/.moss-work" /Applications/Moss.app/Contents/MacOS/Moss &
MOSS_HOME="$HOME/.moss-test" /Applications/Moss.app/Contents/MacOS/Moss &
```

```powershell
# Windows PowerShell
$exe = "<Moss.exe 路径>"
$env:MOSS_HOME = "$HOME\.moss-work"
Start-Process $exe
$env:MOSS_HOME = "$HOME\.moss-test"
Start-Process $exe
Remove-Item Env:MOSS_HOME
```

`MOSS_HOME` 会同时隔离设置、会话、项目、内存、Skill、连接器、App 数据、凭据、日志、缓存及 Electron 浏览器数据。不同目录使用独立的单实例锁；同一目录仍只允许运行一个 Desktop，避免并发写入同一份数据。
