# Tengu 运行时开关审计

审计日期：2026-08-31

Feature/gate 复核日期：2026-09-01

## 结论

项目中共确认：

- 初始审计确认 40 个使用 `tengu_*` 命名的源码运行时键。
- 当前 TypeScript 源码剩余 25 个 `tengu_*` 运行时键。
- 14 个原 `tengu_*` 候选已迁移为 15 个类型化的 `moss_*` 桌面高级设置。
- 7 个只存在于旧 `bin/cli.js` 构建产物中的遗留键。
- `logEvent('tengu_*', ...)` 是遥测事件名，不属于运行时开关；当前 `logEvent()` 为空操作。

当前 `tengu` 开关不是远端服务端开关，也不是编译期开关。它们通过本地运行时配置解析，优先级为：

1. `MOSS_FEATURE_FLAG_OVERRIDES` 环境变量。
2. 全局配置中的 `featureFlagOverrides`。
3. 调用处提供的代码默认值。

真正的编译期开关使用 `feature('FEATURE_NAME')`，由 `scripts/features.js` 等构建配置控制。部分 `tengu_*` 开关位于编译期开关内部，因此只有对应功能被编译进产物后才可能生效。

### Gate 与 feature 的区别

- `getFeatureValue_*('tengu_*', defaultValue)` 和 `checkFeatureGate_*('tengu_*')` 是运行时 gate。当前实现只读取本地环境变量和全局配置，不连接远端实验服务。
- `feature('FEATURE_NAME')` 是编译期宏。普通 Bun 构建会把它替换为常量，并对不可达分支执行 dead-code elimination；修改 `scripts/features.js` 后必须重新构建。
- 当外层 `feature()` 为 `false` 时，仅设置 `MOSS_FEATURE_FLAG_OVERRIDES` 不能开启内部 gate。必须先把对应 feature 编译进产物，内部运行时 gate 才可能被读取。
- 删除运行时 gate、只保留 `feature()`，表示同一构建中的行为固定：feature 关闭时功能不存在，feature 开启时直接使用选定实现，不再允许运行时切换实验分支。
- `feature()` 不是桌面用户设置。若功能需要让用户在运行时选择，应使用类型化的 `moss_*` 正式设置，而不是重新增加 `tengu_*` gate。

## 处置标记

- **高级设置**：功能对用户可理解、可独立选择，适合放到“设置 -> 高级设置”。
- **使用现有设置**：已经存在正式设置，不应再增加重复开关。
- **固化**：保留当前行为，但移除实验开关和双路径代码。
- **内部配置**：代码可能有保留价值，但不适合让普通用户控制。
- **删除**：已经无效、属于遗留实验或当前架构不再需要。

## 高级设置候选

| 开关 | 当前默认值 | 功能 | 建议 |
| --- | --- | --- | --- |
| `tengu_sedge_lantern` | `false` | 终端失焦 5 分钟后生成“离开期间摘要”。 | **高级设置**。注明会增加一次模型调用。 |
| `tengu_immediate_model_command` | `false` | 查询运行过程中立即执行 `/model`、`/fast`、`/effort`，而不是等待当前轮次结束。 | **高级设置**。 |
| `tengu_willow_mode` | `"off"` | 大上下文闲置 75 分钟后提示用户使用 `/clear`。支持 `off`、`dialog`、`hint`、`hint_v2`。 | **高级设置**。使用枚举选择器。 |
| `tengu_compact_streaming_retry` | `false` | compact 流式请求失败后再尝试一次，最多执行两次请求。 | **高级设置**或测试后直接固化开启。 |
| `tengu_tool_pear` | `false` | 对支持的模型启用严格工具 JSON Schema，并发送 Structured Outputs beta header。 | **高级设置**。标记为实验性和模型兼容限定。 |
| `tengu_fgts` | `false` | 第一方接口启用细粒度工具参数流，降低大参数工具调用的等待时间。 | **高级设置**。标记为第一方接口限定。 |

## 已落地的桌面高级设置

以下 15 个设置已迁移为语义化的 `moss_*` 键，并加入桌面客户端“设置 -> 高级设置”。缺失字段按原 `tengu` 默认值解析，不会在首次启动时改变既有行为。

原“记忆”页面中的阈值、更新间隔、压缩保留范围、历史上下文搜索和 Dream 门槛也已统一移入“高级设置 -> 记忆”分组；“记忆”页面只保留会话记忆、长期记忆及其基础开关。底层配置字段和默认值保持不变。

| 正式键 | 默认值 | 桌面显示名称 | 功能 |
| --- | --- | --- | --- |
| `moss_auto_background_agents` | `false` | 长任务自动转后台 | 前台 Agent 运行超过 120 秒后自动转为后台任务。 |
| `moss_hive_evidence` | `false` | 独立验证 Agent | 为非简单实现注册后台验证 Agent、注入验证契约，并在连续完成多个任务但没有验证步骤时给出提示。 |
| `moss_scratchpad` | `false` | 会话临时工作区 | 为 Agent 和 Coordinator Worker 提供隔离的会话级临时目录。 |
| `moss_idle_session_cleanup` | `false` | 闲置会话优化 | 会话闲置 60 分钟后清理较早的工具结果，固定保留最近 5 个可压缩结果。 |
| `moss_streaming_tool_execution` | `false` | 流式工具执行 | 工具参数在流式响应中完成后提前开始执行。 |
| `moss_plan_mode_interview` | `true` | Plan 引导访谈 | Plan Mode 使用分阶段澄清、探索和计划生成流程。 |
| `moss_fast_web_search` | `false` | 快速网页搜索 | Web Search 使用小型快速模型、关闭 thinking 并强制选择搜索工具。 |
| `moss_memory_learn_from_corrections` | `false` | 从纠正中学习 | 用户拒绝或取消工具后，提醒 Agent 识别后续纠正和偏好并考虑写入长期记忆。 |
| `moss_large_tool_result_protection` | `false` | 大型工具结果保护 | 单轮工具结果过大时将较大结果保存到会话目录，只向模型发送预览和文件路径。 |
| `moss_tool_result_budget_chars` | `200000` | 单轮工具结果上限 | 大型工具结果保护启用时，限制一轮内直接发送给模型的聚合工具结果字符数。 |
| `moss_mcp_output_token_limit` | `25000` | MCP 输出 token 上限 | 限制单次 MCP 工具结果发送给模型的 token 数。 |
| `moss_file_read_max_size_bytes` | `262144` | Read 文件大小上限 | 限制 Read 工具可直接读取的完整文件大小，超过后需要按范围读取。 |
| `moss_file_read_max_tokens` | `25000` | Read 输出 token 上限 | 限制 Read 工具单次返回的内容 token 数。 |
| `moss_request_attribution_enabled` | `true` | 发送请求归因信息 | 控制是否在系统提示中附带版本、入口和 workload 信息，关闭可提高自定义接口兼容性。 |
| `moss_context_compaction_strategy` | `"proactive"` | 上下文压缩策略 | 在主动压缩与 API 返回上下文超限后的响应式压缩之间选择。 |

桌面配置保存在 `DesktopSettings.advanced`。本地会话通过 `MOSS_RUNTIME_ADVANCED_SETTINGS` 获取类型化快照；remote-direct 创建会话时通过 `advancedSettings` 协议字段发送，由服务端持久化，并传入 host、embedded 和 Docker backend。修改设置后从新会话开始生效，已运行的远程会话保持创建时快照。

## 已完成的正式设置清理

以下重复 gate 已于 2026-08-31 清理：

- Prompt suggestions 直接由 `promptSuggestionEnabled` 控制，未设置时默认开启。
- 终端标签页状态直接由 `showStatusInTerminalTab` 控制，未设置时默认关闭。
- `bypassPermissions` 直接由 `permissions.disableBypassPermissionsMode` 控制，相关异步 killswitch 检查链已删除。
- 默认关闭的 effort、子 Agent 和定时任务推广提示已删除。
- 默认关闭的 VSCode 实验 gate 转发已删除。
- 默认关闭的 Opus 紧急停服分支及专用错误处理已删除。
- 默认空白的顶部紧急提示组件及持久化字段已删除。
- 15 个桌面高级设置已使用 `moss_*` 正式键，并完成本地及 remote-direct 设置传递。
- Verification Agent 已编入产物，由默认关闭的 `moss_hive_evidence` 按会话控制，不再读取 `tengu_hive_evidence`；Agent 定义缓存按该会话设置隔离，验证进程仅暴露只读工具，并以 OS sandbox 禁止写入项目目录。
- 已删除仅供本地 CLI 使用的 `DIRECT_CONNECT` 编译开关、`server`/`open` 命令和 `cc://` 参数入口；桌面本地及 remote-direct 路径保持独立。
- Read 文件大小与输出 token 上限已拆为两个类型化数值设置，不再读取 `tengu_amber_wren` 原始对象。
- 请求归因信息已改由 `moss_request_attribution_enabled` 控制；`CLAUDE_CODE_ATTRIBUTION_HEADER` 仍保持最高优先级。
- 上下文压缩策略已改由 `moss_context_compaction_strategy` 控制，并统一驱动实际 compact、token 预留显示和终端警告。
- 项目级和本地 MOSS.md 已固定加载，不再允许实验 gate 静默跳过项目指令。
- Plan Mode 已固定使用标准 Final Plan 文案，原三套 A/B 文案及实验遥测字段已删除。
- compact 已固定先复用主会话 Prompt Cache，失败时回退普通流式路径。
- Read 已固定使用紧凑行号格式并对未变化的重复读取返回去重结果。
- Explore/Plan 子 Agent 已固定省略无用的完整 MOSS.md 上下文。
- 自定义快捷键已正式开放；配置加载、文件监听、命令、帮助入口和内置 skill 不再受发布 gate 控制。
- Agent Teams 已删除二次熔断，仅由 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 或 `--agent-teams` 显式启用。
- Opus effort 推荐已使用固定产品文案，不再读取 A/B 对象配置。
- Bash 和 PowerShell 权限确认框已固定显示检测到的破坏性命令警告。
- 开启 `moss_streaming_tool_execution` 时自动禁止流式失败后的非流式重放，避免工具重复执行。
- `ECONNRESET` 或 `EPIPE` 后自动关闭 keep-alive 并使用新连接重试，不再依赖运行时开关。

## 保留行为但不建议进入 UI

| 开关 | 当前默认值 | 功能 | 建议 |
| --- | --- | --- | --- |
| `tengu_amber_stoat` | `true` | 控制已编译进产物的内置 Explore 和 Plan 子 Agent 是否可用。 | **内部配置**。当前默认开启；完成工具权限、模型选择、上下文和 SDK 禁用逻辑验证后，可删除 gate 并固化开启。 |
| `tengu_agent_list_attach` | `false` | 将动态 Agent 列表从工具 Schema 移到附件，避免 Agent/MCP/权限变化破坏 Prompt Cache。 | **内部配置**。验证兼容性后固化最佳路径。 |
| `tengu_basalt_3kr` | `false` | 将 MCP Server Instructions 通过持久化增量附件发送，避免晚连接导致系统 Prompt 缓存失效。 | **内部配置**。测试后固化。 |
| `tengu_glacier_2xr` | `false` | 将延迟加载工具列表从每次请求头改为持久化增量附件。 | **内部配置**。测试后固化。 |
| `tengu_chair_sermon` | `false` | 将 system-reminder 文本合并到 tool_result，修复消息排列导致的空响应和 API 兼容问题。 | **内部配置**。通过协议回归测试后固化。 |
| `tengu_toolref_defer_j8m` | `false` | 移动 tool_reference 消息的相邻文本，避免异常的连续 Human turn 和错误停止序列。 | **内部配置**。通过协议回归测试后固化。 |
| `tengu_satin_quoll` | `{}` | 覆盖各工具的落盘字符阈值。原 `mcp_tool` token 配置已拆为 `moss_mcp_output_token_limit`。 | **内部配置**。剩余字段继续使用字符单位，不暴露原始 JSON。 |
| `tengu_marble_fox` | `false` | 对 1M 上下文且使用超过 25% 的会话附加 compact 提醒。 | **内部配置**。属于模型 Prompt 策略。 |
| `tengu_otk_slot_v1` | `false` | 将默认最大输出降到 8K；触顶时用 64K 对同一请求重试一次。 | **内部配置**。属于服务容量与成本策略。 |
| `tengu_prompt_cache_1h_config` | `{}` | 配置允许使用 1 小时 Prompt Cache 的 `querySource` allowlist。 | **内部配置**。第一方服务专用。 |
| `tengu_cork_m4q` | `false` | 改变 Shell 命令前缀分类器的 policy spec Prompt 布局，并启用 Prompt Cache。 | **内部配置**。不适合用户控制。 |
| `tengu_pebble_leaf_prune` | `false` | 避免 transcript 的进度/元数据分支被误判为可恢复会话叶子。 | **固化**。补充恢复测试后启用修复路径。 |
| `tengu_sage_compass` | `{}` | 第一方服务端 Advisor 工具开关、用户可配置权限和实验模型映射。 | **内部配置**。改为服务能力检测并继续使用正式 `advisorModel`。 |
| `tengu_slate_prism` | `true` | SDK 调用方请求 `agentProgressSummaries` 时允许生成 Agent 进度摘要。 | **固化开启**。调用方已经显式请求。 |
| `tengu_tool_search_unsupported_models` | `null` | 覆盖不支持 tool_reference 的模型名称模式；默认仅包含 `haiku`。 | **内部配置**。改为类型化模型能力表。 |

### 协议与容错 gate 的测试、固化结论

以下 7 个 gate 已存在于当前构建产物中，可以通过 `MOSS_FEATURE_FLAG_OVERRIDES` 在进程启动时单独测试，不需要修改 `feature()`。它们控制的是 Prompt Cache、消息协议、会话恢复或 compact 容错实现，不属于用户偏好，不应进入桌面高级设置。

| Gate | 开启收益 | 主要风险与必测项 | 固化建议 |
| --- | --- | --- | --- |
| `tengu_agent_list_attach` | 将动态 Agent 列表从工具 Schema 移到持久化附件，避免 Agent、MCP 或权限变化破坏 Prompt Cache。代码注释记录动态列表约占 10.2% 的 cache creation token。 | 测试首次发送、Agent 增删、权限变化、MCP 晚连接、恢复会话、完整及部分 compact、子 Agent，确认列表不缺失、不重复、不过期。 | **测试后固化开启**。可暂时保留 `CLAUDE_CODE_AGENT_LIST_IN_MESSAGES` 作为开发诊断覆盖。 |
| `tengu_basalt_3kr` | MCP Server Instructions 改为持久化增量附件，避免 MCP 晚连接改变 system prompt 并破坏缓存。 | 当前按服务器名称而非指令内容比较。测试连接、断开、同名重连但内容改变、服务端与客户端指令并存、恢复和 compact。 | **测试后固化开启**。同名重连语义必须先明确或修复。 |
| `tengu_glacier_2xr` | 延迟加载工具列表改为持久化增量附件，减少每轮重复 Prompt 和缓存失效。 | 代码注释已记录主线程跨轮次可能找不到前一条 delta。测试工具增加、移除、由 deferred 变为 loaded、主线程多轮、子 Agent、完整/部分/reactive compact 和恢复会话。 | **最后处理**。已知状态重建疑点解决前不直接固化。 |
| `tengu_chair_sermon` | 将 system-reminder 等相邻内容合并到 `tool_result`，减少异常 Human turn、空响应和 API 兼容错误；源码记录的 A/B 结果为问题模式从 92% 降到 0%。 | 影响消息规范化核心路径。测试字符串及数组结果、文本、图片、文档、搜索结果、`is_error`、`tool_reference`、相邻 user 消息、Bedrock role alternation 和旧 transcript 修复。 | **完整协议回归后固化开启**。收益高，但影响面也是这组中最大。 |
| `tengu_toolref_defer_j8m` | 把包含 `tool_reference` 的消息旁文本移动到后续普通工具结果，避免异常 Human turn 和错误停止序列。 | 测试单个及多个引用、连续引用、末尾无可移动目标、字符串和数组结果、恢复会话，以及支持和不支持 tool reference 的模型。 | **与 `tengu_chair_sermon` 联合测试后固化**。 |
| `tengu_pebble_leaf_prune` | 避免 progress/metadata 支线把主会话中间节点误判为 `/resume` 叶子。 | 测试 progress 子节点与继续执行的 tool result、仅元数据结尾、真实分支叶子、多分支、缺失 parent 和 parent 环。 | **优先测试并固化开启**。这是边界清晰、收益明确的正确性修复。 |
| `tengu_compact_streaming_retry` | compact 流式请求没有形成 assistant 响应时自动再请求一次，最多两次，提高瞬时网络或流式失败下的成功率。 | 测试第一次空响应后成功、连续两次失败、已开始流式但没有最终响应、退避期间取消、请求过长错误，并验证最多只发送两次。 | **优先测试并固化开启**。主要代价是失败时增加一次请求成本和等待时间。 |

建议处理顺序：`tengu_pebble_leaf_prune`、`tengu_compact_streaming_retry`、`tengu_agent_list_attach`、`tengu_basalt_3kr`、`tengu_chair_sermon`、`tengu_toolref_defer_j8m`，最后处理 `tengu_glacier_2xr`。当前未找到直接覆盖这些新分支的针对性测试，因此以上结论是固化方向，不代表已具备立即删除 gate 的测试条件。

## 受编译期开关限制、当前无效

这些运行时键当前位于关闭或缺失的编译功能内。仅修改 `MOSS_FEATURE_FLAG_OVERRIDES` 不会使其生效。

| 运行时开关 | 外层 feature 与开启条件 | 实际功能和开启价值 | 当前阻塞或副作用 | 后续建议 |
| --- | --- | --- | --- | --- |
| `tengu_amber_quartz_disabled`，默认 `false` | `VOICE_MODE=false`。需将 feature 设为 `true` 并重新构建；该 gate 是反向 killswitch，保持 `false` 才表示允许语音。 | 控制 Voice Mode 是否可见和可用。完整实现后语音输入有明确价值。 | 当前 `hasVoiceAuth()` 固定返回 `false`，即使 feature 开启也无法使用；`audio-capture-napi` 原生模块当前未包含。 | **删除运行时 gate，保持 feature 关闭**。恢复授权与原生依赖后再决定是否增加正式语音设置。当前没有开启价值。 |
| `tengu_birch_trellis`，默认 `true` | `TREE_SITTER_BASH_SHADOW=false`。需开启 feature 并重新构建。 | 使用仓库内纯 TypeScript Bash AST parser 分析命令，将结果与旧解析器比较并记录差异。 | Shadow 模式始终回到旧解析器，不改变权限判定；代价是每次 Bash 权限检查多执行一次解析和遥测。 | **可在验证构建中开启**。收集差异并完成权限回归后，再决定是否启用 `TREE_SITTER_BASH` 正式路径。 |
| `tengu_collage_kaleidoscope`，默认 `true` | `NATIVE_CLIPBOARD_IMAGE=false`。需先提供 `image-processor-napi`，再开启 feature 并重建。 | macOS 直接读取剪贴板图片，源码估算约 5ms 冷启动、热路径低于 1ms，明显快于约 1.5s 的 `osascript`；失败时已有回退。 | `image-processor-napi` 当前未安装；现在开启只会捕获模块加载失败并回退到 `osascript`，没有性能收益。 | **保持关闭**。补齐并验证原生模块打包后再开启；保留现有回退路径。 |
| `tengu_turtle_carbon`，默认 `true` | `ULTRATHINK` 未在 feature registry 声明。必须先声明 feature、设置构建值并重建，不能只修改现有配置。 | 识别输入中的 `ultrathink`，为当前轮附加 high effort，并提供彩色高亮和通知。 | 开启后还会把支持 effort 模型的默认 effort 改为 medium，并非只增加快捷词；项目已有正式 effort 设置和 `/effort`，隐式关键词的增量价值有限。当前 `bin/cli.js` 虽残留 gate 字符串，但函数会立即返回 `false`，行为不可达。 | **低至中等价值，不建议默认开启**。删除 gate；若仍保留功能，应显式注册 `ULTRATHINK` feature，并拆开“关键词触发”和“改变默认 effort”两种行为。 |

### Feature 功能的后续处理优先级

1. 开启 `TREE_SITTER_BASH_SHADOW` 的验证构建，收集与旧权限解析器的差异后再评估正式路径。
2. 补齐并验证 `image-processor-napi` 打包后再开启 `NATIVE_CLIPBOARD_IMAGE`。
3. `VOICE_MODE` 和 `ULTRATHINK` 当前分别受完整性和已有正式替代能力限制，暂不建议开启。

其余 4 个 `tengu_*` 读取仍按上述建议后续处理；本次已将 `tengu_hive_evidence` 迁移为正式高级设置。

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

`tengu_satin_quoll`、`tengu_sage_compass` 等对象型配置必须拆成有校验的布尔、数字或枚举字段。`tengu_amber_wren` 已按此原则拆成两个 Read 数值设置。特别是 `tengu_satin_quoll` 当前同时使用字符和 token 单位，不应原样迁移。

### 5. 明确生效时机

部分值在模块加载、首次调用或会话建立时被缓存。高级设置修改后建议统一按以下规则处理：

- 纯 UI 行为可以立即生效。
- 模型请求、Agent、工具 Schema、compact 策略从下一个新会话生效。
- 编译功能缺失时隐藏对应设置，而不是展示一个无效开关。

### 6. Desktop 设置传递给 Agent 运行时

已落地的 15 个设置通过 `DesktopSettings.advanced`、`MOSS_RUNTIME_ADVANCED_SETTINGS` 和 direct-connect `advancedSettings` 协议传递。后续新增设置应继续复用这条类型化链路，不能只在 `settings-view.tsx` 增加控件。

## 主要代码位置

- `src/services/analytics/featureFlags.ts`：本地运行时开关解析与覆盖优先级。
- `src/services/advancedSettings.ts`：`moss_*` 高级设置的会话级解析与环境覆盖。
- `packages/direct-connect-protocol/src/index.ts`：本地与 remote-direct 共用的高级设置类型、默认值和校验。
- `src/utils/config.ts`：当前 `featureFlagOverrides` 存储结构。
- `scripts/features.js`：本地编译功能清单。
- `ui/src/renderer-react/components/settings-view.tsx`：桌面端设置与高级设置界面。
- `src/utils/api.ts`：严格工具 Schema 与细粒度工具流。
- `src/services/compact/`：compact、microcompact 和缓存策略。
- `src/utils/messages.ts`：消息规范化与 tool_reference 兼容逻辑。
- `src/tools/AgentTool/`：Agent 列表、后台执行和子 Agent 上下文逻辑。
