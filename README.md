# Moss - Claude Code Electron UI

Moss 是一个基于 Electron 的桌面客户端，它直接嵌入了 Anthropic 的 Claude Code Agent 逻辑，提供了可视化的聊天界面、工作区浏览以及生成式 Mini App 的运行环境。

## 文档

- [Moss Server API](server/API.md)

服务端源码位于独立的 `server/` package，远程客户端位于
`src/remote/`，共享连接协议位于 `packages/direct-connect-protocol/`。

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

## 核心功能

- **可视化 Agent 对话**：直接连接本地 Agent，支持流式输出和思考过程展示。
- **工作区管理**：右侧面板实时展示当前工作区文件树，支持文件预览和变更监听。
- **Mini App 生成**：支持通过自然语言描述生成单文件 HTML 应用，并提供 Host API 访问宿主能力。
- **工作区隔离**：每个新会话创建独立工作区目录，不自动初始化 Git 仓库。

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
