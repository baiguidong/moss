# App 工具范围与会话选择方案

2026-10-12 补充：本文件的整体 App 选择规则现由 [App 子服务](app-subservices.md) 扩展。`toolScope` 仍统一在 App 级；显式 `toolSelection: "services"` 时会话按子服务选择和常驻，父 App 不再作为通配选择。

状态：已实现，已完成本地回归、桌面构建和 Builder 隔离源码包验证。验证范围见第 9 节。

## 1. 已确认的规则

- 整个 App 统一声明工具范围，只有一个配置入口。
- App 原生工具和 App 接入的所有 MCP 服务工具全部继承所属 App 的设置。
- 范围有“全局”和“指定”两种；未声明时默认 session，旧 App 在新宿主也采用此默认值。
- 全局 App 未被选择时维持现有按需加载；指定 App 只有被会话选择后才提供工具。
- 用户选择 App 后，其全部可用工具在整个会话中常驻，跨多轮和重启恢复有效，直到移除。
- 输入框 `@` 和“选择资源”都支持选择带工具的 App。
- 用户选择工作流、App 创作等具体资源时，自动把资源所属 App 加入会话。
- 同一交付必须完善 App 创建文档及 `moss.app-builder` 的生成指引、模板、校验和回归，覆盖新建、编辑与转换场景。

| App 范围 | 未选择 | 已选择 | 移除后 |
| --- | --- | --- | --- |
| 全局 | 按需发现和加载 | 全部可用工具常驻 | 取消常驻，回到现有按需机制 |
| 指定 | 不注册到会话工具池，不可搜索或调用 | 全部可用工具常驻 | 从工具池移除，不可搜索或调用 |

“常驻”指模型请求直接包含工具定义，沿用 `alwaysLoad` 语义。App 后端进程启动仍由 `backend.lifecycle` 管理。工具可用性继续受 App/服务启用状态、授权、连接状态及现有工具限制约束。

全局 App 回到按需机制后，沿用现有会话的工具发现记录；这与强制常驻分别处理。指定 App 移除后，历史发现记录不能恢复它的工具。

## 2. 配置与数据模型

在 `app.moss.json` 根级新增字段：

```json
{
  "toolScope": "session"
}
```

以上为字段片段。类型为 `"global" | "session"`，分别显示“全局”和“指定”，缺省按 `session` 处理。

- Manifest Schema、规范化函数、SDK 类型、App 开发能力目录同步支持该字段。
- 原生 contribution 中的范围由 Host 从用户 App 级选择及 Manifest 默认值派生；MCP 范围从 Host 保存的服务归属派生。
- 不提供单工具或单 MCP 服务范围覆盖。2026-10-12 增加 App 内用户设置：`moss.host/v1 tools.scope.get/set`（仅 UI）保存 Host 管理的 App 级覆盖；Manifest 提供默认值，设置页展示有效范围。
- App 所属 MCP 工具的 `_meta['anthropic/alwaysLoad']` 不覆盖 App 范围和会话选择；实际加载状态由 Host 按会话决定。

会话新增 `appIds: string[]`，数据库新增 `app_ids_json`，旧会话默认空数组。保存 App ID，而非工具名称列表；恢复时按当前 App 版本重新解析工具。草稿使用独立的 `draftAppIds`。

`channelAppId` 表示现有渠道来源，不用它代替会话的 App 选择集合。

## 3. 统一的会话工具策略

通过 Main 的配置组装与共享的 `applyAppToolPolicy` 入口，结合 App 安装状态、Manifest 和本次运行采用的会话 App ID 集合，统一决定：

- 可向该会话提供工具的 App 集合。
- 需要常驻的 App 集合，即本次运行已选择且可用的 App。
- App MCP 服务运行时名称到真实 App ID 的映射。

所有模型工具池使用同一结果，不通过工具名字符串前缀猜测 App 归属。

### 原生工具

1. 在 `buildClaudeSessionConfig` 组装 `appTools` 时过滤未选择的指定 App，尽量在加载输入输出 Schema 前完成过滤。
2. 将由 Host 确认的 App 归属和加载状态传入工具工厂。
3. 已选择 App 的工具使用 `alwaysLoad: true`；未选择的全局 App 使用原有按需状态。
4. `app_tool_invoke` 检查本次运行采用的会话策略，避免旧工具引用调用已被排除的指定 App。

### App MCP 工具

1. `AppMcpHost` 提供带来源信息的服务目录，来源信息与实际 transport 配置分开传递。
2. `getSessionMcpServers` 在连接前过滤未选择的指定 App 服务。这些服务不会仅因安装了 App 就接入所有会话。
3. MCP 工具被发现后，在会话工具池组装阶段根据服务归属应用常驻状态；工具刷新、重连和后续动态发现也走同一入口。
4. 对工具做会话内投影，不修改 MCP 客户端的共享缓存或共享工具对象，防止会话 A 的选择改变会话 B。
5. 一个 App 配置了多个 MCP 服务时，选择该 App 会常驻全部已启用且可用的服务工具；没有第二层范围开关。
6. MCP 尚未完成连接时显示加载状态，发现工具后直接常驻，不再要求模型通过 ToolSearch 激活。

### 搜索、恢复与派生执行

- ToolSearch 的目录、关键词搜索、直接按名称选择和整组展开，都只使用过滤后的工具池。
- 维持全局按需工具目前的分组发现规则：原生工具按 App 分组，MCP 按服务分组。本次 App 范围配置不改变搜索分组。
- `preparedTools`、历史发现状态和压缩恢复记录只能激活当前工具池内的工具。
- 子 Agent、恢复的 worker 和 App 后台 Agent 沿用所属运行的 App 策略，并继续与已有资源限制取交集；下游执行不能自行扩大指定 App 集合。
- 管理界面可列出未加入会话的 App，模型工具目录必须按会话过滤，两者分别构建。
- 现有非 App MCP 来源和连接器维持各自接入规则；迁移至 MCP App 的服务统一继承该 App 的范围。现有本地 App 执行环境边界继续生效。

## 4. 会话与资源选择

### 输入框和资源选择器

- 两个入口新增“App”分类，共用候选数据、搜索逻辑和 `appIds` 状态。
- 支持多选、去重、已选标识和可移除的 App 标签；展示图标、名称、能力简介、范围和工具数量/加载状态。
- 已启用且有已授权原生工具或可用工具服务的 App 可进入候选列表，包括没有 UI 的纯后端 App。已确认无工具、全部工具被禁用或服务不可用的 App 不进入候选列表。
- MCP 工具尚未发现时，不因为工具缓存暂时为空就把整个 App 排除；显示待加载状态。
- @ 候选列表不显示已停用、缺少授权等不可用 App；已有选择在资源选择器和已选标签中保留为不可用状态并允许移除。
- 新会话将草稿中的 App 集合一次性传入创建接口；已有会话通过专门的更新接口修改。

### 选择具体资源时自动加入

1. 用户显式选择资源、接受 App 提供的资源草稿或通过现有 App 创作入口进入会话时，由 Host 解析资源 provider 的真实 App ID。
2. 将该 ID 合并到草稿或会话的 App 集合，去重并在已选 App 中显示。
3. 在首次构建本次运行的工具池之前完成加入，再处理资源原有的指令与工具预加载。
4. 自动加入是一次选择事件，不从每轮携带的历史 `appContext` 或模型生成的文字反复推导。
5. 用户手动移除后，历史资源上下文不能偷偷加回 App。再次显式选择资源时才重新加入。移除资源本身不撤销已经形成的会话 App 选择。
6. 如果资源上下文依赖的指定 App 已被手动移除，明确提示该资源工具当前不可用；普通对话仍可继续。

自动加入也遵守同一套会话校验，不能让资源 provider 声称属于另一个 App 来扩大工具范围。

## 5. 变更生效和持久化

沿用连接器已有的运行时重建机制：空闲时更新选择并使运行时失效；会话正在执行或还有活动 worker 时，保存待生效选择，下次安全启动运行前重建。界面明确显示“下一轮生效”。

当前执行使用稳定的策略快照，工具目录与调用检查都使用该快照，避免界面已取消但进行中的工具定义仍旧存在而产生不一致。已经开始的调用按现有执行生命周期结束。

- 会话元信息、数据库、元数据文件、恢复路径都读写 App ID 集合。
- 会话复制/分支沿用连接器的资源复制语义；新建空白会话不继承其他会话的选择。
- App 启停、更新和 MCP 配置变化触发现有的安全重建机制，重新计算范围和可用工具。
- App 从全局改为指定后，在下一次策略生效时，未选择它的会话不再获得其工具。
- App 已选择但停用/卸载后，不能仅凭持久化 ID 重新提供工具。
- 暂不新增项目级默认 App 集合或每服务范围配置；会话选择仍是唯一使用入口。

## 6. 代码改动位置

| 层次 | 主要文件/入口 | 改动 |
| --- | --- | --- |
| App 合约 | `packages/app-sdk/src/schemas/app-manifest.schema.json`、`schemas/index.mjs`、`index.d.mts` | 根级 `toolScope`、校验、默认值和类型 |
| App 贡献目录 | `packages/app-runtime/src/host/index.mjs`、贡献收集逻辑 | 传递真实 App 范围，支持在加载 Schema 前筛选 |
| MCP Host | `ui/src/apps/app-mcp-host.mjs` | 来源映射及会话接入过滤 |
| 会话工具组装 | `ui/src/main.mjs`、`src/electron-direct.ts`、`src/tools/AppContributionTool/AppContributionTool.ts` | 统一策略、过滤与常驻投影、调用校验 |
| 会话保存 | `ui/src/session-database.mjs`、`ui/src/session-persistence.mjs`、会话创建/恢复入口 | App 集合迁移、读写、恢复和复制 |
| Desktop IPC | `ui/src/main.mjs`、`ui/src/preload.mjs`、`ui/src/renderer-react/types.d.ts` | 会话 App 更新及元信息类型 |
| 会话 UI | `App.tsx`、`chat-area.tsx`、`composer-mentions.ts`、`composer-resource-selection-area.tsx` | 草稿、App 分类、多选、标签和状态 |
| 资源入口 | `ui/src/apps/app-composer.mjs`、相关创作/任务会话入口 | 显式选择资源时自动加入 App |
| 工具展示 | `app-tool-disclosure.mjs`、`settings-view.tsx`、`app-mcp-tool-rows.tsx` | 按 App 展示范围与说明，取消写死“统一按需”的文案 |
| 开发文档 | App Runtime/MCP 文档及 App 开发能力目录 | 声明示例、默认值、适用宿主版本和行为约定 |

## 7. App 创建文档与 App Builder 同步交付

这是本次功能的必做范围。运行时、文档与 Builder 必须在同一轮交付中使用一致的规则，不能只有宿主识别新字段，而生成的 App 仍沿用过期指引。

### 创建文档和示例

- Core 的 `packages/app-sdk/README.md`、`ui/docs/app-runtime.md`、`ui/docs/mcp-app.md` 补充 App 根级 `toolScope`、默认值、原生/MCP 继承、会话选择与进程生命周期的区别。
- 在当前 App 创建文档入口提供完整的全局/指定 Manifest 示例，并用实际 SDK 校验示例；示例只在根级声明范围，不能出现逐工具或逐服务覆盖字段。
- `moss-apps/README.md` 的“App 创建手册”仍指向已删除的 `assistants/app-builder/assistant.md`，并描述旧内置创建工具。实施时修正为现行 App Builder、SDK 和 Runtime 文档入口，同时清理失效的创建说明。
- 同步 `moss-apps/docs/app-sdk.md`、App Builder README 和 MCP App 使用说明。以 Core Schema 为契约来源，消费端文档引用它，避免各自维护不同默认值。
- 相关示例 App 和测试夹具覆盖两种范围；已有业务 App 缺省保持 session，不把功能升级自动解释成要改变所有 App 的范围。

### App Builder 的实际改动入口

独立 App 位于相邻仓库 `../moss-apps/apps/app-builder/`，ID 为 `moss.app-builder`。当前创建指引与模板由以下入口提供：

| 位置 | 需要同步的内容 |
| --- | --- |
| `src/backend/actions.mjs` 的 `guidance` | 新建、编辑、Skill 转换时如何声明或保留 App 根级范围；`builder_prepare`、`builder_inspect guidance` 和 `composer.resolve` 返回一致规则 |
| `resources/authoring/README.md` 及随包模板 | 字段示例、默认 session、会话选择说明、全体 MCP 工具继承和最低宿主版本 |
| `README.md` | 新的创建行为、工具可见性和手动/资源自动选择的使用方式 |
| `scripts/sync-core-sdk.mjs`、`generate-tool-schemas.mjs` 及 SDK 来源记录 | 与本次 Core 契约同步，检查生成文件；不新增逐工具范围参数 |
| `tests/builder.test.mjs`、`tests/source.test.mjs` 及现有 Agent/桌面脚本 | 对生成产物、编辑保留、普通会话自动加入和安装后行为进行验证 |
| 仓库 `scripts/lib.mjs`、`validate-apps.mjs`、`package-app.mjs` | 消费同版 SDK，校验范围与最低宿主要求，保证构建/打包/源码恢复不丢字段 |

Builder 的生成规则：

1. 新建 App 时读取当前 Manifest 契约；用户明确指定范围就按需求生成，没有指定时使用已确认的默认 session。新模板显式写出根级 `toolScope`，便于作者检查。
2. 编辑已有 App 时保留其范围；旧 App 缺字段等价于 session，不因为一次普通功能修改切换范围。
3. Skill 转换生成 App 时遵循同样规则，不从技能内容中创造单工具范围配置。
4. 更新现有源码包前检查其固定 SDK 是否认识新字段；需要迁移时明确更新 SDK、契约、锁文件和最低 `hostApi`，不能把字段交给旧规范化器后静默丢弃。
5. Builder 自身遵守同一 App 策略，不添加 Core 特例或隐藏常驻工具。通过配置为指定的 Builder 测试夹具验证：用户进入创作资源后，所属 Builder 自动加入，五个 Builder 工具在本次会话可用。
6. Builder 用于编辑某个目标 App 时，资源 provider 属于 Builder；自动加入的是 Builder，而非仅因出现在 `targetRef` 中就把目标 App 也加入会话。目标 App 工具仍按自身范围和真实会话选择生效。

文档和 Builder 的验收不是只检查提示词中是否出现字段名：需要检查实际生成/打包的 Manifest、源码包恢复后的字段，以及安装后会话中真实可见的工具。

## 8. 兼容性与验收

旧 App 缺省 session、旧会话缺省空 App 集合，因此默认不向会话提供工具，需要选择 App；显式 global 才保留全局按需行为。

当前旧宿主会丢弃未知 Manifest 字段。显式声明 `toolScope` 必须要求最低 `hostApi` 为 3.1.0，SDK 和 Runtime 同步升至 3.1.0；构建、安装校验和开发文档均遵守该约束，防止旧宿主静默忽略指定范围。

必要验收场景：

1. 默认 session 的旧 App 需要先选择才能使用；非法范围声明被拒绝。
2. 指定 App 未选择时，原生工具和 MCP 工具均不出现在目录、搜索结果、整组展开或调用候选中。
3. 从任意选择入口添加 App 后，原生工具首轮常驻，MCP 工具连接发现后直接常驻，后续轮次与重启恢复保持选择。
4. 选择 App 资源会自动加入正确的 App，重复选择去重；手动移除后历史上下文不自动加回。
5. 移除指定 App 后，直接工具名、旧搜索结果、`preparedTools` 和压缩恢复记录都不能重新激活其工具。
6. 两个会话对同一 App 的选择不同，MCP 缓存与动态发现不会导致相互影响。
7. 忙碌期间变更选择，当前运行与下一次运行的工具目录和调用策略各自一致。
8. App 停用、卸载、升级改范围、MCP 授权失败和动态新增工具，都能更新可用状态且不恢复被排除的工具。
9. 普通子 Agent、恢复 worker 和 App 后台执行继续受所属运行的 App 范围及原有工具限制约束。
10. 旧宿主不能把声明“指定”的新版 App 静默当成全局工具加载。
11. Builder 创建全局/指定 App 后，产物根级范围正确、所有原生/MCP 工具一致继承，打包与源码恢复保持声明。
12. Builder 编辑已有指定 App 不重置范围，旧 App 和无额外指定的转换产物维持默认 session。
13. 配置为指定的 Builder 可以通过创作资源自动加入会话，跨轮和重启恢复可用；编辑目标 App 不误加入无关 App。
14. 创建文档入口可访问，Manifest 示例通过目标 SDK 校验，随包 guidance 与创建文档使用相同的默认值和字段层级。

实施顺序：先完成 App 合约和会话数据模型，再贯通原生/MCP 工具策略，然后接入选择 UI 与资源自动加入，同步更新两个仓库的创建文档、Builder 指引/模板和 SDK 消费链路，最后完成上述运行时与生成产物回归、发行包验证和发布兼容检查。

## 9. 实施结果与验证范围

- SDK/Runtime 接入根级范围，省略字段按 session 执行。规范化后的旧 Manifest 仍保留缺省形式，避免旧 `hostApi` 的 Manifest 在二次校验时被误判为显式使用新字段。
- Main 保存会话选择，原生贡献在读取 Schema 前过滤；MCP 在连接前过滤，工具池按运行快照设置常驻。资源加入与手动增删由 Main 串行更新，连续操作不会用旧列表覆盖新选择。
- 输入框、资源选择器和 App 标签共享选择状态；运行中显示下一轮生效。SQLite、元数据、会话恢复和分支携带 App ID。
- `moss.app-builder` 使用 session，指引和随包 Manifest 模板同步到 Host API 3.1。源码包显式包含构建所需的 SDK、host-contracts 和 Runtime，并校验快照与锁文件。

已通过的验证：

| 范围 | 证据入口 |
| --- | --- |
| 工具可见性、常驻、移除、缓存与会话隔离 | `src/utils/appToolPolicy.test.ts`、ToolAvailability / AppContributionTool / ToolSearch 回归 |
| 原生和 MCP 继承、资源归属、并发选择、默认值和 Manifest 示例 | `ui/tests/app-tool-scope.test.ts`、`session-apps.test.ts`、`app-mcp-host.test.ts`、App Composer/创作会话回归 |
| 真实 SQLite 关闭后重开与 ID 恢复 | `ui/tests/session-persistence.node.mjs` |
| 真实 Chromium 的资源选择、`@`、标签移除和会话隔离 | `ui/tests/app-tool-selection.electron.mjs` |
| 契约生成、语法、TypeScript 与生产构建 | `ui` 的 `bun run check`、`bun run build:renderer`，Core 的 `bun run build:electron-direct` |
| Builder 指引、模板和 SDK 消费端 | `moss-apps/apps/app-builder/tests/`、`scripts/app-sdk.test.ts`、`manifest-backend.test.ts`、`source-package.test.ts` |
| Builder 真实交付包 | 在临时目录导出源码，以冻结锁文件安装依赖并执行 check/test/build；打包后检查 Manifest 和模板、恢复源码、验证 Backend 握手及 ZIP 源码完整性 |

本次未调用付费模型完成自动生成流程，未连接真实外部 MCP 服务，也未安装或发布新的桌面发行版。工具策略的 MCP 回归使用本地模拟目录和 transport；Chromium 验证使用实际组件及隔离夹具。发布仍需把当前开发快照固定到正式 Core 提交。

## 10. 2026-10-12：App 内范围切换追加验证

新增 UI-only 的 `moss.host/v1 tools.scope.get/set`。覆盖按 Runtime owner 和 App 存在签名包外，Manifest 提供默认值；原生 contribution 和 MCP 服务所有者均使用有效范围。变更触发安全重载，原生调用和 MCP 都保留忙碌轮次的 scope 快照；显式移出会话仍立即撤销对应选择授权。

追加验证包含 8 个相关文件的 43 项测试，以及 `moss-apps/apps/knowledge-rag/scripts/verify-desktop.mjs` 的真实 ZIP / Core Runtime / 生产 preload 集成：session → global → session，服务可见性随之变化，Backend 重启和页面重载保留设置。真实本机 knowledge-rag HTTP MCP 已完成 13 个工具发现与 CPU 检索；这补充了第 9 节原先仅模拟 MCP 的验证范围。未发布桌面发行版。完整记录见相邻 Apps 仓库 `docs/knowledge-rag-app-delivery.md`。
