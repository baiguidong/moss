# Host API 后续高价值优化评估

2026-10-09。本文基于当时的 Core 2.9.0 及 `moss-apps` 评估，保留原始证据和建议。P0/P1 随后已落地，全部 10 个 App 已同步适配 Host API 3.0.0，见 [当前迭代记录](host-api-3-iteration.md)。按用户最新要求，不再保留本文原建议中的旧调用兼容层；P2 仍属后续范围。上一批实施见 [2.9 记录](host-api-optimization-plan.md)。

结论：还有值得优化的地方。优先处理调用保障、任务存储、契约源和 SDK 公共封装；这些可以沿用现有协议逐项落地。v3 中的统一契约、可靠状态恢复方向有价值，全面更名、全局 ResourceRef 和统一所有长操作暂不列入近期范围。

| 优先级 | 项目 | 实际收益 | 改动范围与 App 影响 |
| --- | --- | --- | --- |
| P0 | 补齐 UI Host 调用生命周期，与 Backend 共用执行保障 | 修复撤权竞态；让 UI 取消、超时真正传到 Host | Runtime、Main、preload、SDK；旧调用保留，OpenIM 优先接入取消 |
| P1 | Task/Execution 增量存储与索引 | 消除进度更新同步重写全部任务；为恢复提供事务边界 | Core 内部改动较集中；Workflow 保持现有业务 API |
| P1 | 小范围 `host-contracts` 与 SDK 导出规范 | 减少类型、校验、错误、限额及文档长期漂移 | 先覆盖 Tasks/Execution、MCP；按协议逐个扩展 |
| P1 | SDK 自动绑定当前 App，统一 Action signal 与事件等待辅助函数 | 删除 App 重复代码，统一取消、订阅清理及缓存失效 | 10 个 App 可分批采用；无需同时重写业务 |
| P2 | 大结果公共读写辅助函数 | 合并已有重复传输代码，避免每个分块都重读全文 | Audit、Trace 先接；Workflow/Core Execution 分步接入 |
| P2 | 持久状态变更流与能力发现 | 更可靠地恢复状态；按支持、授权、可用状态降级 | 依赖存储与契约基础；先用于 Workflow 和实际能力消费者 |
| P2 | Audit/Trace 来源契约、Desktop 通用能力提取 | 降低 Core 与 App 文件结构耦合，改善通用能力复用 | Audit、Trace 局部适配；按真实复用需求提取 |

P0 是已复现的正确性问题；P1 有当前代码重复或性能证据；P2 适合在基础完成后按需实施。

## 1. UI Host 调用保障：已确认需要修复

[UI 路径](../packages/app-runtime/src/host/index.mjs#L750) 在 `await getActivePackage()` 前取得 installation/runtime，随后使用旧的 `installation.grants` 派发。相比之下，[Backend 路径](../packages/app-runtime/src/host/index.mjs#L786) 在包加载后重新检查 generation、版本、启用状态并读取当前 grants。

隔离复现使用临时 fixture 和实际 Runtime：暂停包加载 → 撤销 `fixture:read` → 恢复加载。最终当前 grants 已为空，受保护 handler 仍执行了一次并成功返回。此复现验证 Runtime 的 UI 请求入口，未启动 Electron，也未访问真实业务数据。

此外，[Main UI IPC](../ui/src/main.mjs#L10054) 只向 Runtime 传 `requestId`，没有 UI Host 请求取消入口与 timeout 传递；[UI SDK 类型](../packages/app-sdk/src/index.d.mts#L475) 也没有调用 options。Backend 已有受限超时、请求登记和停进程时的取消机制。共用 Capability Registry 尚不足以消除两条入口的差异。

建议实施：

- 抽取公共请求执行层，统一当前身份、方法权限、限额、deadline、AbortSignal 和错误处理；Electron IPC 与 Node IPC 保留各自适配器。
- 异步准备后、真正派发前复核当前 App/实例/版本/授权。窗口销毁、App 停用、相关权限撤销时取消所属请求；有异步副作用的 handler 在提交前检查取消和当前授权。
- preload 将 `AbortSignal` 转换为 requestId + 取消 IPC，Main 保存实际 controller；不能把 signal 当普通 IPC 数据传递。取消入口校验窗口归属，不能取消其他窗口或 App 的请求。
- 契约声明允许的调用端。UI 与 Backend 使用相同类型和机制，不代表二者自动获得相同能力权限。
- 固定语义：取消尽力停止未完成工作，不撤回已经提交的副作用；请求超时与底层 handler 退出分别处理。业务幂等只对明确支持的方法提供，不能用 requestId 去重代替跨重启幂等。

验收：复现中的 handler 调用数应为 0；包加载、弹窗等待、下载过程中取消均能正确收尾；窗口关闭/撤权/换版本有回归；跨窗口取消被拒绝。保留旧调用形式，OpenIM 可增量接入 signal。

## 2. 任务存储：有明确性能收益，适合独立实施

[`event()`](../ui/src/apps/app-execution-host.mjs#L79) 每次进度/状态变化都会调用 `persist()`，通过同步 JSON 序列化、写文件、rename 重写整个 `tasks.json`。文件包含所有任务、执行输入及事件历史；事件仅在单执行内限制为 2000 条，历史任务持续累积。每个执行的进度可约每 300 ms 触发一次写入。

本机隔离基准调用实际 `AppExecutionHost.event()`，每个任务包含 8 个执行，每个执行预置 50 条事件及约 5 KiB prompt。初始化后测量 5 次进度更新，使用临时目录并在结束后清理。Node v22.22.0，macOS arm64。

| 历史任务数 | tasks.json 大小 | 单次同步更新中位耗时 | 单次最大耗时 |
| --- | --- | --- | --- |
| 10 | 1.10 MiB | 5.28 ms | 6.08 ms |
| 100 | 11.07 MiB | 66.98 ms | 210.97 ms |
| 250 | 27.81 MiB | 184.35 ms | 270.32 ms |

这是合成数据的本地测量，不是线上延迟或 fsync 持久性基准。它验证了单次更新开销随历史总量增长，而且这部分同步工作发生在主进程。

另有两个相关问题：[`task.list`](../ui/src/apps/app-execution-host.mjs#L237) 在分页前映射、克隆、排序全部匹配任务；[`execution.result.read`](../ui/src/apps/app-execution-host.mjs#L379) 每读一个分块都会同步读取完整结果文件。

建议保持公开 Task/Execution API，内部拆出 store：

- SQLite 按 task、execution、event、投递回执存储；按 owner/App/instance/status/updatedAt 和 executionId 建索引。一次更新只写相关行。
- 生命周期状态、事件与待投递记录在同一事务提交；高频 progress 合并写入，明确可丢失的进度窗口，终态及时落盘。
- 使用专用写入队列，并将较重数据库工作放到 worker/独立执行环境；只换成主线程同步 SQLite 不等于消除阻塞。
- 大结果继续存文件；先提交完整结果文件，再提交引用它的完成状态，并处理崩溃留下的孤立文件。
- 结果读改成实际范围读取。现有 v1 offset 是 UTF-16 code unit，不能直接当 UTF-8 字节偏移使用；可增加内部块索引，或另增明确以 byte 为单位的方法。
- 声明历史记录、事件、结果文件的保留与清理策略，防止无限增长；幂等记录不能早于承诺的重试窗口清理。

按已明确的“不迁移数据”边界，不设计旧数据导入和双写系统。新存储初始化后不会自动包含旧任务历史，也不应顺手删除旧文件。当前评估没有改动任何业务数据。

验收：公开 API 与 owner 隔离保持；验证取消/幂等/重启恢复/事务失败；用相同规模数据重测更新与分页，确认写入量不再随全部历史大小增长，并测主进程事件循环延迟。

## 3. 契约统一：先确立单一来源，再逐协议覆盖

当前 Execution 已有类型和返回校验，但方法元数据、手写输入校验、输出 schema、`.d.mts`、handler 限额和文档仍分开维护。[MCP](../ui/src/apps/app-mcp-host.mjs#L33)、[Local Files/Runtimes](../ui/src/apps/app-local-host.mjs#L17)、Audit/Trace 的协议定义仍主要校验输入，缺少统一输出校验，部分业务错误使用普通 Error。

另有一个可以先做的小修复：[SDK exports](../packages/app-sdk/package.json) 除 execution 外，多数子路径的 `types` 都指向整个根声明文件，而运行时导出只来自对应模块，类型可见符号与真实导出范围不一致。

建议新增小型纯数据/校验包 `host-contracts`，以现有 JSON Schema/AJV 为基础，集中定义：协议版本、方法/事件、输入输出、权限、允许调用端、错误码、限额及单位、取消/重试/幂等语义。由它生成 SDK 类型、边界校验器、方法文档与能力描述；生成结果在 CI 中检查是否最新。

第一批覆盖已有较完整契约的 Tasks/Execution 和缺口明显的 MCP。Local Files/Runtimes 随后补齐；其余协议按改动需要进入。授权决策、状态机、业务执行仍属于 Runtime/handler。跨字段和依赖运行状态的验证允许专用实现，避免为“全部自动生成”引入复杂 DSL。

验收：同一限制来自一个源；输入/输出/事件均有边界验证；每个 SDK 子路径声明匹配真实导出；非法参数、授权失败、冲突、取消、超限有稳定错误码。App 不必因内部抽取而修改业务，只在采用新 typed client 或修正不合法调用时适配。

## 4. 当前 App 绑定和公共 SDK 辅助函数

全部 10 个 App 的 UI 中都有 `instances.list()`：DevTools、OpenIM、HTTP Client、Library、Drive、MCP、Trace、Audit、Workflow，以及使用内联 HTML 的 Feishu。多处只是取第一条/default 实例再调用 Action/Host，并重复缓存与错误处理。

建议增加绑定当前 App 的 SDK client，使普通业务调用不再传 `instanceId`；Main 从受信任 sender 确定 App 并解析当前实例，SDK 负责类型、缓存失效、requestId、signal 和清理。管理实例配置的 API 可以继续显式存在。飞书的配置页面仍需要读取实例配置，不能机械删除全部 `instances.list()`。

可一起抽取两种已有重复模式：

- Action 调用的 AbortSignal 包装，涵盖解析实例之前取消、调用期间取消、完成后移除监听。
- Host 状态事件复用与 `watch/wait` 辅助函数：一次底层订阅供多个消费者使用，先订阅再读取当前状态，按 sequence/revision 去重，断线/超时按需补查，结束后清理。目前 [Backend SDK](../packages/app-sdk/src/client/index.mjs#L146) 每个 protocol/event 只允许一个 handler；Workflow 已为此实现了自己的分派与等待器。

generation/launchToken 已由 SDK/Runtime 维护，不应列为还需全面迁出 App 的问题。Workflow 图节点的 instanceId 是业务概念，也不属于这里的 Host 实例封装。

建议先适配 OpenIM、HTTP Client、Workflow 验证不同调用方式，再逐个替换其他 App 的调用入口。新 helper 使用旧协议即可工作；不要自动重试有副作用的 Action。浏览器可用入口不能引入 Node 内建依赖。

## 5. 大结果：先合并现有重复传输

[Audit UI](../../moss-apps/apps/audit/src/lib/api.ts) 与 [Trace UI](../../moss-apps/apps/trace/src/lib/trace/api.ts) 已有几乎相同的 base64 分块拼接、32 MiB 上限、offset 验证和 finally release。两者 Backend 也重复实现临时结果表、过期与总量限制。[Workflow resources](../../moss-apps/apps/workflow/src/backend/resources.ts) 则与 Core Execution 一样，每个分块重新读取整个文件。

适合先提供公共读取器和临时结果 store：明确大小、编码、offset 单位、owner、有效期；支持有界读取、流式消费、取消和释放。JSON 解码保持总量上限。先保留现有 App Action 作为适配层，以降低影响范围。

全局 ResourceRef 可以以后承接这些经验。当前没有必要同时替换文件选择结果、用户文件路径、截图、云上传 handle 和所有执行结果：引用不等于持久访问权限，内容 hash 不等于授权，release 也不等于删除用户文件。Cloud 上传 handle 已有 App/实例/账号归属及过期语义，应在统一前保留这些约束。

## 6. 可靠事件、能力发现和能力边界

当前 Task/Execution 并非没有事件：已有推送、查询及每个 execution 的有限事件历史；Workflow 已通过初始查询和 5 秒兜底恢复当前状态。缺口在持久推送记录、跨任务游标和统一恢复辅助函数。

建议存储改造时在事务中预留状态变更记录，随后增加 owner 范围内的单调游标、分页补读、保留期限和游标过期的 reset 语义。订阅应覆盖快照读取期间产生的变化。交付按“至少一次 + 消费方去重”设计，进度可以合并；不要承诺外部业务副作用恰好一次，也不要持久化每个 token。

`moss.host` 能力发现可直接由契约和已注册 handler 生成，分别返回 supported（实现支持）、allowed（声明及当前授权允许）、available（当前环境/账号/运行时就绪）与有效 limits。它是状态快照，每次实际执行仍要重新授权。未声明能力的枚举范围也要受控。

领域边界建议渐进处理：

- Audit 当前包含 `session.open` 和 `notification.publish`，这两项可以在出现通用消费者时提取为 Desktop 能力，并保留旧入口适配。通知来源与去重范围由 Host 绑定 App，不能直接继承任意 App 自报身份。
- Audit/Trace 已有 `schemaVersion: 1` 和采集隔离，不能描述为完全无契约。后续重点是将输出 DTO、快照/增量语义、兼容性验证纳入 host-contracts，并逐步降低 App 对目录布局的依赖；分析规则、检索索引和展示留在 App。稳定文件契约也可以作为第一步，无需立即重做整个数据读取服务。
- `moss.agent` 同时包含 catalog、binding、session、turn 和投递确认，直接改成 channels 不能自动解决领域边界。`agent-execution → executions` 主要改善命名，可先用 SDK facade；已有 wire protocol 名称继续使用。
- Cloud 传输已可查询/暂停/恢复/取消。可以统一状态读取、订阅、取消的使用方式，但 Agent 恢复、上传续传、OAuth 重新授权有不同业务条件，恢复策略按类型定义。
- OpenIM 保持独立受限集成；Cloud Storage、MCP、受管 Runtime 随各自契约完善升级，不捆绑改版。

## App 同步适配范围与实施顺序

| App | 近期适配 | 后续按对应功能适配 |
| --- | --- | --- |
| OpenIM | 绑定 client；UI Host signal 与下载取消 | 公共文件/结果接口真正落地后再接 |
| HTTP Client | 用公共 Action signal helper 替换现有包装，保留一次 cancel 行为 | 无领域协议改版要求 |
| Workflow | 绑定 client；SDK watch/wait 替换本地执行等待器 | 持久状态流、公共结果读取；定义与调度逻辑保留 |
| MCP | typed client、稳定错误码 | 方法级能力发现 |
| Library | 绑定 client；Local Files/Runtimes 类型和稳定错误 | 运行时可用状态查询 |
| Audit、Trace | 绑定 client；公共分块传输 | 来源 DTO 契约；Audit 导航/通知提取 |
| Drive | 绑定 client、Action signal helper | 复用现有 Cloud 传输契约与能力发现 |
| DevTools | 绑定 client | 无领域协议改版要求 |
| Feishu | 普通 Agent/Action 请求使用绑定 client；保留配置管理读取 | 不要求将现有 agent 协议改名 |

推荐分为三个可独立验收的批次：

1. 修复 UI 授权竞态和请求生命周期；修正 SDK 子路径声明；提供绑定 client 和公共 Action signal，先适配 OpenIM/HTTP Client。
2. 独立完成 Task/Execution 增量存储与性能验证；建立小范围 host-contracts，先覆盖 Tasks/Execution、MCP；Workflow/MCP 随对应 helper 和类型接入。
3. 抽取 Audit/Trace 大结果传输；按需要增加持久状态流、能力发现及来源 DTO；剩余 App 的重复调用入口分批替换。

不设“所有 App 必须同时升级”的门槛，不预设整体 v3 切换。内部实现优化与新增 helper 可继续沿现有协议发布；只有确需改变字段/单位/语义的接口才单独增加版本。
