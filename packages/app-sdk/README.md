# Moss App SDK

## App 页面与宿主头部

Moss 容器负责显示 App 名称、简介、迭代、AI 能力入口与整页刷新。嵌入页面只绘制业务内容，从输入、列表、状态或业务工具栏开始；不要再次绘制 App 名称、Logo、宣传简介或另一组整页管理按钮。SDK 是通信层，不会自动删除页面中的标题。

保留具体页面、对象和分区标题（例如“输入文件”“记忆图谱”、文档名），业务刷新要写明范围（例如“刷新项目”“重新连接”）。同一状态、任务数量和说明只在最相关的区域展示一次。无障碍名称用 `main[aria-label]` 或视觉隐藏的标题提供，不能用全局 CSS 隐藏所有 `h1/header`，也不能通过文字匹配自动删除 DOM。独立网页若需要品牌头部，应显式使用独立布局；不要用 `window.mossApp` 是否存在推断页面是否有外框。

创建与 Skill 转 App 都遵守这条规则。验收必须查看带 Moss 外框的页面，并检查窄窗口、加载、空状态和错误状态，确保应用身份仅显示一次、业务操作仍可见。此约定不增加 Manifest 字段或最低 Host API 版本。完整创建规则见 [App 页面布局](../../ui/docs/app-authoring.md#app-页面布局)。

空间利用与 Moss 风格同样是创建约定：主要输入、数据、编辑器和结果优先占据首屏；设置、帮助等次要操作并入现有工具栏或分区标题行，不能单独占一行。使用紧凑间距、可伸缩工作区和 Moss 语义颜色，保留可读字号与可访问操作。具体尺寸、主题接入、模板和验收要求见 SDK 随包文档 [布局与视觉约定](ui-layout.md)。

App 根级 `category` 声明单一主分类，`keywords` 提供搜索关键词。`@moss/app-sdk/categories` 导出可在浏览器使用的 `APP_CATEGORIES` 和 `getAppCategory(value)`，分类名称和顺序来自 Manifest Schema；缺失或未知展示值归入 `other`。Manifest 校验拒绝非法分类，兼容省略字段的旧包。字段约束与完整分类表见 [分类与搜索](../../ui/docs/app-authoring.md#分类与搜索)。

当前 SDK 对应 Host API `3.20.0`；App 按所需能力声明最低 Host 版本。不提供旧 UI 调用签名兼容层。

跨 App 只读能力和现有工具调用使用 Manifest `appCapabilities` 与 SDK `createAppCapabilitiesClient`。调用已有工具时，调用方用 `usesTools` 精确声明目标 App ID 和工具名；目标 App 无需更新。调用、授权与结果引用见 [跨 App 能力调用](../../ui/docs/app-capabilities.md)。

配置型 MCP App 声明 `ui: { builtin: "mcp" }` 和 `mcpApp: { config: "mcp.json" }`。Core 生成 Manifest、提供公共设置页并直接注册 MCP，无需额外基础 App、包内 UI 文件或 Backend。要求 Host API 3.9，格式和 Draw.io 实测见 [配置型 MCP App 验证](../../ui/docs/mcp-configuration-app-proof.md)。

`toolScope: "global"` 只控制会话可用范围，MCP 连接仍按会话运行时隔离并回收。配置型 App 默认保留服务状态到运行时关闭；只有可安全重启的服务才声明 `mcpApp.runtime: { state: "stateless" }`，启用空闲回收，默认 1 小时。App 可提供 `idleTimeoutMs` 建议值（1000–3600000 毫秒）；Desktop 统一采用用户在“设置 → 高级设置 → Agent 与执行”中的 MCP 回收时间（1–1440 分钟）。未声明可安全重启的服务不会被此设置强制重启，并阻止所属会话运行时自动回收。

App 根级 `toolScope` 为 `session`（默认）或 `global`。App 原生及 MCP 工具全部继承该设置；选择 App 后在整个会话常驻。未选择的 session App 不提供工具，global App 按需提供。显式声明此字段要求最低 Host API 3.1.0。创建/编辑规则和完整示例见 [App 创建文档](../../ui/docs/app-authoring.md)。

App 安装后自动启用。`host.protocols` 是 App 的 UI 与 Backend 共用的 Host 协议字符串数组，例如：

```json
{
  "host": { "protocols": ["moss.platform/v1", "moss.agent/v1"] }
}
```

`persistent` Backend 只在 Moss 客户端运行期间常驻；`on-demand` Backend 在首次 Action 调用时启动，
空闲后退出。每个 App 最多运行一个由 Host 管理的 Backend 进程，使用 App 总开关控制。
如果缺少必填配置或密钥，App 保持启用，Backend 等待配置完成后运行。

`contributes.tools[].inputSchema` 必须是合法 JSON Schema，根节点必须声明 `type: "object"`，
且不得声明顶层 `oneOf`、`anyOf`、`allOf`、`enum`、`const` 或 `not`。在 `properties` 中声明参数，
在 `required` 中声明必填字段；字段内部的枚举和嵌套约束保持原样。
跨字段业务规则在 Backend 中校验，并通过参数或工具的 `description` 告知模型。
SDK 的 `validateAppToolInputSchema(schema, fieldName?)` 检查此根节点契约；App 包安装和 Core 工具注册
使用相同检查，错误包含工具标识和违规关键字。Core 原样发送合法 schema，不删除或改写约束。
未贡献为工具的普通 Backend Action，以及输出 schema，不受这项工具输入限制。

公共云端存储协议为 `moss.cloud-storage/v1`。契约、状态、错误和接入示例见 [云端存储文档](../../docs/cloud-storage.md)。

Host API 2.3 的 `moss.cloud-storage/v1` 新增 `shares.create/list/revoke`，使用独立的 `cloud-storage:share` 权限；创建分享还需 Server 账号的读取权限。契约、分享码和浏览器入口见 [云端存储文档](../../docs/cloud-storage.md)。

Host API 3.7 新增 `moss.testing/v1`，仅供 `moss.self-test` Backend 使用，需要 `testing:control` 及 `agent:permissions:bypass`。Host 管理隔离目标、控制会话、取消与回收；测试清单、调度和结果由 App 管理。接口详见 [自测 App](../../ui/docs/self-test.md)。`moss.local-files/v1.preview` 使用 `local-files:open` 权限预览 App 私有目录内的 HTML，窗口无 Node 或 App 桥接能力。

## Host API 3

UI 使用浏览器可打包的 `@moss/app-sdk/ui`，Main 绑定当前 App 与默认实例。`window.mossApp` 是隔离桥接层；使用 SDK 处理跨 Electron 边界的结构化结果与错误：

```ts
import { createAppClient } from '@moss/app-sdk/ui'
const app = createAppClient(window.mossApp)
const controller = new AbortController()
const result = await app.actions.invoke('request.send', input, {
  signal: controller.signal, timeoutMs: 135000,
})
await app.host.request('moss.platform/v1', 'file.download', {
  url, fileName,
}, { signal: controller.signal, timeoutMs: 300000 })
// 组件/页面销毁时取消这个 client 的未完成调用。
app.dispose()
```

普通请求不传 `instanceId`。实例配置管理保留 `instances` API，运行状态使用 `app.getStatus()`。UI 与 Backend Host 调用共用权限复查、载荷限额、受限超时和取消机制；窗口关闭及 App 生命周期变化会取消所属 UI 请求。取消等待原请求结算，不自动重试有副作用的请求。

Tasks/Execution 与 MCP 的元数据、JSON Schema、权限、限额来自 [host-contracts](../host-contracts/README.md)，生成类型、校验器及文档。App Service v1、领域协议名称保持不变；Host API/SDK/Runtime 3.0 要求 App 重新构建。

Host API 3.16 提供通用 `moss.session-source/v1`。获 `session-source:read` 授权的 App 先调用 `session.list({})` 比对每个会话的 revision，仅对变化的会话调用 `session.export({sessionId})`，读取实例数据目录中的 `session-source/<fileName>`。定位会话需 `session-source:open`；发布通知使用 `moss.notifications/v1.publish` 与 `notifications:publish`。详见 [Host Capability API](../../ui/docs/app-host-capability-api.md)。

`@moss/app-sdk/execution` 提供 `createTasksClient(host)`、`createExecutionClient(host)`、`ExecutionWatcher` 和 `validateExecutionHostInput`。`ExecutionWatcher` 复用一次底层订阅，支持并发等待、序号过滤、初始查询、5 秒兜底及关闭清理。`@moss/app-sdk/mcp` 提供 `createMcpClient(host)` 和方法输入/结果类型。

所有 SDK 子路径的值导出类型与实际模块对应。验证：

```sh
node packages/host-contracts/scripts/generate.mjs --check
node packages/app-sdk/scripts/export-types.mjs --check
```

Host API 3 的 App 级协议声明、类型化 UI/Backend 请求、Host 事件订阅、能力发现、持久任务游标与公共结果读写，见 [收尾记录](../../docs/host-api-3-completion.md)。方法输入输出和限额以 [生成契约](../host-contracts/README.md) 为准。

## Native desktop adapters (Host API 3.2)

Trusted desktop-control Apps can declare `nativeAdapter` and tools with `execution: "native"`, `permission: "desktop:control"` and `toolScope: "session"`. These modules run in Electron main, require a trusted signature from a Host-approved native publisher, and are distinct from ordinary Node Backends. The package must export `createAdapter(context)`; use the exported `NativeDesktopAdapterContext` and `NativeDesktopAdapter` types. Factories must not start native processes before returning the adapter.

Tool descriptions can reference a checksummed `instructions` file (up to 64 KiB). UI settings use the UI-only `moss.host/v1` method `native.settings`; approval decisions are reserved for the trusted Host UI. Native tool results may use `{ format: "moss.tool-result/v1", content: [{ type: "text", text }, { type: "image", mimeType, data }], isError }`. The Host owns cancellation, target grants and the desktop lease. Updates to loaded native modules require restarting the Host.

## App 展示位置（Host API 3.4）

Manifest 根级 `navigation` 显式声明主入口：`{ "location": "more", "viewId": "home" }` 用于日常操作页，`{ "location": "settings", "viewId": "configuration" }` 用于配置页，`{ "location": "none" }` 用于纯后台或辅助 UI。位置引用 `contributes.views`，设置入口复用 `contributes.settings` 并选择 `group: "integrations" | "tools" | "apps"`。操作页与配置页须使用不同路由。显式位置或设置分组要求 Host API >=3.4.0；新建时必须按用途选择，旧安装包不改写。展示位置与 `category`、`toolScope`、生命周期独立。创建和迁移规则由 Core 的 `ui/docs/app-authoring.md` 维护。

App 内用户工具范围设置：UI 可通过 `moss.host/v1` 的 `tools.scope.get/set` 读取/保存 App 级 session/global 覆盖（null 恢复 Manifest 默认）；后台不可调用。Host 统一解析所有原生/MCP 工具的有效范围。

## App 子服务

Host API 3.8 支持根级 `toolSelection: "app" | "services"`（缺省 `app`）。`services` App 在 @ 和资源选择器中展开第二层；选择和搜索均按子服务生效，不会隐式选择父 App。

原生工具通过 `contributes.services: [{id, title, description?}]` 声明子服务，并在每个 `contributes.tools` 条目填写 `serviceId`。MCP 服务由 Host 根据 App、实例和持久化服务 ID 自动提供动态子项；不需要为每个服务修改 Manifest。两种来源可以共存。显式字段需要 `hostApi: "^3.8.0"` 和支持该字段的固定 SDK。

`toolScope` 仍由整个 App 控制：session 只提供已选子服务；global 保持按需发现，只有已选子服务常驻。子服务选择不改变权限或 Backend 生命周期。“全选”保存当前列表的快照；新增服务不自动被选择。MCP 改名保留 ID，删除重建产生新 ID。
