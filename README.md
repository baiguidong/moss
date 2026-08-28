# Moss - Claude Code Electron UI

Moss 是一个基于 Electron 的桌面客户端，它直接嵌入了 Anthropic 的 Claude Code Agent 逻辑，提供了可视化的聊天界面、工作区浏览以及生成式 Mini App 的运行环境。

## 文档

- [Moss Server API](server/API.md)
- [飞书 Adapter 配置与完整权限清单](adapters/README.md)

服务端源码位于独立的 `server/` package，远程客户端位于
`src/remote/`，共享连接协议位于 `packages/direct-connect-protocol/`。

## 飞书 Adapter

Moss Desktop 可以通过企业自建应用机器人连接飞书手机端。当前支持私聊、新建或切换 Moss 会话、消息中心主动推送、手机端允许或拒绝待确认操作，以及 CardKit 流式回复。

### 必须配置的权限

在飞书开发者后台开通以下完整权限集：

| 权限名称 | Scope | 用途 |
| --- | --- | --- |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收飞书私聊消息 |
| 以应用的身份发消息 | `im:message:send_as_bot` | 回复和主动推送消息 |
| 获取与发送单聊、群组消息 | `im:message` | 回复、更新消息和交互卡片 |
| 获取与上传图片或文件资源 | `im:resource` | 发送 Agent 输出图片和处理消息资源 |
| 创建和更新卡片 | `cardkit:card:write` | CardKit 流式创建、写入和收尾 |

同时使用长连接订阅事件 `im.message.receive_v1`、`application.bot.menu_v6`，并订阅卡片回调 `card.action.trigger`。注意：`card.action.trigger` 不在“事件配置”中，需要切换到 `开发配置 -> 事件与回调 -> 回调配置`，搜索中文名称“卡片回传交互”；不要选择旧版 `card.action.trigger_v1`。Moss 只处理私聊，不需要群聊、通讯录、审批或日历权限。

权限、事件、回调和菜单修改后，需要创建并发布新的飞书应用版本，并确保应用可用范围包含目标用户。个人飞书账号如果没有企业自建应用或权限发布能力，需要由所在组织的飞书管理员完成授权。

手机端菜单使用以下“推送事件”事件键：

| 菜单 | 事件键 |
| --- | --- |
| 会话中心 | `moss.sessions` |
| 新建会话 | `moss.new_session` |
| 停止执行 | `moss.stop` |

飞书最多配置 3 个机器人自定义菜单。“当前会话”已经显示在会话中心卡片顶部，不再单独占用菜单项；Adapter 仍兼容 `moss.current` 事件键。菜单入口位于 `应用能力 -> 机器人 -> 机器人配置 -> 机器人自定义菜单`，不在权限管理页面。看不到该入口时，先添加机器人能力，并检查应用类型及当前账号的开发者权限。

Moss 客户端的 `设置 -> IM 接入 -> 飞书` 中只有 `App ID` 和 `App Secret` 是长连接必填项。`Encrypt Key`、`Verification Token` 和公网回调地址不用于当前长连接模式；允许的用户 ID 可留空并通过一次性配对码绑定手机端用户。保存后应看到“飞书长连接已就绪”，再生成配对码并在飞书私聊机器人发送该配对码。

### 配置与功能验收

- [ ] 企业自建应用已添加机器人能力，5 项 Scope 均已开通。
- [ ] 事件配置使用长连接，并包含 `im.message.receive_v1`、`application.bot.menu_v6`。
- [ ] 回调配置使用长连接，并包含新版 `card.action.trigger`。
- [ ] 三个菜单事件键为 `moss.sessions`、`moss.new_session`、`moss.stop`。
- [ ] 已发布新版本，应用可用范围包含验收用户。
- [ ] Moss 显示“飞书长连接已就绪”，手机端已通过配对码完成配对。
- [ ] 发送或点击“会话中心”能看到当前会话、分类、搜索和分页，不显示会话 ID。
- [ ] 点击“新建会话”后，桌面端出现归类到“飞书”的新会话。
- [ ] 点击已有会话后，后续消息进入选中的会话，而不是固定会话。
- [ ] 工具执行期间手机端卡片显示会话名称和执行状态，不出现空白框。
- [ ] “停止执行”能停止当前会话，不影响其他会话。
- [ ] 消息中心通知能主动推送到飞书且不重复。
- [ ] 手机端“允许一次 / 拒绝”只处理对应会话的对应请求，并同步更新桌面端和飞书卡片。
- [ ] 重启 Moss 后 Adapter 自动重连，配对关系、当前会话绑定和待推送重试仍然有效。

详细配置步骤、权限用途、降级行为和飞书官方文档链接见[飞书 Adapter README](adapters/README.md)。

## 快速启动

### 1. 编译依赖 (重要)

由于程序采用了嵌入式架构，启动前需要先编译 Agent 的核心逻辑：

```bash
# 在仓库根目录执行，生成 electron-direct.mjs 和相关依赖
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

# 打包 Windows (exe)
bun run dist:win

# 打包 macOS (dmg)
bun run dist:mac

# 打包所有平台
bun run dist:all
```

生成的安装包将位于 `ui/dist/installers` 目录下。

### 3. Docker Runtime 镜像

服务端 Docker 模式使用 session runtime 镜像。镜像只提供 Ubuntu/Node/工具链环境；实际 Agent 入口由 server 挂载并执行：

```bash
node $MOSS_SERVER_HOME/bin/moss-session-runner.mjs --stdio <manifest>
```

先准备 server runtime 产物：

```bash
bun run server:prepare
```

本地 Apple Silicon / Linux arm64 测试构建：

```bash
bun run docker:build-runtime -- --tag moss-runtime:0.1.8 --platform linux/arm64 --load
```

多平台发布镜像：

```bash
bun run docker:build-runtime -- \
  --tag your-registry/moss-runtime:0.1.8 \
  --platform linux/arm64,linux/amd64 \
  --push
```

默认基础镜像是 `public.ecr.aws/ubuntu/ubuntu:24.04`。如需切换镜像源：

```bash
bun run docker:build-runtime -- \
  --tag moss-runtime:0.1.8 \
  --platform linux/arm64 \
  --base-image ubuntu:24.04 \
  --load
```

配置 `~/.moss/server/settings.json`。新建 session 时，server 会读取这里的
`serverRuntime` 来决定使用 host 还是 Docker 后端：

```json
{
  "serverRuntime": {
    "backend": "docker",
    "dockerImage": "moss-runtime:0.1.8",
    "defaultProfileMode": "session",
    "allowedProfileModes": ["session", "user"]
  }
}
```

`~/.moss/server/server.json` 只保留 server 启动、存储、session 数量上限、
Docker network/label/stop timeout 等基础配置。

Docker 模式不会挂载整个 `~/.moss/server`。挂载边界按 profile mode 区分：
`session` 只挂当前 `var/lib/sessions/<sessionId>`；`user` 挂同一用户的所有
session 目录，并额外挂该用户共享的 profile/workspace 目录。显式传入的外部
`cwd` 会作为工作目录单独挂载。

基础验证：

```bash
docker run --rm moss-runtime:0.1.8 node --version
docker run --rm moss-runtime:0.1.8 rg --version
docker run --rm moss-runtime:0.1.8 node -e "const sharp=require('sharp'); console.log(sharp.versions.sharp, sharp.versions.vips)"
docker run --rm --user 501:20 -e HOME=/tmp/moss-home moss-runtime:0.1.8 whoami
```

## 核心功能

- **可视化 Agent 对话**：直接连接本地 Agent，支持流式输出和思考过程展示。
- **工作区管理**：右侧面板实时展示当前工作区文件树，支持文件预览和变更监听。
- **Mini App 生成**：支持通过自然语言描述生成单文件 HTML 应用，并提供 Host API 访问宿主能力。
- **工作区隔离**：每个新会话创建独立工作区目录，不自动初始化 Git 仓库。
- **Server OAuth 登录**：支持 Authorization Code + PKCE，通过一次性交换返回只展示一次的永久 API Key；数据库仅保存 Key 哈希并支持撤销和登录轮换。

## 配置文件

桌面端配置存储在 `~/.moss/settings.json`，服务端配置存储在 `~/.moss/server/settings.json`。模型配置统一写在 `models.text` 和 `models.image` 下；运行时需要传给模型进程时，再由程序注入 `MOSS_MODEL_BASE_URL` / `MOSS_MODEL_AUTH_TOKEN`。

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
