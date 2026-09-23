# Moss App Host Capability API 2

Host Capability API 是 App Backend 使用 Moss 能力的唯一受支持入口。App 不应导入 Host、
Session 或数据库内部模块；它应在 Manifest 中声明版本化协议和权限，再通过 `@moss/app-sdk`
发起受控请求。

Host API 当前版本为 `2.1.0`，兼容要求 `^2.0.0` 的 App。Backend 进程协议仍为 App Service v1；
前者描述公开能力集合，后者描述 Node 子进程的传输 envelope。

## 内置协议

| 协议 | 职责 | 主要权限 |
| --- | --- | --- |
| `moss.account/v1` | 当前身份和组织通讯录 | `account:identity:read`、`account:directory:read` |
| `moss.agent/v1` | Agent 目录、Binding、Session、Turn 和投递确认 | `agent:*` 细分权限 |
| `moss.platform/v1` | 文件选择、私有缓存、截图、下载、外链和媒体授权 | `platform:*` |
| `moss.openim/v1` | 使用当前 Moss 身份访问 OpenIM integration | `openim:client` |

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

## 传输保证

- Backend 必须是 Node 运行时；构建器可以使用 Bun，但产物目标必须为 Node。
- 消息校验 generation 与每次启动随机生成的 launch token。
- Backend IPC 的普通 JSON envelope 上限为 1 MiB；大文件走客户端文件能力或 App 私有存储。
- Backend 初始化期间可以调用 Host、写日志、上报状态和确认 Host 事件。
- Host 请求与事件有并发、超时、取消、重复 ID 和载荷指纹校验。
- 错误和日志在离开 Runtime 前进行 Secret 脱敏。

Agent 的方法、事件和幂等约束见 [Agent Host API](./agent-host-api.md)，安装与进程模型见
[App Runtime](./app-runtime.md)。
