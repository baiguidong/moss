# 会话式自然语言创建项目

## 已实现的流程

项目页顶部直接展示自然语言创建输入框，下方为项目列表，不再显示“通过会话创建项目”跳转按钮。输入框内“确认方案后创建”带 hover 提示，说明会话完善方案、确认后安装资源和创建项目的流程。“使用表单创建”作为列表工具栏的次要入口继续保留。

输入框与首页会话输入保持相近视觉，草稿独立保存；Enter 发送、Shift + Enter 换行，中文输入法确认不会误发送。第一次发送后直接建立持久的项目创建会话并发送需求，标题标记“创建项目”。内置引导提示词收集名称、目标与约束、项目指令、目录、默认模式、权限、专家、技能、App 和可选首个任务；资源存在多个候选时，要求助手解释差异并通过问题协助选择。

项目列表采用与 App / 专家页一致的紧凑卡片，显示简介、资源数量、会话和成果。支持按名称或描述搜索，按更新时间、创建时间或名称排序；初始显示 24 个，下滑接近底部时自动追加。进入详情再返回时保留已加载项目、排序和滚动位置。

每个项目保存独立图标。会话创建时，AI 根据项目目标生成简洁的矢量图形和配色，并在方案确认卡中预览；用户可继续讨论重新设计，也可在修改方案时选择内置图标、调整配色。图标随完整方案一起确认，修改后须确认新版本。手动表单和项目配置提供 12 个内置图标、7 种配色与恢复默认选项。项目列表、详情、侧栏会话分组和项目记忆使用统一图标；旧项目、缺失或损坏的图标回退为绿色项目图标。

资源发现先查已安装和内置资源，再搜索 SkillHub、ExpertHub 和 App Marketplace。选择使用真实资源 ID，详情接口进行精确查找，不以显示名称或第一个模糊搜索结果安装。内置和自定义专家均在本地候选中。

助手提交完整方案后，消息流末尾显示结构化确认卡。卡片完整显示项目指令、所有目录及默认目录、运行配置、资源名称/来源/版本/安装状态、App 权限和具体子服务、首个任务。用户可以直接修改配置、选择目录、移除资源、调整服务，或者继续会话补充候选。保存修改会生成新版本，必须重新确认。

点击“确认并创建”后，宿主校验整个方案及资源快照，安装缺失资源，再创建项目。App 权限仍通过现有安装权限界面单独确认；需要启用、连接或配置的 App 会暂停创建，显示“配置 / 授权 App”入口。完成后返回创建会话，点击“继续创建”。市场未提供服务列表时，安装后要求明确选择子服务，不自动加入所有服务。

完成后自动进入项目；有首个任务时建立继承项目配置的会话并打开。若首个任务启动失败，项目保持创建成功，错误单独记录在草稿中。重新打开原创建会话可查看已创建项目和首个任务。

## 实现边界

自然语言引导采用宿主内置提示词，固定在专用创建会话，不依赖用户提前安装某个 Skill 或 App。没有新增可直接创建项目的大模型工具。

模型仅获得以下工具，宿主同时限制工具目录与工具调用验证：

| 工具 | 操作 | 行为 |
| --- | --- | --- |
| `ProjectPlan` | `get`、`preview` | 读取或持久化完整草稿；修改须携带当前版本 |
| `ProjectResource` | `list_installed`、`search`、`inspect` | 只读发现和精确详情；本地列表支持关键词和分页 |
| `AskUserQuestion` | 现有问题交互 | 澄清需求和比较候选 |

专用会话使用 Chat 引导模式，不能通过工具执行 Bash、安装资源或创建项目。项目实际使用的 Chat/Boss 模式在方案中单独配置。

原 `project:create` 仍是宿主 IPC/API，供旧表单使用；自然语言确认链路复用内部 `createProject` 实现。模型 `ProjectPlan preview` 与宿主 `project-creation:confirm` 有明确边界。

主要代码：

- `ui/src/project-creation-service.mjs`：草稿、校验、版本、状态机、安装编排、创建与恢复。
- `ui/src/project-creation-resources.mjs`：资源发现、精确身份、版本指纹、安装及可用性检查。
- `ui/src/main.mjs`：真实市场/安装适配、创建会话工具限制、IPC 和首个任务。
- `src/tools/ProjectCreationTool/`：模型工具 schema 和提示词。
- `shared/project-icon.mjs`、`ui/src/renderer-react/components/projects/project-icon.tsx`：图标数据校验、默认回退、渲染和选择器。生成图标只接受有界的 24×24 SVG 路径数据，不接受 SVG 标记或远程图片链接。
- `ui/src/renderer-react/components/projects/project-creation-draft-card.tsx`：会话内确认与编辑卡。
- `ui/src/renderer-react/components/projects/project-creation-composer.tsx`、`project-workspace.tsx`：项目页直接输入入口、列表及原表单。
- `ui/src/client/moss-client.mjs`、`methods.mjs`：桌面与 Web 共用客户端契约。

## 草稿与确认契约

草稿自动保存到 `~/.moss/project-drafts/<draft-id>.json`，绑定创建会话 ID。每个创建会话使用一个方案；同一方案创建成功后不能继续改造成另一个项目。已有预览格式按更新时间恢复最新草稿，旧资源快照需要重新预览确认。

状态包括 `awaiting_confirmation`、`installing`、`awaiting_authorization`、`creating`、`completed`、`failed`、`cancelled`。草稿保留项目配置、资源快照、安装进度、待配置 App、预留项目 ID、创建结果、首个任务和错误。写入采用临时文件加原子替换。

客户端接口：

```ts
projectCreation.getDraft({ sessionId } | { draftId })
projectCreation.updateDraft({ draftId, version, patch })
projectCreation.confirm({ draftId, version })
projectCreation.cancel({ draftId, version })
projectCreation.onChanged(callback)
```

内容修改或资源版本变化递增 `version`，执行进度不递增。过期确认、过期模型方案更新和过期编辑均拒绝。界面按更新时间合并事件；切换回创建会话或 Web 重连后读取持久状态。

同一草稿的操作串行化。执行期间拒绝修改或取消；重复确认等待同一创建结果。创建前保存预留项目 ID，项目文件写入后发生中断也能恢复同一项目。已经完成的安装会保留，重试只处理缺失资源。恢复时不会自动安装，仍由用户点击继续触发。

确认前及资源准备完成后重新检查资源身份、版本/内容指纹和可用性。变化会更新确认卡，要求重新确认。目录必须是已有绝对路径；留空由项目创建链路建立默认目录。已删除创建会话不能继续操作。

技能沿用 SkillHub ZIP 安装与已有路径保护，存在校验和时验证下载。不同技能的目标目录冲突会停止安装。App 沿用市场版本、签名、兼容性与权限校验，不自动批准权限。ExpertHub 使用目录及发布元数据识别版本，市场未提供不可变摘要的内容无法获得完整包锁定保证。

## 项目会话继承

项目保存 `skillIds`、`expertIds`、`assistantName`、`appIds`、`appServiceIds`、`instructions`、目录及默认运行配置。附加 `creationDraftId` 和 `resourceBindings` 记录创建来源和已解析资源信息，不替代原有运行字段。

后续项目会话继续通过 `resolveProjectSessionDefaults` 和项目资源 manifest 继承配置。项目只绑定明确选择的 App 服务，旧会话保留创建时快照。原表单和旧项目保持兼容。

首个任务用持久的 `sourceSessionId` 关联创建会话，恢复时复用已有会话而不重复派发。若恰好在保存任务会话后、发送前退出，恢复结果会提示用户打开已有会话继续发送，避免任务重复执行。

## 验证

- `bun test ui/tests/project-creation-tools.test.ts`：模型 API schema 兼容性与工具边界。
- `bun test ui/tests/project-icon.test.ts ui/tests/project-store.test.ts`：图标校验、旧项目回退、持久化与配置更新保留。
- `node --test ui/tests/project-creation-service.test.mjs`：确认前不安装、并发防重、旧版本拒绝、部分安装重试、写入后恢复、授权暂停、精确服务选择、取消、资源变化、首个任务失败及资源继承。
- `ui/node_modules/.bin/electron ui/tests/project-creation.electron.mjs`：真实 React 界面的完整预览、编辑、目录选择、资源移除、服务选择、配置入口、重试与取消。
- `ui/node_modules/.bin/electron ui/tests/project-list.electron.mjs`：项目页直接输入、输入法与重复提交保护、响应式卡片、下滑自动加载、返回位置、搜索排序及旧表单入口。
- 在 `ui` 目录运行 `node scripts/test-project-creation-host.mjs`：隔离 MOSS_HOME 下真实 Electron IPC、SQLite、项目文件和资源 manifest，覆盖创建与重启两阶段。
- 原项目/资源/数据库测试、主进程服务冒烟、UI TypeScript 检查、Direct 和 Renderer 构建。

自动化测试使用隔离资源和授权状态；真实市场下载与第三方账号 OAuth 仍取决于部署环境和用户账号，没有冒用真实账号验证。

历史偏好排序、保存为项目模板、草稿导入导出及项目级资源升级属于后续可选增强，不属于这次自然语言创建主流程。
