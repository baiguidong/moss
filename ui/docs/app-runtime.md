# App Runtime

Moss 只有一种可安装扩展：App。App 可以只有 UI、只有 Backend，或同时包含两者。

Host API 3.9 增加配置型 MCP App：包内只保存声明和资源，`ui.builtin: "mcp"` 选择 Core 内置页面，`mcpApp.config` 指向 MCP 配置；Core 直接注册服务，无需额外基础 App 或 Backend。复用现有安装、授权、会话选择与启停机制。见 [Draw.io 验证及复现](mcp-configuration-app-proof.md)。

全局工具范围不共享 MCP 进程：连接由会话运行时代次持有，关闭或撤销时回收；配置型 App 可用 `mcpApp.runtime.state: "stateless"` 显式启用空闲回收，默认保留有状态服务。Core 限制总连接数和启动并发，并对只提供 tools 的服务缓存目录、延迟建立实际调用连接。外部文件和远端账号的数据隔离仍由工作区及服务端负责。

Desktop 默认会话运行时空闲 60 分钟后回收，最多保留 15 个，可安全重启的 MCP 服务空闲 60 分钟后断开。三项均可在“设置 → 高级设置 → Agent 与执行”修改并立即应用。达到会话数量上限时优先回收空闲最久且可恢复的运行时；正在执行、等待确认、后台任务和未声明可安全重启的 MCP 连接受到保护。聊天记录保留，下次发送自动从原 transcript 恢复；下次工具调用自动重连。远程直连仅回收本地连接，服务器资源由服务端管理。详见[生命周期验证](mcp-configuration-app-proof.md#会话运行时回收)。

## 安装与启用

1. 用户在 Apps 页面选择 `.zip` 包或从应用市场安装。
2. Moss 在执行任何代码前校验 Manifest V2、路径、文件数量、大小和校验和。
3. App 安装后默认启用。有 UI 的 App 自动进入“更多”，每个 App 只有一个导航入口；停用后入口隐藏，纯后台 App 只在 Apps 中管理。
4. 每个 App 只有一个由 Host 管理的 Backend；`persistent` Backend 会在配置就绪后启动。
5. 如果缺少必填配置或密钥，App 仍保持启用，Backend 等待用户补齐配置后自动运行。有设置页的 App 在自己的页面维护配置；其他 App 使用管理页的配置表单。
6. 管理页只保留 App 总开关、运行管理和日志。Host 沿用原有默认 Backend 标识与数据目录，已安装 App 的配置和密钥继续可用。

Skill 从市场或本地包安装后同样默认启用。

App 的 `backend.actions` 供页面调用；只有显式声明在 `contributes.tools` 中的能力才会加入 Moss
AI 助手的工具列表。安装或更新包含 AI 工具的 App 时，安装确认会列出工具名称、用途及操作类型，
即使 App 没有申请额外权限也会展示。Apps 管理页持续展示该列表，以及工具已注册、未授权或 App
已停用的状态。开发工具与 HTTP 调试 App 仅提供页面功能，不注册 AI 工具。

设置 → 工具也按 App 分组展示声明的 AI 工具，包括已停用或尚未授权的工具。此处仅展示，
不提供逐工具的常驻、按需或关闭选项。App 在 Manifest 根级声明 `toolScope: "session" | "global"`，默认 session；原生和 App MCP 工具全部继承。session App 仅在会话选中后提供工具，global App 未选中时按需提供；两者选中后全部可用工具在整个会话常驻。启停和授权仍由 App 管理控制。
工具加载与 Backend 进程生命周期相互独立。显式声明 `toolScope` 要求 Host API 至少 3.1.0；省略字段的旧 App 在新宿主也默认 session。完整创建、迭代和 MCP 继承规则见 [App 创建文档](app-authoring.md)。

导航位置统一由 Moss 决定，App 不声明 `contributes.views[].location`，也不提供手动加入侧栏功能。进入 App 时优先使用已授权 view 中 `order` 最小的页面路由；未声明 view 时打开 `ui.entry`。多个页面由 App 内部导航，旧包的位置字段会被忽略。

## App 包

App 的单一主分类由根级 `category` 声明，`keywords` 用于搜索。安装读取和版本切换使用该版本的 Manifest；缺字段的旧 App 显示“其他”。分类与展示顺序、创建及迁移规则见 [App 创建文档：分类与搜索](app-authoring.md#分类与搜索)。

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

`checksums.json` 必须覆盖包内除自身和 `app-signature.json` 以外的每个文件。安装包不能包含软链接、
绝对路径、路径穿越或运行期安装脚本。Backend 的运行依赖必须在构建阶段放入包内。

### 源码随版本安装与发布

后续所有新发布 App，以及 App Builder 创建或修改后每次本机安装的版本，都必须在包根/安装版本目录内携带完整、可重建源码：`source/` 保存工程，`source-manifest.json` 记录入口、版本、工具链、SDK 和文件摘要。源码包括实际构建需要的脚本、锁文件、资源、测试及本地依赖，不能只保存 `dist/`，也不能只引用会话工作区或构建缓存。

打包器、CI、Core 安装和应用构建已接入该格式。源码以安装版本目录为准；`project.prepare` 恢复完整 workspace 并返回 `path/sourceRoot/appRoot`，`build.start` 使用声明的精确 npm/Bun 版本、锁文件和包内 SDK，构建后检查独立 Backend 握手。完整格式见 [moss-apps 源码随包发布规范与实施计划](https://github.com/baiguidong/moss-apps/blob/main/docs/app-source-packaging.md)。

Core 必须将运行产物、源码与安装回执一致提交和恢复。删除原会话工作区、清理临时构建缓存、重启或开新会话后，仍能从 `.moss/apps/<app-id>/versions/<version>/` 恢复真实工程继续迭代。源码与对应安装版本一同保留，不能被临时作业清理删除。

市场包的源码与描述文件纳入完整 checksums 和发布者签名；Builder 本机安装无需先生成 ZIP 或市场签名，但必须纳入 checksums、artifactHash 和持久回执。单纯安装不运行源码脚本，后续依赖安装与构建沿用 Agent 执行权限检查。

已发布旧版本保持不可变且沿用原运行兼容规则；缺少有效源码时明确说明不能直接迭代，不能把重新编写的工程当作原源码恢复。未来给旧 App 补源码需发布新版本。

最小 Manifest V2：

```json
{
  "schemaVersion": 2,
  "id": "example.app",
  "version": "1.0.0",
  "displayName": "Example",
  "hostApi": "^3.0.0",
  "ui": {
    "entry": "dist/ui/index.html"
  },
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "actions": [
      {
        "name": "message.send"
      }
    ],
    "configuration": {
      "schema": "schemas/config.schema.json",
      "secrets": "schemas/secrets.schema.json"
    }
  },
  "permissions": [],
  "host": {
    "protocols": [
      "moss.platform/v1"
    ]
  }
}
```

`host.protocols` 是 App 的 UI 与 Backend 共用的 Host 协议字符串数组。Manifest 加载时只保留当前 Schema 定义的字段。

## 进程与数据

同一个 App 最多运行一个 Backend 进程。重复启动会复用现有进程；重启和升级必须先结束旧进程，再启动新进程。

`on-demand` Backend 在第一个 Action 时启动，无待处理 Action 后按空闲超时退出。`persistent` Backend
在 App 启用且配置有效时常驻，退出 Moss 时有界停止。关闭 App 窗口不会停止 Backend。

Backend 完成本地初始化后发送 `service.ready`，不等待互联网或远端服务连接。断网、服务端不可达和
连接重试属于业务连接状态，通过 `service.status` 上报，并在原进程内重连；不得因此退出 Backend。
`service.ping` / `service.pong` 只检查 Host 与本地 Backend 的 IPC 响应，不依赖远端请求成功。
Host 采样在休眠或长时间阻塞后恢复时，启动握手和心跳检查会给予新的响应窗口，再判断进程是否卡死。

Host 在 `apps-runtime/processes/` 持久化每个 App 的进程所有权：宿主 PID 与启动时间、子进程身份、
本次启动的唯一标识。启动器先等待 Host 保存子进程记录，再加载 App 代码。不同 Host 不能同时持有
同一 App 的所有权；仍有活跃宿主时拒绝重复启动。IPC 断开后允许 App 完成清理，并提供 5 秒退出兜底；
事件循环阻塞时由下次 Host 启动回收。

Host 启动时先恢复这些记录，包括已停用 App 的记录。确认旧宿主已退出后，按启动时间和唯一标识
识别遗留子进程，先发 `SIGTERM`，超时后发 `SIGKILL`，确认结束后才允许新进程访问 App 数据。
这一路径不依赖子进程处理 IPC，因此子进程阻塞时也能在下次 Host 启动时回收。损坏或无法验证的
记录会报告恢复错误并阻止相应 App 重复启动，不会仅凭旧 PID 杀进程。

强杀 Host 后的卡死进程由下一次 Host 启动负责恢复；这不是脱离 Host 常驻的看门狗。所有权记录只
覆盖采用此启动器创建的进程，升级前已遗留且未记录的旧进程仍需单独识别和清理。

```text
~/.moss/apps/<app-id>/versions/<version>/
~/.moss/apps/<app-id>/current.json
~/.moss/apps-data/<app-id>/instances/<instance-id>/
~/.moss/apps-runtime/<app-id>/<instance-id>/
~/.moss/credentials/app-secrets.json
```

已安装版本不可变。配置状态与包分离，密钥只进入加密 Credential Vault。版本升级后只读取新 Schema 声明的配置字段，其他字段不会进入 Backend；已声明字段仍按新 Schema 校验。

## 安全边界

- Electron Main 不直接导入 Backend 模块，而是通过版本化 IPC 协议管理子进程。
- Backend 只收到当前 App 的配置、密钥、数据目录和 runtime 目录。
- App UI 使用 context isolation，不能任意访问文件系统，也不能指定其他 App ID。
- Action 输入、输出、消息大小、超时和并发均受限；日志轮转并对密钥字段和值脱敏。
- Backend 进程不是操作系统级沙箱，只应运行第一方或用户明确信任的包。


### 按平台分发 App（Host API 3.3）

Manifest 可声明 `platforms`（如 `["win32-x64"]`），须将 `hostApi` 最低版本设为 3.3。平台列表纳入包校验与签名，安装和加载均以 Host 的 OS/CPU 核验。未声明的旧 App 维持原有兼容行为。

市场版本可以使用 `artifacts: { "darwin-arm64": { ... }, "win32-x64": { ... } }`。键必须与版本 `platforms` 完全一致，Host 不会回退到其他平台的包。目录中的旧 `artifact` 字段仅用于旧 Host 解析元数据；存在 `artifacts` 时新 Host 仅从平台映射选择。每个平台独立提供文件名、下载地址、大小、SHA-256 和签名标识。

## App 展示位置（Host API 3.4）

Manifest 根级 `navigation` 显式声明主入口：`{ "location": "more", "viewId": "home" }` 用于日常操作页，`{ "location": "settings", "viewId": "configuration" }` 用于配置页，`{ "location": "none" }` 用于纯后台或辅助 UI。位置引用 `contributes.views`，设置入口复用 `contributes.settings` 并选择 `group: "integrations" | "tools" | "apps"`。操作页与配置页须使用不同路由。显式位置或设置分组要求 Host API >=3.4.0；新建时必须按用途选择，旧安装包不改写。展示位置与 `category`、`toolScope`、生命周期独立。创建和迁移规则由 Core 的 `ui/docs/app-authoring.md` 维护。
