# Unified App Runtime

Moss 只有一种可安装扩展：App。App 可以只有 UI、只有 Backend，或同时包含两者。Backend 是可选的独立 Node 子进程，不等于 HTTP Server，也不默认监听端口。

## 用户安装与管理

所有用户操作都在客户端 `Apps` 页面完成，不提供 Moss App CLI：

1. 点击“安装 App”，选择 `.zip` App 包。
2. Moss 在执行任何代码前检查 Manifest V2、路径、文件数量、大小和全部校验和。
3. App 安装后默认停用且不授权；有 Backend 的 App 还需要分别打开 App 总开关和实例开关。
4. 多实例 App 可在 UI 中创建多个实例，分别配置非敏感字段和密钥。
5. UI 中可查看状态和日志、重启实例、切换版本、回滚及卸载。
6. 卸载默认只删除包和运行记录；数据与密钥必须分别确认后才删除。

Backend-only App 没有“打开”按钮，但所有配置和运行操作仍可在 App Center 完成。UI-only App 使用 App 开关控制导航等 contribution，但不会创建后台进程。

## App 包

安装包是包含下列内容的 ZIP。ZIP 可以直接以 App 根目录为根，也可以额外包含一层目录。

```text
example-app/
├── app.moss.json
├── checksums.json
├── app-signature.json        # 可选 Ed25519 签名
├── assets/
├── schemas/
└── dist/
    ├── ui/index.html
    └── backend/main.mjs
```

`checksums.json` 必须覆盖包内除自身和 `app-signature.json` 以外的每个文件。安装包不能包含软链接、绝对路径、路径穿越或运行期安装脚本。Backend 应优先编译为独立 JavaScript；无法内联的原生模块及其最小运行时依赖可以随产物放入 `dist/backend/node_modules`。不得复制完整开发依赖树，且所有运行依赖都必须在构建阶段准备完成，安装时不执行包管理器。

最小 Manifest V2：

```json
{
  "schemaVersion": 2,
  "id": "example.app",
  "version": "1.0.0",
  "displayName": "Example",
  "hostApi": "^2.1.0",
  "ui": { "entry": "dist/ui/index.html" },
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "instanceMode": "multiple",
    "targets": ["desktop"],
    "actions": [{ "name": "message.send" }],
    "configuration": {
      "schema": "schemas/config.schema.json",
      "secrets": "schemas/secrets.schema.json"
    }
  },
  "permissions": []
}
```

`lifecycle` 为 `on-demand` 时，第一个 Action 启动共享进程，无待处理 Action 后按空闲超时退出。`persistent` 在 App 和实例开关都启用时常驻。`instanceMode: single` 使用默认实例；`multiple` 每个已启用实例拥有独立进程、配置、密钥、数据和日志。

`backend.targets` 声明同一个 Backend 支持的候选部署位置，不声明多个进程角色。一个 App instance 在任意时刻只能有一个 active deployment：位于 Desktop 或 Server。`["desktop", "server"]` 表示该实例可以在两者之间迁移，不表示两端同时运行，也不表示 Desktop Backend 可以依赖另一个 Server Backend。

App 必须按实际支持范围显式选择 `targets: ["desktop"]`、`["server"]` 或 `["desktop", "server"]`。只声明 `desktop` 的 Backend 只有 Moss Desktop 正在运行时才可用；只有声明 `server` 的 Backend 才能部署到 Moss Server 并 7×24 运行。Server 支持不是默认要求，大多数普通 App 应只声明 `desktop`。Backend 可以根据 `context.target.type` 使用明显不同的实现和功能，但每种已声明模式都必须能独立运行，不能依赖另一 target 的 Backend 同时在线。迁移必须先停止源 deployment，再复制配置和密钥、递增 generation，最后启动并健康检查目标 deployment。

Target 与其他 App 属性没有隐含对应关系：有 UI 不代表 Backend 必须包含 `desktop`，App 可以使用 Desktop UI 搭配 Server-only Backend；有 Backend、`persistent` 生命周期、网络访问或未来扩展设想也不代表应包含 `server`。`["desktop", "server"]` 不是前后端拆分、双进程、主备、同步或故障转移声明。需求没有明确要求离开 Desktop 后继续运行时，应选择 `["desktop"]`。

`backend.protocols` 按 target 声明当前模式会使用的 Host 协议。推荐格式是 `{ "desktop": [...], "server": [...] }`，且只能包含 `backend.targets` 已声明的 key。Account、Agent 等协议可按实际需要出现在任一 target；Desktop 专属协议只能出现在 `desktop`。旧数组格式暂时兼容现有 App，并视为对所有 target 使用同一组协议，新 App 不应再使用。

App 管理界面仅在 `targets` 包含 `server` 且 Server 包源存在相同版本时提供 Server 部署或迁移入口。UI 与 Backend placement 相互独立：UI 可以在 Desktop 打开，而 Backend 只部署在 Server。App UI 调用逻辑 instance，由 Host 解析其 active deployment；App UI 不应自行连接 Server，也不应要求调用者了解 Backend 的物理位置。

Server Backend 默认使用 `user` owner。需要为整个组织共享一份实例、配置和 Secret 时，声明 `backend.serverOwnerScope: "org"`。org App 只能由管理员部署和管理，但组织成员可以在拥有 `apps:invoke` 时调用；Runtime 会分别记录 installation owner 和当前调用 principal，使 Account Host 返回调用用户身份而不是管理员身份。

## 独立 App Repository

推荐的最终 App repo 结构：

```text
example-app/
├── app.moss.json
├── package.json
├── src/
│   ├── ui/
│   └── backend/
├── schemas/
│   ├── config.schema.json
│   ├── secrets.schema.json
│   └── actions/
├── assets/
├── tests/
└── dist/
```

App repo 的运行时代码只依赖 `@moss/app-sdk`，不能导入 `ui/`、`server/`、Session 或 Connector 内部源码。Backend 通过 `defineAppBackend()` 注册 Manifest 已声明的 Action；UI 通过受 App ID 约束的 `window.mossApp.actions` 调用。SDK 的协议、Manifest schema 和测试辅助 API 位于根仓库 `packages/app-sdk`。

Host API 2 提供 `moss.account/v1`、`moss.agent/v1` 和 Desktop 专属能力。外部集成 App 使用通用 [Agent Host API](./agent-host-api.md) 创建 Turn 和接收结果，平台连接、消息格式、用户映射与 SDK 全部留在 App。`moss.remote/v1` 只作为现有实现的过渡兼容协议，不属于新的可迁移 Backend 模型。完整边界见 [Host Capability API](./app-host-capability-api.md)。

## Desktop 数据与进程

```text
~/.moss/apps/<app-id>/versions/<version>/
~/.moss/apps/<app-id>/current.json
~/.moss/apps-data/<app-id>/instances/<instance-id>/
~/.moss/apps-runtime/<app-id>/<instance-id>/
~/.moss/credentials/app-secrets.json
```

已安装版本不可变。配置状态与包分离，密钥只进入加密 Credential Vault。发布的 persistent Backend 由全局 Desktop App Runtime 持有，关闭 App 窗口不会停止它；退出 Moss 会有界停止所有归属进程。预览使用临时 runtime、临时目录和临时进程，关闭预览后不会恢复。

## Server 部署

Server 不接收客户端上传的任意可执行包。管理员在 `server.json` 中配置可信的已知包源：

```json
{
  "apps": {
    "sourceDir": "/srv/moss-app-releases"
  }
}
```

包源布局支持：

```text
/srv/moss-app-releases/<app-id>/versions/<version>/
/srv/moss-app-releases/<app-id>/<version>/
```

客户端 App Center 通过认证 API 按 App ID 和版本要求 Server 获取包，然后完成安装、启停、实例管理、日志和 Desktop/Server 移动。移动先在目标创建停用实例，再停止来源并启动目标；目标失败时恢复来源。Server 使用持久化 deployment generation 和租约，多个节点不能同时拥有同一 deployment。

管理所需 API scope 为 `apps:read`、`apps:manage`、`apps:deploy` 和 `apps:logs`；调用 Action 或 Host API 使用独立的 `apps:invoke`。管理员的 `*` scope 包含全部权限，也可将它们授予自定义角色。普通成员不能管理 org/host App，但可以查看和调用本组织的 org App；host scope 始终仅管理员可选。

## 安全边界

- Electron Main 和 Moss Server 不导入 Backend 模块，只通过版本化 IPC 协议管理子进程。
- Backend 只收到最小环境、当前实例的配置/密钥、数据目录和 runtime 目录。
- App UI 使用 context isolation，不能任意访问文件系统，也不能指定其他 App ID。
- Action 输入、输出、消息大小、超时和并发均受限；日志轮转并对密钥字段和值脱敏。
- 当前进程隔离不是操作系统沙箱。允许 Backend 的包必须来自第一方或显式可信来源。

## 故障处理

- `crash-loop`：修复配置或版本后在 UI 中手动重启；手动重启会清除当前崩溃计数。
- 激活失败：runtime 自动恢复上一健康版本，App Center 显示激活错误。
- Server 不可达：不会隐式在 Desktop 与 Server 同时启动副本。
- 包校验失败：目标版本不会出现在安装目录，已有版本不受影响。
- 密钥丢失：重新填写该实例的 secret 字段；日志和普通配置中不会保存明文副本。
