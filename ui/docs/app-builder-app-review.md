# App Builder App 迁移方案 review

日期：2026-10-10。评审对象：[迁移规划](app-builder-app-plan.md)。方式：两轮代码核对、反例验证和方案自审；不是独立审查员的实现验收。R1–R12 保留首轮发现，RR-01–RR-08 记录第二轮对计划本身的修订。

当前结论：已按方案落地独立 Builder App 与 Core Host 能力，并完成旧入口物理清理。实现自审、修正、真实测试结果及尚未完整验证的门槛见 [实现与验收记录](app-builder-app-implementation.md)。以下 R1–R12、RR-01–RR-08 为实施前发现及设计决策；其中被删除文件的链接用于说明历史基线，不代表它们仍应存在。

## 已固定的架构决定

1. Builder 是可独立安装的 App，所有创作进入普通本地 Agent 会话；不增加专用 Assistant、Skill 执行入口或后台 Builder Agent。
2. 五个模型工具的定义、schema、effect 和 Action 全部归 Builder App；Core 公布最新版开发契约、提供生命周期 handler 与通用 contribution 适配器，不注册静态 builder_* 替代工具。目标 App 调用公开 Host API。
3. 迭代入口由 Core 统一发现 provider、校验可用性，再绑定目标准备会话；各 App 不直接调用 Builder 私有 Action。
4. 首版只维护最新 Host API，当前为 3.0.0；契约与 SDK 通过 hash 固定，构建和安装使用不可变产物引用。
5. 旧 Core App Tools、转换 Skill 和 Builder Assistant 的源码、注册、设置与打包残留必须退役，清理是交付条件。

## R1 · 高：旧模板和校验器已与当前 Host 不一致

证据：[创建助手模板](../../assistants/app-builder/assistant.md) 仍含 `hostApi: ^2.1.0` 和 `actions.invoke(instanceId, ...)`；[默认 manifest 工厂](../src/app-platform.mjs) 也使用旧版本；[转换校验器](../../skills/convert-skill-to-app/scripts/validate_app.py) 只检查 hostApi 非空，扫描的 action 调用格式也是旧签名。

本轮前序分析的临时探针复现：SDK 对 `^2.1.0` 返回 `APP_INCOMPATIBLE_HOST_API`；Python 校验器却判通过，并漏检 V3 写法 `actions.invoke('not-declared', {x: 1})`。

规划处置：开发资料从 Core 契约生成，旧简化验证器退出 release gate，使用 SDK/Runtime 实际校验。检查生成代码能否在官方契约下构建/调用，不能用“提示词包含某句话”作为正确性证明。验收 CT-01/03/04、BU-01、CL-03/04。

## R2 · 高：仅调用现有 composer 无法完成跨 App 迭代

证据：[App UI composer handler](../src/main.mjs) 把 provider 固定为 `${state.id}/${input.providerId}`，只能使用调用 App 自己的 provider；[前端资源类型](../src/renderer-react/lib/app-composer.tsx) 的 ref 仍是 `{workflowId, revision}`。

规划处置：Core 新增窄的 authoring 意图路由，绑定真实目标后调用发现的 Builder provider；ref 通用化并由 provider 校验。不开放任意跨 App Action，也不由目标 App 填写别人的会话/工作区。普通会话上下文须持久化，续聊与重启不能仅靠内存 selection。

验收 EN-04/05、SE-01/02/04。现有 Workflow 资源流程必须保留回归。

## R3 · 高：安装状态不能直接代表迭代能力可用

证据：[Apps 管理页](../src/renderer-react/components/apps-panel.tsx) 当前对可用包直接展示迭代按钮，与 Builder 安装无关；[Runtime listContributions](../../packages/app-runtime/src/host/index.mjs) 在逐包读取时没有单包错误隔离，一个不兼容包可能使整个发现失败。

规划处置：统一 provider 状态、权限和安装事件；点击/执行时复查，普通消息不因 provider 不可用而被整体拒绝。区分正常 on-demand stopped 和 crash-loop。逐包隔离无关损坏，不能把一个失败吞成“全都没有”。首版重复 provider 明确冲突。

验收 EN-01/02/03、SE-03、E2E-01/04。目标 App 的停用或旧 Host 依赖，不必阻止其源码迁移。

## R4 · 高：当前源码抽取可能覆盖修改，也可能只有编译产物

证据：[extractAppToWorkspace](../src/app-platform.mjs) 首先删除目标目录；没有 source tar 时复制 dist/schemas/assets。市场安装的 [installAppPackage](../src/main.mjs) 又以 packageRoot 作为 sourceRoot，因此 sources 目录中的 tar 也可能只是安装产物。[市场打包脚本](../../../moss-apps/scripts/package-app.mjs) 不默认包含 src/package.json。

规划处置：source.inspect 检查可重建输入；项目绑定来源版本和 hash；重复准备幂等，已有修改不覆盖，缺源码进入补充流程。旧包的源码检查与执行兼容性分离，读取资料不能顺便启动旧 Backend。

验收 SO-01/02/03、AP-03、E2E-05。不能以 tar 存在或 manifest 可读宣称“支持完整迭代”。

## R5 · 高：能力查询不等于开发契约查询，SDK 也必须配套

证据：[capabilities.get 定义](../../packages/host-contracts/src/host.mjs) 仅返回方法状态/权限/限额；[运行时实现](../../packages/app-runtime/src/host/index.mjs) 限制查询已声明协议。[3.0 收尾记录](../../docs/host-api-3-completion.md) 明确 Account/Agent/OpenIM 尚保留独立校验定义；Registry 中的一些成员是校验函数，不能直接序列化成 schema。

规划处置：增加只读公开开发目录与完整契约，不改变 capabilities.get 授权语义；SDK/Host contracts 从同次 Core 构建导出。契约版本/hash、SDK hash 和可离线准备的依赖一起锁定。禁止把 npm 最新包或整个 Core 内部源码目录当导出结果。

验收 CT-01～CT-05。公开文档读取不能扩大目标 App 实际调用权限，导出大小必须有边界。

## R6 · 高：固定命令名称仍会执行项目代码

证据：[runPackageBuild](../src/app-platform.mjs) 调用 `npm run build`；package scripts 内容由项目决定。App Backend 也不是操作系统级沙箱。仅声明 `apps:build` 或把 tool 标为 write 无法等价替代普通会话的命令权限。

规划处置：构建与依赖准备必须绑定真实普通会话，在 Core 使用其权限策略和受管进程执行；输入只接受项目引用，不接收任意 shell/cwd。预览可以启动目标 Backend，作为执行能力处理，不再沿用旧工具的纯只读标记。

验收 EN-05、BU-02/03，覆盖 deny、ask、已有 allow，以及拒绝后不产生进程/文件副作用。

## R7 · 高：可变 build 目录与多会话更新会导致版本错配

证据：[现有构建](../src/app-platform.mjs) 覆盖 `apps/<id>/build`，旧 publish/update 接收 buildDir；它们不携带预期的当前版本，无法明确表达两个会话的基准冲突。

规划处置：构建固定源码快照，产物以不可变 artifactRef/hash 引用；提交携带 expectedBaseVersion、提交键和输入摘要。接受后修改源码不改变本次待安装的包。同键重复提交返回原回执，同键不同内容/旧基准返回冲突。

验收 BU-03、RE-01/02。版本号与内容不可变需要真实并发测试，而不只是 semver 单元测试。

## R8 · 高：本地修改市场 App 不能沿用原发布者身份

证据：现有 App 包有 checksums 与可选 Ed25519 签名，市场包版本是不可变的；本地生成新代码不能沿用原包签名和信任。以同 ID 直接更新还会遇到后续市场升级的覆盖问题。

规划处置：默认本地副本使用独立 ID 并记录来源；明确选择替换时，保留旧版本、标识本地修改、重新评估权限与工具，不继承签名。市场升级不得无提示覆盖本地修改。

验收 RE-03/05。测试只用临时签名密钥，不触发公共市场发布。

## R9 · 高：安装状态分散，激活中断需要统一回执

证据：[publishAppFromBuild](../src/app-platform.mjs) 先写包/current/源码/registry，再由 [emitAppsChanged](../src/main.mjs) 激活 Runtime；后者已有失败回滚，但整个流程不是一个跨文件事务。

规划处置：保留已有 Runtime 串行激活及失败恢复，补最小持久 release 记录和恢复顺序；最终成功以真实 activeVersion 为准。一次准备不等于安装成功，取消不等于撤回已提交副作用。复用现有安装展示与授权，不加重复确认链。

验收 RE-03/04，故障注入覆盖写包、切换 current、激活和结果丢失等阶段。中断后必须可查询/恢复，不承诺外部副作用恰好一次。

## R10 · 高：普通会话、长构建和 Builder 自身更新的所有权要分开

证据：现有 Host/Action 有有界超时；SDK Host 请求通过 actionRequestId 关联来源；停用/升级会终止对应 Backend。在 Builder Action 中等待并激活自己的新版本可能失去响应。

规划处置：模型与聊天归普通会话；长构建接受后由 Core 保存作业与权限归属，页面关闭不结束会话，显式停止按来源取消。Builder 自身版本激活走 Core 安装入口，安装结果由 Core 持久化并反馈到普通会话。

验收 BU-04、RE-06、E2E-04。首版不增加后台 Builder Agent 或一套新的模型任务系统。

## R11 · 高：只删目录/工具实现会留下注册、设置和系统副本

证据：[工具加载表](../../src/tools/MossTool/toolLoading.ts)、[UI 工具目录](../src/tool-loading-settings.mjs)、[事件类型](../../src/Tool.ts)、[发行包断言](../scripts/verify-package.mjs) 仍显式列出旧入口。main 的初始化会把内置资源复制到用户目录；删除仓库目录不会移除先前复制的用户目录条目。

规划处置：第 8 节把七个工具、Skill、Assistant、UI 状态、事件、设置、文档和打包残留逐项列为 P4 必做。确认过的旧系统资源停止自动装载；同名自定义/用户修改内容和历史会话保留。保留标准 AppContributionTool、通用事件桥、普通 Skill/Assistant 系统及 Core 安装管理。

验收 CL-01～CL-09、E2E-06。退役名只允许存在于精确的历史/负向测试清单，不能用大范围忽略掩盖运行时残留。

## R12 · 中：现有测试不足以证明新创作体验可用

证据：App Builder guidance 测试主要检查文字片段和 Python manifest 形状；[当前 previewAppBuild](../src/main.mjs) 要求 UI 并创建独立预览 Runtime，不能据此推断所有 Host handler、授权和 Backend-only 验证都齐备。

规划处置：新增 CT/EN/SE/SO/BU/PV/RE/AP/SK/UI/E2E/CL 分层测试、三类 App fixture、真实进程/ZIP/普通 Agent/Electron 路径。Backend-only 用 Action 和状态验收；依赖 Host 的 App 使用真实受控 handler 或报告尚未验证的能力。P2 的集成测试必须断言没有调用旧工具、加载旧创作资源；P4 在物理清理后的包上重跑关键链路。

验收：plan 第 11 节的命令和证据矩阵落实；真实模型或环境不可用时明确 blocked，不能用 mock 或 skipped 改称通过。

## 第二轮复核：计划缺口与修订

### RR-01 · 高：连续迭代缺少基准推进和会话绑定的权威来源

首版计划只要求持久化 App ref，没有明确 draftRef 何时变成 projectRef、成功安装后谁推进基准，也没有阻止并行 Agent 写同一目录。若简单沿用当前 [main.mjs](../src/main.mjs) 发送前的 appComposer.resolve，Builder 停用会连普通追问一起失败。

已修订：Core 持久保存会话/项目绑定与安装回执；成功安装推进版本和 installationRevision，失败与外部更新不静默推进。并行会话使用独立草稿目录，显式恢复原会话才复用原草稿。不可用 provider 只阻止相关执行，普通消息和 Core 操作摘要仍可用。验收 SE-02/03/05/06/07、AP-04、E2E-07。

### RR-02 · 高：actionRequestId 和 surface=tool 不能证明来自 Agent 授权

核对发现 [main.mjs](../src/main.mjs) 的 appUiRequests.invocation 在 UI 绑定会话时也设置 surface=tool；[Runtime Host 转发](../../packages/app-runtime/src/process/index.mjs) 只是用 actionRequestId 找到 pending Action。原计划若只检查这两个字段，就会把普通 UI Action 当成已授权的 Agent 构建请求。

已修订：真正工具分发入口在 Core 内签发 origin/ticket，并核对安装、generation、owner、会话和调用；App 输入不能构造票据。执行项目命令需接入 [Agent Runtime canUseTool](../../src/electron-direct.ts) 及组织规则/额外 validation，不能由 Main 根据 permissionMode 自行放行。验收 EN-05/06、BU-02。

### RR-03 · 高：完整 Host 协议表仍不足以生成正确 App

首版契约范围容易遗漏 [SDK 公共 UI 签名](../../packages/app-sdk/src/index.d.mts)、manifest、appearance 和 Backend Service 规则；[Audit/Trace 定义](../../packages/host-contracts/src/local.mjs) 还有 apps 限制。只提供方法 JSON Schema 会漏掉旧模板的 actions.invoke 参数错误，复制新 ID 也可能失去能力。SDK 离线承诺原先没有区分自身依赖与项目新增业务依赖。

已修订：开发目录按 kind 覆盖所有公开开发界面及 App ID 限制；导出 Core 配套 SDK 的依赖闭包，业务依赖遵循项目锁文件/网络条件。同一 semver 的开发快照仍需检查必需 handler 与 hash，缺接口不能显示 Builder 可用。验收 CT-01/02/03/07/08、E2E-08。

### RR-04 · 高：预览可执行目标代码，必须有独立数据和权限作用域

当前 [previewAppBuild](../src/main.mjs) 没有接入完整 Host handler，且拒绝 Backend-only；原计划的“真实预览”未明确每个预览实例的配置/凭据/grants 归属，也缺少测试结果补读和显式关闭契约。

已修订：previewRef 独立 Runtime、数据和配置作用域，使用真实目标身份接入相同 handler 工厂，不继承 Builder 或已安装目标的权限。Backend-only 在预览 Runtime 调用声明 Action；预览/测试先返回稳定引用，artifact.get 补读，artifact.close 停止并清理。验收 PV-01～PV-04、RE-05、E2E-04。

### RR-05 · 高：操作接受、结果通知、取消和幂等重试缺少闭合规则

首版说明“长任务归 Core”，但未固定响应丢失后的读取顺序、正常 Backend idle 与主动停用的差别，也未覆盖成功重试时安装基准已经变化。预备安装取消还缺对应方法与终态。

已修订：接受后立即返回稳定 buildId/releaseRef/previewRef/testRef；幂等回执先于基准检查；状态和摘要持久回传普通会话，事件丢失用查询补齐，不自动启动新模型轮次。正常 idle/崩溃不丢作业；主动停止取消未提交工作，committing 安装必须完成或恢复。补 release.cancel、canceled 状态及日志/并发/保留限额。验收 BU-03～BU-06、PV-04、RE-01/03/04/06。

### RR-06 · 高：版本号 CAS 覆盖不了更新后回滚，也不能代表数据可回滚

原计划以 expectedBaseVersion 检测冲突，无法发现目标先被市场更新再回滚到同版本的 ABA 变化；准备到提交期间权限和目标状态也可能变化。本地副本只改 ID 不代表其数据、凭据或受限 Host 能力可复制。

已修订：所有安装/市场/回滚路径统一推进 installationRevision；授权绑定产物 hash、权限/工具差异及 revision，commit 再验。副本独立配置/数据并核对身份依赖；有状态变更需 App 自己提供并验证备份/迁移/恢复，Core 不宣称代码回滚等价于业务数据恢复。验收 RE-02/03/05/07/08、SE-05。

### RR-07 · 高：阶段依赖和首个 Builder 包的自举原先不完整

若普通会话绑定/路由留到 P3，P2 的 Builder 就无法完成真实普通会话链；而首个 Builder 不能依赖已安装 Builder 才能打包。相邻 App 仓库使用 [vendor/moss-core submodule](../../../moss-apps/.gitmodules)，仅修改当前 Core 并不会自动让 App 使用相同 SDK。

已修订：通用会话与路由基础提前到 P1，P2 从 Builder 自己的入口验收，P3 再验收其他 App 的入口。首包通过现有 CLI/CI 构建，固定双仓 commit/submodule/hash；P4 用无源码仓库可访问的已安装 Core 证明 SDK 导出与安装自举。验收 CT-03/08、E2E-01/02/03/07/08。

### RR-08 · 中：测试阶段与清理要求有冲突，工具归属需要负向验收

原 E2E-01 在 P2 就要求无旧文件，但物理删除计划在 P4；E2E-03 又提前依赖 P3 的目标入口。测试证据清单漏了 CL，命令漏了 SDK 类型检查，也没有证明五个 Builder 工具确实由 App 动态贡献。

已修订：第 11 节为每组用例指定套件和阶段；P2 断言旧工具/资源没有被调用，P4 才断言物理退役。补 SDK 类型、PV 隔离、连续更新与发行包无源码环境的测试入口；CL-01/08 断言 Core 没有静态 builder_* 替代注册，安装包拥有五个工具，卸载后工具消失。验收第 11.7 节映射、CL-01～CL-09。

上述八项均已落实到设计与可执行测试计划；新增 suite、脚本及 Host 方法仍需后续实施，未声称已运行通过。

## Review 后的范围控制

- 没有引入通用跨 App 任意调用接口，仅增加声明式创作入口和 Core 的目标绑定。
- 没有引入第二层 Builder Agent、全新会话类型或多版本 Host 适配器。
- 没有扩大到删除其他 Skill/Assistant，也不在本轮规划中修改用户安装与数据。
- 前序分析中已执行 38 项现有基础测试并通过，涵盖 composer、动态工具、Host 请求及任务机制；两项契约/SDK 生成一致性检查通过。它们只说明可复用基础可工作，不是新迁移功能的测试结果。
- 本轮交付为两份规划/review 文档，测试矩阵共 68 个验收编号。相对链接、代码围栏、空白格式、编号唯一性与引用检查通过；git diff --check 通过。没有新增测试实现或执行迁移测试；后续 P1–P4 完成后应按矩阵再次做实现 review。
