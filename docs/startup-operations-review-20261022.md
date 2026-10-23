# Moss 启动操作审计

日期：2026-10-22。范围：Desktop 主进程、renderer 首次加载、App Runtime，以及主要有后台行为的 App。

## 1. 范围与结论

- 本轮只检查并整理，没有修改启动实现、重启 Moss、运行模型请求或回补历史数据。
- 检查方式：追踪启动入口及调用链，核对读写、定时器、网络和子进程；只读查询本机数据库、文件大小与既有日志；使用内存 SQLite 验证重复写入。没有运行真实启动流程进行性能压测。
- Core 源码位于 `/Users/bgd/repo/moss`，App 源码位于 `/Users/bgd/repo/moss-apps`。已安装应用、已构建运行时与工作区源码并非完全相同。下文的源码行为与运行日志证据分开，不把尚未部署的修复说成运行版本已生效。
- **不止 Trace：启动仍有全会话搜索索引重写、子会话跨重启重复导入、项目全目录扫描、远程会话无变化回写、空 Cron 周期写入等行为。** 还有资源覆盖复制、凭据重新加密、开发 SDK 哈希、App 状态整文件保存等成本。
- 必须区分三类操作：必要的一次性迁移／中断恢复；功能要求的后台服务；数据未变化仍执行的重复扫描或回写。不能用“启动都不写”替代这项区分。

## 2. 实际启动顺序

以下是主要顺序；异步任务与 renderer 加载会交错，并非所有工作都等开窗后才发生。

| 阶段 | 主要操作 | 是否可能写入／启动工作 | 入口 |
| --- | --- | --- | --- |
| 模块加载，Electron ready 之前 | 设置 profile、注册协议权限、取得单实例锁、创建数据目录、打开 SQLite，初始化表／索引与状态存储 | 建目录、DDL／迁移；恢复特定中断状态 | `ui/src/main.mjs:405`、`ui/src/main.mjs:721` |
| 同上 | 加载 settings；从加密存储恢复 WebSearch／远程凭据 | 存在凭据时再次保存凭据和 settings | `ui/src/main.mjs:810` |
| 同上 | 从 SQLite 加载全部主／子会话历史；同步每个会话搜索索引 | 全量 JSON 解析；FTS 删除后重插 | `ui/src/main.mjs:3318` |
| 同上，后台恢复 | 对主会话尝试恢复缺失 underlying session ID 的本地记录 | 符合条件才读 engine 目录／JSONL、保存恢复结果 | `ui/src/main.mjs:3320` |
| 同上 | 初始化自测 Host 的 build ID | 同步读取 main 和完整 agent bundle 计算哈希；不是运行自测 | `ui/src/main.mjs:9661` |
| ready 后、开窗前 | 加载 TLS 信任，检查随包 Node／Python／Git，恢复确认请求，初始化 Agent Mail | CA bundle 可写；运行时验证／安装／清理；邮箱启用时后台联网 | `ui/src/main.mjs:7951` |
| 同上 | 复制内置 skills／assistants，迁移旧 expert，读取 App 市场信任配置 | 内置目录强制复制；旧 expert 仅缺失目标时迁移 | `ui/src/main.mjs:7995` |
| 同上 | 初始化 App Execution Host、开发目录、App Runtime、App Authoring | task 恢复／保留期清理；SDK 哈希；孤儿进程清理；预览和构建目录清理／状态保存 | `ui/src/main.mjs:8180`、`ui/src/main.mjs:8272`、`ui/src/main.mjs:8439` |
| 同上 | 注册 IPC／协议和常驻服务，启动 Cron、资源监控、Agent Teams | 可写状态、周期扫描；到期 Cron 可运行模型任务 | `ui/src/main.mjs:8695`、`ui/src/main.mjs:8754`、`ui/src/main.mjs:8817` |
| 创建主窗口后 | 开始 App 延迟恢复计时；恢复项目任务；启动 runtime pool、本地引擎预热和 WebSearch 能力检测 | 项目状态恢复；能力检测满足条件时发真实模型请求 | `ui/src/main.mjs:8898`、`ui/src/main.mjs:8939`、`ui/src/main.mjs:8953` |
| renderer 首次加载 | 读状态、settings；必要时迁移 appearance；并发加载 Apps、会话、项目、助手，再加载连接器 | 会话列表和项目列表不是纯读，详见下文 | `ui/src/renderer-react/App.tsx:1142` |
| renderer 获得 server URL 后 | 获取远程身份 | 请求 `/api/v1/auth/me`；此 effect 不额外检查 remoteEnabled | `ui/src/renderer-react/App.tsx:524` |
| 开窗约 1 秒后 | App restoreAllOwners，concurrency=3；同步安装记录；恢复 MCP／连接器／Trace 服务 | 启动合条件的 Backend、保存 runtime 状态、恢复渠道待处理工作 | `ui/src/main.mjs:8898`、`ui/src/main.mjs:8573` |
| 持续运行 | 远程同步、Cron、Teams、资源监控、runtime 回收、邮箱、App 自身定时器 | 不属于一次性的“启动完就结束” | 见第 5 节 |

`Application starting` 日志在许多初始化之后才输出，不能拿它的时间当进程开始时间；`Application ready` 也不表示后台 App 恢复和预热已经完成。

## 3. 类似 Trace 的重复扫描／回写

### 3.1 全会话 hydrate + 搜索索引无条件重建：优先处理

- `ui/src/session-persistence.mjs:262` 对主、子会话分别执行查询 `.all()`，读取全部 `history_json` 并解析为内存对象；两类记录实际上都存储在 `sessions` 表。
- `ui/src/session-persistence.mjs:340`、`ui/src/session-persistence.mjs:413` 对每个记录无条件调用搜索索引同步。
- `ui/src/session-search-index.mjs:113` 每次执行事务：删除该会话旧 FTS 行，插入标题及全部可搜索消息。没有 revision／内容 hash 判断，**历史没有变化也重写**。
- 本机快照为 72 个主会话、18 个子会话，原始历史 JSON 合计 **42,409,130 字节，约 40.44 MiB**。对象解析后内存占用更高，且当前操作发生在开窗前。
- hydrate 本身没有给所有会话重新写 `session.json` 或 Trace snapshot；这里确认的全量回写是 FTS，不应混为一谈。
- 建议：搜索索引持久化投影版本和内容签名，内容未变化跳过；只在缺失／版本升级／损坏时重建。会话列表优先加载摘要，完整历史按打开、搜索索引缺失或实际恢复需要加载。

### 3.2 首次会话列表扫描所有本地主会话的子会话，跨重启重复导入

- `ui/src/main.mjs:9870` 先返回内存摘要，再通过 `setImmediate` 调本地 reconcile 和远程同步。
- `ui/src/main.mjs:9845` 对所有主会话执行子会话同步；本地路径检查每个主会话的 subagents 目录，读取 `agent-*.meta.json`，stat JSONL。
- `ui/src/main.mjs:6535` 用 `sourceTranscriptSignature` 判断是否读取完整 JSONL；变化时解析、复制到镜像子会话目录，并保存子会话、资源 manifest 和索引。
- 问题是 `sourceTranscriptSignature`、`sourceResourceManifestSignature` 等源状态只在内存中，当前 persistence／hydrate 不保存和恢复它们。重启后第一次比较必然缺失旧 signature，**未变化的已有子会话也会再次读取、复制、保存**。
- 同一进程内存在签名及 metadata 比较，完全未变化时会跳过；每父会话有串行队列。不能说“每次刷新都无条件重写”。但全局 reconcile 只合并同时任务，结束后的下一次列表仍可再次扫目录。
- 建议：持久化源签名及必要的解析状态，补充源路径身份；父会话做增量发现，避免每次列表扫描所有归档会话。

### 3.3 项目列表会递归扫描工作区，启动可能扫描两轮

- `ui/src/main.mjs:1570` 的 `listProjects()` 不只读项目 JSON，还会 enrich assets／tasks／decisions。
- `ui/src/project-assets.mjs:98` 读取资产前确保项目目录结构，递归扫描工作区；默认每项目最多 **10,000 个文件**，跳过隐藏目录和 `node_modules`。文件都会 stat，新增或 size／mtime 变化才读文件计算 SHA256。
- 资产变化才在 `ui/src/project-assets.mjs:168` 回写索引，不是无条件重建；但目录扫描本身每次列表都发生。
- renderer 首次加载和 `ui/src/main.mjs:2096` 的项目任务中断恢复都调用 `listProjects()`，启动可能重复扫描工作区。本机有 10 个项目目录。
- 建议：拆分只读项目摘要和显式资产 reconcile；资产扫描使用增量缓存、文件事件或后台有界任务，状态恢复不顺带枚举完整工作区。

### 3.4 远程会话：全文请求有增量判断，保存却无变化判断

- `ui/src/main.mjs:6159` 在启用远程且连接配置有效时请求远程会话列表；新会话或 history checkpoint 变化才请求全文。
- `ui/src/main.mjs:6271` 对列表中每个有效会话无条件 `schedulePersistSession(record, true)`，即便全文和 metadata 都未变化。Cron 来源关联还有一轮保存。
- 立即保存涉及 SQLite 的完整 history、会话 manifest 和 FTS；remote-direct 会话不会通过当前 Trace Host 写本地 snapshot。
- renderer 启用远程时每 5 秒再同步，因此这不仅是启动成本。网络全文读取已增量化，不代表持久化也增量化。
- 建议：只保存确实变化的历史／metadata／关联；区分 history dirty 和 metadata dirty，避免仅更新 metadata 重写完整历史与索引。

### 3.5 空 Cron store 仍然启动写、每 20 秒写

- `ui/src/moss-cron-scheduler.mjs:137` 首次 initialize 使用 `updateCronTaskStore` 做 migration／旧 host transient 清理／中断 run 恢复。
- `ui/src/moss-cron-scheduler.mjs:278` tick 又调用一次 update，之后读取并执行到期任务；start 立即 tick，并设置 20 秒定时器。
- `shared/cron-task-store.mjs:17` 无论内容是否变化，都写临时 JSON 再 rename。因此正常首次启动会写 initialize 和 tick 两次，之后空任务也周期写。
- 本机 `cron_tasks.json` 为 18 字节，`tasks=[]`，依然存在该源码写入路径。
- 建议：store 更新后内容一致则不写；保留实际状态迁移、nextRunAt 变化、任务 claim 等必要事务。

### 3.6 凭据 hydration 重新加密，随后再次写 settings

- `ui/src/main.mjs:810`、`ui/src/main.mjs:847` 读取 WebSearch 和远程凭据；只要存在对应凭据，就调用 save credentials，再保存已 hydrate 的 settings。
- `ui/src/connector-hub-ipc.mjs:121`、`ui/src/connector-hub-ipc.mjs:169` 的保存路径更新 timestamp；`ui/src/connector-credential-store.mjs:192` 会加锁、解密整个凭据文件、重新加密、原子写入，没有 unchanged 判断。
- 旧明文迁移至加密存储是必要写入；**已是加密凭据的只读加载不应每次重新保存**。普通 settings store 构造函数本身只加载，不是默认无条件写。
- Agent Mail 缺 consumer ID 时也会首次生成并保存 settings；这是一次性初始化，应与重复加密区分。
- 建议：将纯 hydration 与 migration 分离；凭据值／schema 未变化不写，不只比较每次变动的 timestamp。

### 3.7 TLS 信任加载也会重建 CA bundle

- `ui/src/remote-direct-tls.mjs:209` 的 load 扫信任记录、读 PEM、验证证书后调用 rebuildBundle。
- 有有效 CA 内容时，在 `ui/src/remote-direct-tls.mjs:187` 的 rebuild 路径重写完整 `trusted-ca-bundle.pem`，即便内容未变；没有 CA 时尝试删除 bundle，并清理对应环境变量。
- 这不是每启动请求服务器证书：启动 load 是本地校验，远端证书探测是另一条路径。
- 建议：保留证书身份校验和权限修正；bundle 内容未变化时跳过文件替换。

### 3.8 内置 skills／assistants 无版本判断强制复制

- `ui/src/main.mjs:5502` 使用 `fsp.cp({ recursive: true, force: true })`，每次启动覆盖复制随包目录中的受管理资源；过滤主要是 `node_modules` 和 `.git`。
- 没有版本 marker／内容 hash 判断，资源未变化仍复制。不是覆盖所有用户文件，而是随包条目对应的目标路径。
- 当前安装资源包含 skills 10 文件／54,138 字节，assistants 2 文件／27,276 字节；不能用源码仓库没有这些目录断言安装版没有复制成本。
- `ui/src/public-experthub-ipc.mjs:1377` 的旧 expert 迁移会扫描，但目标存在时跳过，不属于同样的全量重复复制。
- 建议：内置资源做版本／hash 管理，只同步变化的受管理文件，明确用户修改与升级覆盖策略。

### 3.9 运行时“检查”还会写 registry、删除旧版本

- `ui/src/main.mjs:7954` 提前发起安装检查，`ui/src/main.mjs:8005` 又 await 同一入口。`ui/src/main.mjs:2931` 只缓存 in-flight promise，完成后清空；若第一次提前完成，第二次会重新检查，**不是必然两次，也不是永久缓存一次**。
- `ui/src/runtime/managed-runtimes.mjs:202` 的 markInstalled 即使已安装也更新时间并保存 registry，随后清理旧版本目录；Node／Python 已存在时先通过版本子进程验证。
- 安装来自随包资源，不是此路径联网下载。macOS 的 managed Git 路径跳过，日志中的通用 `git runtime ready` 不证明执行了 `git --version`。
- 此启动调用没有传入 settings 中 managed runtime 开关；开关用于后续环境应用。这是需核对产品语义的点，不擅自认定应该取消检查。
- 建议：缓存一次完整启动检查；未变化 registry 不写；清理保留安全策略，不在不同入口重复清理。

### 3.10 为开发工具／自测做启动全量哈希

- `ui/src/main.mjs:8181` 在开窗前 await `createDeveloperCatalog()`；`ui/src/apps/app-developer-catalog.mjs:37` 加载 contracts／types，递归收集 SDK、host-contracts 及外部传递依赖，并读文件做 SHA256。没有跨启动缓存。
- 本次工作树统计覆盖 694 文件／2,866,162 字节，其中 SDK 63 文件、contracts 16 文件、10 个依赖包共 615 文件。
- `ui/src/main.mjs:9661` 另做同步 build ID 哈希：main 494,627 字节、agent bundle 16,383,087 字节。即使不进入自测，也计算该 ID；自测实例本身仍按需创建。
- 建议：构建期生成可信版本／内容指纹，启动读产物；开发模式或显式验证再计算。不得取消需要的包验签／安装完整性验证。

### 3.11 App Authoring 清理和整份状态回写

- `ui/src/main.mjs:8439` 每启动删除整个受管理 `app-authoring-previews` 目录后重建。
- `ui/src/apps/app-authoring-host.mjs:548` 遍历所有历史 operation：核实 committing 是否已提交；未完成且非 prepared 的操作标 interrupted／closed；所有带目录的 build operation 尝试删构建目录，包括已成功的记录。
- `ui/src/apps/app-authoring-host.mjs:567` 无条件保存整份 state，即使未改变。committing 恢复核对包内容和安装 revision，不重新执行 build。
- 本机 state 为 33,830 字节，有 1 个 succeeded operation、1 个 build directory 记录。
- 建议：只保存实际变化，已清理记录持久化标记；预览清理要保持活跃操作与 prepared artifact 的恢复约束。

### 3.12 App Runtime 恢复按 backend 重复整文件保存

- Desktop 使用 `deferRestore: true`，但 `packages/app-runtime/src/host/index.mjs:219` 的 initialize 仍加载／迁移状态、初始化能力密钥、清理 retired native package marker、恢复孤儿 lease。
- 开窗后恢复每个 Backend 时，`packages/app-runtime/src/host/index.mjs:1250` 验证配置，再无条件 upsert desiredState。
- `packages/app-runtime/src/state/index.mjs:531` 的 runtime upsert 更新时间；JSON store 的 `packages/app-runtime/src/state/index.mjs:154` transaction 总是走整份 state clone／序列化／写临时文件／rename。
- 本机 `app-runtime-state.json` 为 176,461 字节。此处重写的是 App 状态，不是全部会话历史。
- UI-only 的版本延迟表只用于初次 restore；后续 `emitAppsChanged` 调 authoring availability，而 `listContributions()` 在过滤贡献之前遍历 installation 并 getActivePackage，可把 deferred 包提前加载。不能认定端到端按需加载已经实现。
- `registerStoredApps` 有 sameVersion 跳过，连接器 refresh 有身份比较；包验证不是每次读取并 hash 整个 App 目录，不能扩大为“所有 App 都被重装”。
- 建议：desiredState 未变化跳过 upsert；在保留串行／原子性约束下合并启动恢复事务；按 manifest 贡献先筛选，再加载相关包。

### 3.13 部分 App Backend 自己也无变化保存状态

- 当前 App 源码的 `../moss-apps/packages/local-tasks/src/backend.mjs:49` initialize 读取全部 workspace 状态，将 running／queued／canceling 标 interrupted，随后**无条件 save 整个 `workspace.json`**。
- image-tools／transcription／pdf-tools 等使用该实现；若 Host 支持 artifacts protocol，不再为旧文件 URL 启动本地 HTTP listener，否则创建回环地址服务。
- 这些任务不会因这里的 initialize 自动重跑；与 engine-apps 的 pending queue 恢复行为不同。
- 建议：仅发生状态迁移或首次创建时保存；保留人工重新提交的恢复语义。该项归属 App 共享后端，不是 Moss Core Trace 采集器。

## 4. 哪些启动动作会联网、调用模型、启动进程

### 4.1 Core 主动请求与恢复

| 操作 | 条件与实际行为 | 归属／入口 |
| --- | --- | --- |
| WebSearch 能力检测 | local 模式，webSearch=native，或 auto 且没有 Tavily／Brave；无可用检测缓存时，发送真实 `queryModelWithStreaming` 请求，要求搜索 example.com，max output=256，timeout=20 秒。不是 GET 模型元信息，可能产生用量和费用 | Core：`ui/src/main.mjs:1080`、`ui/src/main.mjs:1167`、`src/tools/WebSearchTool/nativeProbe.ts:42` |
| 远程身份／会话同步 | renderer 有 server URL 后获取身份；远程启用且配置有效时拉会话列表，需更新才拉全文 | Core：`ui/src/renderer-react/App.tsx:524`、`ui/src/main.mjs:9086`、`ui/src/main.mjs:6159` |
| Agent Mail | 开启且配置有效时获取邮箱能力、建立长轮询／消费 lease，恢复旧 queued 和处理新邮件；自动执行策略可能发模型请求 | Core：`ui/src/main.mjs:7182`、`ui/src/main.mjs:7428` |
| Cron | 到期且调度允许时 claim／运行任务，可能调用模型；初始化会处理旧 host 和中断任务状态，不重跑全部历史 | Core：`ui/src/moss-cron-scheduler.mjs:137`、`ui/src/moss-cron-scheduler.mjs:278` |
| Agent Channel | App 服务 ready 后恢复 queued turn、处理待交付 completion；按策略可能执行模型或投递结果 | Core Runtime：`ui/src/main.mjs:8573`、`packages/app-runtime/src/agent-channel/store.mjs:328` |
| 本地引擎预热 | 导入 agent bundle、全局 config／CA／proxy／mTLS／目录与首启时间初始化、后台 IDE／Git 仓库识别、初始化 LSP 配置。memory closure 注册不是开始整理，LSP manager 初始化不等于启动全部 LSP server | Core：`ui/src/main.mjs:3487`、`src/bootstrap/headless.ts:40`、`src/entrypoints/init.ts:35` |
| 自动更新 | packaged，未设置 disable／CI 时，窗口创建后约 5 秒检查，之后每 6 小时及唤醒检查；native updater 的 autoDownload 允许后台下载，不自动安装 | Core：`ui/src/main.mjs:7854`、`ui/src/update-ipc.mjs:60` |

本机日志中 WebSearch probe 为 2026-10-22 15:20:45，晚于 14:17 启动，并发生在设置变化之后；它证明能力检测会运行，**不能证明该次启动已经发过 probe**。

### 4.2 App 后台初始化

本机安装记录为 137 个 App：110 个无 Backend，20 个 persistent、7 个 on-demand；20 个 persistent 和 7 个 on-demand 的 installation 均 enabled。**安装数量不是进程数量**：配置缺失、权限、实例 enabled 和运行时状态都影响是否能启动，native adapter 也不等于独立子进程。

- Runtime 对已启用、配置合法的 persistent Backend 自动启动。on-demand 通常不启动，但有 `moss.runtime/v1` 且检测到 queued task marker 时可以唤醒，以恢复待处理任务。
- 下表是当前 App 源码检查结果，并未证明每个已安装版本都实现完全相同的行为；只有 Backend 实际被 Host 启动时才执行对应初始化。

| App／共享 Backend | 初始化与恢复行为 | 入口 |
| --- | --- | --- |
| Trace | 注册 action／transport，Backend 初始化不重放历史 POST；打开列表才读取／投影 trace 数据 | `../moss-apps/apps/trace/src/backend/backend.ts:7` |
| Audit | 100 ms 后首次扫描，之后 30 秒；列会话 revision，使用持久化 cache，revision 变化才 export；event 文件每轮读取，事件 hash cache 仅内存，DB 按 ID 去重 | `../moss-apps/apps/audit/src/backend/backend.ts:31` |
| Memory | setImmediate 注册／检查 MCP memory server，配置变化才保存，但会主动 `servers.inspect`，触发 MCP 连接／工具发现和所需 MCP 进程 | `../moss-apps/apps/memory/src/backend/backend.ts:64` |
| Knowledge RAG | 准备存储，engine 已安装时自动 start；prepare_model 检查模型文件，缺失／损坏可能下载，写 config，启动 Python 本地 engine，注册 MCP | `../moss-apps/apps/knowledge-rag/src/backend/service.mjs:86`、`../moss-apps/apps/knowledge-rag/src/backend/service.mjs:167` |
| Library | 打开数据库／schema，恢复 pending jobs；自动继续 recoverable refresh／rebuild job，不是默认每启动重建全库；当前入口没有开启默认关闭的 watchSources | `../moss-apps/apps/library/src/backend/store.mjs:899`、`../moss-apps/apps/library/src/backend/store.mjs:2911` |
| Workflow | 读取全部 run JSON，旧 running 在内存标 interrupted；约 5 秒对已完成但未 hostFinished 的结果补交付，不自动重跑全部 worker | `../moss-apps/apps/workflow/src/backend/runs.ts:33` |
| Takt | 读取 catalog／runs，旧 live／submitting 标 interrupted 并保存；约 5 秒 reconcile | `../moss-apps/apps/takt/src/backend/runs.mjs:14` |
| Buddy | 读取 instructions／handbook／controller 状态，注册事件处理；入口初始化本身没有立即 sendPrompt | `../moss-apps/apps/buddy/src/backend/main.mjs:6` |
| OpenIM | 初始化即 ensureSession：创建本地 SDK 目录、加载 native library、向 Host issue session profile，再按状态初始化 SDK／login；失败后重试，成功按 token 生命周期刷新 | `../moss-apps/apps/openim/src/backend/automation.ts:250`、`../moss-apps/apps/openim/src/backend/openim-client.ts:289` |
| Feishu | 缺 appId／appSecret 会失败，不连接；配置完整时本地 action ready 后背景连接 WebSocket，失败 30 秒重试、启用 autoReconnect；agent policy 不符合预期才更新 | `../moss-apps/apps/feishu/src/backend/feishu/index.ts:36`、`../moss-apps/apps/feishu/src/backend/feishu/index.ts:280` |
| code-map／file-cleaner／media-tools 等 engine-apps | setImmediate 恢复 queued／claimed task、lease 与 pump，注册 engine；可以继续旧 queued worker，不重跑全部历史完成任务；旧 Host 协议下还创建本地 HTTP listener | `../moss-apps/packages/engine-apps/src/backend.mjs:27`、`../moss-apps/packages/engine-apps/src/queue.mjs:173` |
| image-tools／transcription／pdf-tools 等 local-tasks | running／queued／canceling → interrupted，保存 workspace；不自动再次执行，HTTP listener 取决于 artifacts protocol | `../moss-apps/packages/local-tasks/src/backend.mjs:49` |

Core 的 `appMcpHost.refresh()` 本身不是无条件 inspect 全部 MCP；配置／定义变化或 legacy migration 可以写配置。Memory 等 App 的主动 inspect 是另一个层级的操作。

该部分覆盖主要高风险后台入口，不宣称已逐项审计所有 137 个安装 App 的所有传递依赖。

## 5. 启动后常驻扫描／轮询

| 服务 | 频率／范围 | 写入与执行边界 |
| --- | --- | --- |
| 本地 transcript sync | 约 1 秒，仅已打开／acknowledged 的会话 | fingerprint 变化才读 JSONL／保存，不轮询全部历史会话 |
| 远程会话同步 | renderer 开启 remote 时每 5 秒 | 列表同步；当前无变化会话仍保存，见 3.4 |
| Cron | 立即 tick，之后 20 秒 | 当前空 store 也写；到期才执行任务 |
| Agent Teams | 启动 checkNow + persisted continuation reconcile；约 750 ms 扫 teams／tasks／inboxes／terminal receipt | 首次读取主会话 archive；archive fingerprint 未变跳写，receipt 保存后删除，失踪 live 标 interrupted；不是无条件新建总结模型调用 |
| App Execution Host | 1 秒检查，保留期 prune 另有节流 | 初始化只读 running／待通知及最近 100 条；非 settled 才标 interrupted，可能补通知；不重写所有完成任务 |
| 资源监控 | 后台约 5 秒，面板活跃约 2 秒 | macOS 用 `/bin/ps` 获取系统进程元数据再筛 Moss；不读取 argv／env，App 名称约 30 秒缓存 |
| CloudStorageHost | 2 秒检查 settings／权限／active requests | 启动读取 transfer 状态，未完成的先在内存 paused；不默认重新上传／下载，也不构造即全量保存 |
| session runtime pool | 30 秒 sweep | 仅 tracked runtime 的闲置回收；hydrate 的会话 runtime=null，不启动全部历史 runtime |
| Agent Mail | 长轮询约 25 秒，heartbeat 约 30 秒及队列 drain | 开启且配置有效才运行，可能恢复 queued 工作 |
| 自动更新 | 初始约 5 秒，之后 6 小时／唤醒 | 受 packaged／disable／CI 条件控制 |
| App 自身定时器 | Audit 30 秒，Workflow／Takt 约 5 秒，Feishu 失败重试 30 秒等 | 由 App 功能及 Backend 生命周期控制，不能只停 Core timer 认为后台已停 |

主要入口：`ui/src/local-transcript-sync.mjs:1`、`ui/src/agent-teams/agent-teams-service.mjs:771`、`ui/src/apps/app-execution-host.mjs:62`、`ui/src/resource-monitor/resource-monitor.mjs:198`、`ui/src/apps/cloud-storage.mjs:25`、`ui/src/session-runtime-pool.mjs:146`。

## 6. Trace、必要恢复与已排除的误报

### Trace 当前源码边界

- 前一轮已经删除 Core Trace refresh 中的全历史 snapshot 回写。当前 `ui/src/apps/app-trace-host.mjs:33` 只确认启用状态／输出目录、执行一次性 legacy import、配置采集。
- `ui/src/apps/app-trace-host.mjs:61` 的 legacy import 由 marker 保护；本机 marker 已存在，不会每次重新复制旧 JSONL。
- `src/services/api/traceFetch.ts:1` 在实际 POST 调用过程中异步记录请求，response 消费结束后收尾，不在启动重放 POST，也不是阻塞网络请求的同步写入。
- 真实会话后续保存仍可能更新该会话 snapshot；这与“启动无条件遍历所有历史”不同。当前活跃 snapshot 路径已有合并／串行处理。
- **还有按需列表成本**：`../moss-apps/apps/trace/src/backend/store.ts:25` 打开 `traces.list` 时，在分页之前按全部 raw trace 文件并发读取对应 session snapshot，metadata 读取包括 messages；raw projection 主要按页解析，但列表 metadata 尚未按页／摘要优化。
- 本机 snapshot 总量为 141 文件／33,579,539 字节。不是断言每次列表必读这全部字节，但全目录匹配且 Promise.all 读 metadata 有内存峰值风险。这是 Trace App 列表读取优化，不是原先 Core 启动写队列溢出的同一个原因。
- 已构建运行版本尚未验证包含前序修复；不能因此承诺当前已安装程序启动不再出现旧回写。

### 必要恢复，不应一刀切取消

- SQLite schema／索引首次创建及缺列 migration。
- Desktop／Agent Channel 的旧 running turn → failed；可保留审批的 resolving → pending，失效审批 → expired。
- `ui/src/desktop-state-store.mjs:145` 清理已结束 decision 对应通知，会把 `decision_request_id` 置空。内存验证第二次启动不再命中同一记录，**已排除“所有旧通知每启动都更新 timestamp”的误报**。
- `ui/src/agent-mail-store.mjs:50` 旧 running mail → queued；其后的执行仍服从邮箱启用、配置及策略。
- 缺 underlying session ID 的本地会话恢复；项目任务／App Execution 中断状态处理，而不是自动重跑全部旧会话。
- App Runtime orphan lease 清理验证 PID、started identity 与 marker，活跃 owner 跳过，不是按历史 PID 任意杀进程。
- 决策签名／能力密钥首次创建、appearance／legacy settings 迁移、Legacy Trace import、legacy expert／MCP 迁移。
- Memory Dream 服务构造及引擎 memory closure 注册不开始长期记忆模型整理；明确 start 才运行。
- App 市场构造读 cache；进入市场面板加载列表可能联网，不等于每启动拉完整市场。

### 需单独验收的单实例边界

`ui/src/main.mjs:441` 拒绝单实例锁后调用 `app.quit()`，但没有显式阻断余下模块顶层初始化；只有 `whenReady` handler 由 `hasSingleInstanceLock` 保护。退出前是否仍触达 SQLite／hydrate 等顶层写入存在风险，需要独立检查与双启动测试。本轮没有启动第二个进程验证，不把它报告成已复现的数据损坏。

## 7. 本机只读证据与内存复现

### 数据规模

| 项目 | 本次审计快照 |
| --- | --- |
| 主会话历史 | 72 条，40,751,592 字节 |
| 子会话历史 | 18 条，1,657,538 字节 |
| 合计 | 90 条，42,409,130 字节；FTS 当前 651 行 |
| 本地主会话缺 underlying ID | 5 条；不代表 5 条都能成功恢复 |
| 项目目录 | 10 个 |
| App Runtime | 137 installation；JSON state 176,461 字节 |
| Backend 生命周期 | persistent=20，on-demand=7，无 Backend=110；不等于实际进程数 |
| Cron | tasks=0，文件 18 字节 |
| Trace snapshots | 141 文件，33,579,539 字节；legacy import marker 存在 |

### FTS 无变化仍写入

从真实库以 readOnly 读取一个大主会话，在新建内存 SQLite 中用当前 `syncSession` 同步两次相同记录：

```text
indexedRows = 12
firstWriteChanges = 44
unchangedSecondWriteChanges = 85
```

`total_changes()` 包含 FTS 内部表写入，**85 不是 85 条消息**；它证明数据未变的第二次同步仍有数据库写入。真实数据库未用于写入测试。

### 通知清理幂等性

内存数据库放入一条已 resolved decision 和对应 notification，连续构造 store：

```text
firstRecoveryWriteChanges = 1
secondRecoveryWriteChanges = 0
```

首次将通知 decision ID 清空，第二次不再命中；因此不列为重复回写整改项。

### 既有启动日志

以下来自 `~/.moss/logs/moss.log` 的 2026-10-22 记录，不是本轮重新启动：

```text
14:17:17 node runtime ready
14:17:18 python runtime ready
14:17:18 git runtime ready
14:17:18 Application starting
14:17:18 Application ready
14:17:19 Local agent global init prewarmed
14:17:22 Installed Apps restored after window startup
          count=137 loadedApps=137 deferredApps=0
          durationMs=2850 reconcileMs=2586 registrationMs=1 servicesMs=263
15:20:45 WebSearch probe completed
```

恢复阶段日志显示该运行版本加载 137 个包，不代表启动 137 个 Backend，也不能据此证明当前源码的 defer 路径有效。总启动时间不能只由这些秒级日志推算。

## 8. 建议整改顺序与验收

这里只提出方案，本轮不执行代码修复。

| 优先级 | 整改项 | 验收重点 |
| --- | --- | --- |
| P1 | FTS 内容签名／索引版本；摘要先加载、历史按需 | 未变数据第二次启动不 DELETE／INSERT FTS；首次建库、升级／损坏重建、搜索结果一致 |
| P1 | 子会话源签名及解析状态持久化，增量发现 | unchanged JSONL 重启后不再次完整读取／复制／保存；metadata-only、截断、源替换、删除正确处理 |
| P1 | 项目摘要与资产扫描分离 | 首屏／中断恢复不递归扫工作区；明确 reconcile 后新增／删除／修改资产仍正确 |
| P1 | 远程会话 dirty-save | 未变化的连续 sync 不保存 history／manifest／FTS；checkpoint、新会话、标题／关联变化仍更新 |
| P1 | 单实例启动边界 | 第二进程未获锁时不执行状态初始化、恢复和持久化；不干扰第一进程 |
| P2 | Cron no-op update；凭据 hydration 与迁移分离；TLS bundle 内容比较 | 空 Cron 不周期改 mtime；已加密凭据不启动重加密；未变 CA bundle 不替换；必要迁移仍执行 |
| P2 | 内置资源版本同步；运行时一次检查／registry no-op | 连续相同版本启动无重复复制／registry 改写；升级、缺资源、失效 executable、旧版本清理正确 |
| P2 | 开发 SDK／自测 build ID 构建期生成或懒加载 | 首屏不做完整 SDK／bundle 哈希；开发更新失效正确，安全验证不被绕过 |
| P2 | App Runtime no-op upsert／有界合并；manifest 先筛选贡献 | 未变 desiredState 不整份保存；deferred UI 包不被无关 availability 全量加载；persistent 及 queued 恢复保留 |
| P2 | Authoring／local-tasks 状态 dirty-save 和清理标记 | 无变化 state 不写；中断／committing／prepared／预览资源恢复不回归 |
| P2 | Trace 列表轻量 metadata／分页／并发上限 | 不为第一页读取所有会话 messages；标题／project 搜索和页结果正确；不重新引入启动回补 |
| 产品决策 | 启动 WebSearch probe、Memory inspect、RAG 自动 engine、自动更新及 persistent Apps | 明确哪些允许启动联网／下载／模型调用，提供可解释的开关／状态；不是直接关闭所有必要后台功能 |

后续应补充按阶段观测：耗时、文件数／字节数、SQL 写入变化、JSON 保存次数、启动进程及原因、网络／模型请求及原因。用“首启／相同数据二次启动／升级／中断恢复／大历史／离线”分别验收，避免以窗口出现或 Trace 队列不再满作为全部启动问题已解决的依据。
