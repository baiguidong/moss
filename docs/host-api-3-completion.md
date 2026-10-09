# Host API 3 收尾与 App 适配

2026-10-09。在 [首轮 3.0 迭代](host-api-3-iteration.md) 上完成调用语义、App 声明、订阅、契约覆盖、大结果、历史管理、状态恢复和能力发现。Host API、SDK、Runtime 继续为未发布的 **3.0.0**；不维护旧调用、旧 Manifest 字段或旧任务数据库格式，不迁移用户数据。

## 调用和声明

协议声明从 `backend.protocols` 调整到 App 级 `host.protocols`。旧位置明确报错，防止遗漏权限边界。`moss.host/v1` 隐式可用，其余协议仍须显式声明。纯 UI App 有内部身份记录，不需要启动 Backend；普通 App 调用不传 instanceId、generation 或 owner。

```json
{
  "hostApi": "^3.0.0",
  "host": { "protocols": ["moss.tasks/v1", "moss.platform/v1"] },
  "permissions": ["tasks:read", "platform:files"]
}
```

UI 的 `createAppClient(bridge).host.request` 和 Backend 的 `client.host.request` 使用相同的方法输入输出类型；自定义协议仍可调用，不能借自定义重载绕过已知协议的检查。Local Files、Runtimes、Platform、Cloud Storage、Audit、Trace 管理方法已加入 `host-contracts`，与 Tasks/Execution、MCP 一起生成类型、输入输出/事件校验和方法文档。Account、Agent 和受限 OpenIM 继续使用各自协议校验；Account/Agent 也纳入请求类型推导。

`timeoutMs` 只接受 100–300000 范围的有限数值，Host 配置可降低上限。Action 的截止时间从进入调用队列开始计算，覆盖包读取、排队和 Backend 启动；默认采用 Action 声明或 Host 默认值。Host 调用默认 30 秒。超时分别保留 `APP_ACTION_TIMEOUT` / `APP_HOST_TIMEOUT`，主动取消为 `APP_ACTION_CANCELED`；SDK 取消向底层传递对应原因。非法输入、未授权、冲突和容量限制使用稳定错误码。已经提交的副作用不会因取消回滚，也不会自动重试。

## 订阅和能力发现

UI 支持 `await client.host.subscribe(protocol, event, listener, { signal, onError })`，返回取消订阅函数。导航、窗口销毁、App 停用、版本/配置/授权变化和 SDK dispose 均清理订阅；每次投递复核当前身份和授权。Main 按窗口隔离订阅 ID，每窗口最多 64 个请求/订阅；Runtime 最多 512 个 UI 订阅。Backend 的 `subscribe` 支持同一事件多个观察者；需要响应回执的 Backend handler 继续使用单一 `on`。

```ts
const { capabilities } = await client.host.request(
  'moss.host/v1', 'capabilities.get', { protocols: ['moss.platform/v1'] },
)
// 每个方法分别给出 supported、allowed、available、reason、surfaces、permission、limits。
```

发现范围只包含当前 App 声明的协议及隐式的 `moss.host`。限制、允许调用端和实现支持来自 Registry；当前授权及异步环境检查后再次验证的授权决定 allowed。Cloud 非状态方法检查账号/服务状态；启动 Agent 执行检查 Node Runtime。发现是状态快照，实际调用仍独立授权。MCP App 已使用发现结果决定能否配置内置服务。

## 大结果

`@moss/app-sdk/results` 提供浏览器安全的 `readJsonResult` 和 `readJsonRanges`；`results/store` 提供 Backend 临时传输 store 和实际 UTF-16 文件范围读取。

- Audit、Trace 复用同一 store/reader：单结果最多 32 MiB，分块 256 KiB，待取结果总量最多 64 MiB，租约 60 秒且读取续租；成功、失败和取消均尝试 release。
- base64 传输 offset 是解码后的字节；Workflow/Core 文件范围 offset 是 UTF-16 code unit。范围读取校验单调 offset、块长度、总量和取消，拼接后解析 JSON，保留跨块代理对。
- Workflow 资源改为 UTF-16 文件，只读取请求范围；UI 资源展开及 Backend Agent 结果读取均使用 SDK 公共读取器。
- release 只释放临时传输结果，不删除原始文件或 App 的持久业务结果。

## 任务历史和可靠恢复

SQLite Worker 每次事务同时写任务/执行状态、执行事件和公开 Task 变更摘要。列表直接读取摘要，不加载全部执行事件。

| 范围 | 行为 |
| --- | --- |
| `task.list({cursor?, limit?})` | limit 最大 10；按创建序号倒序，使用不会复用的 AUTOINCREMENT 序号；返回 nextCursor，末页为 null。进度更新不改变排序；第一页之后的新任务在下一次刷新出现 |
| `task.changes({afterCursor?, limit?})` | limit 最大 100；按 owner 范围读取持久变更，返回 changes、nextCursor、hasMore、reset。游标绑定库 epoch、owner 和用途，不可混用列表游标 |
| 初次订阅 | 不带 afterCursor 获取当前检查点；读取当前快照，再从检查点追赶。`TaskChangesWatcher` 已封装此流程，onReset 负责消费者快照恢复 |
| 过期/无效游标 | changes 返回 reset=true 和新检查点，消费者重新读快照后继续；list 的无效游标报非法输入 |
| 保留 | 终态任务、执行、结果和幂等回执保留 30 天；到期查询返回不存在，幂等 key 可重新使用。运行中任务不清理；未送达通知也在任务过期后结束保留 |
| 变更流 | 保留 7 天且每 owner 最近 10000 条，先达到的窗口决定可补读范围；执行内事件仍保留最近 2000 条 |
| 内存 | 最近 100 个普通终态任务，加运行中/待通知任务；历史按 ID、scope、幂等 key 加载。会话历史从存储查询最近 100 个摘要 |
| 清理 | 启动及运行中每分钟清理过期记录；回收超过 1 小时的孤立结果/临时文件，只处理已知生成文件名。关闭等待清理和写入完成 |

变更项包含 Task 摘要；需要 Execution 详情或事件时继续调用 execution.get/events。推送用于降低延迟，持久游标用于补漏；消费回调成功后推进游标，失败会重读当前页，因此业务回调仍应幂等。Workflow 实时应用 task.changed，并按 revision/时间及相同摘要去重，再用游标增量补读，平时每 5 秒兜底；游标重置时查询当前运行任务。这里不承诺永久重放或外部副作用恰好一次。

## App 适配

| App | 版本 | 本轮适配 |
| --- | --- | --- |
| Audit | 0.1.3 | host.protocols、公共结果 store/reader、类型化审计请求 |
| DevTools | 0.1.3 | SDK 调用保障和构建同步 |
| Drive | 0.3.2 | host.protocols、Cloud 生成契约和统一错误码 |
| Feishu | 0.4.9 | host.protocols、浏览器 SDK 打包依赖 |
| HTTP Client | 0.1.4 | SDK 取消和错误语义同步 |
| Library | 0.1.5 | host.protocols、Local Files/Runtime 契约 |
| MCP | 0.1.5 | host.protocols、能力发现与内置服务检查 |
| OpenIM | 0.2.10 | host.protocols、UI Agent/Platform 类型推导 |
| Trace | 0.1.2 | host.protocols、公共结果 store/reader、类型化状态查询 |
| Workflow | 0.1.13 | host.protocols、TaskChangesWatcher、范围读取与有界 JSON 展开 |

App 模板、示例、文档和测试 fixture 同步更新；SDK 子模块必须引用对应 Core 提交。未签名本地包位于相邻 `moss-apps/artifacts`，不发布。

## 验证

回归覆盖真实纯 UI Runtime、Electron preload/IPC、撤权竞态、排队 deadline、订阅释放、结果租约/分块/Unicode、Task 分页、游标重启/过期、按需加载和保留期限；SDK TypeScript 检查不启用 skipLibCheck。Apps 执行完整类型检查、测试、生产构建及 Manifest 校验，Workflow 安装包使用真实 Node IPC 和受控 Agent 执行器验证执行恢复及任务取消。

更新后的合成存储基准（每任务 8 个执行、各 50 个事件）在 10/100/250 个历史任务时，初始缓存分别为 10/100/100 个；本机主线程更新中位为 0.03/0.09/0.04 ms，事务完成中位为 0.37/0.73/0.44 ms。这是临时库本地测量，不能视为生产 SLA。

保持此前确定的范围：不全面重命名 Channels/Executions，不推出全局 ResourceRef，不重写 App 业务领域；Audit/Trace 的源文件格式沿用已有 schemaVersion 约束。测试、基准和安装包集成均使用隔离临时目录。
