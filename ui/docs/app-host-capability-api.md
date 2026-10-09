# Moss App Host Capability API 2

Host Capability API 是 App Backend 使用 Moss 能力的唯一受支持入口。App 不应导入 Host、
Session 或数据库内部模块；它应在 Manifest 中声明版本化协议和权限，再通过 `@moss/app-sdk`
发起受控请求。

Host API 当前版本为 `3.0.0`，App 声明 `^3.0.0`；不兼容旧 UI 调用签名。Backend 进程协议仍为 App Service v1；
前者描述公开能力集合，后者描述 Node 子进程的传输 envelope。

## 内置协议

| 协议 | 职责 | 主要权限 |
| --- | --- | --- |
| `moss.account/v1` | 当前身份和组织通讯录 | `account:identity:read`、`account:directory:read` |
| `moss.agent/v1` | Agent 目录、Binding、Session、Turn 和投递确认 | `agent:*` 细分权限 |
| `moss.platform/v1` | 文件选择、私有缓存、截图、下载、外链和媒体授权 | `platform:*` |
| `moss.openim/v1` | 使用当前 Moss 身份访问 OpenIM integration | `openim:client` |
| `moss.tasks/v1` | 后台任务状态、进度与生命周期 | `tasks:read/write/cancel` |
| `moss.agent-execution/v1` | 有界的结构化 Agent 执行与结果读取 | `execution:read/run/cancel` |

Manifest 中的 `backend.protocols` 使用字符串数组。

## Manifest 与授权

```json
{
  "schemaVersion": 2,
  "id": "example.integration",
  "version": "1.0.0",
  "displayName": "Example Integration",
  "hostApi": "^2.1.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "protocols": ["moss.account/v1", "moss.agent/v1"],
    "actions": [{ "name": "status.get" }]
  },
  "permissions": [
    "account:identity:read",
    "agent:turns:read",
    "agent:turns:write"
  ]
}
```

`protocols` 和 `permissions` 是包声明，installation grants 是实际授权。每次请求和事件都必须同时通过：

1. App 和实例已启用，且进程 generation 有效。
2. Backend 声明了所用协议。
3. Manifest 请求了方法所需权限。
4. installation grants 实际授予了该权限。
5. App ID 和实例 ID 与运行进程一致。

撤销 grant 会停止并用新 generation 重启 Backend，旧进程不能继续使用已撤销能力。

## Backend 调用

```js
import { defineAppBackend } from '@moss/app-sdk'

const backend = defineAppBackend({
  'message.accept': async (input, context) => {
    const identity = await context.account.request('identity.current', {})
    const turn = await context.agent.request('turn.start', {
      externalUserId: input.senderId,
      externalConversationId: input.conversationId,
      externalEventId: input.messageId,
      text: input.text,
    })
    return { identity: identity.user?.id, turn }
  },
})

backend.agent.on('turn.completed', async (event) => {
  await deliverToPlatform(event)
  return { handled: true }
})
```

也可用 `context.host.request(protocol, method, input)` 调用 Manifest 已声明的自定义协议。Host 通过
`registerHostProtocol()` 注册 schema、权限和事件，再用 `registerHostHandler()` 提供实现。

## 客户端能力边界

`file.pick`、`file.materialize` 和 `file.thumbnail` 返回的文件路径只位于调用 App 的实例数据目录。
`file.download` 是用户确认的导出操作。摄像头和麦克风授权还要求 `platform:media` grant。

自 2.9 起，下载边读取边限制实际大小（100 MiB），成功后才将同目录临时文件替换到目标路径。网络失败、超限或提交前取消会清理临时文件并保留已有目标文件。Backend 请求的 signal 会传入下载网络请求；文件选择、缩略图和截图也在提交前检查取消。已经完成的导出或外链打开不会被取消撤回。

当前 App UI 直调 `host.request` 没有独立的取消入口；本次未新增这套 UI 协议。流式限额和文件提交规则对两条调用路径均生效。

## 传输保证

- Backend 必须是 Node 运行时；构建器可以使用 Bun，但产物目标必须为 Node。
- 消息校验 generation 与每次启动随机生成的 launch token。
- Backend IPC 的普通 JSON envelope 上限为 1 MiB；大文件走客户端文件能力或 App 私有存储。
- Backend 初始化期间可以调用 Host、写日志、上报状态和确认 Host 事件。
- Host 请求与事件有并发、超时、取消、重复 ID 和载荷指纹校验。
- 错误和日志在离开 Runtime 前进行 Secret 脱敏。

Agent 的方法、事件和幂等约束见 [Agent Host API](./agent-host-api.md)，安装与进程模型见
[App Runtime](./app-runtime.md)。

## 本地文件与受管运行时

Desktop 自 Host API 2.4 起还提供 `moss.mcp/v1`，供独立 MCP App 管理自己的服务、检查连接和发起授权。协议、权限与迁移规则见 [MCP App](./mcp-app.md)。

Desktop 额外注册两个通用协议，使用现有 `context.host.request` 调用，无需扩展会话/项目上下文。

| 协议 | 方法 | 输入 / 输出 | 安装权限 |
| --- | --- | --- | --- |
| `moss.runtimes/v1` | `python.get` | `{}` → `{ available, path, version }`；不可用时 path 为 null | 无 |
| `moss.local-files/v1` | `pick` | `{ kind?: 'file' \| 'directory', multiple?: boolean }` → `{ paths: string[] }`，取消为空数组 | `local-files:pick` |
| `moss.local-files/v1` | `open` / `reveal` | `{ path: 绝对路径 }` → `{ opened: true }` / `{ revealed: true }` | `local-files:open` |

`pick` 返回用户选择的原始路径，不复制大型目录。App 自己管理导入及副本；`open/reveal` 校验 realpath，只接受调用 App 实例数据目录内的普通文件，拒绝越界链接。
`python.get` 仅报告已有受管运行时，不下载运行时或安装 Python 包。各 App 随安装包准备自己的解析依赖。

资源引用由 App 的 `contributes.resourceProviders` 声明 scheme 和 `resolveAction`。Desktop 的 `openAppResource(uri)` 与显式附件解析均先查找唯一已启用的 provider，再校验其返回的 `{ kind: 'file', path }` 位于该 App 实例数据目录。业务 ID、revision 和文档导出由 App 处理，Core 不解析知识库或 Wiki 的资源 ID。

## Trace App（Host API 2.5）

`moss.trace/v1` 仅支持 `status({})`，要求 `trace:capture` 授权，返回 enabled、queuedBytes、droppedRecords 和 error。Core 写入应用实例数据目录，App 独立管理读取与索引。采集由已安装 App 及其默认实例的启用状态决定，无第二个采集开关，不支持任意输出目录或采集结果查询。参见 [Trace App 架构](../../docs/trace-migration-plan.md)。

## 审计 App（Host API 2.6）

`moss.audit/v1` 供 `moss.audit` 读取本地会话并接入桌面导航与通知：

| 方法 | 权限 | 契约 |
| --- | --- | --- |
| `source.capture` | `audit:read` | 空对象输入；Host 原子写入实例私有 `source/snapshot.json`，返回 `{schemaVersion:1,capturedAt,sessionCount}` |
| `session.open` | `audit:navigate` | `{sessionId,toolUseId?}`；只接受仍存在的本地会话 |
| `notification.publish` | `audit:notify` | `{id,severity,title,message,details?}`；按 App 固定来源及 ID 前缀幂等投递 |

会话正文在 Host 侧脱敏后写文件，避免超出 IPC 消息大小。Host 保留撤销前后事件文件写入，App 自己导入、索引和分析；不公开任意目录、数据库查询或规则执行接口。首次读取前通过 SQLite 在线备份复制旧审计数据库，保留原件。

停用、撤权、卸载先使在途导出与事件票据失效并等待写入结束。未安装或停用 App 不会阻止会话撤销。详见 [审计迁移记录](audit-app-migration.md)。

## Host API 3 调用约定

UI 用 `createAppClient(window.mossApp)` 绑定当前 App，普通 `actions.invoke(name, input, options)`、`host.request(protocol, method, input, options)` 不再接受 instanceId。SDK options 包含 `signal`、`timeoutMs`、`requestId`；preload 只传可序列化字段，取消通过单独 IPC 传递。Main 按窗口隔离 requestId，可信身份由 sender 解析。运行状态通过 `app.getStatus()` 查询。

两种 Host 入口共享请求容量、载荷上限、deadline 和生命周期取消；异步准备后以及 handler 派发前重新检查 App/实例/版本及当前授权。后台请求原有超时传入公共执行层。窗口销毁、App 停用、换版本及授权改变会取消相关请求；副作用 handler 仍须在异步提交前检查 signal / assertCurrent。

Tasks/Execution 与 MCP 的统一契约见 [生成文档](../../packages/host-contracts/README.md)。声明允许的调用端不会自动授予能力；Manifest 和 grants 校验继续执行。新增机制不代表业务调用会自动重试或恰好执行一次。
