# Claude Code → Moss：review 与后续迁移交付

日期：2026-10-19。对应用户“review 后继续后面的功能借鉴”。本轮交付第一批发送流程的补充修复、R3 的 MCP 目录一致性子集，以及 R4a 首阶段的提示词组成诊断。基于现有 Moss Core、Host、Composer 和邻仓 Trace App 实现。

## Review 发现与修复

| 问题与触发条件 | 修复后行为 | 验证 |
| --- | --- | --- |
| App 预检查、新建会话、附件复制位于恢复逻辑之外，失败时可能丢掉已提交内容；晚到的清空操作会影响新输入 | 恢复范围覆盖整个发送准备；文字在开始时清空，后续新输入保留。原文字、附件、Skill、App、Agent、意图回填或成为独立草稿；未创建会话时保存在首页草稿列表 | 实际 App 回调测试覆盖创建失败、复制失败和新输入竞争 |
| 附件复制返回错误时仍可能继续发送缺附件的消息 | 明确失败并保存原附件引用，允许用户处理后重试 | 复制错误 fixture 确认没有调用发送 |
| Stop 发生在 App 预检查或新会话复制期间，异步完成后仍可能发出第一条请求 | 最终分发前检查取消代次，新会话同样生效；内容保留为草稿 | 两个 Stop 竞争用例确认发送次数为 0 |
| 首次 MCP 目录请求失败的 Promise 被 LRU 长期缓存 | 失败项自动退出缓存；晚到的旧失败不会删除较新的成功项 | LRU 并发用例 + 真实 MCP 子进程故障恢复 |
| 刷新分页期间的新目录通知被正在运行的请求吞掉 | 标记当前候选失效，在同一截止时间/页数预算内重新读取；通知合并，不提交过时候选 | 连续 20 次通知合并为一次补读，只提交最新目录 |
| 同名 MCP 工具更新参数定义后可能继续沿用旧 schema/token 数 | 新调用校验已确认目录中的定义；旧 adapter 对变更或删除明确拒绝。token 缓存按实际解析的工具 schema 与模型/提供方身份区分 | 同名 string → number、不同 provider、并发计数、失效/重试 |

“发送准备失败”和“发送未确认”保持区分；后者仍需核对会话记录，不自动重发。跨崩溃可靠投递属于 R2b，本轮没有作恰好执行一次的保证。

## 迁移一：MCP 目录与缓存一致性

参考上游 [C07 / RefreshMcpTools 协议](../output/claude-upstream-review-20261019/version-pair/code-comparison.zh-CN.md#c07-mcp-主动刷新刷新失败保留旧工具不隐式重连)：查询当前连接的工具集合，失败保留此前集合，未连接状态不能因刷新而隐式拉起服务。复用 Moss 的连接池、App 授权与工具披露。

- 同一真实 Client/transport 维护完整目录快照。读取全部 `tools/list` 分页并验证 schema、重复游标和重复工具名；上限为 100 页请求、10,000 个工具、单候选 8 MiB、一次刷新 20 秒。完整的空目录才表示工具已全部移除。
- `tools/list_changed` 通知、显式内部刷新和首次实际使用共享目录状态。并发请求合并；分页期间收到通知则丢弃候选重新取页；取消或连接关闭不能提交结果。
- 失败保留上一次完整快照及 revision，标记 `stale/error`。App 工具列表显示“目录待刷新”和经过脱敏的错误；缓存重载仍保留过期状态，不展示为已确认可用。
- 刷新只操作既有连接，不重启有状态服务。真实子进程测试确认失败恢复与 schema 更新前后 PID、已存储内容不变；会话释放后再刷新不能重新拉起进程。
- 工具定义变化会使转换缓存失效。已经开始的调用保留其原连接；后续旧 adapter 无法默默按旧定义执行。调用时过期目录先尝试刷新，失败会报错，不把保留的旧说明当成可用性保证。
- ToolSearch 的 token 缓存改为解析后的 schema/说明、模型、会话及提供方身份的 hash，最多 64 项。计数不可用、为零或失败时退避 30 秒，避免每轮重复请求计数接口。

主要代码：[liveToolCatalog.ts](../src/services/mcp/liveToolCatalog.ts)、[client.ts](../src/services/mcp/client.ts)、[toolTokenCache.ts](../src/utils/toolTokenCache.ts)、[AppMcpToolRows](../ui/src/renderer-react/components/app-mcp-tool-rows.tsx)。

**范围限制：**完整快照替换的原子性发生在 Moss 本地；MCP 未提供服务端快照事务令牌，服务端无通知的页间变化仍无法完全识别。新增工具何时重新注入模型仍遵循现有加载路径；部分执行入口需要下次加载/下一轮。尚未新增供模型主动调用的刷新动作，也未完成 instructions delta 或 SDK 专用连接的全面刷新适配。App 的摘要目录与实际执行 schema 保持版本关联，二者不混作同一个权威对象。

## 迁移二：Trace 内的提示词组成诊断

参考上游 [C12 / Skill doctor 与 prompt-audit 入口](../output/claude-upstream-review-20261019/version-pair/code-comparison.zh-CN.md#c12-skill-审计插件评测与顾问模型值得借鉴但成熟度不同)。本次借鉴“让注入与成本可核查”的方向，**没有完整恢复上游 prompt-audit 的压缩提示词或评分器**。

启用已有 Trace 采集后，新请求详情中可展开“提示词组成诊断”：

- 从实际捕获请求读取 system/instructions/developer 文本、工具定义和普通消息文本，支持 Messages、Chat Completions、Responses 的对应位置。
- 按体积排序，显示请求位置、工具名、Unicode 字符数、UTF-8 字节数和完全重复片段的原始位置；诊断元数据含 SHA256 指纹，不重复保存提示词全文。
- 最多计量 256 个片段、2,000,000 个 UTF-16 代码单元。达到上限明确显示不完整；图片、工具调用/结果等未计入普通文本的块单独披露，避免制造完整统计。
- 请求 pending、成功、失败记录均保留诊断。生成在请求已发出后进行，沿用现有 Trace 生命周期，不新增常驻采集通道。
- 首屏最多 12 行，可展开全部。字符/字节不是计费 token；工具定义包含 JSON 结构；完全重复可能是有意安排，不自动删改。

Core：[promptDiagnostics.ts](../src/services/trace/promptDiagnostics.ts)、[traceFetch.ts](../src/services/api/traceFetch.ts)。界面位于邻仓 `/Users/bgd/repo/moss-apps/apps/trace/src/components/trace/detail/PromptDiagnostics.tsx`，接入现有请求详情。

**这只是 R4a 的首阶段。** Skill、App、项目说明、记忆的精确来源 ID/版本尚未在注入点登记，显示为未归属文本；工具/Skill 使用事件关联、按来源成本、语义冲突分析均未完成。不会从提示词措辞或最终回答猜测来源和调用次数。

## 验证结果

| 检查 | 结果 / 范围 |
| --- | --- |
| 最终 Core review 回归 | 39 项通过，0 失败，6 个文件：LRU、目录、真实 MCP 子进程、App 工具命名、提示词组成和 Trace 生命周期 |
| 队列专项 | 14 项通过，包含新会话失败与 Stop 竞争 |
| 工具 token 缓存 | 3 项通过，结果保存在组合回归日志中 |
| App MCP Host | 29 项通过，包含过期状态持久化与错误脱敏 |
| Trace App | 71 项通过，0 失败 |
| Trace 浏览器 | 2 项通过；实际 App reader/store + 隔离 Host 桥，覆盖诊断展开、重复标注、480px 布局、缺少 Host 等场景 |
| Electron 队列 | 5 组交互通过；真实 Composer/IndexedDB + 隔离 Host fixture。首页创建失败由实际 App 回调专项验证，未声称完整桌面端到端覆盖 |
| UI 与 Trace App 类型/契约检查 | 通过 |
| CLI/Desktop 核心、Moss renderer、Trace App 生产构建 | 通过；大 chunk 提示仍存在 |

以上合计 156 个不同的单元/集成用例，另有 2 项浏览器测试和 5 组 Electron 交互；部分组合日志重复执行相同用例，不重复计数。未调用真实付费模型，未重启或安装用户正在使用的客户端；不据此宣称模型任务成功率或费用提升。

根目录 `bunx tsc --noEmit` **仍未通过**。与第一批保存的日志按文件路径、错误码和消息比较、忽略行列位移后，没有新增诊断签名。两份日志均来自既有脏工作树，这不是独立干净基线编译，不能声称全仓类型检查通过。比较结果随证据保存。

## 保留、使用与后续

Workspace、Task list、Team/Boss、Workflow App、文件观察、右侧展示和现有权限体系继续保留。本批不新建任务/结果面板，不自动初始化 Git，不恢复按 Write/Edit 次数推断文件改动的旧逻辑。

要体验本次更改，需要运行本工作树构建的 Moss，并使用邻仓重新构建的 Trace App。开启既有 Trace 后产生的新请求才有诊断数据，旧记录没有该字段时不会显示；已安装的其他副本不会自动升级。关闭 Trace 即停止该诊断采集，不影响请求行为。

后续按[迁移计划](claude-code-migration-plan-20261019.md)继续：H4 故障探针、R1 剩余读取/落盘边界、R3 模型加载与说明版本衔接、R4a 精确来源登记、R5a 有界重试和 R2b 回执恢复分别实施；本轮未宣称这些已完成。没有引入 Anthropic 官方账号、远程 gate 或遥测作为新依赖。

证据保存在 [followup](../output/claude-upstream-review-20261019/followup/)：测试与构建日志、类型诊断比较、窄窗口截图、相关文件最终 hash，以及本轮开始时选定文件的部分基线和增量 diff。两个工作树原有其他改动未提交、重置或清理；部分基线不等于完整仓库快照。
