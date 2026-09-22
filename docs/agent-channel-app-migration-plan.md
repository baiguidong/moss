# Agent Channel 与独立 IM App 改造计划

状态：阶段 A、阶段 B 和飞书试点已完成；OpenIM 按独立的个人 AI 回复模型另行迁移，详见 [OpenIM 独立 App 与个人 AI 回复改造计划](./openim-app-migration-plan.md)

负责人边界：Moss Core 提供账号、Agent、权限和会话能力；市场 App 负责渠道协议、消息展示以及该产品实际需要的交互。

## 1. 目标

把飞书、OpenIM 以及后续 IM 接入统一成可安装的 Channel App，同时保证：

- 每个外部会话有可审计的回复策略；不同产品可以采用渠道成员限制或本地用户联系人策略。
- AI 只能使用 Core 最终授权的 Agent、Tool、Skill 和 Connector。
- 外部消息可以使用固定会话、自动轮换会话或每次新会话。
- AI 自动回复、人工回复、AI 草稿人工确认都有明确且可审计的状态。
- App 永远拿不到 Moss 登录 Token、模型密钥或 Connector 凭据。

## 2. 产品模型

### 2.1 回复策略

策略按“会话默认值 → 成员覆盖值 → 管理员限制”解析：

| 策略 | 行为 |
| --- | --- |
| `human_only` | 消息只进入人工收件箱，不启动 Agent。安全默认值。 |
| `ai_auto` | 启动 Agent，成功后可直接交给渠道发送。 |
| `ai_draft_review` | 启动 Agent，结果进入待确认状态；批准、编辑后批准或拒绝都要留痕。 |
| `mention_only` | 只有明确 @ AI 时才启动 Agent，其余消息由人工处理。 |
| `inherit` | 仅用于成员覆盖，继承会话默认策略。 |

这些策略是通用 Agent Channel 能力，并不要求每个渠道全部暴露。飞书只使用 `ai_auto + fixed`，不提供成员覆盖、人工收件箱、草稿审核或会话控制。

OpenIM 不采用这一产品模型。它是当前登录用户自己的即时消息客户端：默认策略只是模板，每个单聊联系人都可以在当前用户实际拥有的 Core 权限范围内完整覆盖 Agent、资源、回复方式和上下文策略。

### 2.2 会话策略

| 策略 | 行为 | 建议用途 |
| --- | --- | --- |
| `fixed` | 外部会话持续绑定一个 Moss Session，依赖 Core 自动 compact。 | 长期客户、稳定项目群 |
| `rotating` | 达到轮次阈值后生成可信摘要，再切换新 Session。 | 默认；兼顾上下文和成本 |
| `new_each_turn` | 每条消息创建新 Session，不继承历史。 | 高隔离、一次性问答 |

具体默认值由产品决定；飞书使用 `fixed`。轮换模式的摘要必须由 Core 生成并保存，App 传入的“摘要”只能作为不可信消息内容，不能作为系统上下文。

### 2.3 权限计算

有效资源由 Core 计算，App 只能提交选择请求：

```text
有效工具 = Host 当前可用工具
         ∩ Agent 声明工具（如有）
         ∩ 会话/成员选择工具（如有）
         ∩ 管理员策略
```

Skill、Connector 使用同样的交集原则。`bypassPermissions` 不允许用于 Channel 会话；危险操作继续走 Moss 的确认与审计流程。App installation grant 只决定 App 能否调用 Host API，不能代替 Agent 的运行权限。

## 3. Host API

### `moss.channel/v1`

保留传输职责：连接、配对、外部消息接收、会话选择、投递确认和决策回传。消息来源、可选 @ 状态和草稿投递语义供有需要的 Channel App 使用。

### `moss.account/v1`

- `identity.current`
- `directory.list`
- `directory.search`
- `directory.changed` 事件

它是 Core Host Capability。OpenIM 用户创建、OpenIM Token 和平台 ID 映射仍属于 `moss.openim`，不能混入通用通讯录。

### `moss.agent/v1`

- `catalog.list`：返回可选择的 Agent、Tool、Skill、Connector 的脱敏目录。
- `binding.get` / `binding.update`：读写会话默认策略和成员覆盖。
- `turn.start` / `turn.list` / `turn.get` / `turn.abort`：启动、查询和停止 AI Turn。
- `turn.reply` / `turn.review`：处理人工消息，或批准、编辑、拒绝 AI 草稿。
- `binding.changed`、`turn.*` 事件：让 App UI 实时更新。

所有请求都由 Runtime 注入 `appId`、`instanceId` 和 owner；调用方不能指定其他 App 或实例。

## 4. 持久化

Desktop 使用现有 `sessions.db` 新增：

- `agent_channel_bindings`：App/实例/外部会话/可选成员、策略 JSON、revision、时间戳。
- `agent_channel_conversations`：外部会话与 Moss Session 的绑定、轮换计数和可信摘要。
- `agent_channel_turns`：来源消息、Binding 快照、Session、状态、草稿/最终文本、错误、时间戳。
- 唯一键和来源事件唯一索引保证幂等。

非敏感策略存 SQLite。App Secret、Moss Token、模型密钥和 Connector 凭据继续使用既有加密或 Core 内部存储，绝不写入 Binding 或下发给 App。

## 5. 安全与可靠性约束

- 外部文本始终作为普通、非特权用户消息进入绑定 Session；不可信输入约束在 Session Runtime 的通用系统提示中建立，协议 envelope 不写入可见会话历史。
- `source=agent/system` 默认不触发 AI；主动回复需单独授权。
- 每个会话串行执行；来源事件 ID 幂等；更新 Binding 使用 revision 乐观锁。
- 限制主动回复冷却时间、连续次数和链路 hop，防止两个 Agent 相互触发。
- Binding 更新后重建空闲 Runtime；忙碌 Runtime 在当前 Turn 完成后切换。
- 草稿未经 `turn.review` 批准不得产生“可发送”事件。
- App 只能读取脱敏目录，不返回 Agent system prompt、Connector 密钥或 Host 文件路径。

## 6. 实施阶段

### 阶段 A：Core 契约与存储（已完成）

- [x] App SDK 增加 Account/Agent 协议、权限、校验和 TypeScript 类型，Host API 提升到 `1.2.0`。
- [x] App Runtime 提供协议定义并继续复用统一授权、限流、取消和幂等传输。
- [x] Server 的通用通讯录接口脱离 OpenIM 开关，并按 App owner 与用户 scope 隔离。
- [x] Desktop 增加 Binding/Conversation/Turn SQLite 存储和策略解析。
- [x] 增加协议、grant、revision、幂等、策略继承、跨实例隔离和脱敏测试。

### 阶段 B：Desktop Agent Channel 执行链路（已完成）

- [x] 注册 Account/Agent Host handlers，并向受信 App UI 提供同一套 grant 校验入口。
- [x] 将飞书专用消息控制器抽象为通用 Channel Controller，保留旧适配器兼容层。
- [x] 将有效 Tool/Skill/Connector/Agent 策略注入 Session Runtime，并在 Tool 执行层再次拒绝越权。
- [x] 实现 `human_only`、`ai_auto`、`ai_draft_review`、`mention_only` 与人工回复/忽略。
- [x] 实现 `fixed`、`rotating`、`new_each_turn` 和可信摘要轮换。
- [x] 增加主动消息限流、hop 限制、并发串行、崩溃恢复、草稿审核和投递确认测试。

### 阶段 C：Server 与 OpenIM App（Desktop 已完成，Server 待后续）

OpenIM 的详细阶段、验收和个人联系人策略以 [OpenIM 独立 App 与个人 AI 回复改造计划](./openim-app-migration-plan.md) 为准；下列条目只保留总体里程碑。

- [x] Server 注册 Account Host handlers，并以 App owner 的组织/用户权限读取脱敏通讯录。
- [ ] Server 注册 Agent Host handlers，并接入 Server Session/Turn 执行链。
- [x] 将 OpenIM UI、消息协议、媒体和 RTC 交互迁入 `moss.openim` App，Desktop Core 只保留受控原生桥和账号供应代理。
- [x] OpenIM App 通过 first-party 平台 Broker 展示脱敏通讯录，并使用 `moss.agent/v1` 管理当前用户的默认策略和每个单聊联系人的完整自定义策略。
- [x] 即时消息入口由市场 App View 接管；禁用或卸载时暂时恢复旧内置入口。

### 阶段 D：迁移与发布（飞书代码已完成，待发布）

- [x] 对现有飞书实例应用 `ai_auto + fixed + 不额外收窄资源` 的兼容默认值，不改变老用户行为。
- [x] 新 Channel App 默认 `human_only + rotating + 空资源权限`。
- [x] `moss.feishu` 升级到 `0.2.0`，要求 Host API `^1.2.0`，只开放执行权限设置，并保留旧配对与固定会话映射兼容层。
- [x] `moss-apps` CI 已具备测试、签名 ZIP、GitHub Release 和 GitHub Pages Marketplace 发布流程。
- [ ] 创建 `moss.feishu-v0.2.0` 发布标签，发布后再把 Moss 预装锁从已发布的 `0.1.3` 更新为 `0.2.0`。

## 7. 验收标准

- 未声明协议、未申请权限或未授予 grant 的 App 均无法调用对应能力。
- App A 无法读取或修改 App B 的 Binding/Turn。
- 成员覆盖能继承会话策略，只能在 Core/管理员允许范围内运行资源。
- 相同外部事件不会创建两个 Turn；并发消息不会同时写同一个 Session。
- `human_only` 不调用模型；草稿未经批准不会进入可发送状态。
- Channel 会话无法启用 `bypassPermissions`，未授权 Tool/Skill/Connector 在执行层被拒绝。
- 固定、轮换、新会话三种策略重启后行为一致。
- 飞书配对、固定会话和普通文本回复无回归，且不暴露会话控制或卡片交互。

## 8. Moss 仍需补齐的独立 App 基础能力

本计划覆盖 Account、Agent 编排和 Channel 策略。OpenIM 完整迁移前还需要后续提供：

- 通用受限文件/媒体桥接（选择、缓存、下载、缩略图），不能暴露任意文件系统。
- 通知、Badge、深链和系统权限（相机、麦克风、屏幕录制）的声明式 API。
- 后台网络长连接生命周期、网络状态与系统休眠恢复语义。
- App 数据迁移/备份 API 和可观察的 schema version。
- 组织级管理员策略下发、审计查询和资源配额。
- App View 的标准列表/详情/设置组件规范，确保颜色、间距、空状态与 Moss 一致。

## 9. 本轮验证记录

- Moss Desktop：`643 pass, 0 fail`。
- Moss Core：`340 pass, 0 fail`。
- Moss Server：`64 pass, 0 fail`。
- `moss-apps` 飞书：`37 pass, 0 fail`。
- `moss.feishu@0.2.0` 已通过 TypeScript 检查、构建、Manifest 校验和本地 ZIP 打包。

本轮没有把 Moss 的预装锁提前指向 `0.2.0`。只有 GitHub Release 实际存在后才能更新锁文件，否则客户端更新时会再次出现 `Marketplace version not found`。

## 10. Review 加固（已完成）

- [x] Account、Agent 与 Channel 请求拒绝未知字段；消息正文、附件数量和附件字段均有明确上限。
- [x] Turn 只持久化安全消息字段，不保存附件本地路径或原始 data，也不能用额外成员字段冒用其他成员策略。
- [x] `resources.* = null` 在选择 Agent 后仍保持“不额外限制”的语义；技能和 Connector MCP 工具不会被误关。
- [x] 飞书设置页只呈现确认方式与资源选择，并保留暂时不可用的资源及混合 `null/array` 配置。
- [x] 飞书只订阅完成/失败事件并发送普通文本；稳定 Turn ID 保证重放不会重复投递。
- [x] 解绑同时移除配对记录和静态白名单；状态页优先展示传输错误并避免旧请求覆盖新状态。
- [x] Turn 终态内容不可再次修改，仅允许更新投递确认；Agent 文件按 UTF-8 字节限制总大小。
