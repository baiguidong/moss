# App Builder 实现与验收记录

日期：2026-10-10。对应 [plan](app-builder-app-plan.md) 与 [设计 review](app-builder-app-review.md)。本记录区分已落地代码、已运行的测试和未完整验证的发布门槛；不能把一个套件名称中的多个编号视为这些编号的全部断言已经通过。

## 实现结果

- 独立 App 源码位于 `../moss-apps/apps/app-builder`，ID 为 `moss.app-builder`。`builder_inspect / builder_prepare / builder_build / builder_preview / builder_release` 的定义、schema、effect 和 Backend Action 全部在 App 包内，安装后通过通用 AppContributionTool 动态发现。
- Core 新增公开开发目录、SDK 快照导出、authoring provider 发现、目标引用、会话绑定、源码快照、异步构建、隔离预览、Action 验证及本机安装回执。没有注册静态 Builder 模型工具。
- 新建、迭代和 Skill 输入使用普通本地 Agent 会话。准备需求不调用模型或生成源码；真正构建接入普通 Agent 的 Bash validation / canUseTool，UI/composer 请求不能伪造执行票据。
- 管理页、嵌入容器、独立 App 窗口及 SDK 都通过同一 provider 状态准备迭代。普通会话保留项目绑定、操作摘要和停止入口；成功安装推进同一项目的版本与 installationRevision。
- 仅支持当前最新 Host/SDK 3.0.0 开发快照，另外校验必需 handler、contractHash 和 sdkHash。公共开发目录覆盖 Host、manifest、UI、Backend 与 SDK exports。
- 已删除七个旧 Core App 工具、内置 Builder Assistant 与转换 Skill，同时清理加载表、设置、IPC、上下文、旧预览/构建分支和打包要求。历史系统副本仅在内容指纹完全匹配时停止自动装载，用户改动和自定义文件保留。

关键代码：

| 责任 | 文件 |
| --- | --- |
| 协议与生成源 | [apps.mjs](../../packages/host-contracts/src/apps.mjs)、[host.mjs](../../packages/host-contracts/src/host.mjs) |
| 公开开发目录、SDK | [app-developer-catalog.mjs](../src/apps/app-developer-catalog.mjs)、[export-contracts.mjs](../../packages/app-sdk/scripts/export-contracts.mjs) |
| 项目、执行票据、作业与安装回执 | [app-authoring-host.mjs](../src/apps/app-authoring-host.mjs) |
| 安全源码快照、预览 Runtime | [app-authoring-source.mjs](../src/apps/app-authoring-source.mjs)、[app-authoring-preview.mjs](../src/apps/app-authoring-preview.mjs) |
| 普通 Agent 命令授权 | [AppContributionTool.ts](../../src/tools/AppContributionTool/AppContributionTool.ts) |
| 安装 CAS、版本与市场保护 | [app-platform.mjs](../src/app-platform.mjs)、[app-marketplace.mjs](../src/apps/app-marketplace.mjs) |
| UI 状态与操作记录 | [app-authoring.ts](../src/renderer-react/lib/app-authoring.ts)、[app-authoring-operations.tsx](../src/renderer-react/components/app-authoring-operations.tsx) |
| 旧资源识别与静态退役检查 | [retired-app-authoring-resources.mjs](../../shared/retired-app-authoring-resources.mjs)、[check-app-authoring-retirement.mjs](../../scripts/check-app-authoring-retirement.mjs) |

## 实现 review 与修正

本次为实现自审，没有使用独立子 agent。复核后补了以下修正与行为测试：

1. 构建必须经过真实普通会话的命令授权；调用票据绑定 owner/App/version/generation/session/workspace，异步授权返回后再核对有效性。
2. 同键安装重试先返回既有回执，再检查已经推进的基准。安装恢复同时验证实际包摘要、源码摘要、installationRevision 和 Runtime activeVersion；摘要不符或 ABA 变化不会误报成功，单个损坏回执不会阻止 Core 启动。
3. SDK 导出检查被修改的依赖和链接，恢复被 npm ci 删除的链接。Builder 构建前验证 vendor 快照与 provenance 一致，拒绝静默使用另一份 SDK。
4. 每个 previewRef 采用独立 Runtime、配置、凭据存储、grants 和数据目录。UI-only、Backend-only 与 UI+Backend 均有真实运行路径；文件 Host handler 使用目标 App 身份和预览数据目录。
5. provider 发现隔离无关坏包；识别实际 supervisor 的 `error` / `crash-loop` 状态，正常 on-demand idle 可用。
6. Builder 自身更新交给 Core 作业完成，旧 Backend 退出不丢回执。需求备注写入失败不丢失 Core 已绑定项目；备注只能保存标题、需求和分析，不能充当安装基准。
7. 真实外部服务转换测试发现工具 schema 合并覆盖了 `kind`。现改为从固定 Host 输入契约生成各工具字段，保留字段 schema 的兼容组合，并在 operation 描述列出每种操作的必填参数；构建时检查生成一致性。已回归验证所有开发目录 kind。
8. 源码检查不再要求 Backend 必须放在 `src/`，合法根目录 `.mjs/.js/.ts` 等源码也可以重建；只有 build 脚本或编译产物仍不能冒充完整源码。
9. 安装 App 引发的工具刷新可能在首轮消息准备、尚未设置 busy 时释放 runtime。现在会话准备阶段也延后 MCP reload，执行结束或准备失败后再处理；新增回归与真实外部转换会话通过。

## 已执行测试

全量回归首次结果：Core **489 pass**；UI **1,035 pass**，附加 Node 专项 **28 pass**。新增创作专项 **21 pass / 0 fail**（8 个文件），随后新增真实 publisher CAS 用例通过；Builder App **5 pass / 0 fail**。

后续 UI 全量 1,042 项在并行打包/安装包复制时出现默认 5 秒时限失败。以 20 秒全局测试时限重跑为 **1,041 pass / 1 fail**：唯一失败是既有 watchdog 用例的 300ms 启动时序（子进程尚未注册 SIGTERM handler）；单独重跑该套件与源码回归 **8 pass / 0 fail**，Node 专项再次 **28 pass / 0 fail**。此处保留波动记录，不把单次全量运行改写为全绿。完整日志只在本机临时目录，交付证据不包含用户模型凭据或完整会话。

| 验证 | 结果与边界 |
| --- | --- |
| Host/SDK 生成检查、UI typecheck | 已通过 `bun run --cwd ui check`，含新增公开契约生成检查 |
| Core / Renderer 构建 | `build:direct`、`build:renderer` 通过 |
| Builder check / test / build / package | 通过；首次构建不依赖已经安装的 Builder |
| 真实 Electron Builder UI | 浅色/暗色、420px 窄窗口、输入持久化、通过 preload→Backend→Host 准备普通草稿，断言无构建/模型副作用 |
| 真实 Desktop 主进程与 ZIP | 临时 profile 安装 ZIP、发现五个动态工具、provider 可用、准备草稿不新建会话、停用后不可用 |
| 真实普通 Agent | 已完成同项目两次构建、真实预览和本机安装；0.1.0→0.2.0、installationRevision 1→2；纯追问不增加作业；未调用退役工具。安装包隔离环境中还验证了 Skill 资料转换后的真实待办添加/清空操作，以及目标 App 的 Host 迭代入口 |
| 安装包源码隔离 | macOS 外层 sandbox 禁止访问两个源码仓库；SDK 导出、包内 Node 导入、完整 Desktop 安装/卸载，以及真实模型 Skill 转换→两次构建/预览/安装均已通过 |
| macOS 包完整性 | DMG + ZIP、运行时、契约文件、退役资源缺席、更新元数据校验通过；本地未签名开发包 |
| 外部服务 Skill 转换 | 真实普通 Agent 转换 Backend-only App；本地加法结果等价、实际 HTTP 服务成功、缺凭据/服务不可用失败。验证在源码运行的最新 Core 上完成；模型根据构建错误修正了 manifest 入口后成功，不隐藏中间失败 |

最终产物摘要、平台信息和追加的安装包端到端结果记录于 `moss-apps/artifacts/moss.app-builder/verification/0.1.0/results.json`。安装包隔离测试在临时副本注入测试入口；为适应 macOS seatbelt，关闭嵌套 Chromium sandbox，并通过只读测试代理执行原来的两种 `/bin/ps` 查询。Core、Backend 和构建子进程仍受源码目录读取禁令约束。这项测试验证安装包自举，不是产品沙箱强度测试。

最终开发产物（未公开发布）：

| 产物 | SHA-256 |
| --- | --- |
| `moss-apps/artifacts/moss.app-builder/0.1.0/moss.app-builder-0.1.0.zip` | `1cb2d4171072835e356b08adffc1ef3cad75b04186db0a38370fbd1915f45862` |
| `ui/dist/installers/Moss-0.0.1-arm64-mac.zip` | `398a82e96955c8aeedc8144bf7e40c7afd1cb9c3872edfb647d3c9f8f29136b2` |
| `ui/dist/installers/Moss-0.0.1-arm64.dmg` | `eb1d38e11d902cc4a493d62c78dc99331f7610d756e93779873dcde5776cb5ad` |

已核对最终包内 Main、MCP reload、authoring service 与 source guard 和当前源码逐字节一致。最终 ZIP 的 Desktop 源码隔离安装/卸载测试包含显式完成标记，进程提前正常退出不会被当作通过。较早的普通 Agent 连续迭代证据使用修正前的 Builder SHA `968dbae2…`；最终 Builder SHA 上的浏览器与外部转换回归单独记录，避免将历史运行误标为同一产物。

## 验收编号的实际覆盖

“已有证据”列列出实际断言，不等同于该编号全部通过。带剩余项的编号保持未完整验证。原 plan 的 68 个编号及要求保留，不因实现套件合并而删除。

| 编号 | 已有证据 | 剩余项 |
| --- | --- | --- |
| CT-01 | catalog 全量遍历、公开协议/manifest/UI/Backend/SDK 类型 | 无 |
| CT-02 | 公开 App ID/permission 元数据；原 Host 授权回归 | 同一 Builder 读取后越权调用的完整组合 |
| CT-03 | SDK 导出依赖闭包、独立 Node、实际 UI+Backend 构建 | 断网新增业务依赖失败的独立用例 |
| CT-04 | hash 不匹配与导出依赖被改动拒绝 | 正在运行期间替换 Core 快照的完整构建/安装用例 |
| CT-05 | 目录分页、错误 hash、有界读取 | 每类大输出及非法响应矩阵 |
| CT-06 | provider manifest 校验、动态发现、缺 Action 拒绝 | 无 |
| CT-07 | 真实 Builder preload/UI API；SDK 类型回归 | UI/Backend 全部取消/事件组合 |
| CT-08 | 缺必需 handler 不可用；SDK 缺资源明确失败 | 无 |
| EN-01 | 安装、启停、撤权、冲突、坏包 | 所有 UI 容器的卸载/兼容变化组合 |
| EN-02 | idle 可用；error/crash-loop 映射 | 真实崩溃重试的页面交互 |
| EN-03 | 无关损坏包不会遮蔽 Builder | 无 |
| EN-04 | Core 入口与目标绑定实现、Desktop 草稿链 | 各个容器入口全部浏览器交互 |
| EN-05 | 伪造票据、读工具写入、跨会话项目拒绝 | 全部跨 owner/目标输入组合 |
| EN-06 | 真正工具入口、进程内票据、普通命令授权 | 所有旧 generation/replay 组合 |
| SE-01 | 草稿无文件/模型/构建副作用、实际普通会话 | 三种输入每种恰好一次发送的界面用例 |
| SE-02 | 多项目目录、重复 prepare、重启绑定 | 完整 Renderer 重启恢复交互 |
| SE-03 | provider 不可用时保留绑定和 Core 摘要的代码路径 | 停用后真实模型续聊、外部更新讨论分支 |
| SE-04 | 原 composer/Workflow 回归 | 无 |
| SE-05 | 真实 Agent 同项目连续两次安装、版本/revision 推进 | 无 |
| SE-06 | 同目标两个会话独立项目/目录、跨会话引用拒绝 | 原空闲会话显式恢复的 UI 操作 |
| SE-07 | 重复 prepare 和 Core 重启；备注故障恢复展示 | Renderer 响应丢失故障注入 |
| SO-01 | 可重建源码检查及纯产物拒绝 | 旧 Host、各来源的全部 fixture |
| SO-02 | 重复准备保留修改；基准变化拒绝 | 无 |
| SO-03 | symlink、归档路径与敏感文件排除 | 所有损坏归档组合 |
| SO-04 | 前/中/后源码摘要校验实现 | 受控并发改写故障测试 |
| BU-01 | 三类 fixture 真实构建与 package/checksum 校验 | 无 |
| BU-02 | 真实 canUseTool 回调、deny 无进程、真实 Agent 构建 | 组织规则/额外 validation 的完整组合 |
| BU-03 | 不可变快照、取消、10 MiB 输出上限 | 120 秒超时、挂起孙进程用例 |
| BU-04 | 超过 Action 等待的作业、停止与 shutdown | 页面关闭/进程硬杀组合 |
| BU-05 | 同键重试、持久操作记录 | 事件丢失、真实 Backend 崩溃后补读 |
| BU-06 | 全局 2 / 项目 1、排队取消、日志上限、GC | 所有安装/草稿保留引用组合 |
| PV-01 | UI-only Electron；Backend-only Action；UI+Backend 同一预览页面点击→preload→Backend→真实文件 Host | 无 |
| PV-02 | 两个独立 previewRef、不同 grants、文件和数据隔离 | 已安装实例同时运行及凭据/配置 sentinel |
| PV-03 | 缺授权、未声明 Action 返回实际失败 | 缺凭据/外部服务/Action 超时矩阵 |
| PV-04 | 同键 preview、补读、显式关闭、会话停止 | Core 硬杀恢复及丢响应组合 |
| RE-01 | 成功回执重试、版本推进、真实 publisher 拒绝同版本不同包 | 无 |
| RE-02 | 实际 publisher 同基准并发提交仅一个成功 | 两个真实 Agent 会话同时 commit 的调度测试 |
| RE-03 | grant 漂移、prepared 取消、不重复授权实现 | 工具差异 UI、committing 响应取消 |
| RE-04 | 安装失败保留旧基准；重启核对包/源码/revision；原激活回归 | 每个跨文件写入边界的进程级故障注入 |
| RE-05 | 本地来源记录、默认副本、市场静默覆盖阻止 | 测试签名包副本/替换与数据 sentinel 全链 |
| RE-06 | 真实 provider 自身更新、旧 Backend 停止、Core 回执成功 | 无 |
| RE-07 | 真实 publish/rollback/delete/reinstall 推进 revision；旧基准及 grant guard 拒绝 | 各 UI 安装入口的同一并发测试 |
| RE-08 | 未知兼容性拒绝；migration-tested 要求证据 | App 自己的真实迁移失败/备份恢复 fixture |
| AP-01 | 五工具 manifest/schema/Action/effect、Desktop 动态注册 | 无 |
| AP-02 | composer 普通会话上下文、动态契约/SDK 请求 | 三种输入的完整模型行为 |
| AP-03 | 备注持久化；失败作业不替换成功产物；缺源码错误 | 源码不足页面展示交互 |
| AP-04 | 备注故障不阻断 Core 项目、Core 状态覆盖展示 | 无 |
| SK-01 | 静态清单、依赖识别、脚本执行数 0、越界/symlink 拒绝 | 无 |
| SK-02 | 真实 Agent 完成本地 UI 转换及 Backend 加法等价测试 | 非法数值输入与取消的转换 fixture 用例 |
| SK-03 | 真实 Agent 转换 Backend：实际 HTTP 服务成功，缺 token、服务不可用真实失败 | 无 |
| UI-01 | 真实浏览器浅暗主题、空列表、窄屏、需求草稿与持久化 | 源码不足/失败/结果链接状态全集 |
| E2E-01 | 实际 ZIP→Desktop 安装→五工具→普通草稿 | 所有目标容器入口的安装前后对照 |
| E2E-02 | 真实普通 Agent 构建、预览、安装；已安装包实际 UI 添加/清空断言 | 无 |
| E2E-03 | 目标 App Host 准备草稿已接通到 harness | 从该草稿新建另一个会话并完成更新的完整链 |
| E2E-04 | 临时 Desktop、停用、Core service 停止/恢复测试 | 全部桌面生命周期组合 |
| E2E-05 | 源码不足与冲突分别有 service 测试 | Skill/市场源码不足/并发更新的模型组合 |
| E2E-06 | 发行包无旧资源；精确旧副本识别和自定义保留 | 旧 transcript 的发行包恢复操作 |
| E2E-07 | 同项目两次真实安装和 UI 行为、版本/revision 推进、无重复构建的追问 | 无 |
| E2E-08 | 已安装 Core SDK、真实普通 Agent、构建和安装全过程源码隔离通过 | 双仓 commit 尚未固定 |
| CL-01 | 旧工具定义/加载/搜索负向测试，Core 无 builder_* 替代注册 | 无 |
| CL-02 | 旧设置键丢弃，设置 UI 回归 | 无 |
| CL-03 | 内置资源物理移除，加载器与启动上下文处理 | 无 |
| CL-04 | 精确运行时代码扫描、发行包资源校验 | 无 |
| CL-05 | 原系统副本指纹匹配；用户修改/自定义副本保留 | 无 |
| CL-06 | 旧 transcript 未删除；旧工具不可注册 | 实际旧会话在发行包中继续使用 |
| CL-07 | 原安装/打开/启停/卸载/回滚回归 | 无 |
| CL-08 | 实际 ZIP 动态贡献五工具；Desktop 卸载后五工具消失，普通会话仍可读取 | 无 |
| CL-09 | 全量 Core/UI 回归 | 无 |

## 复现命令与实际套件映射

plan 中的 `app-authoring-contracts.test.mjs` 合并为 `app-developer-catalog.test.mjs`；退役套件扩展名为 `.mjs`；Builder projects/composer/tools/conversion 的单元断言合并在 `tests/builder.test.mjs`。没有创建只含占位断言的空套件。

```sh
# Moss
bun run --cwd ui check
bun test ui/tests/app-authoring-*.test.mjs ui/tests/app-developer-catalog.test.mjs
node scripts/check-app-authoring-retirement.mjs --check
bun run test
bun run --cwd ui test
node ui/scripts/verify-package.mjs --platform=darwin --arch=arm64
node ui/scripts/test-installed-app-sdk.mjs
node ui/scripts/test-installed-app-builder.mjs
# 使用预先配置的模型 JSON；harness 只复制 text model 到临时 profile
MOSS_BUILDER_AGENT_SETTINGS=/path/to/settings.json node ui/scripts/test-installed-app-builder.mjs --agent
MOSS_BUILDER_TEST_CONVERSION=1 MOSS_BUILDER_AGENT_SETTINGS=/path/to/settings.json node ui/scripts/test-installed-app-builder.mjs --agent
MOSS_BUILDER_TEST_EXTERNAL=1 MOSS_BUILDER_AGENT_SETTINGS=/path/to/settings.json node ui/scripts/test-installed-app-builder.mjs --agent

# Moss Apps
node apps/app-builder/scripts/sync-core-sdk.mjs --check
node apps/app-builder/scripts/generate-tool-schemas.mjs --check
bun run --cwd apps/app-builder check
bun run --cwd apps/app-builder test
bun run --cwd apps/app-builder build
bun run package -- --app moss.app-builder --skip-build
bun run --cwd apps/app-builder test:browser
bun run --cwd apps/app-builder test:desktop
```

## 发布前仍需完成

1. 上表列出的测试余项保持开放，尤其是有状态 App 迁移恢复和进程级安装故障矩阵。外部服务 Skill 转换已完成成功与缺依赖验收；现有测试不构成全部 68 个编号通过的声明。
2. 尚未实测 Windows 和 Intel macOS；仅记录 Apple Silicon macOS。没有公开发布、签名或公证。
3. 两仓均有未提交工作，未创建最终双仓 commit 或修改 submodule pin。Core 基线 `811e949c274e3e801d913df729fa06e08434d928`，Apps 基线 `c2d62cc8af24ed6a003df319d1e33012f3072e91`；vendored SDK 是有记录的开发覆盖，`uncommittedSdkChanges=true`，snapshot `f4494fd96923ed527e72793bf68ec203eb3b893e5cf312d51069cd1c10a164bc`。构建脚本校验此摘要，不能将它描述成已经发布或锁定的 Core revision。
4. Account/Agent/OpenIM 的 JSON Schema 由现有公共 DTO 类型导出，并附原验证器源码。它们尚未与所有运行时跨字段规则合并为一个 canonical schema；开发目录没有隐藏这一限制。

已有用户市场/下载改动及并行出现的其他改动均保留。测试没有改动真实用户的已安装 App、业务数据或凭据。
