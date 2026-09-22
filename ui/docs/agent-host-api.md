# Moss Agent Host API

`moss.agent/v1` 是 App 使用 Moss Agent、策略、Session 和 Turn 的通用协议。它不包含任何消息平台名称、事件格式或 SDK；平台 App 负责连接、身份映射、消息解析、发送与幂等投递。

## 权限与方法

| 权限 | 方法 |
| --- | --- |
| `agent:catalog:read` | `catalog.list` |
| `agent:bindings:read` | `binding.get` |
| `agent:bindings:write` | `binding.update`、`binding.reset` |
| `agent:sessions:read` | `session.list`、`session.current` |
| `agent:sessions:write` | `session.create`、`session.select`、`session.abort` |
| `agent:turns:read` | `turn.list`、`turn.get` |
| `agent:turns:write` | `context.observe`、`turn.start`、`turn.abort`、`turn.reply`、`turn.review`、`turn.delivery.ack` |

外部身份统一使用 `externalUserId`、`externalConversationId` 和 `externalEventId`。Core 将这些值视为 App 内的不透明标识，只在当前 App、实例和 owner 范围内使用，不解析平台 ID 格式。

## Binding

Binding 决定回复模式、Agent、资源限制、确认策略和 Session 策略。`defaultConversationId` 是 App 可选的默认策略作用域；Core 只处理继承，不推断其格式。

```js
await backend.agent.request('binding.update', {
  externalConversationId: conversationId,
  defaultConversationId: accountDefaultId,
  expectedRevision,
  patch: {
    replyMode: 'ai_auto',
    permissionMode: 'default',
    resources: { tools: ['Read'], skills: null, connectors: null },
    session: { mode: 'fixed', rotateAfterTurns: 24 },
  },
})
```

App 只能收窄用户实际可用资源，不能请求 `bypassPermissions`。Core 在每次执行前重新计算 Agent、Tool、Skill 和 Connector 的授权上限。

## Turn

```js
const accepted = await backend.agent.request('turn.start', {
  externalUserId: senderId,
  externalConversationId: conversationId,
  externalEventId: platformMessageId,
  text,
  source: 'human',
})
```

`externalEventId` 在 App/实例内必须稳定。同一 ID 和相同内容会返回已有 Turn；同一 ID 对应不同内容会被拒绝。正文最多 100,000 字符，附件最多 32 个；Core 持久化时只保留安全元数据。

Host 可能推送：

- `turn.accepted`
- `turn.review_requested`
- `turn.completed`
- `turn.failed`
- `binding.changed`

App 完成外部发送后调用 `turn.delivery.ack`，必须同时提供 `turnId` 和原 `externalConversationId`。发送失败可回报 `ok: false` 和安全错误摘要；App 自己负责平台级重试和稳定消息 ID。

## Session

`session.list/current/create/select/abort` 与 Turn 使用同一外部会话作用域。`fixed`、`rotating` 和 `new_each_turn` 策略由 Core 执行；App 不直接访问 Session 数据库。人工发送可用 `context.observe` 作为下一次 Turn 的受限上下文，但不会自行启动 Agent。

## 安全边界

- 外部消息始终作为不可信用户输入，不能成为 system/developer 指令。
- App 不能覆盖运行时 App ID、实例、owner 或发送者身份。
- Turn 查询、审核、取消和 ACK 均再次检查 App/实例范围。
- 草稿批准前不会产生 `turn.completed` 投递事件。
- Host 只返回公开 Turn 摘要，不暴露策略快照、内部路径、continuity summary 或原始异常。

通用授权和传输规则见 [Host Capability API](./app-host-capability-api.md)。
