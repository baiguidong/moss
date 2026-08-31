# Tengu 运行时开关审计

审计日期：2026-08-31

## 结论

项目中共确认：

- 51 个使用 `tengu_*` 命名的源码运行时键。
- 7 个只存在于旧 `bin/cli.js` 构建产物中的遗留键。
- `logEvent('tengu_*', ...)` 是遥测事件名，不属于运行时开关；当前 `logEvent()` 为空操作。

当前 `tengu` 开关不是远端服务端开关，也不是编译期开关。它们通过本地运行时配置解析，优先级为：

1. `MOSS_FEATURE_FLAG_OVERRIDES` 环境变量。
2. 全局配置中的 `featureFlagOverrides`。
3. 调用处提供的代码默认值。

真正的编译期开关使用 `feature('FEATURE_NAME')`，由 `scripts/features.js` 等构建配置控制。部分 `tengu_*` 开关位于编译期开关内部，因此只有对应功能被编译进产物后才可能生效。

## 处置标记

- **高级设置**：功能对用户可理解、可独立选择，适合放到“设置 -> 高级设置”。
- **使用现有设置**：已经存在正式设置，不应再增加重复开关。
- **固化**：保留当前行为，但移除实验开关和双路径代码。
- **内部配置**：代码可能有保留价值，但不适合让普通用户控制。
- **删除**：已经无效、属于遗留实验或当前架构不再需要。

## 高级设置候选

| 开关 | 当前默认值 | 功能 | 建议 |
| --- | --- | --- | --- |
| `tengu_amber_flint` | `true`，但整体功能默认关闭 | Agent Teams 总熔断。目前还需要 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 或 `--agent-teams` 才能启用。 | **高级设置**。整合成单一的“Agent 团队”设置，整体默认关闭。 |
| `tengu_auto_background_agents` | `false` | 前台 Agent 运行超过 120 秒后自动转为后台任务。 | **高级设置**。 |
| `tengu_scratch` | `false` | 创建会话级 scratchpad；协调者和 Worker 可以在其中免确认共享临时文件。 | **高级设置**。 |
| `tengu_sedge_lantern` | `false` | 终端失焦 5 分钟后生成“离开期间摘要”。 | **高级设置**。注明会增加一次模型调用。 |
| `tengu_destructive_command_warning` | `false` | 在 Bash/PowerShell 权限确认框中显示破坏性命令警告。 | **高级设置**。建议评估将正式默认值改为开启。 |
| `tengu_immediate_model_command` | `false` | 查询运行过程中立即执行 `/model`、`/fast`、`/effort`，而不是等待当前轮次结束。 | **高级设置**。 |
| `tengu_keybinding_customization_release` | `false` | 加载用户自定义快捷键配置。 | **高级设置**。 |
| `tengu_plan_mode_interview_phase` | `true` | Plan Mode 使用分阶段访谈和提问流程。 | **高级设置**。 |
| `tengu_willow_mode` | `"off"` | 大上下文闲置 75 分钟后提示用户使用 `/clear`。支持 `off`、`dialog`、`hint`、`hint_v2`。 | **高级设置**。使用枚举选择器。 |
| `tengu_attribution_header` | `true` | API 请求附带版本、入口和 workload 路由信息。 | **高级设置**。作为隐私和接口兼容选项。 |
| `tengu_amber_wren` | `{}` | 控制 Read 的大小与 token 限制。默认最大文件 256 KB、最大输出 25,000 token，另含范围提示参数。 | **高级设置**。拆为类型化数字/布尔设置，不暴露原始 JSON。 |
| `tengu_cobalt_raccoon` | `false` | 禁止主动 compact，仅在 API 返回上下文超限后执行响应式 compact。 | **高级设置**。命名为“上下文压缩策略”。 |
| `tengu_slate_heron` | `{ enabled: false, gapThresholdMinutes: 60, keepRecent: 5 }` | Prompt Cache 过期后清理旧工具结果，减少下次请求重传的 token。 | **高级设置**。拆为开关、时间阈值和保留数量。 |
| `tengu_compact_streaming_retry` | `false` | compact 流式请求失败后再尝试一次，最多执行两次请求。 | **高级设置**或测试后直接固化开启。 |
| `tengu_tool_pear` | `false` | 对支持的模型启用严格工具 JSON Schema，并发送 Structured Outputs beta header。 | **高级设置**。标记为实验性和模型兼容限定。 |
| `tengu_fgts` | `false` | 第一方接口启用细粒度工具参数流，降低大参数工具调用的等待时间。 | **高级设置**。标记为第一方接口限定。 |
| `tengu_streaming_tool_execution2` | `false` | 工具参数在流式响应中完成后提前开始执行工具。 | **高级设置**。标记为实验性。 |
| `tengu_plum_vx3` | `false` | Web Search 改用小型快速模型、禁用 thinking，并强制选择 Web Search 工具。 | **高级设置**。可命名为“快速网页搜索”。 |

## 已完成的正式设置清理

以下重复 gate 已于 2026-08-31 清理：

- Prompt suggestions 直接由 `promptSuggestionEnabled` 控制，未设置时默认开启。
- 终端标签页状态直接由 `showStatusInTerminalTab` 控制，未设置时默认关闭。
- `bypassPermissions` 直接由 `permissions.disableBypassPermissionsMode` 控制，相关异步 killswitch 检查链已删除。
- 默认关闭的 effort、子 Agent 和定时任务推广提示已删除。
- 默认关闭的 VSCode 实验 gate 转发已删除。
- 默认关闭的 Opus 紧急停服分支及专用错误处理已删除。
- 默认空白的顶部紧急提示组件及持久化字段已删除。

## 保留行为但不建议进入 UI

| 开关 | 当前默认值 | 功能 | 建议 |
| --- | --- | --- | --- |
| `tengu_agent_list_attach` | `false` | 将动态 Agent 列表从工具 Schema 移到附件，避免 Agent/MCP/权限变化破坏 Prompt Cache。 | **内部配置**。验证兼容性后固化最佳路径。 |
| `tengu_amber_prism` | `false` | 用户拒绝或取消工具后，提示模型关注用户纠正并考虑写入自动记忆。 | **删除**。属于模型提示实验。 |
| `tengu_compact_cache_prefix` | `true` | compact 使用 forked-agent 路径复用主会话 Prompt Cache，失败时回退普通路径。 | **固化开启**。代码注释已有明确成本收益。 |
| `tengu_compact_line_prefix_killswitch` | `false` | 关闭紧凑行号格式的反向熔断。默认实际行为是使用 `N\t`，而不是填充箭头格式。 | **固化紧凑格式**。 |
| `tengu_read_dedup_killswitch` | `false` | 关闭重复 Read 去重的反向熔断。默认实际行为是相同文件未变化时不重复返回全文。 | **固化去重**。 |
| `tengu_slim_subagent_mossmd` | `true` | Explore/Plan 子 Agent 不携带完整 MOSS.md 和无用的旧 git 状态，减少上下文成本。 | **固化开启**。 |
| `tengu_basalt_3kr` | `false` | 将 MCP Server Instructions 通过持久化增量附件发送，避免晚连接导致系统 Prompt 缓存失效。 | **内部配置**。测试后固化。 |
| `tengu_glacier_2xr` | `false` | 将延迟加载工具列表从每次请求头改为持久化增量附件。 | **内部配置**。测试后固化。 |
| `tengu_chair_sermon` | `false` | 将 system-reminder 文本合并到 tool_result，修复消息排列导致的空响应和 API 兼容问题。 | **内部配置**。通过协议回归测试后固化。 |
| `tengu_toolref_defer_j8m` | `false` | 移动 tool_reference 消息的相邻文本，避免异常的连续 Human turn 和错误停止序列。 | **内部配置**。通过协议回归测试后固化。 |
| `tengu_hawthorn_steeple` | `false` | 启用单消息聚合工具结果预算；超限时把最大结果落盘并以预览替换。 | **内部配置**。属于资源保护机制。 |
| `tengu_hawthorn_window` | `null` | 覆盖单消息工具结果预算，默认硬编码为 200,000 字符。 | **内部配置**。不单独暴露。 |
| `tengu_satin_quoll` | `{}` | 覆盖各工具的落盘阈值，并使用 `mcp_tool` 字段覆盖 MCP 默认 25,000 token 上限。 | **内部配置**。当前同一对象混用字符和 token 单位，应拆分类型。 |
| `tengu_marble_fox` | `false` | 对 1M 上下文且使用超过 25% 的会话附加 compact 提醒。 | **内部配置**。属于模型 Prompt 策略。 |
| `tengu_otk_slot_v1` | `false` | 将默认最大输出降到 8K；触顶时用 64K 对同一请求重试一次。 | **内部配置**。属于服务容量与成本策略。 |
| `tengu_prompt_cache_1h_config` | `{}` | 配置允许使用 1 小时 Prompt Cache 的 `querySource` allowlist。 | **内部配置**。第一方服务专用。 |
| `tengu_disable_streaming_to_non_streaming_fallback` | `false` | 流式失败时禁止非流式重放，避免流式工具已开始后再次执行同一工具。 | **内部配置**。应根据工具执行语义固化。 |
| `tengu_disable_keepalive_on_econnreset` | `false` | 遇到 ECONNRESET/EPIPE 后关闭 HTTP keep-alive，再创建客户端重试。 | **内部配置**。属于网络恢复策略。 |
| `tengu_cork_m4q` | `false` | 改变 Shell 命令前缀分类器的 policy spec Prompt 布局，并启用 Prompt Cache。 | **内部配置**。不适合用户控制。 |
| `tengu_paper_halyard` | `false` | 开启后跳过项目级和本地 MOSS.md/规则。 | **删除**。固定为 `false`，避免静默丢失项目指令。 |
| `tengu_pebble_leaf_prune` | `false` | 避免 transcript 的进度/元数据分支被误判为可恢复会话叶子。 | **固化**。补充恢复测试后启用修复路径。 |
| `tengu_pewter_ledger` | `null` | Plan 文件结构 Prompt 的 `trim`、`cut`、`cap` 文案实验。 | **删除**。选择固定 Prompt。 |
| `tengu_grey_step2` | `{ enabled: true, ... }` | Opus medium effort 推荐弹窗开关和文案。 | **使用现有设置**。并入正式 effort 设置和固定产品文案。 |
| `tengu_sage_compass` | `{}` | 第一方服务端 Advisor 工具开关、用户可配置权限和实验模型映射。 | **内部配置**。改为服务能力检测并继续使用正式 `advisorModel`。 |
| `tengu_slate_prism` | `true` | SDK 调用方请求 `agentProgressSummaries` 时允许生成 Agent 进度摘要。 | **固化开启**。调用方已经显式请求。 |
| `tengu_tool_search_unsupported_models` | `null` | 覆盖不支持 tool_reference 的模型名称模式；默认仅包含 `haiku`。 | **内部配置**。改为类型化模型能力表。 |

## 受编译期开关限制、当前无效

这些运行时键当前位于关闭或缺失的编译功能内。仅修改 `MOSS_FEATURE_FLAG_OVERRIDES` 不会使其生效。

| 运行时开关 | 默认值 | 外层编译开关 | 功能 | 建议 |
| --- | --- | --- | --- | --- |
| `tengu_amber_quartz_disabled` | `false` | `VOICE_MODE=false` | Voice Mode 紧急关闭开关。当前 `hasVoiceAuth()` 也固定返回 `false`。 | **删除**，或在完整恢复 Voice Mode 时改用正式设置。 |
| `tengu_amber_stoat` | `true` | `BUILTIN_EXPLORE_PLAN_AGENTS=false` | 控制内置 Explore/Plan Agent。 | **删除**，或恢复编译功能后使用正式“内置 Agent”设置。 |
| `tengu_birch_trellis` | `true` | `TREE_SITTER_BASH_SHADOW=false` | Tree-sitter Bash AST 安全解析的 shadow-mode 熔断。 | **删除**，由编译能力和 WASM 可用性决定。 |
| `tengu_collage_kaleidoscope` | `true` | `NATIVE_CLIPBOARD_IMAGE=false` | macOS 原生剪贴板图片读取快速路径；失败时回退 osascript。 | **删除运行时 gate**，由编译能力自动选择。 |
| `tengu_hive_evidence` | `false` | `VERIFICATION_AGENT=false` | 注册 Verification Agent、注入验证 Prompt，并在任务完成时追加验证提醒。 | **删除**，或恢复验证 Agent 后使用正式设置。 |
| `tengu_terminal_panel` | `false` | `TERMINAL_PANEL=false` | 内置终端面板及快捷键提示。 | **删除**，或恢复终端面板后使用正式设置。 |
| `tengu_turtle_carbon` | `true` | `ULTRATHINK` 未在本地 feature registry 声明 | 启用 `ultrathink` 关键词，将 effort 提升到 high。 | **删除或修复编译配置**，不要保留无效运行时开关。 |

## 只存在于旧构建产物的遗留键

下列键在本次清理前只存在于旧 `bin/cli.js`，当前 TypeScript 源码已经没有相应 `tengu` 读取。它们不应进入高级设置；本次重新构建后已从产物中清除。

| 遗留开关 | 构建产物中的默认值 | 旧功能 | 当前替代 |
| --- | --- | --- | --- |
| `tengu_coral_fern` | `false` | 在记忆 Prompt 中增加“搜索过去上下文”的操作说明。 | `autoMemory.pastContextSearchEnabled`。 |
| `tengu_moth_copse` | `false` | 不再注入完整 AutoMem 索引，改为按当前问题预取相关记忆。 | 当前自动记忆与 past-context 配置。 |
| `tengu_onyx_plover` | `null` | Auto Dream 开关以及 `minHours`、`minSessions` 参数。 | `autoMemory.dreamEnabled`、`dreamMinHours`、`dreamMinSessions`。 |
| `tengu_session_memory` | `true` | Session Memory 总开关。 | `sessionMemory.enabled`。 |
| `tengu_sm_compact` | `true` | Session Memory compact 开关。 | `sessionMemory.compactEnabled`。 |
| `tengu_sm_compact_config` | `{}` | Session Memory compact 的 token 和消息阈值。 | 类型化 `sessionMemory` 设置。 |
| `tengu_sm_config` | `{}` | Session Memory 提取频率与阈值。 | 类型化 `sessionMemory` 设置。 |

## 高级设置落地原则

### 1. 建立类型化注册表

不要让 UI 直接编辑 `featureFlagOverrides: Record<string, unknown>`。应建立统一、类型化的高级功能注册表，至少包含：

- 稳定的设置字段名。
- 对应旧 `tengu` 键，仅用于迁移。
- 类型与允许值。
- 默认值。
- UI 标签和简短说明。
- 是否需要新会话或进程重启。
- 是否受编译功能或接口提供方限制。

### 2. 缺失时解析默认值，不主动持久化默认值

设置字段缺失时，运行时和 UI 都应显示注册表中的默认值，但不建议首次启动就把所有默认值写入磁盘。只持久化用户明确修改的值，原因是：

- 后续版本调整默认值时，未主动选择的用户可以自然采用新默认值。
- 避免配置文件充满与默认值相同的字段。
- 可以区分“用户明确选择”和“沿用产品默认”。

读取形式应等价于：

```ts
const effectiveValue = persistedValue ?? defaultValue
```

### 3. 保留环境变量最高优先级

`MOSS_FEATURE_FLAG_OVERRIDES` 应继续作为开发、诊断或部署策略覆盖。被环境变量覆盖时，高级设置 UI 应显示“由环境变量控制”，并禁用对应控件或明确提示实际生效值。

### 4. 不暴露原始 JSON 配置

`tengu_amber_wren`、`tengu_slate_heron`、`tengu_satin_quoll`、`tengu_sage_compass` 等对象型配置必须拆成有校验的布尔、数字或枚举字段。特别是 `tengu_satin_quoll` 当前同时使用字符和 token 单位，不应原样迁移。

### 5. 明确生效时机

部分值在模块加载、首次调用或会话建立时被缓存。高级设置修改后建议统一按以下规则处理：

- 纯 UI 行为可以立即生效。
- 模型请求、Agent、工具 Schema、compact 策略从下一个新会话生效。
- 编译功能缺失时隐藏对应设置，而不是展示一个无效开关。

### 6. Desktop 设置必须传递给 Agent 运行时

桌面端 `DesktopSettings` 与 Agent 进程读取的全局配置不是同一层。仅在 `settings-view.tsx` 增加控件不会自动影响 `getFeatureValue_CACHED_MAY_BE_STALE()`。实现时需要将类型化高级设置传入本地和远程 Agent 的启动/会话环境，或者统一到共享运行时设置协议中。

## 主要代码位置

- `src/services/analytics/featureFlags.ts`：本地运行时开关解析与覆盖优先级。
- `src/utils/config.ts`：当前 `featureFlagOverrides` 存储结构。
- `scripts/features.js`：本地编译功能清单。
- `ui/src/renderer-react/components/settings-view.tsx`：桌面端设置与高级设置界面。
- `src/utils/api.ts`：严格工具 Schema 与细粒度工具流。
- `src/services/compact/`：compact、microcompact 和缓存策略。
- `src/utils/messages.ts`：消息规范化与 tool_reference 兼容逻辑。
- `src/tools/AgentTool/`：Agent 列表、后台执行和子 Agent 上下文逻辑。
