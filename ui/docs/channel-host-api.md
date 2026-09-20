# Moss Channel Host API

`moss.channel/v1` 是常驻 Moss App 接入外部消息渠道的双向协议。Channel App 负责平台连接、消息格式和平台 API；Moss Host 负责身份授权、会话、Agent 执行、通知和决策。

## Manifest

Channel App 必须使用 persistent Backend，显式声明协议及实际需要的权限：

```json
{
  "schemaVersion": 2,
  "id": "moss.feishu",
  "version": "1.0.0",
  "displayName": "飞书",
  "hostApi": "^1.1.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "instanceMode": "multiple",
    "targets": ["desktop", "server"],
    "protocols": ["moss.channel/v1"],
    "actions": []
  },
  "permissions": [
    "channel:connection",
    "channel:pairing",
    "channel:sessions:read",
    "channel:sessions:write",
    "channel:messages",
    "channel:deliveries",
    "channel:notifications",
    "channel:decisions"
  ]
}
```

没有声明 `moss.channel/v1`、缺少对应权限、App 被停用、实例被停用或实例已迁移到其他 Host 时，调用会在进入业务处理器前被拒绝。

## Backend 调用 Host

| Method | Permission | 用途 |
| --- | --- | --- |
| `connection.update` | `channel:connection` | 上报外部平台连接状态 |
| `pairing.attempt` | `channel:pairing` | 验证一次性配对并绑定外部用户 |
| `conversation.list` | `channel:sessions:read` | 查询可写 Moss 会话 |
| `conversation.current` | `channel:sessions:read` | 查询外部会话当前绑定 |
| `conversation.create` | `channel:sessions:write` | 创建并绑定 Moss 会话 |
| `conversation.select` | `channel:sessions:write` | 切换绑定的 Moss 会话 |
| `session.abort` | `channel:sessions:write` | 停止当前会话并取消排队消息 |
| `message.receive` | `channel:messages` | 接收外部文本或附件并提交给 Agent |
| `delivery.ack` | `channel:deliveries` | 确认回复或通知的外部投递结果 |
| `decision.respond` | `channel:decisions` | 响应一次性审批或确认请求 |

外部身份字段统一使用 `externalUserId`、`externalConversationId` 和 `externalEventId`。`message.receive` 和会产生副作用的方法必须携带稳定的 `externalEventId`，由 Host 做持久化幂等。

```js
const accepted = await backend.channel.request('message.receive', {
  externalUserId: senderId,
  externalConversationId: chatId,
  externalEventId: messageId,
  text,
})
```

## Host 推送 Backend

| Event | Permission | 用途 |
| --- | --- | --- |
| `turn.accepted` | `channel:messages` | 消息已进入执行队列 |
| `turn.output` | `channel:messages` | 增量文本或运行状态 |
| `turn.completed` | `channel:messages` | 回合完成 |
| `turn.failed` | `channel:messages` | 回合失败 |
| `notification.deliver` | `channel:notifications` | 投递移动端安全摘要或操作卡片 |
| `decision.resolved` | `channel:decisions` | 更新已经投递的决策卡片 |

每个事件都要求 Backend 返回 ACK。Host 可使用稳定 `eventId` 重试；Backend SDK 会在同一进程生命周期内缓存并重放重复事件的 ACK。持久化重试和最终投递状态仍由 Host 负责。

```js
backend.channel.on('notification.deliver', async (notification) => {
  const result = await sendPlatformCard(notification)
  return { externalMessageId: result.messageId }
})
```

## Host 注册

Desktop 与 Server 使用同一个 Runtime API 注册业务实现：

```js
runtime.registerChannelHandler('message.receive', async (input, context) => {
  // context 包含 appId、instanceId、target、requestId、permission 和 AbortSignal。
  return channelService.receive(input, context)
})

await runtime.publishChannelEvent(
  appId,
  instanceId,
  'turn.completed',
  payload,
  { eventId: turnId },
)
```

Host handler 不应信任外部用户、会话或事件 ID。身份绑定、会话归属、决策 token、幂等和可写状态必须在 Host 内重新验证。

## 传输保证

- 所有消息继续使用 App Service IPC 的版本、generation 和 launch token 校验。
- 双向请求均有数量限制、超时、取消、消息大小限制和错误码。
- Backend→Host 的重复 request ID 仅在协议、方法和输入完全一致时返回缓存结果；同一 ID 对应不同载荷会被拒绝。
- Host→Backend 的事件需要 ACK；同一时刻重复投递不会并发执行，已完成事件会重放相同载荷的 ACK，不同载荷复用 ID 会被拒绝。
- 超时或取消只表示结果未知，不代表平台操作已撤销；处理器因取消失败时不缓存失败 ACK，Host 可在处理器退出后用同一 `eventId` 重试。
- 进程退出会取消 Host handler，并拒绝所有等待中的事件。
- 错误经过 App 密钥脱敏后才返回 Backend 或写入日志。

`moss.channel/v1` 不允许 App 导入 Desktop、Server 或 Session 内部模块，也不让 App 直接访问 Host 数据库。
