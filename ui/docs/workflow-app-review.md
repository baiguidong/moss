# Workflow App 拆分复核与修复

更新：2026-10-09。当前交付 `moss.workflow@0.1.9`，Host API / SDK / Runtime `2.8.0`。审查基线 0.1.2 的边界问题在 0.1.6 修复；本轮按用户六项意见调整普通会话入口、App 页面和运行呈现。继续复用旧 Workflow v3 引擎。完整实施与证据见 [交互调整计划](workflow-app-experience-plan.md#10-实施复核与证据019)。

## 引擎与工具

Definition、图、Code 编译、状态机和 Journal 继续使用旧实现。App 新增 Backend/Worker 接线、目录存储、外层页面；Core 新增通用任务与 Agent 执行合同。

旧版 4 个工具中 Manage 已包含 8 个操作。0.1.2 把操作展开成 16 个 AI Tools，增加了发现与选择成本。现在保留 6 个模型入口：`workflow_read/create/edit/manage/run/remove`。创建/修改/使用每轮分别准备 read/create、read/edit、read/run 两个工具；其余工具仍可按需发现。内部 Action 继续服务 UI；取消发布、归档、删除仍归 destructive，读取为 read，其他操作为 write。组工具使用 operation 枚举，Backend 再按该操作的完整 Schema 校验，避免模型提供商不支持顶层 oneOf 的问题。

## 历史边界问题与当前处置

| 项目 | 0.1.2 的问题 | 修复与证据 |
| --- | --- | --- |
| R1 | 重复 requestId 产生第二次运行且超时 | 持久保存 submissionKey、规范化输入指纹和提交意图，再调用 Host；重试返回原 runId，变更输入拒绝；传输尝试使用独立 wire ID。单元测试覆盖 Host 已受理但响应丢失、App 重启，ZIP 测试覆盖相同 requestId 重试。 |
| R2 | 超过 1 MiB 的结果终止 Backend | 完整结果留在 App；摘要与事件有界，资源按块读取；列表分页，UI 有翻页及完整导出。Core task.result 上限 32 KiB。ZIP 测试覆盖 2.1 MB 中文/emoji Code 与 Agent 输出、完整重组和历史翻页，保留协议原上限。 |
| R3 | 旧强制禁用规则可绕过 | Core 策略边界映射两项旧环境变量及 managed disableWorkflows/enableWorkflows；入口、Agent 执行和活跃任务持续检查。使用受控策略源测试，未修改本机组织策略。 |
| R4 | 创作 Schema 缺失，错误 Code 可发布 | 从原 Zod v3 自动生成完整 Schema，迁移创作规则；创建/编辑/读取修订时编译 Code、验证 JSON Schema，保存/发布/启动检查已发布子流程、自引用和嵌套层级。 |
| R5 | 缺少名称/文件/动态命令及项目来源 | name、definitionPath 和可信项目来源保留。0.1.9 用资源选择/@ 替代 Workflow 动态斜杠命令；listAction/resolveAction 由 App 提供。SDK source.workspace 由 Main 绑定，项目范围缺目录仍拒绝。 |
| R6 | 显式 revision 可正式运行草稿 | Backend 正式运行只接受当前发布快照，测试可用指定修订；归档拒绝。0.1.9 测试由会话 Agent 按需发起，App 不再提供测试按钮。名称使用发布版本，文件/内联是明确的一次性快照。 |
| R7 | 迁移静默跳过，完成标记阻止重试 | 0.1.6 曾修复迁移核验。用户现已取消旧兼容，0.1.9 删除迁移器、自动扫描及 history 操作；旧用户数据文件保留，不再读取/展示迁移历史。 |
| R8 | App 固定的 SDK 与真实 Host 不一致 | 配套 SDK/Runtime 更新为 2.8.0；本地固定源码快照、补丁与校验和由 source-provenance 报告记录。干净解包验证与实际 CDP 验证分别记录。 |

正式运行相对旧版“默认当前修订”是有意的产品规则调整。恢复保留逻辑节点幂等键，attempt 单独递增，优先复用 Core 已完成回执；中断中的外部工具副作用不宣称恰好执行一次。

## 复核结论与范围

App 负责节点调度、绑定、分支、循环、目录和 Journal；Core 负责真实 Agent 执行、权限、会话、资源上限和取消。这个拆分边界继续保留。

聊天发起沿用普通会话；App 只准备普通会话草稿，发送时才创建会话。结果追问保留；输入框上方 Workflow 大卡片移除，流程由会话左侧 App 视图展示。资源/@ 共用选择状态，App 跟随 Moss 主题。

首版仍为本地 Desktop、只读画布；不兼容/导入旧 Core Workflow 数据；远程、拖拽编排、定时触发、公共市场发布不在本次范围。Windows 实际 UI 与全部故障组合尚未执行，不把 macOS 成功推断为跨平台验收。旧引擎及历史兼容源码已从 Core 物理删除，详见交互计划第 12 节。

## 验证入口

- App：`bun run --cwd apps/workflow test`、`check`、`build`。
- ZIP：`apps/workflow/scripts/review-package.mjs`（现在使用断言，失败非零退出）、`verify-package.mjs`。
- 实际 Moss：`verify-experience-cdp.mjs`；旧 CDP 命令转到同一现行脚本，避免安装旧版本。当前报告在相邻仓库 `artifacts/moss.workflow/verification/0.1.9/`，0.1.6 报告保留为历史证据。
- Core：通用 Host/会话/策略测试、App Runtime 生命周期/故障/重试测试、Direct/renderer 构建与 TypeScript。
- 0.1.2 的 `review.json` 保留为修复前证据，不是通过报告。


## 本轮交互复核

六项调整均已实现。补修真实 CDP 暴露的资源按钮不可见、WebView 未就绪即访问与 App 跳转草稿被清空问题；长流程初始缩放按可读性调整。节点状态从独立持久快照恢复，不依赖最近 10 条事件。

真实 Agent 在普通会话创建草稿并修改至下一修订；自然语言“数量 21”运行 14 节点流程，结果为 42，追问未再次运行。补查 800px 窄窗、亮暗主题、停用/启用通过。详细事件、单元测试、首次超时及重试和未完成的故障组合均在交互计划按实际证据区分。


## 用户复核后的设置清理

用户指出旧 `WorkflowRun/Create/Edit/Manage` 仍显示在内置工具表中。根因是只关闭旧构建开关，未删除静态工具目录和加载分组。现已删除这些残留，并移除基础工具/命令装配的旧注册。

另按用户要求删除独立“工作流”设置分区、说明卡片和 `workflows.enabled` 会话传递；历史用户设置不再影响 App。工作流随 App 安装启用，统一由 App 管理启停。相关 50 项测试与真实 CDP 检查通过，详见交互计划第 11 节。

完整源码清理复核：50 个旧文件已删除；旧 Workflow 注册、任务/进度类型、历史扫描、IPC、设置传递及无引用组件均已清理。100 项 Core/UI/协议测试、7 项 Host 测试、构建及实际 CDP 创建/修改/运行回归通过。通用 App 执行策略和当前 App 功能保留，没有双引擎入口。
