# Moss 轻量启动修复方案

日期：2026-10-22。依据：`docs/startup-operations-review-20261022.md` 的源码审计和只读证据。

本文件是待实施方案，本轮不修改启动实现、不重启、不迁移真实数据。目标不是把原来的全量任务统一推迟 1 秒，而是**删除无效工作、按实际使用初始化、只恢复真正需要继续运行的服务**。

## 1. 启动的边界

划分三个明确阶段，不再用一个 ready 标志表示全部功能都已经初始化。

| 阶段 | 工作与完成条件 | 不允许发生的工作 |
| --- | --- | --- |
| 最小启动／首屏可交互 | 单实例／profile／协议；基础配置；必需数据库兼容性；小型本地摘要；IPC 注册；创建窗口并显示可用界面 | 全会话历史解析、全目录扫描、全部 App restore、完整 agent／SDK 哈希、网络探测、模型调用、下载和维护清理 |
| 功能首次使用 | 打开某会话、发消息、搜索、访问项目资产、调用某 App／工具、使用远程服务时，初始化该功能的必要依赖 | 为一个功能顺带初始化所有 App、扫描所有项目、重写所有历史 |
| 明确启用的后台工作 | 首屏可交互后，只启动配置有效、确实要求常驻／继续处理的邮箱、渠道、非空定时任务、活动任务恢复 | 用 installation.enabled、engine 已安装、目录存在等条件推导所有功能都要启动；重跑已完成历史；无变化保存 |

各功能可以处于“未初始化／准备中／可用／失败”，不能因为某可选功能失败阻止首屏。用户马上发消息时等待该会话依赖即可，不等待无关功能。

这里的“首屏可交互”用 renderer 确认本地摘要及基本操作可用来标记，不等同于任意 `setTimeout(1000)`、`Application ready` 日志或所有远程请求完成。

## 2. 首屏之前必须保留的操作

1. **单实例与身份隔离**：profile／数据路径、单实例锁、协议权限和基础安全设置。拿不到锁必须在任何业务 store／恢复／写入之前结束，不能仅调用 `app.quit()` 后继续模块顶层初始化。
2. **必需数据兼容性**：打开基础 SQLite、设置连接参数、根据 schema version 做影响首屏读写的最小迁移。索引重建、历史回填、App legacy 导入不是基础 schema migration。
3. **只读加载小型配置和目录摘要**：本地 settings、会话 metadata、项目 metadata、安装 App 的 registry metadata。不要 SELECT 或解析 `history_json`，不要递归读取工作区或 App 包内容。
4. **注册界面和惰性功能入口**：基础 IPC、协议路由、窗口／renderer、最小状态对象。注册 handler 不等于立刻构造重型服务或启动子进程。
5. **防止错误恢复的最低状态保护**：识别旧 host generation 的 running 状态，UI 不显示为当前运行；少量必要的状态迁移允许写。具体会话／App／任务的恢复在它被使用或后台服务启动前完成。

允许的首启写入仅包括必需目录、缺失密钥／schema／profile、单实例或 lease 状态，以及确实发生变化的安全恢复；正常相同版本、相同业务数据再次启动，不应改写历史、索引、凭据、资源和业务 JSON。

凭据、TLS、包签名、权限和 orphan 检查仍然必须执行，**但在相应操作执行前执行，不要求为尚未使用的所有功能提前执行**。

## 3. 明确不属于启动必需的操作

| 当前操作 | 修复后的行为／触发点 | 归属 |
| --- | --- | --- |
| 全部主／子会话历史 hydrate | 启动只取 metadata；打开、发送、导出、分叉、回退或恢复该会话时，加载该条历史 | Core |
| 每启动 DELETE／INSERT 所有 FTS | 删除启动同步；正常消息／标题变化时增量更新；首次搜索遇到缺索引或 schema 变化时有界补建 | Core |
| 会话列表触发全部父会话子会话扫描 | list 纯读；展开／打开对应父会话或有活动 worker 事件时增量同步；源签名持久化 | Core |
| listProjects 递归扫所有项目工作区 | list 只读项目摘要；打开资产视图、添加／修改文件、执行依赖项目资源的任务或显式刷新时 reconcile 对应项目 | Core |
| 缺 underlying ID 的所有旧会话启动扫描 | 打开／继续／导出该会话时尝试恢复；有确实待执行任务时只恢复其关联会话 | Core |
| 启动远程身份／全远程会话同步 | 首屏读本地缓存；进入远程功能、显式刷新或确有远程后台工作时联网；sync 仅保存变化 | Core |
| renderer 全局每 5 秒远程同步 | 仅远程列表／会话活跃、相关事件或明确后台同步策略要求时运行；离开范围停止，合并并发 | Core |
| 启动 WebSearch 模型 probe | **取消启动模型探测**；实际需要 WebSearch 时再检测或利用真实调用结果；未检测显示“未验证”，不假造支持／不支持 | Core |
| 导入完整 agent bundle、全局本地预热 | 第一次本地模型／工具请求初始化；若保留用户选择的预热，单独标为可选，不属于默认启动 | Core |
| Node／Python／Git 全部安装和版本检查 | 首次需要哪种 runtime 就 ensure 哪一种；启动只读 cached registry；已验证版本未变化不重写 registry | Core |
| 内置 skills／assistants 每启动强制复制 | 从随包只读目录展示内置资源；真正需要 materialize 或用户执行升级同步时复制变化的受管理文件 | Core |
| 全量 SDK／contracts／依赖哈希 | 构建期生成指纹；第一次使用 App 开发契约／导出时加载，开发模式按变更失效 | Core |
| 自测 build ID 读取完整 main／agent bundle | 构建期生成；开发模式首次自测时计算，不进入自测不算 | Core |
| 全部 App package restore／贡献遍历 | 首屏读 registry metadata；调用特定贡献／App 时只加载相关包；manifest 元信息先筛选，再 getActivePackage | Core Runtime |
| App Authoring 构造、遍历 operation、清空全部 previews | 第一次进入开发／预览／发布功能时恢复相关状态；确定失效的临时资源走独立维护，不每启动全目录 rm | Core |
| App Execution 的近期完成历史加载和 retention prune | 任务面板按需加载完成历史；后台仅读未完成／待通知任务；retention 清理由独立维护节流执行 | Core |
| CA bundle 无条件重建 | 第一次远程请求前加载信任；内容未变不替换 bundle，安全验证照常 | Core |
| 读取凭据后立即重新加密和保存 settings | 读取不保存；首次实际使用时加载相应凭据；只在值变化或明确迁移时写 | Core |
| Cron 空 store 初始化／周期写入 | 空任务不启动 timer，不保存；非空任务才启动 scheduler，no-op update 不落盘 | Core |
| 全主会话 Teams archive／continuation 扫描及 750 ms timer | 有持久化活动 team／待恢复 continuation 才按相关 ID 检查；无活动 team 不轮询，归档按打开读取 | Core |
| 资源监控后台反复 `/bin/ps` | 打开监控面板或明确开启后台监控时采样；活动 runtime 必需 watchdog 保留，不用全系统采样替代 | Core |
| 读取全部 cloud transfers，启动 watcher | 打开云存储或执行传输时构造；旧传输仍暂停，不能因为初始化而自动恢复上传／下载 | Core |
| 没有 runtime 仍启动 runtime pool sweep | 第一个 runtime 被跟踪时启动回收 timer，集合为空时停止 | Core |
| Trace legacy 全量导入／列表全 metadata 读取 | 进入 Trace 时一次性迁移或显式导入；列表按页读轻量 metadata，详情才读 messages；不启动补录历史 | Core + Trace App |
| 开窗后自动检查／下载更新 | 从默认启动路径移出；手动检查保留，自动检查作为独立且明确启用的维护策略，不阻塞启动 | Core |

“有界补建／维护”不能在主进程一次同步解析几十 MB；需要后台分批或现有 worker，并在用户操作繁忙时让出资源。不能为做 hash／dirty 比较，又在启动读一次全部历史和资源。

## 4. 哪些后台服务仍需要启动

**是否必须开机运行取决于用户已经启用的功能，不取决于 App 是否安装。** 不擅自丢弃已有定时任务、邮箱、消息渠道或待交付结果。

| 功能 | 允许后台启动的条件 | 只做哪些必要工作 |
| --- | --- | --- |
| Cron | 有 enabled、可调度任务，自动化未暂停 | 读取小型任务表、必要的中断状态转换、建立计时；到期才加载关联会话／runtime，正常恢复不重复执行已完成 run |
| Agent Mail | 用户开启、连接／策略有效 | 长轮询与 lease、旧 queued 的按策略处理、必要投递；关闭时不建 consumer、不联网、不 drain |
| Feishu／其他消息渠道 | 用户配置并启用常驻接收、有效凭据和权限 | 只启动对应连接服务，模型 runtime 到消息需要处理时才加载 |
| OpenIM | 当前产品功能确实要求登录／常驻接收，且账号连接配置有效 | 必要的 session／SDK 登录与刷新；仅浏览本地入口不为首屏等待登录 |
| 活动 Team／待交付任务 | 有实际活动或恢复记录 | 按相关 task／session ID 做必要检查和投递，没记录不扫全历史、不启动 timer |
| 自动审计 | 已明确开启连续审计 | 轻量订阅新增事件，消费 checkpoint 后的变化；不每次启动遍历导出全部会话和读取全部事件文件 |
| 自动更新／后台资源监控 | 明确启用对应后台策略 | 首屏后独立运行、可暂停／取消；默认轻量启动不把它们当必需服务 |

调度规则：首屏不 await 上述服务；之后只启动符合条件的服务，使用有限并发和每服务 single-flight。用户实际操作优先；不要保留“1 秒后无条件 restore 所有 App”的路径。

### App 生命周期需要配套调整

- **Trace**：保持 on-demand；Core 采集配置是另一条轻量路径，必须在第一条实际 LLM／工具事件发生前就绪，不能等用户打开 Trace 才采集。
- **Memory**：移除 Backend 初始化时的主动 MCP inspect；首次调用记忆工具／显式测试连接时注册和连接。若注册依赖现有 persistent 生命周期，应先完成按需注册能力再调整 manifest。
- **Knowledge RAG**：engine 已安装不再触发启动；第一次检索或显式“启动引擎”才 prepare_model／启动 Python／注册 MCP。模型下载必须有明确请求和进度，不在默认启动发生。
- **Library**：浏览／搜索／导入按需；只有明确启用的 source watch／refresh 或实际 pending job 需要后台工作。不能默认重建库。
- **工具类 App／Workflow／Takt／Buddy**：纯 UI 和 action 按需；待执行 job、必须接收的事件和待投递结果逐项保留恢复入口。完成 run 只读展示，不启动 worker。
- **消息渠道**：真正承担常驻接收的 persistent Backend 保留，但只启动配置有效且用户启用的实例，不拉起无关 App。

不能直接把所有 manifest 的 `persistent` 改成 `on-demand`：否则事件接收、队列恢复和通知可能丢失。官方 App 逐项修改启动副作用及生命周期；第三方 persistent 声明在没有兼容的明确启动策略之前继续尊重，不把“App 启用”静默变成“后台停用”。如需新增“随 Moss 启动”配置，要区分安装启用与后台策略、展示迁移结果，并保存现有用户选择。

## 5. 实现必须处理的依赖与数据安全

### 5.1 摘要加载与完整历史必须是不同状态

当前 `ui/src/session-persistence.mjs:43` 会序列化 history；`ui/src/session-persistence.mjs:198` 每次保存还同步 manifest／FTS／Trace。直接把所有 record 的 history 改为 `[]` 会导致旧历史被保存成空数组，这是本次改造最大的风险。

必须先完成以下约束，再切换摘要启动：

- 单独标记 DB 历史是否已加载、来源 transcript 是否已 reconcile；现有 `historyLoadedFromSource` 不能同时承担两个含义。
- metadata-only 保存使用只更新 metadata 的 SQL，不覆盖 `history_json`；未加载历史不生成空 snapshot、不清空 FTS、不重置账单。
- history 写入、消息 append、发送、分叉、删除／回退、导出、compaction 详情读取等入口必须先 ensure 该条历史；加载去重，失败时拒绝操作，不能把失败当空历史。
- 异步加载与删除／消息 append／回退使用现有会话串行约束和版本检查，不能让较晚返回的旧 snapshot 覆盖新记录。
- pending plan approval、usage、project finalizer、subagent status 等摘要投影在正常变化时持久化；旧记录缺投影时只对实际打开／待审批的少数记录回算，不在启动全量回填。
- 未加载 pending approval 不等于没有 approval；不能保留现在基于空 history 派生 null 就 expire 审批的启动判断。审批动作前按持久化 decision 与该会话状态校验。
- Audit／session export 的 source revision 改为稳定的持久化 revision；不得因为 history 未加载或进程内对象引用变化让全部旧会话被判 changed。
- 前序 usage／context／Trace 修复不回退：当前窗口用量与会话累计仍各用各的正确口径，未知容量仍不猜容量、不主动压缩。

### 5.2 惰性依赖必须在真实操作前就绪

不引入新的通用任务框架，优先使用小型 ensure 函数与现有队列：

- ensure 会话历史 → 必要的会话恢复 → ensure 所需 runtime → 设置 Trace 采集 → 执行实际请求。
- ensure 远程 trust／credentials → 远程身份、fetch、后台渠道或远程模型请求。
- ensure 指定 App 的状态迁移、权限、配置、包完整性 → 清理该 runtime 的旧 orphan → 启动该 Backend／action。
- ensure 指定项目资产 reconcile → 使用其生成的资源 manifest 执行任务。
- ensure 开发目录／Authoring committing 恢复 → 开始新的 build／publish，不能跳过未决事务冲突校验。

并发首次使用共享同一 in-flight promise；失败后允许显式重试，退出／取消能终止后台准备。所有权限／凭据检查仍在执行前完成。

### 5.3 真正的 no-op 持久化

- 历史和 metadata dirty 分开；FTS 用已持久化的投影版本／内容 revision，不用每启动全量 hash。
- 子会话存储源路径身份、文件 signature、必要终态和资源 signature；截断、文件替换或 metadata-only 变化仍可正确同步。
- Cron、凭据、CA bundle、runtime registry、App desiredState、Authoring／local-tasks 比较业务内容；未变化不制造新的 updatedAt、临时文件或 rename。
- 真的状态变化才写一次，保留事务、原子 rename、权限、崩溃恢复和必要串行性。不得仅靠吞掉错误或增大 Trace 队列掩盖重复写。
- 没有任务不启动周期 timer；有任务时先保留可靠调度和 no-op 跳写，不必第一批重写所有调度算法。

## 6. 分批修复顺序

### 第一批：删除启动重复工作，先不改变历史表示

范围：`ui/src/main.mjs`、`ui/src/session-persistence.mjs`、`ui/src/session-search-index.mjs`、`ui/src/project-assets.mjs`、`ui/src/moss-cron-scheduler.mjs`、`shared/cron-task-store.mjs`、凭据／TLS／runtime registry。

- 修正未获得单实例锁仍继续顶层初始化的问题。
- 去掉 hydrate 的全量 FTS 同步、listSessions 的全父会话 reconcile、listProjects 的资产递归扫描副作用；相关功能改走明确的 reconcile 入口。
- 删启动 WebSearch probe；凭据 hydration 不保存；空 Cron 不调度、no-op 不写。
- 远程、TLS、App desiredState 等未变化不保存；保留前序 Trace 不启动全量补录的修复。
- 此批即使仍暂时保留旧历史 hydrate，也能先停止大量不必要写入；**不把这一批称为最终轻量启动完成**。

### 第二批：拆开首屏和功能初始化

范围：`ui/src/main.mjs`、`ui/src/renderer-react/App.tsx`、`ui/src/runtime/managed-runtimes.mjs`、`ui/src/apps/app-developer-catalog.mjs`、Authoring／App Execution Host 等。

- 单实例成功后执行最小 bootstrap；重型服务不在模块顶层构造。
- 移出 runtime 全部安装、资源复制、agent 预热、SDK／自测 hash、Authoring／retention 清理、远程联网和后台监控。
- renderer 初始 batch 只加载轻量本地摘要；连接器／助手用缓存或小型本地 metadata，配置项存在不自动联网。
- 替换 1 秒全 App restore 为按条件启动需要常驻的服务；服务入口可以先注册，真正使用时 await ensure。
- 配置 Trace 采集与本地引擎懒加载的先后顺序，确保第一条实际请求不漏采集。

### 第三批：完成摘要启动，消除全历史加载

范围：session SQL／persistence／history service、所有使用 history 的 action、审批／usage／Audit 投影及对应 tests。

- metadata SELECT 不带 `history_json`，新增明确加载状态、history／metadata 独立保存及每会话 ensure。
- 所有读写入口补齐加载屏障；子会话源签名和持久化 revision 到位。
- 搜索缺索引、旧摘要缺投影采用按需／有界补建，避免新版本第一次启动做 40 MB 全量迁移。
- 专项验证旧会话、刚开新会话、meta-only 保存、用量显示、审批、分叉／回退和 Trace，不要求用户另开会话或丢弃旧数据。

### 第四批：App 本身轻量化与维护隔离

范围：`packages/app-runtime`、`../moss-apps/apps/{memory,knowledge-rag,library,audit,...}`、共享 local-tasks／engine-apps，以及 Trace 列表。

- 官方 App 按前述条件调整生命周期、初始化副作用、job 恢复和事件订阅；不是仅从 Core 延后启动它们。
- 贡献先按 registry manifest 筛选，避免 availability 再把所有 UI-only 包加载回来。
- 取消 no-op workspace／Authoring／runtime JSON 回写；清理仅针对失效资源，不每启动扫整个历史目录。
- 单独配置更新、监控、资源升级和迁移维护；Trace 列表分页读摘要，messages 按详情读取。

每批最小 patch、独立测试和回归；不和前序上下文统计修复或无关工作区修改混为一个大重构。

## 7. 最终验收标准

### 默认启动与相同数据二次启动

- 不 SELECT／解析任何会话 `history_json`；不读取所有 engine JSONL、子会话 transcript、Trace snapshots。
- 不递归扫描项目工作区，不覆盖复制随包资源，不计算完整 SDK／agent bundle hash。
- 不自动发模型请求、WebSearch probe、远程身份／会话请求，不下载 runtime、RAG 模型或更新；明确启用的后台策略例外单独统计。
- 未配置实际后台工作时，不启动 App／MCP／Python 子进程，不运行空 Cron／Teams／runtime pool 轮询，不后台反复 `/bin/ps`。
- 同版本未变化业务数据不改历史、FTS、凭据、CA bundle、资产、Cron、registry／App JSON 的内容与 mtime；必要迁移、lease、安全恢复、日志及 Electron profile 另列。
- 首屏可交互后也不会突然执行同样的全量扫描／回写，启动轻量不是只让窗口早出现。

### 首次使用与后台兼容性

- 打开一个旧会话只加载该条历史，完整消息、累计账单、当前 context、审批和 compaction 信息与改造前正确结果一致。
- 修改未打开会话的 metadata，旧 history／usage／索引／snapshot 不被清空。
- 第一次发消息只初始化必要依赖；用户立刻操作与后台准备并发时不重复初始化、不丢第一条 Trace。
- 缺索引／资源／runtime／投影可以按需恢复，并提供明确进度或错误；不能用空结果伪装完整搜索或成功恢复。
- 非空 Cron、已启用邮箱／消息渠道、实际 pending job／completion 按原策略继续；已完成任务不重复执行，配置无效服务不拖慢窗口。
- WebSearch 未验证、远程离线、MCP／App 准备失败不阻塞本地 UI；取消和退出不会遗留误写或新子进程。
- 首启／升级／中断恢复／大历史／空任务／离线／双启动／立即使用／退出准备中分别测试。

实现时记录真实阶段指标：进程开始→窗口显示→首屏可交互；读取字节／文件数、SQL 写入、JSON 保存、子进程／网络／模型请求及触发原因。用本机现有 90 会话／42.4 MB 历史和 137 安装 App 验证消除全量成本，不凭源码或任意秒数承诺性能。

## 8. 方案的默认选择

- **必须保留**：最小基础启动、安全约束、摘要可用、实际使用前的依赖准备、明确启用服务的可靠恢复。
- **从默认启动删除**：全量 hydrate／FTS 重建／子会话和项目扫描、模型探测、资源强制复制、全 runtime 安装／检查、全 SDK hash、无任务轮询、未请求的 engine／MCP 启动和维护清理。
- **按需触发**：会话历史、资产、搜索补建、App／工具／runtime、TLS／凭据、开发／自测、Trace 详情与迁移。
- **不只是延后**：不保留固定延迟后执行原来全部工作的逻辑；不以扩大队列、默认猜容量或丢弃旧数据换取表面轻量。
