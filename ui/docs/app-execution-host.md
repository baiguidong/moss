# App Agent Execution / Tasks（Host API 3）

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

`execution.get` 返回状态及 `resultRef`。结果经 `execution.result.read` 分块读取（每块最多 100,000 个 JavaScript UTF-16 code units；offset/limit 均使用此单位，返回 `text` 与 `nextOffset`）。按顺序拼接全部 `text` 后解析 JSON，不能把单个分块当作完整 JSON。`execution.events` 用 `afterSequence` 补读，每次至多 200 条；事件保留最近 2,000 条，返回 `earliestSequence` 以识别截断。Host 持久化任务、执行结果与上下文引用。

## 类型、状态事件与错误

原有 `host.request` 继续可用。SDK 根入口与 `@moss/app-sdk/execution` 提供 `createTasksClient`、`createExecutionClient` 及完整的输入、输出、状态事件类型，helper 校验请求与响应：

```ts
import { createTasksClient, createExecutionClient } from '@moss/app-sdk/execution'
const tasks = createTasksClient(backend.host)
const executions = createExecutionClient(backend.host)
// 在启动 Backend 前注册；一个协议事件对应一个 handler，多个执行在此按 ID 分派。
const off = executions.on('execution.changed', ({ taskId, execution, event }) => {
  // 使用 execution.id 定位执行，用 event.sequence 忽略重复/旧事件。
  updateProgress(taskId, execution, event)
})
const current = await tasks.request('task.get', { taskId }) // 推导为 AppTaskSummary
// 消费方退出时调用 off()。
```

| 事件 | 数据 | 所需权限 |
| --- | --- | --- |
| `task.changed` | `{ task: AppTaskSummary }` | `tasks:read` |
| `execution.changed` | `{ taskId, execution: AppExecutionSummary, event: AppExecutionEvent }` | `execution:read` |

执行事件携带 `eventId/executionId/sequence/timestamp/type`，进度可带 `tokens/toolCalls/lastToolName`。推送使用已有 Host 事件与 ACK 通道，并检查安装 owner、实例和读取授权；状态变化不会为了通知而启动已停止的 Backend。`capabilities.events` 表示 Host 是否接通推送，不代表调用者拥有读取授权。

推送是状态提示，可能丢失、重复或晚到，不保证恰好一次或自动重放。订阅后查询当前状态，重连时结合 `execution.events` 和序号补读；任务快照以查询为准（执行进度不会递增 task revision）。`ExecutionWatcher` 提供共享订阅、初始查询和 5 秒兜底等待器；消费方可直接使用，无需各自实现分派与监听清理。

| 场景 | 错误码 |
| --- | --- |
| 参数或 outputSchema 无效 | `APP_INVALID_ACTION_INPUT` |
| revision、幂等键或任务状态冲突 | `APP_CONFLICT` |
| 任务调用次数或 token 限额耗尽 | `APP_RESOURCE_EXHAUSTED` |
| 资源不存在或超出 App owner 范围 | `APP_NOT_FOUND` |
| 未知协议方法、响应或事件不符合契约 | `APP_HOST_PROTOCOL_ERROR` |

revision 冲突的 `details` 含 `{ kind: 'revision', currentRevision }`；幂等冲突含 `{ kind: 'idempotency' }`。使用错误码处理分支，避免匹配错误消息。执行启动后的模型/工具失败仍由 execution 的 `status/error` 表达。

校验函数统一命名为 `validateExecutionHostInput`，已删除旧名 `validateExecutionInput`。当前 App 声明 `hostApi: '^3.0.0'`；Manifest 2、App Service v1 和领域协议字符串保持不变。契约源、生成类型与校验器见 [host-contracts](../../packages/host-contracts/README.md)。

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

真实 Node Backend 事件、补读、授权和启动前取消：`ui/tests/app-execution-ipc.test.mjs`。SDK 根入口与 execution 子路径的严格 TypeScript 消费测试：`ui/tests/app-sdk-types.test.ts`。

App 包集成与实际模型 CDP 验证位于相邻 `moss-apps/apps/workflow/scripts/`；详见 [迁移计划与落地记录](workflow-app-migration-plan.md)。

## 有界结果与 Action 来源（2.7）

`task.finish.result` 的 JSON UTF-8 上限为 32 KiB；完整数据由 App 保存并提供资源引用。`task.list` 使用 offset/limit，每页至多 10 项。`AppActionContext.requestId` 是稳定提交身份，传输 wire ID 每次尝试独立；App 必须自行持久保存提交意图及指纹。

SDK `source` 是只读的 surface/workspace 提示，源会话和权限仍只由 Main/Host 决定。通用 commands 可声明 `listAction` 返回 name/description/input，Host 发现并重新解析后调用既定 action。它不增加 Core 对任何业务图语言的依赖。

## 存储与恢复

`tasks.sqlite` 由专用 Worker 管理，任务摘要、执行状态/输入和事件分表保存，事件与对应状态在同一事务提交。进度更新只写关联记录，任务列表使用 owner/updatedAt 索引分页。内存仍保存运行期任务状态；本次没有引入历史记录自动清理。

结果保存在独立 `.result.utf16` 文件，分块读取按 UTF-16 单位计算文件范围，不再每块读取全文。完成状态在结果文件提交后持久化。退出时等待状态落盘并关闭 Worker；重启将未结束的工作标记 interrupted。

按当前未发布阶段约定，不导入旧 tasks.json，不自动删除旧数据。SQL 状态事件可通过现有 execution.events 补读；尚未提供跨任务全局游标或持久投递 outbox。
