# App Agent Execution / Tasks（Host API 2.7）

Workflow 调度归 `moss.workflow` App；以下接口可供任何具有相应权限的 App 使用。Core 不接收流程 Definition、分支或图结构。

## 协议

`moss.tasks/v1`：`task.create/get/list/update/finish/cancel/resume`。

`moss.agent-execution/v1`：`capabilities`、`execution.start/get/list/events/cancel/result.read`。

Backend 通过 `backend.host.request(protocol, method, input)` 调用。Manifest 需同时声明协议、权限，并获得安装授权：`tasks:read/write/cancel`、`execution:read/run/cancel`。

```js
const task = await backend.host.request('moss.tasks/v1', 'task.create', {
  idempotencyKey: runId,
  title: '处理资料',
  route: '#/runs/' + runId,
  limits: { maxConcurrency: 4, maxCalls: 32 },
})
// Action 到此即可返回。后台调度器使用 scopeRef 派发后续任务。
const execution = await backend.host.request('moss.agent-execution/v1', 'execution.start', {
  scopeRef: task.scopeRef,
  idempotencyKey: 'collect:visit-1',
  contextKey: 'collector',
  prompt: '整理指定输入并返回结果',
  outputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  resources: { tools: ['Read', 'Glob', 'Grep'] },
})
```

`execution.get` 返回状态及 `resultRef`。结果经 `execution.result.read` 分块读取（每块最多 100,000 个字符，返回 `text` 与 `nextOffset`）。`execution.events` 用 `afterSequence` 重连；事件保留最近 2,000 条，返回最早序号以识别截断。Host 持久化任务、执行结果与上下文引用。

## 会话与权限

- Main 在调用 App Action 时附加可信来源，仅经 Host 内部参数传递。App 输入中的 `sessionId`、`invocation` 等字段不能指定来源。
- 从主会话 App Tool 发起时沿用当前本地会话的工作区和权限。从 App 窗口独立发起时新建并打开以任务命名的普通本地会话（desktop/chat），使用普通会话的默认权限和工作区。后台定时器不能凭空创建来源会话。
- `scopeRef` 绑定 App、实例和安装所有者。读取执行结果同样校验所有权。
- Node Agent 使用当前会话最终工具池，并过滤 Agent/Team/SendMessage 与调用 App 自身的工具；指定 `resources.tools` 只能进一步缩小范围。
- Code、分支和业务并发控制属于 App。Core 额外限制全局并发 16、每任务调用 256、默认时长 30 分钟及最多 2,000,000 输出 tokens。
- 主会话自然结束不取消后台任务；显式停止、删除来源会话、停用 App、权限变更、Backend 退出或 Moss 退出会级联取消/中断。

## 恢复

同一任务内 `contextKey` 复用 Agent transcript，并串行执行同一上下文。`idempotencyKey` 和输入指纹防止重复派发；恢复后完成的执行仍返回原结果，前一轮未完成的执行可重试。重复键改变输入会报错。

`task.update/finish/resume` 必须传当前 `revision`。恢复旋转 `scopeRef`，递增 `attempt`。未知或已中断的工具副作用不保证恰好执行一次；业务 App 必须显示中断状态并由用户决定恢复。Core 不自动重放 App 图。

过程和结果以通用 `app_task` 记录保存在普通会话中，同时显示可停止和跳转详情的后台任务卡片。聊天 transcript 刷新时保留这些 Host 记录，用户继续追问时将近期任务结果作为数据加入上下文。后台 Agent 的执行上下文不会冒充主聊天 transcript。完成通知采用持久待发送标志和按任务/轮次去重，不自动启动主会话的新模型轮次。

## 验证

Host 所有权、幂等、并发、停止、schema 校验、重启和丢失 App Journal 后复用已完成结果：`ui/tests/app-execution-host.test.mjs`。

App 包集成与实际模型 CDP 验证位于相邻 `moss-apps/apps/workflow/scripts/`；详见 [迁移计划与落地记录](workflow-app-migration-plan.md)。

## 有界结果与 Action 来源（2.7）

`task.finish.result` 的 JSON UTF-8 上限为 32 KiB；完整数据由 App 保存并提供资源引用。`task.list` 使用 offset/limit，每页至多 10 项。`AppActionContext.requestId` 是稳定提交身份，传输 wire ID 每次尝试独立；App 必须自行持久保存提交意图及指纹。

SDK `source` 是只读的 surface/workspace 提示，源会话和权限仍只由 Main/Host 决定。通用 commands 可声明 `listAction` 返回 name/description/input，Host 发现并重新解析后调用既定 action。它不增加 Core 对任何业务图语言的依赖。
