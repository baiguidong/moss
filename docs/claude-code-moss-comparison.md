# Claude Code 2.1.88–2.1.310 对 Moss 的借鉴分析

## 基线和证据边界

Moss 的初始提交 `3ea8f0bf` 的 `package.json` 明确是 `@anthropic-ai/claude-code@2.1.88`；当前 `package.json` 已改为 `moss@0.0.17`，所以应把 2.1.88 当作 Moss 的泄漏基线，而不是把当前版本号当成 Claude Code 版本。

上游公开 Git 仓库提供各版本 `CHANGELOG.md` 标签。npm 的 2.1.310 包已经是平台 wrapper（`cli-wrapper.cjs`、`install.cjs`、平台入口和 SDK 类型），没有后续 CLI 源码。因此 2.1.88 后的逐文件实现不能从官方 npm 包直接恢复；本报告把 **Moss 中仍保留的 2.1.88 源码** 作为可验证实现样本，把后续 changelog 描述作为行为证据，推断部分明确写成借鉴方案。

完整逐条清单和归类见 [`claude-code-changelog-2.1.88-2.1.310.csv`](./claude-code-changelog-2.1.88-2.1.310.csv)，统计总览见 [`claude-code-changelog-2.1.88-2.1.310.md`](./claude-code-changelog-2.1.88-2.1.310.md)。

## Moss 已经具备的实现基础

| Claude Code 演进点 | Moss 现状 | 代码证据 | 判断 |
|---|---|---|---|
| 长会话、自动压缩、Prompt Cache 稳定性 | 有自动压缩阈值、压缩失败熔断、Prompt Cache 追踪和恢复逻辑 | [`src/services/compact/autoCompact.ts`](../src/services/compact/autoCompact.ts:24)、[`src/services/compact/compact.ts`](../src/services/compact/compact.ts:400)、[`src/services/api/promptCacheBreakDetection.ts`](../src/services/api/promptCacheBreakDetection.ts:1) | 已覆盖，继续吸收上游 bugfix |
| Hook 事件和 PermissionDenied | 已有 typed hook schema，包含 `PermissionDenied`、`PermissionRequest`、`PreCompact`、`WorktreeCreate` 等；实现层已有 `executePermissionDeniedHooks` | [`src/types/hooks.ts`](../src/types/hooks.ts:48)、[`src/utils/hooks.ts`](../src/utils/hooks.ts:3359) | 已覆盖，但 `defer`、通用 output rewrite、Hook 限流仍有缺口 |
| Tool Search / MCP 延迟加载 | 已有 ToolSearch，MCP 工具支持 `alwaysLoad`，并按 server 分组激活 | [`src/tools/ToolSearchTool/prompt.ts`](../src/tools/ToolSearchTool/prompt.ts:41)、[`src/services/mcp/client.ts`](../src/services/mcp/client.ts:1551) | 已覆盖，可借鉴后续启动非阻塞和协议升级 |
| Agent、后台任务、团队通信 | Agent 支持 fork、in-process teammate、tmux/iTerm2、worktree；`Task` 有状态、输出文件、通知；`SendMessage` 有团队 mailbox | [`src/tools/AgentTool/AgentTool.tsx`](../src/tools/AgentTool/AgentTool.tsx:297)、[`src/tools/shared/spawnMultiAgent.ts`](../src/tools/shared/spawnMultiAgent.ts:870)、[`src/Task.ts`](../src/Task.ts:6)、[`src/tools/SendMessageTool/SendMessageTool.ts`](../src/tools/SendMessageTool/SendMessageTool.ts:520) | 已有骨架；跨会话、预算、嵌套深度和统一 Agent View 尚不等价 |
| Worktree / 非 Git VCS Hook | 已有 Enter/ExitWorktree、WorktreeCreate hook 和路径安全处理 | [`src/utils/worktree.ts`](../src/utils/worktree.ts:740)、[`src/types/hooks.ts`](../src/types/hooks.ts:158) | 已覆盖 |
| AGENTS.md / 项目指令 | 已支持 `CLAUDE.md` 与 `AGENTS.md`，并以 AGENTS.md 为 Moss 主指令 | [`src/utils/instructionFiles.ts`](../src/utils/instructionFiles.ts:1)、[`src/utils/mossmd.ts`](../src/utils/mossmd.ts:1) | 已覆盖 |
| MCP OAuth、Elicitation、连接池 | 有 MCP client、OAuth、端口回调、Elicitation 和连接池 | [`src/services/mcp/client.ts`](../src/services/mcp/client.ts:1)、[`src/services/mcp/auth.ts`](../src/services/mcp/auth.ts:1)、[`src/services/mcp/elicitationHandler.ts`](../src/services/mcp/elicitationHandler.ts:1) | 已覆盖主干；需补 provider 特殊场景 |
| 权限、Bash/PowerShell 安全和 sandbox | 有统一 permission result、Bash/PowerShell AST/路径检查和 sandbox-runtime 适配 | [`src/types/permissions.ts`](../src/types/permissions.ts:162)、[`src/tools/BashTool/bashPermissions.ts`](../src/tools/BashTool/bashPermissions.ts:1)、[`src/utils/sandbox/sandbox-adapter.ts`](../src/utils/sandbox/sandbox-adapter.ts:174) | 已覆盖基础；凭据 mask、classifier 和严格策略仍可增强 |
| API 重试、流式恢复、provider 兼容 | 有 retry budget、thinking fallback、streaming/non-streaming fallback、Bedrock/Vertex/Foundry | [`src/services/api/withRetry.ts`](../src/services/api/withRetry.ts:44)、[`src/services/api/claude.ts`](../src/services/api/claude.ts:1) | 已覆盖基础；fallback model、gateway hint 和新协议需核对 |
| Remote / Cloud / Desktop host | 有 direct-connect、remote permission bridge、Electron host、WebUI、App runtime | [`src/remote/directConnectManager.ts`](../src/remote/directConnectManager.ts:1)、[`src/remote/remotePermissionBridge.ts`](../src/remote/remotePermissionBridge.ts:1)、[`packages/app-runtime/src/host/index.mjs`](../packages/app-runtime/src/host/index.mjs:1) | Moss 已走自己的宿主路线，不应照搬 VS Code/Claude Tag UI |
| Trace / OTel / 本地索引 | 有 trace record、tool trace、protocol trace、SQLite index | [`src/services/trace/traceRecord.ts`](../src/services/trace/traceRecord.ts:1)、[`src/services/trace/localIndex/traceIndex.ts`](../src/services/trace/localIndex/traceIndex.ts:1) | 适合吸收上游事件字段和关联模型 |
| Session Memory / Auto Memory | 有 SessionMemory、auto memory、dream/consolidation | [`src/services/SessionMemory/sessionMemory.ts`](../src/services/SessionMemory/sessionMemory.ts:1)、[`src/services/autoDream/autoDream.ts`](../src/services/autoDream/autoDream.ts:1) | 已覆盖，重点是压缩/恢复边界测试 |

## 最值得借鉴的功能

### P0：直接改善 Moss 核心体验

|功能|上游行为变化|Moss 缺口|借鉴实现|
|---|---|---|---|
|`defer` 权限决策（2.1.89）|PreToolUse hook 可以暂停 headless 工具调用；后续用 `-p --resume` 重新评估，而不是直接 allow/deny|Moss 的 `PermissionBehavior` 只有 `allow/deny/ask`（[`src/types/permissions.ts`](../src/types/permissions.ts:42)）|增加 `defer` 结果和 `PendingPermission` 持久记录；把 tool_use、输入、hook 快照、session id 写入 transcript/sidecar；resume 时重新执行 hook 和权限链，过期/拒绝要有确定性结果。先只给 `-p`、Remote 和 WebUI，交互终端仍用 ask。|
|统一 Monitor 工具（2.1.98、2.1.105、2.1.310）|模型可订阅后台脚本/事件流；有 deadline，结束时明确“无输出/已结束”，前台长 sleep 被限制|Moss 没有模型可调用的 `Monitor` 工具，只有本地资源监控 UI 和 Sleep/Cron|复用 `Task`、`LocalShellTask`、输出文件和 notification；新增 `MonitorTool`：创建 watch、读取增量 offset、最大 30 分钟（`-p` 更短）、退出/无输出/超时三种状态；把 watch 状态挂到 session engine dir，重启后可恢复或明确失效。|
|Agent 生命周期预算和统一列表（2.1.139、2.1.172、2.1.212、2.1.217、2.1.287）|`claude agents` 汇总 running/needs-input/completed；后台 fork、并发上限、session spawn 上限、嵌套深度和可停止状态逐步加入|Moss 有任务/团队 UI，但 teammate 明确限制为 flat（[`src/tools/AgentTool/AgentTool.tsx`](../src/tools/AgentTool/AgentTool.tsx:285)），没有 `/goal` 和统一跨会话状态协议|把 `Task` 扩展为 `parentId/depth/needsInput/lastHeartbeat/budget`；在 `AgentTool` 入口做 session、depth、concurrency 三层预算；将 agent metadata、task output、mailbox 统一投影到一个 `AgentRegistry`，CLI、Electron、WebUI 只订阅这个 registry。|
|Auto mode classifier + 可解释拒绝（2.1.193、2.1.246、2.1.271、2.1.278）|静态权限规则之外，classifier 判断任意 Bash/PowerShell/Monitor；拒绝原因出现在 transcript、toast、`/permissions`，并触发 PermissionDenied hook|Moss 有 coordinator/permission handlers，但没有名为 Auto mode 的统一 classifier 和决策审计|新增 `SafetyClassifier` 接口（本地规则/服务端模型可替换），输出 `allow/ask/deny + category + reason + confidence`；接入统一 permission pipeline，写入 `PermissionDecision` 与 OTel/trace；禁止把 classifier 结果当永久 allow rule。|
|跨会话 SendMessage/ListAgents（2.1.224、2.1.225、2.1.239）|同机和跨机器会话发现、按 name/ref 发送、`notify_when_idle` 单次通知；消息在忙时排队并显示 Needs input|Moss `SendMessage` 主要是 team/worker mailbox；已有 remote direct-connect 但没有统一 session registry|定义 session registry（本地 SQLite + 可选 server presence），统一 session identity/name/ref；消息 envelope 带 sender、target、request id、ttl、delivery state；忙会话只追加 queued user message，权限模式 bypass 的 inbound 默认 hold。|
|Hooks 生命周期补齐（2.1.121、2.1.152、2.1.214、2.1.295、2.1.307）|Hook 可 reload skills、改 session title、替换任意 tool output、限制失败策略、产生 safety event|Moss 已有 Hook registry，但 schema 只有 `updatedMCPToolOutput`，没有 `MessageDisplay`/`PreModelSwitch`/`onFailure: block` 等统一能力|把 Hook 事件定义集中到 `src/types/hooks.ts`，每个事件声明 input/output/timeout/failure policy；将 `updatedMCPToolOutput` 泛化为 `updatedToolOutput`；增加 per-event semaphore（默认 12）、超时、onFailure block；所有 permission/hook/sandbox 决策写 `safety_event`。|

### P1：稳定性、成本和运维

|功能|上游做法|Moss 建议|
|---|---|---|
|模型 fallback/effort/cache TTL（2.1.166、2.1.243、2.1.251）|主模型过载时按序 fallback；effort 按模型保存；主会话和 subagent 可分别设置 cache TTL|在 `src/services/api/withRetry.ts` 保留 retry budget，增加 provider capability 表和 fallback chain；模型切换前检查 context window，超限先摘要；把设置写入 Moss `models.text` 配置。|
|MCP 非阻塞启动和结果持久化（2.1.85、2.1.121、2.1.268、2.1.274）|非交互首轮有可配置等待上限；`alwaysLoad:false` 工具延迟到 Tool Search；断线重连和大结果落盘|Moss 已有 `alwaysLoad`/ToolSearch/输出落盘，下一步补 `MCP_STARTUP_WAIT_MS`、按 server 状态通知、重连退避和 protocol negotiation 能力缓存。|
|凭据 mask/严格 sandbox（2.1.187、2.1.221、2.1.224）|sandbox 可阻止读取 credential 文件/secret env，Linux 支持 mask + 出站重签名；managed policy 只能收紧|Moss `sandbox-adapter` 已做路径/域名和敏感文件保护；新增 credential provider 抽象，先做 deny + sentinel mask，再做 TLS terminate/SigV4，策略来源按 user/managed/project 分层并禁止项目放宽。|
|OTel 关联和安全审计（2.1.145、2.1.193、2.1.214、2.1.307）|tool span 带 agent/parent，事件带 message UUID、request id、tool source、classifier verdict/category|Moss 已有 trace/SQLite index；扩展 `traceRecord` schema，建立 session→turn→tool→agent→permission decision 链，内容默认脱敏，`OTEL_LOG_TOOL_DETAILS` 才放名称和参数。|
|压缩和大结果保护（2.1.88、2.1.98、2.1.261、2.1.296）|Prompt-too-long 后按密集文本重算；大 tool result 落盘并限制；`Read allow_large` 显式绕过|Moss 已有 autocompact circuit breaker 和 `mcpOutputStorage`；补 base64/SVG 密集文本估算、post-compact schema 重建、磁盘容量/截断标记测试。|

### 不建议直接搬运

- VS Code 专属面板、Claude Tag/Slack 管理、Claude apps gateway 的组织策略、具体云端 routine/artifact 管理，和 Moss 的 Electron/WebUI/App runtime 不是同一宿主。
- Fable/Opus/Sonnet 等具体模型名、价格和发布日期，应该由 Moss 的 provider/model capability 配置驱动，不能写死在工具和 prompt 中。
- Mods 是后期可编程 UI/Hook 运行时，Moss 已有 App runtime；应先评估 App capability 是否能覆盖需求，再决定是否引入第二套插件执行模型。

## 建议的实现顺序

1. **先做安全和状态底座**：`PendingPermission`、`AgentRegistry`、统一 Hook event/failure schema、decision trace；这四项会被 defer、Monitor、跨会话消息和 Auto mode 共用。
2. **再做 Monitor + agent budget**：沿用 `Task` 输出文件和现有通知，完成 watch deadline、增量读取、停止/超时和统一 UI 投影。
3. **接入 Auto mode classifier**：先本地确定性规则，再开放 provider/server classifier；所有结果都走同一 permission pipeline。
4. **补跨会话消息**：先同机 SQLite registry 和 queued delivery，再接已有 remote direct-connect；不把 team mailbox 当成跨会话协议。
5. **最后扩 provider/MCP/OTel**：fallback/effort、MCP startup wait/protocol、credential mask 和 safety event 在前面底座稳定后逐项上线。

每一阶段都应以行为测试为主：恢复中断的 deferred permission、watch 超时/无输出、并发和深度上限、消息重复/过期、classifier deny 后 retry、compaction 后 tool schema/cache 稳定性。
