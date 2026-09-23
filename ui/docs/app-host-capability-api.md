# Moss App Host Capability API 2

Host Capability API 是 App Backend 使用 Moss 能力的唯一受支持入口。App 不应导入 Desktop、Server、Session 或数据库内部模块；它应在 Manifest 中声明版本化协议和权限，再通过 `@moss/app-sdk` 发起受控请求。当前 Node Backend 进程不是操作系统沙箱，因此只应运行第一方或用户明确信任的 Backend 包；Host grants 约束 Moss 能力，不代表文件系统和网络隔离。

Host API 当前版本为 `2.1.0`，兼容要求 `^2.0.0` 的 App，不兼容 1.x。Backend 进程协议仍为 App Service v1；两者含义不同：前者描述公开能力集合，后者描述 Node 子进程的传输 envelope。

## 内置协议

| 协议 | 运行位置 | 职责 | 主要权限 |
| --- | --- | --- | --- |
| `moss.account/v1` | Desktop、Server | 当前 owner 身份、组织通讯录 | `account:identity:read`、`account:directory:read` |
| `moss.agent/v1` | Desktop、Server | Agent 目录、Binding、Session、Turn、投递确认 | `agent:*` 的细分读写权限 |
| `moss.desktop/v1` | Desktop | 文件选择与私有缓存、截图、下载、外链、媒体授权 | `desktop:*` |
| `moss.openim/v1` | Desktop | 使用当前 Moss 身份访问 Server OpenIM integration | `openim:client` |
| `moss.remote/v1` | Desktop | 过渡兼容：调用同一 App 的 Server Action；新 App 不应使用 | `remote:actions` |

Account 和 Agent 是跨 Host 的领域契约；Desktop 是操作系统能力边界。第三方平台事件、SDK 方法和部署参数不属于通用 Core 协议。

`moss.openim/v1` 是第一方 OpenIM integration 的窄控制面，只提供当前用户 Token、分页组织通讯录映射以及单聊/群聊准备。OpenIM SDK 和消息事件位于 Desktop App，管理密钥只保存在 Moss Server。

## Desktop 与 Server 部署语义

- `backend.targets` 是同一个 Backend 的候选部署位置，不是 Desktop/Server 两个协作角色。
- 同一 App instance 同一时刻只能在一个 target 上 active。`["desktop", "server"]` 表示可迁移，不表示双端同时运行。
- Backend 在每个声明的 target 上都必须能独立运行，但不同 target 可以采用不同逻辑并提供不同的适用功能。`context.target.type` 用于选择当前模式的实现。
- `backend.protocols` 应按 target 分别声明，Host 只把当前 target 对应的协议交给 Backend。旧数组格式仅作现有 App 的迁移兼容。
- Server 是显式 opt-in。只声明 `desktop` 的 App 只在客户端运行期间可用；只有声明 `server` 的 App 才能部署到服务端并 7×24 运行。
- 不能通过另一个 target 的常驻 Backend 补齐当前模式；Desktop 与 Server 不是两个协作进程角色。

`moss.remote/v1` 与上述单实例单活模型不一致，仅为尚未迁移的 App 保留。它不能作为新 App 拆分 Desktop 控制面和 Server 数据面的架构工具，后续应在现有调用方完成迁移后删除。

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
    "instanceMode": "single",
    "serverOwnerScope": "org",
    "targets": ["desktop", "server"],
    "protocols": {
      "desktop": ["moss.agent/v1"],
      "server": ["moss.account/v1", "moss.agent/v1"]
    },
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

1. App/实例已启用且部署 generation 有效。
2. Backend 声明了目标协议。
3. Manifest 请求了方法所需权限。
4. installation grants 实际授予该权限。
5. owner、App ID 和实例 ID 与运行进程一致。

App 不能在输入中覆盖这些运行时身份。撤销 grant 会停止并以新 generation 重启 Backend，旧进程不能继续使用已撤销能力。

Host handler 同时接收不可由 App 覆盖的 `owner` 和 `principal`：前者表示 installation、数据和 Secret 的归属，后者表示触发当前调用的用户；后台调用可以没有用户 principal。固定结构的内置协议会在返回 App 前校验输出，阻止实现细节或额外字段意外穿过公开边界。

## Backend 调用

SDK 为内置协议提供类型化入口：

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

Account 协议提供 `directory.changed` 和 `directory.user-changed` 事件。后者携带发生变化的目录用户；依赖外部账号或会话的 Server App 应在用户变为 `disabled` 时撤销对应外部会话。

也可用 `context.host.request(protocol, method, input)` 调用 Manifest 已声明的自定义协议。Host 通过 `registerHostProtocol()` 注册 schema、权限和事件，再用 `registerHostHandler()` 提供实现；自定义协议同样经过统一授权、限流、超时和取消。

## Desktop 能力边界

`file.pick`、`file.materialize` 和 `file.thumbnail` 返回的文件路径只位于调用 App 的实例数据目录。文件型平台 SDK 必须再次校验路径属于该目录，不能读取用户未选择的任意文件。`file.download` 是用户确认的导出操作，返回用户选择的保存路径。`file.materialize` 使用不超过 512 KiB Base64 的分块请求，通过 `transferId`、`offset` 和 `complete` 组装最大 100 MiB 文件，不能把大文件塞进单个 IPC envelope。摄像头和麦克风授权还要求 `desktop:media` grant，预览或停用实例不会获得授权。

过渡期的 `moss.remote/v1 action.invoke` 仍只能调用同一 App ID、同一实例 ID 的 Server Action，并继续执行 owner、principal 和 `apps:invoke` 检查；不要在新 App 中依赖它。

## Server owner

Server installation、instance、deployment、Secret、数据和日志绑定到 `user`、`org` 或 `host` owner。需要一套组织共享配置的 App 在 Manifest 中声明 `backend.serverOwnerScope: "org"`。只有管理员能安装、配置或启停 org/host App；具有 `apps:read` 的组织成员可查看 org App，具有 `apps:invoke` 的成员可调用本组织 org App。Action 内发起的 Account/Agent Host 请求使用已认证调用者 principal，而配置、Secret 和数据仍归 installation owner。相同 App/实例 ID 可在不同 owner 下并存。

## 传输保证

- Backend 必须是 Node 运行时；构建器可以使用 Bun，但产物目标必须为 Node。
- 消息校验 generation 与每次启动随机生成的 launch token。
- Backend IPC 的普通 JSON envelope 上限为 1 MiB；大文件走 Desktop 文件能力或 App 私有存储。
- Backend 初始化期间可以调用 Host、写日志、上报状态和确认 Host 事件；完成 `onInitialize` 后再发送 `service.ready`。
- Host 请求与事件具有并发限制、超时、取消、重复 ID 和载荷指纹校验；Backend 请求的超时会被 Host 接收，并限制在 100 ms 至 300 s。
- Host 事件要求 Backend ACK；稳定 `eventId` 可安全重试。
- 错误和日志在离开 Runtime 前进行 Secret 脱敏。

Agent 的方法、事件和幂等约束见 [Agent Host API](./agent-host-api.md)，安装、进程和 Server owner 模型见 [Unified App Runtime](./app-runtime.md)。
