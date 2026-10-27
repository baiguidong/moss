# Claude Code 2.1.88–2.1.310：REA 逆向与 Moss 借鉴方案

生成时间：2026-10-27。Moss 的泄漏基线是初始提交 `3ea8f0bf` 中的 `@anthropic-ai/claude-code@2.1.88`。本报告先梳理 2.1.88–2.1.310 的全部变更，再用 REA 对 2.1.88 的源码标记模块和几个后续 Bun 产物做静态核验，最后给出 Moss 的借鉴优先级。

## 结论先行

这 223 个版本号中实际发布了 181 个版本，共 6,354 条 changelog 条目。按条目首要语义分类，约 67% 是 bug 或回归修复，约 11% 是新功能，约 9% 是改进，约 8% 是行为变化或弃用。上游的主要工作不是不断添加孤立工具，而是把长会话、后台 Agent、MCP、Hook、权限、沙箱和多宿主恢复做成有边界的状态机。

对 Moss 最有价值的借鉴集中在六个底层能力：

1. 权限决策的可恢复状态，尤其是 headless/远程模式的 `defer`。
2. Prompt-too-long 后的压缩、截断、附件重建和失败熔断。
3. MCP 调用的总截止时间、进度续期、重连和 elicitation 结果处理。
4. 后台进程的事件流工具 `Monitor`，以及 Agent 的统一生命周期和预算。
5. 延迟工具的占位、Tool Search 激活和 schema 未加载时的安全拒绝。
6. 文件真实路径、符号链接、凭据文件和 sandbox 的一致权限判断。

Moss 当前已经有不少对应骨架：自动压缩和 reactive compact、Tool Search、MCP OAuth/Elicitation、Agent/teammate mailbox、大结果落盘、sandbox-runtime、PermissionDenied hook 和 OTel trace。因此实际工作应以边界修复和协议统一为主，而不是复制一套 Claude Code。

## 资料、版本和证据边界

### Changelog 全量资料

- [逐条 CSV](./claude-code-changelog-2.1.88-2.1.310.csv)：181 个发布号、6,354 条原始条目、6,310 条文本去重后条目。
- [统计梳理](./claude-code-changelog-2.1.88-2.1.310.md)：按十版本窗口、发布号、领域和条目类型统计。
- [Moss 对比初稿](./claude-code-moss-comparison.md)：当前 Moss 代码覆盖情况和初步优先级。

CSV 的 `kind` 是便于聚类的首要语义，不是上游官方标签：`Fixed/Resolved` 归为 bugfix，`Added` 归为 feature，`Improved/Updated` 归为 improvement，`Changed/Removed/Deprecated` 归为 behavior/deprecation。包含多个动作的条目按主要风险归类，因此不能把百分比理解为精确的产品投入比例。

### REA 操作

REA 已安装为 `rea@6.5.0`。2.1.88 bundle 从 Git 对象导出到 `/tmp/moss-cli-88.js`，再按 `// src/...` 标记拆出目标模块。完整应用分析因 1 GiB worker 限制 OOM；对小模块的 JavaScript 静态分析成功，得到以下 Evidence：

| 目标 | REA Evidence | 解析文件/发现数 | 直接观察到的内容 |
|---|---|---:|---|
| compact | `ev_97ad26f9c3823cc5a8577044029637726e478a50c5cfac7c000244439cc44872` | 6 / 0 | 上下文窗口、自动压缩阈值、Prompt-too-long 重试、压缩提示和附件路径 |
| hooks | `ev_9125f8037f6132d5bf54fe82e4ea0d0b34f77dea7a5e5fca303a4d4c59df57a0` | 7 / 4 | Hook 输出 schema、PermissionDenied、Pre/PostToolUse、异步 Hook registry |
| MCP | `ev_9f91f7e737619dfa423c928dca3384c36b7e5cecf54bdb33b40963e6f8d973aa` | 4 / 23 | 连接超时、工具超时、OAuth 缓存、重连、URL elicitation retry |
| agents/team | `ev_ca208a95b351b0a6244d5c4a948edd1759d62c4eb8edf61dc340c5905508eff2` | 8 / 10 | `runAgent`、异步生命周期、AsyncLocalStorage teammate context、mailbox |
| security | `ev_64926728c9b8e738656485d7283cbd4911a3bcb0a5586a2262439388a3bc356e` | 6 / 27 | sandbox 配置转换、真实路径、读写权限和权限决策优先级 |
| tools | `ev_32483b5c009cf3ea8cbff691302c8a6f4bd4222a2f0997f27a56ae8f17a16edf` | 7 / 7 | retry/fallback、Deferred Tool Search、结果持久化和预算 |

REA 不能直接证明未执行的运行时路径；静态 AST 也不能证明某个分支在所有宿主中都会执行。Wakaru、Hopper、Ghidra、IDA 均未配置，所以没有声称已经对后续 Bun Mach-O 完成函数级反编译。

### 后续版本产物

从 npm 下载了 Darwin ARM64 平台包并用 REA `inspect_macho` 检查。它们都是不同的 Bun 编译产物，`__BUN` 段大小如下：

| 版本 | `__BUN` 段 | REA Evidence |
|---|---:|---|
| 2.1.119 | 139,296,768 | `ev_6a0fb86fb41533ce801d4c72d3f6cb1b1791e775134e97e4b5cc72a445872241` |
| 2.1.157 | 140,951,552 | `ev_3ac3fc702ad7da452236fbe54ea27b9938f53f5b767bb8218b524d0e74af8b7a` |
| 2.1.198 | 165,380,096 | `ev_393db258f1523e77d36f20b163228abce5b17e7f98108283926a042fb19f6d2a` |
| 2.1.239 | 255,016,960 | `ev_66081f2ae605a15ca712b86d9e333b3c4614df65b41f9944a3cf81a4ecf7c900` |
| 2.1.269 | 135,331,840 | `ev_417cdfa492d8aaf679d94bab07fd129a36531c20c57ace0e510a868c08e538b9` |
| 2.1.310 | 180,027,392 | `ev_995eb03203e791411e217f6eb8ef0afe036f50a18b7cd4e17eec534afc560321` |

`strings` 提取的 JS 文本补充了后续版本的实现线索，例如 `permissionDecision=defer`、`hook_deferred_tool`、`DeferredToolPlaceholder`、`getMcpToolTimeoutMs`、`maxTotalTimeout`、`resetTimeoutOnProgress`、`Monitor` 和 Prompt cache TTL。字符串命中是二进制中的实现线索，不等于可编译源码。

## 2.1.88–2.1.310 的全部改动如何归纳

### 按二十版本窗口看演进重心

| 窗口 | 发布数 | 条目数 | bug/回归 | 新功能 | 主要重心 |
|---|---:|---:|---:|---:|---|
| 88–107 | 12 | 359 | 235 | 45 | 长会话、文件/Git 工具、终端输入和初始 MCP/Hook 稳定性 |
| 108–127 | 16 | 383 | 220 | 47 | MCP、插件、Hook、skills 与配置优先级 |
| 128–147 | 16 | 449 | 327 | 41 | Agent、后台任务、worktree、上下文恢复 |
| 148–167 | 17 | 299 | 188 | 33 | Agent view、worktree、模型和终端回归 |
| 168–187 | 15 | 245 | 168 | 29 | 后台 Agent、模型 provider、权限和 session 恢复 |
| 188–207 | 16 | 281 | 193 | 33 | 后台 Agent 默认化、provider failover、团队消息 |
| 208–227 | 19 | 464 | 309 | 52 | Agent registry、跨会话消息、Git/worktree 和策略边界 |
| 228–247 | 17 | 480 | 296 | 50 | Remote/cloud、MCP、Prompt cache、全屏 UI 和权限规则 |
| 248–267 | 13 | 506 | 354 | 50 | provider 能力、后台 fan-out、压缩和 headless session |
| 268–287 | 19 | 1,550 | 1,021 | 176 | 大量 IDE/cloud/remote 功能和高密度稳定性修复 |
| 288–307 | 18 | 1,232 | 881 | 120 | Hook/plugin 安全边界、Agent map、MCP、Session 恢复 |
| 308–310 | 3 | 106 | 79 | 7 | Monitor、MCP timeout 语义、Prompt-too-long 和符号链接安全 |

2.1.268 以后条目数明显增加，主要是 VS Code、cloud、Claude Tag、Code Review 等宿主产品一起发布。Moss 应优先取核心 CLI/Agent 条目；完整的宿主分类仍保存在 CSV 中。

### 按功能域梳理

| 领域 | 主要新增/改进 | 主要 bug 类型 | 对 Moss 的相关度 |
|---|---|---|---|
| sessions/context/memory | 自动/手动 compact、reactive compact、session memory、Prompt cache TTL、resume/fork、`/goal` | 压缩后重复执行 skill、Prompt cache miss、过大 transcript、恢复错目录或错模型 | 最高 |
| agents/background/workflows | 后台默认化、Agent view/ListAgents、通知、跨会话 SendMessage、并发/嵌套限制、worktree | 任务卡死、孤儿 worktree、状态错报、重启后丢失、消息唤醒失效 | 最高 |
| mcp/plugins/hooks/skills | Tool Search、延迟 schema、MCP OAuth/elicitation、插件 skills、Hook reload、`onFailure:block` | 连接超时、OAuth 非 JSON、重连失败、Hook 空输出/错误放行、插件权限越界 | 最高 |
| git/files/tools | EnterWorktree、非 Git `WorktreeCreate`、Bash diff、结果落盘、Read/Edit/Write 大文件保护 | 符号链接、`tee` 绕过路径规则、CRLF、worktree 根目录和 stale worktree | 高 |
| security/sandbox/permissions | Auto mode classifier、sandbox 网络/文件策略、credential mask、managed policy ceiling | 真实路径判断错误、凭据泄漏、策略优先级反转、sandbox 不可用时误放行 | 最高 |
| models/api/providers | fallback model、effort、Bedrock/Vertex/Foundry、retry watchdog、gateway discovery | 网关 beta 不兼容、流式重复计费、STS 过期、错误重试死循环 | 高 |
| terminal/ui/input | 全屏 renderer、虚拟滚动、kitty/SSH 输入、粘贴、Voice、输出样式 | 重绘、焦点、鼠标报告、CJK/组合字符、后台通知丢失 | 中，取决于 Moss 宿主 |
| IDE/cloud/remote | Agent map、Hook/Permission 对话框、cloud session、Remote Control、环境脚本 | session 复位、云端状态、权限 UI、恢复/重连和跨宿主同步 | 中，Moss 有自己的宿主 |
| telemetry/observability | tool_use_id、agent/parent span、repository attributes、`safety_event` | trace fragmentation、敏感参数、后台状态和权限决策无法关联 | 高 |

### 代表性的新增功能与 bug 修复

下面的例子用于说明类别，不替代 CSV 的逐条清单。

- **2.1.88 基线**：新增 `PermissionDenied` hook，`{retry:true}` 可让模型重试；修复长会话工具 schema 变化导致的 Prompt cache miss、嵌套 `CLAUDE.md` 重复注入、超大 Edit/Write 和 session 文件崩溃。
- **2.1.119**：配置写入 `settings.json` 并按 project/local/policy 覆盖；Hook 输入增加 `duration_ms`；MCP OAuth 非 JSON 响应、环境变量占位符、插件 MCP 和 stale worktree 的错误路径被修复；Vertex 默认关闭 Tool Search 以避开不支持的 beta header。
- **2.1.157**：`.claude/skills` 插件自动加载、EnterWorktree 中途切换、后台 Agent 生命周期和 sandbox 网络询问修复；工作树清理与 `/resume` 状态成为稳定性重点。
- **2.1.198**：后台 Agent 默认运行并通过 `Notification` hook 报告 `agent_needs_input`/`agent_completed`；网络短断自动 backoff；Agent team API 错误向 lead 报告 `failed`，给卡住的 teammate 发消息会唤醒重试。
- **2.1.239**：跨机器 `ListAgents`/`SendMessage` 在 Windows 可用；MCP transient 5xx 重连、elicitation 表单布局、Prompt cache 和 worktree/session 标识修复；`/goal` 退避策略从固定周期改为逐级增加。
- **2.1.269**：Workflow 并发 Agent 可配置；Bash 结果可附带文件 diff；修复输出截断后的 cache、后台 Agent 状态错报、超大 Agent SDK Prompt 永久卡在 Prompt-too-long、MCP 配置只调整 URL query 顺序却错误重连。
- **2.1.310**：Monitor 取代长前台 sleep 的轮询方式；MCP elicitation 未回答时超时错误明确要求不要重复调用；压缩后的密集 base64/SVG 仍过大时继续丢弃更多历史；文件权限提示显示符号链接目标；网关拒绝 `effort-2025-11-24` 或中途 system message 时降级重试。

## REA 对 2.1.88 的实现还原

### Compact 和 Prompt-too-long

REA 导出的 `/tmp/rea-targets/compact/01_120_src__services__compact__autoCompact.ts` 直接显示了以下算法：

```text
effectiveWindow = contextWindow - min(modelMaxOutput, 20000)
autoCompactThreshold = effectiveWindow - 13000
warning/error = threshold - 20000
manual blocking limit = effectiveWindow - 3000
MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
```

`autoCompactIfNeeded` 先排除 `session_memory` 和 `compact` 来源，按 token 估计判断是否压缩；失败次数达到 3 次后熔断，避免对不可恢复的 Prompt-too-long 每轮重复调用压缩 API。压缩成功后会清理旧 summary、刷新 user context，并把文件、Agent、Plan、Skill、MCP、Deferred Tool 等 attachment 重新注入。

`compact.ts` 和 `prompt.ts` 还表明 Prompt-too-long 不是简单删除一条消息：压缩请求本身超限时按 API round 丢弃前部消息，最多重试固定次数；压缩提示要求模型只输出 `<analysis>`/`<summary>` 文本，禁止工具调用；继续会话时附带完整 transcript 路径和“Recent messages are preserved verbatim”提示。

后续 Moss 代码已经吸收了这条思路：`src/services/compact/autoCompact.ts` 有三次熔断和 `isCompactionEffective`，`src/services/compact/compact.ts` 有 compaction request 的 Prompt-too-long 截断，`src/query.ts` 有 server-side Prompt-too-long 的 reactive compact。剩余风险是密集文本估算、附件预算和 headless 大 transcript，需要继续补行为测试。

### Hook、PermissionDenied 和 async hook

REA 导出的 `/tmp/rea-targets/hooks/05_165_src__types__hooks.ts` 显示 Hook 响应是按 `hookEventName` 细分的 union，而不是任意 JSON。核心字段包括：

- `PreToolUse`：`permissionDecision`、`permissionDecisionReason`、`updatedInput`、`additionalContext`。
- `PostToolUse`：`updatedMCPToolOutput`、`additionalContext`。
- `PermissionDenied`：`retry?: boolean`。
- `PermissionRequest`：结构化 allow/deny 和权限更新。
- `Elicitation`/`ElicitationResult`：`accept/decline/cancel` 与内容。
- `async:true`：可选 `asyncTimeout`，默认由异步 registry 限制。

`runPreToolUseHooks` 先把 Hook 结果转换为 allow/ask/deny，再由 `resolveHookPermissionDecision` 检查 `requiresUserInteraction`、`requireCanUseTool`、deny/ask 规则和 bypass mode。Hook 的 allow 不能覆盖更高优先级 deny；ask 会重新进入 `canUseTool`。`runPostToolUseHooks` 可以产生 additional context、阻断 continuation、改写 MCP tool output，并把错误变成 transcript attachment。

`AsyncHookRegistry` 用 `pendingHooks` 保存进程、Hook id、事件、工具名、开始时间、timeout 和输出读取器；完成时只接受非 `async:true` JSON 响应，退出或 session 结束时统一 finalize/kill。这样可以解释 2.1.88–2.1.119 中“空的 async PostToolUse 不写入 transcript”“Hook 运行时显示进度”和后续 `onFailure:block` 的演进方向。

后续二进制字符串进一步显示了 `defer` 的边界：

- 交互模式返回 `permissionDecision=defer` 会被忽略。
- 非交互 `-p` 模式会记录 `tengu_pre_tool_hook_deferred`，创建 `hook_deferred_tool`，保存 `toolUseID/toolName/toolInput/hookName/hookEvent/permissionMode`，等待 resume。
- 一个 assistant message 中有多个 sibling tool call 时，defer 会被忽略，避免只暂停一个调用而让其它调用成为 orphan。
- 2.1.310 对 served call 明确写出“refusing (no resume machinery)”，说明远程 served session 没有 resume 能力时必须 fail closed。

Moss 已有 `PermissionDenied` schema 和 `executePermissionDeniedHooks`（见 `src/types/hooks.ts`、`src/utils/hooks.ts`），但 `PermissionBehavior` 仍是 `allow/deny/ask`。应增加持久化 `defer`，并为交互、`-p`、remote/served 三种模式分别定义语义，不能把 `defer` 当作普通 ask。

### MCP 连接、超时、重连和 elicitation

REA 导出的 `/tmp/rea-targets/mcp/00_051_src__services__mcp__client.ts` 显示 MCP client 有独立生命周期：

1. `getConnectionTimeoutMs()` 给连接建立设置上限，`Promise.race(connectPromise, timeoutPromise)` 超时会关闭 transport 和 in-process server。
2. `getMcpToolTimeoutMs()` 给工具调用设置总超时；调用同时传入 SDK `timeout`、AbortSignal 和 `onprogress`，外层再用 `Promise.race` 防止 SSE 中途断流时 SDK 不返回。
3. 连接失败后可 `ensureConnectedClient`，`reconnectMcpServerImpl` 清理 server cache，连接成功后并行拉取 tools/commands/resources。
4. MCP auth 失败会写 `mcp-needs-auth-cache.json`，TTL 约 15 分钟，避免每轮重复弹认证。
5. `callMCPToolWithUrlElicitationRetry` 识别 JSON-RPC `-32042`，校验 URL、elicitationId、message，依次执行 Elicitation hook、用户交互和 ElicitationResult hook，最多重试 3 次。

2.1.310 字符串中出现 `maxTotalTimeout`、`resetTimeoutOnProgress`、`onprogress`，说明后续把超时从固定总时长演进为“总 deadline + 有效进度续期/进度状态”的组合；changelog 同时要求非交互模式在 elicitation 无响应时返回“没有收到回答，不要重复调用”。

Moss 已有相同的 OAuth/Elicitation/reconnect 主干（`src/services/mcp/client.ts`、`src/services/mcp/auth.ts`、`src/services/mcp/elicitationHandler.ts`），还实现了大结果落盘和 live catalog。当前 `MCP_TOOL_TIMEOUT` 默认值约 27.8 小时，适合长任务但缺少明确的总 deadline/进度策略；建议增加分层配置，而不是直接改成 30 秒：连接 deadline、首字节 deadline、无进度 idle deadline、总 deadline，并在结果中区分 elicitation 未回答、连接失败和真正超时。

### Agent、team 和 mailbox

REA 导出的 `runAgent`/`runAsyncAgentLifecycle` 展示了 Agent 不是一次函数调用，而是带上下文和清理的生命周期：

- 创建稳定 `agentId`，记录 parent/session/transcript 子目录。
- 根据 Agent 定义、来源、permissionMode、async 与主线程过滤工具。
- 子 Agent 可拥有额外 MCP server，连接后只在自己的生命周期内清理动态 client。
- 异步循环逐条保存消息、更新 token/tool-use/activity 进度，完成时生成摘要和 notification，Abort 时保存 partial result 并清理。
- `AsyncLocalStorage` 保存 in-process teammate context，包含 team name、agent name、parent session id、plan mode 等。

`teammateMailbox.ts` 使用每个 agent 的 JSON inbox 和 `.lock` 文件；读取未读消息、按 index 或 predicate 标记已读，消息 schema 覆盖 shutdown、permission、sandbox、plan approval、mode set 和 idle notification。这个实现解释了后续“卡住 teammate 被消息唤醒”“Agent API 错误向 lead 报告 failed”“跨会话 `ListAgents`/`SendMessage`”为什么需要结构化 envelope 和稳定 agent identity。

Moss 已有 `Task`、in-process teammate、worktree、SendMessage 和 UI，但还没有统一的跨会话 `AgentRegistry`。建议把 `parentId/depth/needsInput/lastHeartbeat/budget` 加到任务元数据，CLI/Electron/WebUI 都订阅 registry；团队 mailbox 可以继续作为低层传输，但不要把它直接当跨机器协议。

### Sandbox 和真实路径

REA 的 security 模块把 sandbox runtime 配置、文件系统路径验证和工具权限分开。`checkReadPermissionForTool`/`checkWritePermissionForTool` 会对 Read/Edit/Write/Notebook 等工具生成待检查路径，`realpath` 和 symlink 处理参与最终决策；`hasPermissionsToUseToolInner` 的优先级为 deny rule → ask rule/工具自身检查 → bypass/plan 规则 → always-allow rule → ask。

2.1.310 的 changelog 修复了“读文件权限提示不显示符号链接指向哪里”，说明安全判断和用户解释必须使用同一条真实路径解析结果。后续还修复了 Bash `tee` 绕过 Edit deny、credential 文件读取、sandbox 不可用和 AppArmor 的提示。

Moss 已有 sandbox adapter、Bash/PowerShell 路径检查和 `realpath` 相关逻辑。借鉴重点是：把 `displayPath`、`resolvedPath`、`decisionPath` 写进统一 `PermissionResult`；当 symlink target 在 deny 区时，提示目标而不是只显示 link 本身；managed policy 只能收紧用户规则，项目配置不能放宽。

### Deferred Tool Search、结果持久化和 retry

REA 的 Tool Search 模块暴露了一个关键安全约束：工具只有名字而没有 schema 时不可调用。`getDeferredToolsCacheKey` 对当前工具名排序生成 key，工具集合变化就清缓存；`searchToolsWithKeywords` 先 exact，再 prefix，再关键词匹配；`DeferredToolPlaceholder` 是保留占位工具，不能真的调用。

2.1.310 字符串显示：未加载 schema 的工具调用会返回“先用 Tool Search 加载 schema，再重试”，而不是把数组/数字参数当字符串发给服务器。Moss 当前 ToolSearch 已有 exact/prefix/keyword、MCP server 分组和 cache invalidation，重点是统一错误类型和把“schema 未加载”写成可恢复的 tool result。

`toolResultStorage.ts` 的实现会按 tool_use_id 把大结果写到 session engine 目录，返回 preview、原始大小、存储大小、截断标记和 `<persisted-output>` 指令；`enforceToolResultBudget` 再按会话预算清理旧内容。`withRetry.ts` 则把 retry context、retry-after、ECONNRESET、529、thinking token 调整和 `FallbackTriggeredError` 分开。Moss 已经有等价大结果落盘和 retry budget，应补密集文本、磁盘不足、恢复读取和 fallback chain 测试。

## 后续版本如何把这些实现演进成行为

### 2.1.119：配置、MCP 和 headless 一致性

这一阶段把交互和 `--print` 的行为拉齐：Agent frontmatter 的 `tools`/`disallowedTools`、`permissionMode` 在 headless 中生效；MCP server reconfiguration 并行连接；PostToolUse 增加 `duration_ms`；Vertex 因 beta header 不兼容默认关闭 Tool Search。大量修复集中在 OAuth 非 JSON、插件 MCP、配置优先级、async Hook 空输出和 stale worktree。

**可还原的设计**：配置源必须带 precedence；headless 不能绕过 Agent 工具限制；MCP 连接批次应 `Promise.all` 但每个 server 保留独立状态；Hook 输入要包含 tool id、duration 和绝对路径。

### 2.1.157：插件 skill、worktree 和后台 Agent 清理

`.claude/skills` 自动加载降低了插件安装门槛；EnterWorktree 能中途切换；后台 Agent 的完成、Esc 取消、休眠恢复、30 天清理和 worktree 解锁成为一组完整生命周期修复。

**可还原的设计**：任务结束条件必须等待 parked/后台 shell 清理；worktree 绑定 session/job，不依赖当前 cwd；重启后先恢复状态再展示 UI；清理任务要处理孤儿目录和 stale lock。

### 2.1.198：后台默认化和通知

后台 Agent 逐步变成默认路径，`Notification` hook 用结构化类型报告需要输入或完成；模型、extended thinking 和 compaction 配置向下传递；短网络掉线用 backoff；agent team 的失败/唤醒通过 mailbox 传播。

**可还原的设计**：后台任务状态至少需要 `running/needs_input/completed/failed/cancelled`，通知应该是幂等事件而不是只更新 UI 文本；重试和唤醒要由 request id 去重。

### 2.1.239：跨会话发现和策略退避

`ListAgents`/`SendMessage` 开始承担跨机器 session registry；`/goal` check-in 退避为 30 分钟、1 小时、2 小时；MCP transient 5xx 重连，Remote session 保持 hook 期间的 keep-alive；Prompt cache 和 session title 处理更强调持久化边界。

**可还原的设计**：定义 session identity/name/ref、presence、queued/delivered/expired 状态和 TTL；长 Hook 不应让容器被 idle reap；重复 title/update 要限流去重。

### 2.1.269：高并发 fan-out 和 headless 恢复

Workflow Agent 并发可由 `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` 提升；Bash 可返回文件 diff；恢复中断的 headless session、Prompt cache、MCP config、plugin archive 权限和 Agent status 大量修复。

**可还原的设计**：并发上限、总预算和嵌套深度在 Agent 入口统一检查；输出截断、模型切换和 retry 必须共享同一 transcript turn id；插件解包使用用户私有权限、清理旧文件并拒绝 world-writable。

### 2.1.310：Monitor、网关兼容和压缩后密集文本

Monitor 是模型可调用的后台进程事件流：每行 stdout 作为通知；前台长 sleep 被阻止，轮询由 Monitor 的 until-loop 负责。它与 Moss `ui/src/resource-monitor` 的 CPU/内存监控不是同一个能力。

网关兼容修复采用降级重试：如果 provider 拒绝 `effort-2025-11-24` beta 或中途 system message，就删除不兼容部分重新请求。Prompt-too-long 修复进一步识别 base64/SVG 等“字符很多但信息密度高”的内容，压缩后仍超限时继续丢弃更多对话。符号链接权限提示和 Windows Git Bash 缺失的 Hook 判定则是典型 fail-closed 修复。

## Moss 借鉴判断

### P0：建议直接进入实现排期

| 项目 | Moss 当前状态 | 建议落点 | 需要验证的 bug |
|---|---|---|---|
| `defer` 权限和恢复 | `PermissionBehavior` 只有 allow/deny/ask；已有 PermissionDenied hook | `PendingPermission` sidecar/transcript，保存 tool call、Hook 快照、mode、过期时间；resume 重新执行完整权限链；交互模式忽略，served 无 resume 时拒绝 | 重启、多个 sibling tool、重复 resume、过期和 deny 后 transcript 一致 |
| Prompt-too-long 防循环 | 已有三次压缩失败熔断和 reactive compact | 加 dense-text 估算、附件预算、压缩后 schema/cache 重建，明确“无完整 earlier exchange”时终止 | base64/SVG、超大 transcript、压缩结果仍超限、Agent SDK `-p` |
| MCP deadline/elicitation | 已有 OAuth、Elicitation、重连和结果落盘；默认工具 timeout 很长 | 增加 connect/first-byte/idle-progress/total 四类 deadline，进度只续期 idle，不突破总 deadline；超时错误区分未回答 elicitation | 进度永不结束、SSE 半断、hook 接受/拒绝、headless 无回答 |
| 真实路径权限 | 已有 sandbox adapter 和 Bash/PowerShell path checks | 统一 `linkPath/resolvedPath/decisionPath`，提示 symlink target；`tee`、Notebook、MCP 写入共用 resolver | link→deny、link→不存在、循环 link、worktree path |

### P1：基础能力稳定后实现

| 项目 | 借鉴方式 |
|---|---|
| Model-facing Monitor | 复用 Moss `Task`、后台 shell、输出文件和通知；新增 watch id、增量 offset、deadline、无输出/退出/超时三种结果。不要复用资源 Monitor 的 UI 协议。 |
| Agent Registry 和预算 | 扩展 `Task` 为 parent/depth/heartbeat/needsInput/budget；统一 CLI、Electron、WebUI 视图；先同机 SQLite，再接 remote direct-connect。 |
| DeferredToolPlaceholder | ToolSearch 已有主体，补 schema 未加载的确定性错误、调用重试指令、placeholder 生命周期和跨 compaction 的 activated set。 |
| Hook 事件/失败策略 | 把 `updatedMCPToolOutput` 泛化为 `updatedToolOutput`；统一 per-event timeout、并发 semaphore、`onFailure:block` 和 `safety_event`；`PermissionDenied.retry` 做端到端测试。 |
| 大结果和 fallback | 保留当前落盘格式，补磁盘不足/截断标记/恢复读取；在 retry budget 上增加 provider capability 和 fallback chain，先检查 context window 再换模型。 |
| OTel 安全关联 | 在现有 trace/SQLite index 中加入 session→turn→tool→agent→permission decision，参数默认脱敏，显式开关才记录 tool details。 |

### P2：按 Moss 产品路线选择

- `ListAgents`/`SendMessage` 跨机器协议、Remote Control、cloud session 组织权限：Moss 已有 remote/direct-connect，但要先确定 session registry 和权限模型。
- VS Code 专属 Agent map、Hook/Permission 对话框、Claude Tag/Code Review 管理：Moss 有自己的 Electron/WebUI，不应照搬宿主 UI。
- 具体模型名、价格、provider beta 和上游产品命名：使用 Moss 的 provider capability 配置，不能把 Claude Code 的常量写死。

## 建议的实施顺序和验收

先做四个共用底座：`PendingPermission`、`AgentRegistry`、统一 Hook event/failure schema、decision trace。然后实现 Monitor 和 Agent budget，再接入 classifier/跨会话消息，最后补 provider fallback、MCP protocol negotiation 和 credential mask。

每个阶段都应有行为测试，而不是只测函数返回值：

- deferred permission 在 `-p --resume`、进程重启、多个 tool call 和无 resume served session 下的状态转换。
- Monitor 的增量读取、无输出、退出码、超时、取消和重启恢复。
- Agent 并发/嵌套/预算上限、失败上报、重复通知、mailbox 幂等和孤儿 worktree 清理。
- MCP 进度续期、总 deadline、elicitation 接受/拒绝/无回答、连接半断和重连。
- Prompt-too-long 的密集文本、无可摘要历史、附件超预算、压缩失败熔断和 prompt cache 稳定性。
- symlink/`tee`/worktree/凭据文件的真实路径权限，以及所有 deny/ask/allow 决策的审计事件。

这套顺序能把 changelog 中反复出现的 bug 根因收敛到状态、预算、边界和恢复四类机制，优先改善 Moss 的核心 CLI/Agent 可靠性。
