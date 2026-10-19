# Claude Code → Moss：可靠性批次交付

日期：2026-10-19。用户同意继续实施“参数改写校验检查、大输出边界、重试总上限”。本次完成这三个方向的可独立验证部分，并补入既有聊天界面的重试记录。

依据仍为此前下载的 Claude Code 2.1.88 与 2.1.303 对照，特别是[代码比较 C03/C06](../output/claude-upstream-review-20261019/version-pair/code-comparison.zh-CN.md)和[迁移计划 H4/R1/R5](claude-code-migration-plan-20261019.md)。具体限制、权限语义和生命周期适配 Moss；本次未重新查询上游版本，也未宣称完整复制 Claude 内部实现。

## 1. 参数改写后的校验与授权

原流程先校验模型输入，然后运行 Hook/权限流程；后者可以替换 `updatedInput`，但未统一复核。此次用实际 resolver 源码、隔离的权限依赖验证：旧基线 6 组故障断言失败，修复后通过。没有执行真实外部业务动作。

现在的行为：

- Hook 的 passthrough 改写与 allow/ask 附带输入都先过 schema 和工具自身值约束；支持严格对象的 schema 不静默删除未知字段。
- 权限回调返回的新参数、对原对象的直接修改同样复核。校验在权限回调前保存快照，避免原地修改绕过比较。
- 按最终参数再次核对规则：deny 继续生效；新适用的 ask 使用既有权限机制。再次批准期间参数又变化，则拒绝本次调用并要求用最终参数重新发起，避免循环或执行未经核对的另一动作。
- 取消会阻止允许结果继续执行。校验/权限失败会收尾已开始的工具等待与 trace span。
- AskUserQuestion 收集到的答案继续保留。Bash 的 `_simulatedSedEdit` 只允许从 permission UI 回调进入，Hook 不能注入；内部结构也需通过校验。

代码：[validateRewrittenInput.ts](../src/services/tools/validateRewrittenInput.ts)、[toolHooks.ts](../src/services/tools/toolHooks.ts)、[toolExecution.ts](../src/services/tools/toolExecution.ts)。覆盖主工具运行链路及共享 resolver，不等于对全部 App/第三方执行器完成安全审计。

## 2. 有边界、可核实的大输出快照

原来通用工具落盘没有单项上限；Bash/PowerShell 虽有 64 MiB 限制，却会截断原始任务日志，并继续生成“全文已保存”的说明。此外，文件已存在时未核实内容；通用保存失败又会把完整大结果送回模型。

现在通用文本输出和 Shell 保存环节共用 `persistBoundedOutput`：

| 场景 | 修复后行为 |
| --- | --- |
| 超大结果 | 单项最多保存 64 MiB，沿用 Moss 原 Shell 限值。按块写入；文本边界与预览按 UTF-8 字节计量 |
| Shell 任务日志 | 读取独立快照，不在保存环节截断源文件、不把源文件硬链接为结果；后续源文件变化不会改写已保存快照 |
| 保存中断/失败 | 临时文件收尾，完整写好后才发布目标路径；模型只收到有明确说明的有限预览 |
| 同一结果重放/并发 | 同路径本地写入串行，复用前核对普通文件、大小、内容指纹；拒绝链接和内容冲突，不覆盖现有文件 |
| 截断 JSON | 保存为文本片段，明确可能不是有效 JSON；MCP 不再要求读取缺失部分或直接用 jq 当完整 JSON 分析 |
| 历史结果 | 新的字节/完整性字段可选；旧记录缺少该信息时不补造“完整”状态 |
| 工具调用 ID | 文件名限制在结果目录内，非安全 ID 转为 hash，不能通过 ID 拼接越出目录 |

`PersistedToolResult` 记录原始字节、实际保存字节、完整性和截断位置；Bash/PowerShell 输出保留对应可选字段。模型收到的说明明确区分完整文件、部分快照和保存失败。已失败的工具不会因此被重跑。

代码：[boundedToolOutput.ts](../src/utils/boundedToolOutput.ts)、[toolResultStorage.ts](../src/utils/toolResultStorage.ts)、[BashTool](../src/tools/BashTool/BashTool.tsx)、[PowerShellTool](../src/tools/PowerShellTool/PowerShellTool.tsx)、[MCP 输出说明](../src/utils/mcpOutputStorage.ts)。

**范围：**本次约束单项文本快照，沿用原消息摘要预算。原始进程日志采集、图片/二进制输出、整个任务累计落盘额度、大文本 `allow_large` 和 WebFetch 续读不在这次交付内。文件源在复制期间变化会将快照标为不完整；这不是文件系统事务快照。

## 3. 每个逻辑模型请求的重试上限

增加 Host/运行时持有的 `RetryBudget`，每次逻辑模型请求创建，thinking 兼容重试、流式与非流式恢复共享同一对象。

| 模式 | 累计重试等待上限 | 硬尝试上限 |
| --- | --- | --- |
| 普通交互 | 120 秒 | 12 次 |
| 无人值守 | 600 秒 | 20 次 |

普通错误重试仍受既有 `maxRetries` 限制；无人值守 429/529 沿用突破该次数限制的旧策略，但现在受共享等待额度和硬尝试上限约束。兼容调整也计入硬上限。无人值守使用 Moss runtime 的标记，并兼容原环境开关。等待以单调时钟计量；完成或取消后保留已耗用额度，不因进入非流式补发清零。

- 支持 `Retry-After` 秒数与 HTTP 日期。服务端要求的等待超过剩余额度时立即结束重试，不缩短服务端等待要求。
- 原有长等待心跳保留；每次等待前检查额度。停止原因包含尝试次数与累计等待。
- 已完成并交出的 tool_use 之后发生流中断，禁止自动整条非流式补发，防止工具调用被重复生成。尚未交付的工具参数片段、空流等仍遵循原恢复开关。
- 重试事件携带可选额度字段。CLI 与 Desktop/Web 的既有聊天记录显示次数、HTTP/连接状态、计划等待及累计额度；相邻心跳合并，不新增右侧面板或文件改动卡片。
- API key 校验关闭内层 SDK 自动重试，由外层统一计数，避免嵌套放大。

代码：[retryBudget.ts](../src/services/api/retryBudget.ts)、[withRetry.ts](../src/services/api/withRetry.ts)、[claude.ts](../src/services/api/claude.ts)、[聊天记录格式化](../ui/src/renderer-react/lib/api-retry.ts)。

**范围：**120/600 秒约束重试间隔；单次网络请求沿用既有超时。整个用户任务及跨模型回退链的统一预算、资源账本和跨崩溃副作用去重分别留给 R5b/R6/R2b。现有模型切换不等于新增可配置回退链。SDK 新字段可选，旧 Host 没有额度时只显示其实际提供的字段。

## 验证与使用

- Core 组合回归 55 项通过；最终边界专项 13 项通过，其中新增 Shell adapter 用例 1 项，两组共 **56 个不同用例**。覆盖参数改写、磁盘快照、Unicode、链接/冲突、保存失败、取消、thinking 兼容、HTTP 日期、无人值守上限、实际模型请求 fixture 的流式/非流式恢复与重复工具保护。
- UI transcript 回归 **29 项通过**。Electron **5 组交互通过**，包含已有三文件展示、唯一 Task list、路径链接、工具折叠、预览编辑，以及新增重试记录；使用真实 React/Electron 和隔离 Host fixture。
- HTTP fixture 覆盖原生 Messages 请求路径，没有进行真实提供方性能验证；PowerShell 验证了共享写入器及实际结果 adapter，未在 Windows 执行 PowerShell 进程。
- UI 完整检查通过。检查发现当前工作树 App SDK 导出声明落后于其源声明，已运行既有生成脚本同步导出文件，未改写 App SDK 业务定义。
- 根目录 `tsc --noEmit` 仍因历史类型积压失败。对比上批保存日志、忽略行列位移后没有新增错误签名；这不是独立干净基线检查。
- CLI/Desktop 核心和 renderer 生产构建均通过；renderer 保留既有大 chunk 提示。构建日志、源码指纹与通过的最终空白检查保存在下方证据目录。

未使用真实付费模型，未重启/安装用户运行中的 Moss，未提交、重置或清理其他工作树改动。要体验变更，重启使用本工作树构建的 Moss。没有新增扩展依赖、自动 Git 初始化或根据 Write/Edit 记录推断文件变化的逻辑；Workspace、Task list、Team/Boss、Workflow 和 presentation 保留。

证据：[reliability-batch 目录](../output/claude-upstream-review-20261019/reliability-batch/)，含旧基线故障断言、最终回归日志、类型检查比较、构建日志、相关文件基线与 hash、Electron 场景和重试界面截图。

基线为当前脏工作树的选定文件快照，不是干净 checkout。最初 12 个文件在修改前保存；其余文件分批补采，其中 `coreSchemas.ts` 和 `mcpOutputStorage.ts` 已在改写后保存。快照清单分别注明来源，不能将整套快照视为完整的改动前基线；Hook 故障复现使用的是最初保存的 `toolHooks.ts`。
