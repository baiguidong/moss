# Moss Group Room Coordinator 重构计划（V2）

状态：V2 已实现；自动化验证、macOS ARM64 未签名安装包校验与真实模型桌面验收通过（2026-09-02）
适用范围：桌面端本地 Group Room
替代方案：废弃 Group Room 自建的 JSON 决策循环，复用 Moss 已有 Coordinator、AgentTool 和任务通知体系

## 1. 修正结论

此前方向存在架构偏差：Group Room 单独实现了一个无工具主持模型，再由 `GroupRoomController` 解析 `respond/delegate` JSON、创建成员会话、执行并行任务、回收结果并再次询问主持模型。这套实现重复了 Moss 已经成熟的 Coordinator 能力，也造成了会话恢复、成员续接、任务状态、语言一致性和 UI 映射上的额外问题。

新方向：

- 每个群聊只有一个真实的 Coordinator 主会话，主持人就是该 Coordinator。
- 主持人拥有正常主会话工具，可以直接读取和修改房间工作区。
- 委派、并行、等待、继续追问、停止和收敛全部复用现有 `Agent`、`SendMessage`、`TaskStop`、task notification 和会话恢复逻辑。
- Group Room 不再实现另一套 agent 调度器、聊天页或消息协议，只负责固定成员 roster、资源作用域和群设置；会话、消息、工具过程与子任务展示全部复用正常会话。
- 调度策略由模型根据主持人 prompt 判断，不增加固定人数、固定轮数或代码启发式。

## 2. 目标交互模型

```text
左侧现有群列表
  ↓ 选择房间
正常会话页面（中间聊天 + 右侧群设置）
  ↓ 用户普通消息 / 补充要求 / 停止
群聊主持人（原生 Coordinator Session）
  ├─ 自己使用 Read / Edit / Write / Bash 等工具完成工作
  ├─ Agent(name=<memberId>) 首次委派某个固定成员
  ├─ 同一响应内多次 Agent 调用，并行委派不同成员
  ├─ SendMessage(to=<memberId>) 继续追问或纠正已有成员
  ├─ TaskStop 停止不再需要的成员任务
  └─ 接收 task-notification 后自行判断继续、复核或最终回答
```

成员不直接争夺用户会话。用户只与主持人对话；成员结果作为公开证据进入群聊时间线，最终答复仍由主持人给出。

## 3. 必须复用的成熟能力

不得在 Group Room 内重新实现以下功能：

- `ClaudeSession({ coordinatorMode: true })` 及 Coordinator system prompt；
- `Agent` 的同步/异步 worker 创建与并行运行；
- `SendMessage` 对运行中 worker 的追加消息及对已停止 worker 的恢复；
- `TaskStop` 的停止语义；
- task notification 队列和 Coordinator 自动续轮；
- Agent transcript、metadata、任务状态、usage 与错误处理；
- 主会话和 worker 的上下文压缩、恢复及缓存机制；
- 现有工具权限判断、文件工作区约束和 connector/skill/expert 资源作用域；
- 现有 subagent 生命周期事件和状态判断。
- 正常会话的聊天区域、消息渲染、输入框、工具调用卡片、working 状态和子 Agent 入口；
- 项目页面已有的右侧配置面板布局、开合交互和保存反馈。

Group Room 不复制上述实现，只消费它们产生的事件和结果。

## 4. 主持人会话

### 4.1 会话形态

- 每个房间对应一个持久 Coordinator 会话。
- `coordinatorMode` 必须为 `true`。
- 使用正常主线程工具池，不再设置空 `mcpServers`，也不再通过 `onToolUseValidation` 拒绝全部工具。
- 主持人可直接使用房间工作区中的读取、搜索、编辑、写入、命令执行等工具。
- 主持人可使用房间范围内可用的连接器和 Skill；不得自动获得未加入该房间的外部资源。
- 沿用正常权限模式：需要确认的写操作仍走现有桌面权限请求；`allow-all` 仍服从产品的全局安全策略。

### 4.2 Prompt 只描述群聊差异

不得复制完整 Coordinator prompt。应直接启用现有 Coordinator prompt，再追加一段短的 Group Room 专属 prompt，内容只包括：

- 你是该房间主持人，也是唯一面向用户的最终答复者；
- 当前房间主题和用户指定的主持人工作方式；
- 固定成员 roster，以及每个成员的 `memberId`、显示名、职责、可用资源 ID；
- 何时自己处理，何时委派，由你根据任务判断；
- 独立工作可并行，有依赖的工作应先看结果再继续；
- 审查、方案和风险任务应主动判断是否需要相关成员交叉验证，但不能机械凑人数；
- 使用用户当前主要语言回复，并在委派任务中明确要求成员沿用该语言；
- 首次使用成员时调用 `Agent`，后续联系同一成员必须使用 `SendMessage`；
- 不要仅为了“让成员准备好”而机械启动所有 worker；创建房间本身不触发模型调用；
- 当任务确实需要全员建立共同认知、独立给出初始意见或进行会议式讨论时，可由你决定并行启动相关成员或全部成员；
- 每个成员首次启动时必须收到完整房间简报和当前任务，而不是假设它看过主持人与用户的对话；
- 不允许创建 roster 外成员，也不允许为同一成员重复创建 worker；
- 不暴露内部 agent ID、工具协议、预算字段或隐藏控制状态。

最终回答使用正常 assistant 文本，不再要求模型返回 `respond/delegate` JSON。

### 4.3 与正常会话的关系

- 群聊不是新的聊天运行时，而是一种带 `group-room` 元数据的正常 Coordinator 会话。
- 房间首次打开时创建并绑定一个正常会话；之后始终恢复该会话，不创建平行的“群聊 transcript”。
- 正常会话负责历史记录、流式输出、工具卡片、附件、取消、重试、上下文压缩和底层 transcript。
- Group Room 记录只保存名称、主题、工作区、固定成员和成员资源配置，并保存与正常会话的稳定关联。
- 左侧仍使用现有群列表，不把群聊混入普通会话列表；点击群条目后，在主区域打开其关联的正常会话页面。

## 5. 固定 roster 与单 worker 不变量

房间成员是已配置的执行身份，不是供模型任意复制的角色模板。一个房间成员在一个主持人会话中只能对应一个原生 worker。

### 5.1 稳定映射

为每个成员建立稳定映射：

```text
memberId
  → worker name
  → expert instructions
  → connector grants
  → skill grants
  → native agentId（首次创建后产生）
```

- `worker name` 固定使用 `memberId`，显示名称仅用于 UI。
- 成员首次执行时，主持人调用 `Agent(name=memberId, ...)`。
- 成员完成后仍保留 native agent identity。
- 主持人需要该成员继续工作时调用 `SendMessage(to=memberId, ...)`，由现有恢复逻辑续接原 transcript。

### 5.2 工具入口校验

Prompt 负责告诉模型如何调度，工具入口负责保证身份不变量：

- `Agent.name` 必须是当前 roster 中的 `memberId`；Coordinator 原生保证 worker 后台运行，不依赖在所有 feature 组合下都可见的 `run_in_background` 参数；
- `expert_id` 必须与该成员绑定的专家一致；
- `connector_ids`、`skill_ids` 必须是该成员已授权集合的子集；
- 同一 `memberId` 已创建 worker 后，再次调用 `Agent` 必须拒绝并提示改用 `SendMessage`；
- `SendMessage.to` 只能指向已经创建的房间成员；
- `TaskStop.task_id` 只能指向该房间中的 native worker；
- 禁止 `TeamCreate`、房间外 agent 类型和未列入 roster 的动态 worker。

这些校验只保证身份、权限和资源边界，不决定应该调用谁、调用几个人、是否并行或何时结束。

### 5.3 自定义成员与专家团队

- 已安装专家复用其现有 instructions 文件。
- 专家团队中的成员使用已快照的成员 prompt，不重新解释团队角色。
- 用户创建的自定义成员由 Group Room 生成一个稳定的 scoped expert instructions 文件，仅供现有 AgentTool 加载；不创建新的执行引擎。
- 房间配置更新后刷新 scoped manifest，并使主持人会话按正常恢复规则重建或失效。

### 5.4 房间简报与按需激活

创建房间时生成一份结构化 Room Brief，但不立即创建或调用任何 worker。Room Brief 至少包含：

- 房间主题、目标和工作区；
- 用户填写的主持人工作方式；
- 共享约束、权限边界和主要输出语言；
- 固定成员 roster、职责与资源能力摘要。

成员首次由 `Agent` 激活时，主持人必须在任务 prompt 中加入：

- Room Brief 中与该成员相关的内容；
- 当前用户请求；
- 已知事实、已形成结论和仍待验证的问题；
- 其他成员正在处理的相关范围，避免重复工作；
- 本次具体任务、验收标准和输出语言。

这是一种“激活时广播”，不是创建房间时无条件预热所有模型。主持人可以根据任务自行选择三种方式：

1. 自己直接处理，不激活成员；
2. 只激活一个或若干相关成员；
3. 当共同上下文和多方初始意见确有价值时，并行激活全部成员作为 kickoff。

已激活成员保留自己的 transcript。共享上下文发生重要变化时，主持人通过 `SendMessage` 更新受影响的已有成员；不为更新上下文重复创建 worker，也不向无关成员机械广播。

## 6. 资源与权限

### 6.1 主持人

- 主持人拥有标准 Coordinator 的文件和代码工具，可直接操作 `room.workspace`。
- 主持人可加载房间所有成员获授资源的并集，但不能越过房间范围访问未配置连接器。
- 主持人的写操作、命令和连接器副作用继续走成熟的桌面权限链。

### 6.2 成员 worker

- 复用现有 project worker resource scope 的能力，将其泛化为可供 Group Room 使用的 scoped worker resource manifest。
- 每次 `Agent` 调用只传该成员实际需要且已经获授的 `connector_ids`、`skill_ids` 和 `expert_id`。
- worker 环境变量只包含它获授的连接器凭据，不能继承其他成员或主持人的完整凭据并集。
- worker 继续使用现有工具过滤、MCP 校验、确认流程和 transcript 记录。

## 7. 运行与消息流程

### 7.1 新用户消息

1. 正常 session transcript 保存用户消息；Group Room 不另建消息或 run 记录。
2. 将用户消息发送给该房间绑定的 Coordinator 会话。
3. Coordinator 可以直接调用工具，也可以调用一个或多个 `Agent`。
4. AgentTool 负责 worker 的并发、执行和完成通知。
5. Coordinator 收到 task notification 后自行判断：
   - 直接回答；
   - 继续 `SendMessage` 原成员；
   - 委派尚未创建的其他成员；
   - 停止无效任务；
   - 自己使用工具补充处理。
6. Coordinator 的最终普通文本作为主持人消息写入房间。

创建房间和打开空房间不自动执行上述流程，不产生模型请求或 worker。首次用户消息到来后，主持人根据任务判断是否需要一次全员 kickoff。

### 7.2 用户运行中补充

- 输入框始终可继续发送。
- 补充消息立即显示为已排队给主持人。
- 不直接指定或打断某个成员。
- 在当前 Coordinator 的安全消息边界投递给主会话，由主持人决定是否 `SendMessage`、新委派、停止旧任务或直接回答。
- 不另建一套“软插话决策状态机”；复用主会话消息队列和任务通知机制。

### 7.3 停止

- 停止整个房间：中止 Coordinator 当前请求，并通过现有任务生命周期停止该会话的所有后台 worker。
- 停止单个成员：根据 `memberId → native agentId` 映射调用现有任务停止逻辑。
- 停止后迟到的 task notification 不得重新发布为有效结果。

## 8. UI 与持久化

### 8.1 左侧群列表

- 左侧群列表保持当前展示方式、入口位置、创建群聊流程和房间切换体验。
- 群条目支持拖拽排序；排序结果持久化，重启后保持一致，并提供键盘可访问的移动方式。
- 列表中的标题、成员头像、最近活动和运行状态来自房间配置与关联正常会话的摘要。
- 群聊不混入普通会话分组，也不改变用户寻找群聊的入口。
- 删除、重命名、置顶等列表级操作放在左侧群条目的上下文菜单中；删除不放在聊天标题栏或右侧设置面板。
- 删除前显示确认，运行中的群先停止 Coordinator 及其 worker，再删除房间配置和关联正常会话数据。

### 8.2 中间区域复用正常会话页面

- 选择群聊后，中间区域直接使用现有正常会话页面和消息组件。
- 不再维护 Group Room 专用消息气泡、输入框、Markdown 渲染、流式文本、工具轨迹或 working 样式。
- 主持人的 Read/Edit/Bash 等工具调用使用正常工具卡片。
- `Agent`、`SendMessage`、task notification 和子 Agent 执行状态使用正常 Coordinator 会话已有展示。
- 用户输入、附件、停止、复制、重试和滚动行为与正常会话完全一致。
- Group Room 只在会话标题区保留必要的“群聊/主持人”身份标识，不改变消息协议。

### 8.3 右侧群设置

- 复用项目页面右侧设置面板的布局、展开/收起交互、滚动区和保存反馈。
- 面板内容包括：群名称、主题、工作区、主持人工作方式、成员列表、成员角色、专家来源、Skill、连接器和权限。
- 不放置讨论轮数、并行开关、接收人或固定收敛规则。
- 成员增删、资源调整和主持人 prompt 更新在右侧完成；存在运行中 worker 时禁止破坏性配置修改。
- 设置保存后更新 Coordinator 的 roster/resource manifest；下一次模型调用必须使用新配置。
- 删除、排序、置顶等群列表管理不放入右侧设置；右侧只管理当前群的运行上下文和成员配置。

### 8.4 会话关联与事实来源

- 为房间绑定一个正常 session，使用 `sessionKind = group-room` 和稳定的 room 关联标识；不再创建第二份聊天历史。
- 正常 session transcript 是消息、工具调用、worker 结果和恢复的唯一事实来源。
- Group Room 存储只保留房间配置和成员配置；旧的 messages/runs/turns 表及相关读写在新路径稳定后删除。
- 左侧群列表从关联 session 读取预览、更新时间和忙碌状态，不复制这些状态。
- 使用现有 `resumeClaudeSession` 恢复主持人和 worker registry；恢复失败时明确标记会话失败，绝不能静默重复创建同一成员。

## 9. 删除旧编排实现

迁移完成后删除，而不是继续双轨维护：

- `group-room-moderator.mjs` 的 `respond/delegate` JSON 协议；
- `GroupRoomController.#executeRun()` 中“调用主持模型 → 解析 JSON → 自建 turn → Promise.allSettled → 再调用主持模型”的循环；
- Group Room 自己创建和缓存主持人/成员 `ClaudeSession` 的执行路径，统一交给正常 session runtime；
- 自制成员并发调度器中与 AgentTool 重复的部分；
- 主持人专用的 `maxModeratorSteps` 语义；
- 主持人 `maxTurns: 1`、空工具池和拒绝全部工具的策略；
- Group Room 专用消息、run、turn、stream 和摘要模型，统一改用正常会话历史、任务状态及上下文压缩；
- 仅为旧 JSON 调度协议存在的恢复、指纹、force-finish 和测试代码。

保留并调整：

- 房间与成员配置；
- 固定 roster；
- 左侧现有群列表；
- 权限弹窗和连接器授权恢复体验；
- 正常会话已有的输入、附件、工具展示、用户补充、停止和恢复体验；
- 右侧群设置面板；
- 正常会话已有的网络故障保护、取消和用户显式停止；不再增加房间专属轮次、Token 或超时参数。

## 10. 实施阶段

### 阶段 A：Coordinator 接入

- 将房间绑定为 `sessionKind = group-room` 的正常会话，并切换为 `coordinatorMode: true`。
- 恢复标准工具池和正常权限链。
- 注入 Group Room 专属 prompt 与 roster manifest。
- 最终输出改为普通文本。
- 验证主持人可以自己读取仓库并直接回答。

### 阶段 B：固定成员映射

- 把房间成员转换成现有 scoped worker resources。
- 校验首次 `Agent`、后续 `SendMessage` 和 `TaskStop`。
- 强制一个 `memberId` 对应一个 native worker，支持恢复后重建映射。
- 验证同一成员不会被重复创建。

### 阶段 C：正常会话 UI 与群设置

- 左侧群列表保持现有视觉样式，增加拖拽排序和条目菜单中的删除操作，并将选中房间路由到其关联正常会话。
- 中间区域直接复用正常聊天页，不再渲染 Group Room 专用消息时间线。
- 复用正常 AgentTool/task notification UI 展示委派、执行中、结果、失败与继续消息。
- 在右侧加入与项目设置一致的群设置面板，并接入房间配置保存。
- 验证并行任务、失败、停止、继续追问、附件和工具卡片的展示一致。

### 阶段 D：删除旧实现

- 移除 JSON moderator、独立成员 runtime、重复调度器和独立摘要器。
- 移除 Group Room 专用聊天页、消息流和执行状态组件，清理失效 settings、IPC、类型和测试。
- 不保留双实现 feature flag；首次发布直接使用新架构。

### 阶段 E：恢复与回归

- 接入现有 Coordinator/session resume。
- 验证应用重启后不会重复创建已存在成员。
- 验证正在运行的 worker 能恢复、停止或明确失败。
- 完成单测、集成测试、renderer build、打包验证和真实模型 CDP 验收。

## 11. 验收矩阵

- [x] 主持人是 `coordinatorMode: true` 的真实 Coordinator 会话。
- [x] 主持人能直接使用 Read、Write、Edit、Bash 等标准工具。
- [x] 左侧群列表保持现有展示和入口。
- [x] 左侧群列表可拖拽排序，顺序持久化且支持键盘操作。
- [x] 删除群聊只从左侧列表条目发起，运行中删除会先安全停止 Coordinator 和 worker。
- [x] 群聊正文使用正常会话页面、输入框、工具卡片和流式状态，不存在第二套聊天 UI。
- [x] 右侧群设置复用项目设置面板交互，并可管理主题、工作区、主持方式、成员及资源。
- [x] 简单任务可由主持人自己完成，不强制委派。
- [x] 创建或打开房间不会无条件启动全部成员或产生模型调用。
- [x] 每个成员首次激活时收到完整、可独立理解的 Room Brief 和当前任务。
- [x] 主持人可在确有必要时并行激活全部成员完成 kickoff，但不是固定流程。
- [x] 主持人只能从固定 roster 首次创建成员。
- [x] 同一成员不会被重复创建；后续工作使用 `SendMessage` 续接。
- [x] 主持人可在一次响应中并行委派多个不同成员。
- [x] worker 结果通过 task notification 自动回到主持人。
- [x] 主持人根据结果自主继续、交叉验证或最终回答。
- [x] 用户不能指定成员、并行模式或讨论轮数。
- [x] 主持人和成员沿用用户当前主要语言。
- [x] 成员只获得自身获授的 connector、Skill、提示词目录和凭据。
- [x] 主持人直接工具调用遵循正常桌面权限策略。
- [x] 正常 Coordinator UI 实时显示具体成员、任务、进度、完成和失败。
- [x] 单成员停止和整房间停止使用原生任务生命周期。
- [x] 应用重启恢复后重建稳定成员映射，不重复创建成员。
- [x] Group Room 不再包含自建 JSON 编排循环、独立成员执行引擎或专用聊天消息实现。
- [x] 全量单测、类型检查、renderer build、打包检查通过。

以上勾选表示实现与自动化验证完成；真实模型对“何时委派、是否交叉复核、何时收敛”的表现仍需按第 13 节在桌面端人工验收。

### 11.1 2026-09-02 自动化验证记录

- `bun run --cwd ui check`：通过。
- `bun run --cwd ui test`：314 项通过；CI 与 Release 已改为执行该完整集合，不再遗漏 `ui/src/group-room`。
- `bun test`：762 项通过（包含 Coordinator 工具范围、成员标题和 abort listener 生命周期回归）。
- `bun run build:node` 与 `bun run --cwd ui build:renderer`：通过。
- `CSC_IDENTITY_AUTO_DISCOVERY=false bun run --cwd ui dist:mac`：通过；实际包内验证 Node `v22.22.2`、Python `3.13.15`、ripgrep `14.1.1`、Sharp `0.34.5`、116 个连接器，并确认 DMG/应用未进行分发签名。
- Windows x64 由同一包校验脚本在 CI 的原生 Windows runner 执行；本地 macOS 不伪造 Windows 安装包结果。

### 11.2 2026-09-02 真实模型调试验收记录

- 使用开发模式、现有本地模型配置和独立测试房间完成真实请求；创建和打开空房间未触发模型或成员。
- 简单问题由主持人直接回答；重启后的主持人工具列表包含 `Read`、`Edit`、`Write`、`Bash`、`Agent`、`SendMessage`、`TaskStop` 等正常主会话能力，已由主持人自行读取根目录 `package.json` 并返回 `moss / 2.1.88`。
- 首次真实委派暴露 `run_in_background` 被 fork feature 从 Agent schema 隐藏、但房间校验仍强制要求该字段的问题；已改为依赖 Coordinator 原生后台生命周期并回归成功。
- 主持人先自主选择“代码检查员”，收到初审后又自主选择“反方审阅员”交叉复核，没有固定人数或轮数判断。
- 成员运行期间输入框可继续提交补充要求；消息显示为排队并在安全边界自动进入主持人下一轮，不再锁死输入。
- 点击停止后，主持人立即转为空闲，运行中成员标记为失败/停止；未出现迟到结果覆盖停止状态。
- 应用重启后恢复了 `memberId → native agentId` 映射；主持人通过 `SendMessage` 续接已完成的“代码检查员”，没有新建第三个 worker，结果自动通知主持人并由主持人用中文收敛。
- 成员子任务标题不再暴露内部 `memberId`；点击运行中或已完成成员时，在群聊主区域内打开只读成员线程，返回后仍停留在原群聊，不再跳到普通会话。
- 群列表折叠改为独立窄栏，避免覆盖正常会话标题栏按钮；群设置提供显式折叠/展开入口、完整滚动区域和响应式宽度约束。
- 长时间成员审查暴露 `StreamingToolExecutor` 未释放父级 abort listener 的告警；已在完成和丢弃路径释放监听器，并增加回归测试。

## 12. 实施约束与评审重点

- 不修改成熟 Coordinator 的决策语义来迎合 Group Room；只提取或泛化必要的资源作用域接口。
- 不同时保留两套调度机制，避免同一请求既被 Controller 委派又被 AgentTool 委派。
- 不依赖 prompt 保证 roster 和唯一性；这两项必须在工具入口校验。
- 不通过解析主持人的自然语言猜测任务状态；只消费 AgentTool 和 task notification 的结构化事件。
- 不把原生 agent 的完整工具日志复制进房间数据库。
- 不因 UI 映射失败影响原生 worker 的真实生命周期；执行事实以 Coordinator session 和 native task state 为准。
- 删除旧代码前先完成等价回归测试，确保权限、停止、恢复和连接器错误路径没有倒退。

## 13. 完成定义

只有同时满足以下条件才算完成：

1. 真实模型下，主持人能自己检查仓库，也能按需选择固定成员执行。
2. 同一成员首次由 `Agent` 创建，后续始终由 `SendMessage` 继续，没有重复 worker。
3. 并行、等待通知、失败恢复、停止和会话恢复均由已有 Coordinator 链路承担。
4. 左侧仍是群列表；中间是正常会话；右侧是群设置，并能实时显示主持人和成员的原生执行状态。
5. 旧 JSON 调度器、独立成员执行器和群聊专用消息页已删除，没有双轨状态。
6. 自动化测试、生产构建、包内容检查和真实桌面验收全部通过。
