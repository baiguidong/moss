# Moss Core / App 模块化迁移计划

## 状态

- 计划日期：2026-09-20。
- 当前阶段：Phase 1 已完成；Phase 2 飞书 Desktop App 代码迁移已完成，待使用真实飞书凭据做发布前联调。
- 本计划中的 App 是安装在 Moss 内、由 Moss App Runtime 托管的可选插件，不是脱离 Moss 的独立桌面应用。
- 迁移期间保留现有功能入口和数据格式；每个模块只有在迁移、回退和卸载验收通过后才删除旧实现。
- 当前项目尚未发布，因此 Manifest 和 Host API 可以在实现阶段直接演进，不为未发布格式保留兼容层。

## 目标

将 Moss 收敛为稳定、可审计的平台核心，其余产品能力按需安装：

1. 默认安装只包含聊天、Agent、Session、Project、安全、身份和 App 平台。
2. 飞书、资料库、即时消息、协作邮箱、Cron、审计中心、工作流等成为可独立启停、升级、回滚和卸载的 App。
3. App 不导入 Desktop、Server、Session 或 Project 内部模块，只通过版本化 Host Capability API 使用宿主能力。
4. Desktop 与 Server 使用同一 App 包；App 显式声明支持 Desktop、Server 或两者，并按 target 声明协议。Server 额外强制执行组织、用户和 Host 归属。
5. App 被禁用或卸载后，历史会话、长期引用、审计证据和通用 Tool 结果仍然可读。

## 非目标

- 不把飞书或其他模块改造成脱离 Moss 的独立 OS 应用。
- 第一阶段不允许运行任意不可信原生代码；Backend App 仍限定为第一方或可信发布者。
- 不在首轮统一现有 Connector、Skill 和 App 包格式。
- 不允许 App 直接读取 Moss 数据库、用户 JWT、Credential Vault 主密钥或内部文件路径。
- 不为 App 提供绕过 Moss 权限、checkpoint、决策或审计规则的执行路径。

## 当前基线

现有 App Runtime 已具备：

- UI-only、Backend-only、UI + Backend App。
- on-demand 和 persistent 子进程。
- Desktop / Server target。
- 配置、密钥、实例、日志、启停、升级、回滚和卸载。
- 隔离 WebView、Backend Action、事件和版本化 Host Capability 双向协议。

距离完整插件平台仍有四类缺口：

1. App UI 只有 App 自身的 instance/action/storage/event API，没有 Agent、Project、资源、通知等宿主能力。
2. Manifest 没有 View、Settings、Command、Tool、Resource Provider、Widget 等贡献点，顶层导航仍由 Moss 硬编码。
3. Host API 2 已接入真实 Session/Agent 服务；资源、通知等后续领域仍需复用同一注册机制。
4. Server installation、instance 和 deployment 没有 org/user owner，无法安全替代当前按用户隔离的服务。

## 核心边界

### 必须保留在 Moss Core

| 能力 | 保留原因 |
| --- | --- |
| Agent / Session / Turn / Task Runtime | 所有 App 的统一执行内核和生命周期权威源 |
| Chat 基础 UI 与通用 Tool 结果渲染 | App 缺失时仍需读取历史会话 |
| Project 权威状态 | 保存任务、资源、记忆、决策、会话和权限关系 |
| Tool 权限、安全策略、workspace/checkpoint | 不能由可卸载 App 绕过或删除 |
| Identity、Server 登录、Credential Vault | App 只取得最小授权句柄，不取得宿主凭据 |
| App Runtime、App Center、包验证和签名 | 安装模型本身必须始终可用 |
| 通知、决策和最小审计账本 | 保障高风险操作、追责和卸载后的可恢复性 |
| 导航壳、Deep Link 路由和权限 Broker | 统一发现、授权和撤销 App 能力 |
| 文件、媒体和资源授权 Broker | 避免 App 直接获得任意宿主文件访问权 |

### 优先迁入 App

- 平台适配 SDK、连接守护进程和产品专属配置页面。
- 产品页面、市场页面、索引器、解析器、调度器和规则引擎。
- 产品专属数据库、缓存、投递队列和可重建派生数据。
- 通过 Host API 调用 Agent、资源、通知和决策的业务编排。

## 模块迁移矩阵

| 模块 | 当前可行性 | App 所有内容 | Core 保留内容 | 前置能力 |
| --- | --- | --- | --- | --- |
| 飞书 Desktop | 高 | SDK、长连接、配对 UI、消息转换、投递状态 | 身份绑定、Session、Agent、决策、通知 | Channel 真实 handler、View/Settings |
| 飞书 Server | 中 | 与 Desktop 相同 | 租户鉴权和主体上下文 | org/user ownership、Server request principal |
| 概览 / 记忆浏览 | 高 | 浏览、筛选、统计页面 | Usage Ledger、记忆生成和权威状态 | 只读 Agent/Project API、View |
| Buddy | 高 | UI 和交互逻辑 | Agent 和通知 | View；悬浮体验另需 Widget/Overlay |
| Skill / Expert 市场 UI | 高 | 目录、搜索、详情和安装体验 | 校验、加载、权限、会话注入 | View/Command、受控安装 API |
| Cron | 中高 | 调度、任务库、历史和配置 UI | Session/Agent 执行、权限、通知 | Agent、Notification、Tool Contribution |
| 协作邮箱 | 中 | 轮询、队列、邮件 UI、投递逻辑 | Moss 主体、Agent、决策 | Account Proxy、Agent、Notification、Tool |
| OpenIM | 中 | IM UI、连接和消息逻辑 | 主体、组织目录、文件权限 | Account、Files、Media；Web/WASM 或原生桥 |
| 审计中心 | 中 | 规则、扫描、索引和分析 UI | 最小事件账本、checkpoint、撤销证据 | Audit API、高权限 grant、Tool |
| 资料库 | 整体中低，拆层中高 | 解析、索引、集合、搜索、管理 UI | 资源授权、稳定 URI、项目资产状态、引用快照 | Resource Provider、Files、Agent、流式句柄 |
| 工作流 | 整体低，拆层中 | Catalog、编辑器，后续迁执行编排 | 子 Agent、权限继承、任务状态、取消语义 | Agent/Task API、Tool、快照契约 |
| Connector | 暂缓 | 长期可成为 Provider 类型 App | 当前 Connector Runtime 暂留 | OAuth/Credential/Tool/Resource 统一贡献模型 |

## 目标架构

```text
App UI / App Backend
        |
        | @moss/app-sdk: request(protocol, method, input)
        v
Scoped App Bridge
        |
        v
Host Capability Broker
├── protocol/version validation
├── manifest declaration validation
├── installation grant validation
├── app/instance/owner principal
├── schema, size, timeout and concurrency limits
├── cancellation, idempotency and redaction
└── per-domain handler registry
        |
        +-- moss.account/v1
        +-- moss.agent/v1
        +-- moss.desktop/v1
        +-- moss.remote/v1
        +-- moss.resources/v1
        +-- moss.files/v1
        +-- moss.audit/v1
        +-- moss.notifications/v1
```

Host API 2 不保留旧 Channel 兼容层。会话与 Turn 收口到 `moss.agent/v1`，操作系统和跨 Host 能力分别由 Desktop、Remote 协议承载；业务协议不能直接导入宿主内部模块。

## Host Capability API

### 统一契约

每个请求必须携带或由运行时注入：

- `protocol`、`method`、`requestId` 和版本。
- `appId`、`appVersion`、`instanceId`、deployment generation 和 target。
- `ownerScope`、`orgId`、`userId`；不适用的字段为 `null`，不能由 App 自报。
- Manifest 声明、已批准 grant 和对应 method permission。
- `AbortSignal`、超时、消息大小、并发和幂等上下文。

协议注册项必须声明：

- 稳定协议名称和主版本。
- method 名称、输入/输出校验器和所需权限。
- 默认超时、最大响应大小、是否允许长期任务和幂等要求。
- 支持的 target、owner scope 和是否允许 UI 直接调用。

### 领域协议

| 协议 | 首批能力 |
| --- | --- |
| `moss.agent/v1` | Binding、Session、Turn、投递确认和脱敏事件 |
| `moss.account/v1` | 当前主体、组织目录、受限 Server API 代理；永不返回 JWT |
| `moss.desktop/v1` | App 私有文件、截图、外链和媒体权限 |
| `moss.remote/v1` | 现有 App 的过渡兼容；新 App 不用于拆分 Desktop/Server Backend |
| `moss.resources/v1` | 授权资源句柄、读取元数据、本地化、Provider 注册 |
| `moss.files/v1` | 文件/目录选择、临时文件、open/reveal、Blob/Stream handle |
| `moss.audit/v1` | 脱敏实时事件和显式授权的历史查询 |
| `moss.notifications/v1` | 系统通知、进度和一次性决策请求 |

大文件、媒体、全文和长任务不能装进普通 JSON request。Host 返回带权限、期限和 owner 的 opaque handle，内容通过受限流读取；后台任务返回 operation ID，并通过事件报告进度。

## Manifest Contributions

Manifest 新增可验证、可授权的静态贡献声明：

| Contribution | 用途 | 关键约束 |
| --- | --- | --- |
| `views` | 一级或二级页面 | 使用稳定 ID、已打包 UI entry、可声明导航位置 |
| `settings` | App 设置入口 | 只能管理本 App；敏感字段走 Vault |
| `commands` | 命令面板和 Deep Link | 声明标题、参数 schema 和后台 action |
| `tools` | Agent 可调用 Tool | 声明 input schema、只读/副作用/破坏性和 permission |
| `resourceProviders` | 资料、附件等稳定资源 | URI scheme、metadata、resolve action、卸载 fallback |
| `widgets` | 有限的浮层或状态组件 | 首阶段仅可信内置 App；单独系统权限 grant |

规则：

1. Contribution ID 在 App 内唯一，完整 ID 为 `<app-id>/<local-id>`。
2. Manifest 只表示 App 请求能力；installation grants 才表示 Host 已批准。
3. 禁用 App 时立即注销其 View、Command、Tool 和 Provider，不删除用户数据。
4. Tool invocation 仍进入 Core 的统一权限、checkpoint、审计和取消管线。
5. 未安装 App 的历史 Tool 结果使用通用 JSON/Markdown fallback renderer。

## Server ownership 与鉴权

### 归属模型

| Scope | 含义 | 典型场景 |
| --- | --- | --- |
| `host` | Server 管理员管理、整台 Host 唯一 | 运维型 Backend-only App |
| `org` | 属于一个组织，可由组织管理员共享配置 | 企业统一渠道或审计规则 |
| `user` | 属于组织内单个用户 | 个人飞书账号、个人邮箱、个人 Cron |

installation、instance、deployment、secret、data 和 log 均继承 owner。所有 list/get/update/delete/action/channel 操作必须将请求 principal 与 owner 做服务端匹配，不能只依赖通用 scope 字符串。

Desktop 使用本地 owner，迁往 Server 时必须显式选择目标 scope；移动部署不改变数据归属。旧的无 owner Server 记录只允许管理员迁移一次，不能自动归到第一个访问用户。

### 状态迁移

1. State schema 升级到新版本，增加 owner 字段和复合唯一约束。
2. 新建记录必须指定经 Host 解析的 owner；App 输入中的 owner 字段被忽略或拒绝。
3. Server 路由从认证上下文构造 principal，并将其传入 Runtime，而不是使用全局 Runtime 身份。
4. Channel/Host API context 始终包含不可伪造的 principal。
5. 日志、事件订阅、部署 lease 和远端移动均按 owner 过滤。

## App Catalog 与信任

首阶段保留本地 ZIP 安装，同时增加 Catalog 抽象：

- Catalog 返回不可变版本、校验和、发布者和签名信息。
- 安装前显示权限、后台生命周期、target 和 publisher。
- 内置 App 进入默认 Catalog，但不再因位于仓库 `apps/` 而无条件自动启用。
- 第一方签名 App 可请求高权限；未知发布者不能请求原生桥、Widget、审计回填等能力。
- 更新增加权限时必须重新确认，回滚不得恢复已经撤销的 grant。

## 数据、禁用和卸载

### 数据分类

| 类型 | 所有者 | 示例 |
| --- | --- | --- |
| Core authoritative | Moss | Session、Project 资产、审计证据、决策、checkpoint |
| App authoritative | App | 平台账号配置、规则、调度表达式、集合设置 |
| Derived / rebuildable | App | 全文索引、缓存、消息搜索索引、统计聚合 |
| Cross-reference | Core + stable App URI | 资料引用、Workflow 快照、Tool 结果 |

### 生命周期规则

- 禁用：停止 Backend，注销 contributions，保留包、配置、密钥和数据。
- 卸载：默认删除代码和运行记录，保留数据；密钥和数据分别二次确认删除。
- 重装：同一 App ID 可认领保留数据，但必须重新校验 schema 和 permission grants。
- 旧数据迁移：幂等、先复制、验证数量和校验和、切换读取、观察后再删除旧副本。
- App 缺失：历史会话和 Project 仍可打开；稳定资源显示 metadata 和“需要安装 App”状态。
- Cron 卸载后任务暂停而不是丢失；重装可恢复。
- 资料库资源 URI、Workflow 执行快照和审计事件不得只存在 App 私有数据库。

## 分阶段实施

### Phase 1：插件平台基础

范围：

1. 将 Channel 专用 Host dispatch 抽象为版本化 Host Capability Registry，并以 adapter 保留 Channel SDK。
2. 增加安装时 grants，运行时同时验证 Manifest declaration 和 grant。
3. 增加 View、Settings、Command、Tool、Resource Provider 的 Manifest schema 和查询 API。
4. 将 Desktop 导航改为 Core entries + enabled App contributions；不在这一阶段迁产品页面。
5. 给 Server App 状态增加 host/org/user owner，路由按 principal 过滤。
6. 增加 Catalog/Publisher 接口和签名元数据，保留本地 ZIP source。

验收：

- 现有 App、Action 和 Channel 测试全部通过。
- 未声明协议、未授权 permission、owner 不匹配和禁用实例均在业务 handler 前拒绝。
- 两个用户不能看到、操作或订阅彼此的 App instance、日志和事件。
- 测试 App 能通过 Manifest 增加/移除导航项和 Tool；禁用后立即消失。
- Host protocol handler 可注册、注销、取消并正确清理并发计数。
- 旧 state 可幂等升级，失败不破坏原数据库。

### Phase 2：飞书 Desktop App

范围：

- 将飞书平台 SDK、连接、配对、配置和投递移动至 `moss.feishu` App。
- Desktop 与 Server 注册通用 Agent handlers，接入 Session/Turn 与授权策略。
- 产品配置、配对、连接状态和投递全部由 App 自身持久化与处理。

验收：

- App 可独立安装、配置、启停、升级和卸载。
- Moss 关闭飞书页面后 Backend 保持运行，Moss 退出后正确停止。
- 重复外部事件不会创建重复 Turn；取消、超时和重连不会泄漏 handler。
- 未安装飞书 App 时 Moss 核心功能无飞书代码依赖。

实现记录（2026-09-20）：

- 飞书源码已迁移至独立的 [`baiguidong/moss-apps`](https://github.com/baiguidong/moss-apps) 仓库，Manifest ID 固定为 `moss.feishu`。
- Moss 构建通过 `config/bundled-apps.lock.json` 下载、校验并预装固定版本，不再从主仓库编译飞书源码。
- 飞书 SDK、长连接、消息转换、配置 schema、设置页、配对状态和测试均归 App；Moss 不再生成或启动独立 Adapter 产物。
- Desktop 与 Server 共用 `moss.agent/v1`；Core 只持有 Session/Turn、授权和幂等账本。
- App UI 通过统一 instance/action/host API 管理 Desktop 或 Server 实例，不再调用产品专用 IPC。
- 自动验证覆盖 Agent 映射、权限、取消、事件 ACK/去重、持久进程生命周期和通用构建入口；真实账号连通性仍属于发布前人工验收。

### Phase 3：轻量 UI App

- 迁移概览、记忆浏览、Buddy、Skill/Expert 市场 UI。
- 验证 View、Settings、Command 和 Widget 边界。
- 删除对应硬编码导航，但保留 Core 服务。

### Phase 4：Cron App

- 迁移调度器、任务库、配置和运行历史。
- 使用 `moss.agent/v1`、Notification 和 Tool Contribution。
- 用此阶段验证长任务、恢复、幂等和卸载暂停语义。

### Phase 5：协作邮箱与 OpenIM

- 协作邮箱验证 Account Proxy、决策通知和多实例常驻进程。
- OpenIM 验证组织目录、文件、截图、麦克风和摄像头授权。
- 原生 SDK 若无法安全隔离，使用受限的 first-party native bridge，不向通用 App 开放 Node/Electron。

### Phase 6：审计中心拆层

- 迁出规则、扫描、查询索引和 UI。
- Core 保留最小事件写入、权限执行、checkpoint 和撤销证据。
- 历史回填单独高权限授权并记录操作者。

### Phase 7：资料库拆层

- 先建立稳定资源 URI 和 Resource Provider，再迁解析、索引、集合和 UI。
- Core 保存 Project 资源授权、会话快照及引用 metadata。
- 文件内容通过 handle/stream 传递，不通过普通 Channel JSON。

### Phase 8：工作流执行器

- 先迁 Catalog 和编辑器，再迁执行器。
- 固化 Workflow snapshot、子 Agent、权限继承、任务进度、嵌套和取消契约。
- App 缺失时仍可查看历史执行图和结果。

### Phase 9：模型统一评估

- 评估 Connector、Skill、Expert 是否统一为 App Contributions。
- 只有 OAuth、Credential、Tool、Provider 和依赖解析均成熟后才合并安装模型。

## 测试策略

每个阶段至少覆盖：

- Manifest/schema 正反例及 Host API 版本兼容性。
- 权限、grant、owner 和 target 的拒绝路径。
- Action/Host request 的超时、取消、并发、幂等和进程退出。
- Desktop/Server 重启恢复、persistent reconcile 和 deployment lease。
- 安装、更新、降级、回滚、禁用、卸载和保留数据重装。
- 跨 App、跨实例、跨用户和跨组织的数据隔离。
- 旧数据迁移中断后的重试及回退。
- App 缺失时历史 Session、Tool 结果、资源引用和审计证据的降级显示。

## 发布门槛

任何模块从 Core 删除前必须满足：

1. 新 App 在受支持 target 上连续完成安装、迁移、运行、升级、回滚和卸载测试。
2. 数据迁移具有统计校验、幂等重跑和一键回退。
3. Core 不再静态导入该模块实现；未安装时启动和核心测试通过。
4. 权限清单、数据保留和卸载影响在 App Center 中可见。
5. 对长期引用提供 App 缺失 fallback。
6. Server 模块通过跨组织、跨用户隔离测试。

## 主要风险与处理

| 风险 | 处理 |
| --- | --- |
| Host API 演变为内部模块透传 | 按领域设计小型协议；只暴露稳定 DTO 和 opaque handle |
| Manifest 自声明被误当授权 | 单独持久化 installation grant；每次调用动态核验 |
| Server 全局 Runtime 导致越权 | owner 进入主键、查询、事件、日志、secret 和 handler context |
| 大文件或媒体堵塞 IPC | 受限 blob/stream handle，不提高普通 JSON 上限 |
| App 卸载破坏历史 | Core 保存长期引用快照，通用 fallback renderer |
| 第三方 Backend 读取本机数据 | 首阶段仅可信发布者；文件、网络和原生能力经 Broker |
| 双实现期间行为漂移 | shadow/read compare、功能开关、单向切换和明确回退窗口 |
| 一次迁移范围过大 | 按平台能力和单个 App 垂直切片，每阶段独立验收 |

## 决策记录

- 2026-09-20：App 保持为 Moss 内的插件，不发展为独立进程产品或独立 OS App。
- 2026-09-20：先完善 Host Capability 和贡献模型，再迁产品模块。
- 2026-09-20：飞书 Desktop 为首个业务迁移；Server 版本以 ownership 完成为前置。
- 2026-09-20：资料库、审计中心和工作流采用“Core 权威层 + App 产品层”，不整体搬迁。
- 2026-09-20：Connector 暂时维持独立模型，最后统一评估。

## 实施进度

- [x] 完成现状盘点和模块迁移分级。
- [x] 固化整体迁移计划、核心边界和阶段验收标准。
- [x] Phase 1.1：通用 Host Capability Registry 和 Channel adapter。
- [x] Phase 1.2：Manifest Contributions 与 installation grants。
- [x] Phase 1.3：Desktop 动态导航和 Tool 注册。
- [x] Phase 1.4：Server ownership、principal 和隔离。
- [x] Phase 1.5：Catalog/Publisher 抽象与第一阶段总体验收。
