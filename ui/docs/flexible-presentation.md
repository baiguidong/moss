# 灵活内容区与文件观察

右侧的文件、目录、变更、结果集合、浏览器及 App 工作台入口由同一个会话展示控制器管理。会话任务与工作区、结果、浏览器共用顶部导航：存在任务时展示任务入口，任务首次出现或切换到有任务的会话时自动选中。返回箭头始终位于导航最左侧；面板较窄时导航改用下拉菜单。文件预览只保留一处文件名，多份已打开内容通过标题下拉菜单切换。手动打开文件（包括再次打开同一文件）或收到新的有效展示请求时退出任务视图；普通刷新和后台结果登记保留任务视图。工作区入口继续提供原文件树与版本；手动浏览文件不会自动变成交付结果。App 继续使用自己的工作台；右侧提供入口，不擅自把 App 页面压缩到窄面板。

## 展示链路

`moss_present` 或宿主适配器 → 资源解析 → 会话资源登记 → 用户状态仲裁 → renderer → 就绪回执。

展示能力由宿主显式声明：只有传入 `presentationEnabled: true` 并接入 `onAppEvent`，且最终工具池允许 `moss_present` 的主会话，才注入展示提示词。CLI、无 UI 宿主和未声明能力的调用方不获得该工具，也不收到面板、预览回执和文件观察说明。

项目事实和用户约束继续使用共享 `appendSystemPrompt`；`ProjectMemory`、`ProjectResult` 和展示职责使用 `mainSessionSystemPrompt`，追加到主会话选定的 Agent 系统提示词。独立 Agent、恢复的 worker 和继承父上下文的 fork 都排除这些主会话指令及工具；worker 返回实际路径与验证结果，主会话负责最终交付。

- `ui/src/shared/presentation-contracts.mjs` 定义模型输入、能力提示与纯状态转换。模型只能提交路径、已授权 URI 或本会话已有资源 ID，不能指定窗口或会话。
- `ui/src/presentation/presentation-service.mjs` 保存资源、回合绑定、请求顺序、会话 epoch、用户选择和回执。持久化内容位于 `MOSS_HOME/presentations`。
- `resource-resolver.mjs` 按消息所属 workspace/远端解析路径，处理真实路径、行列位置与 App 资源。工具不能借绝对路径越过 workspace；用户手动打开外部文件为只读。
- `components/presentation/presentation-panel.tsx` 提供 renderer 注册表并复用原 PreviewDrawer、TurnChangeCard。增加资源类型时扩展 adapter/renderer，不改聊天的核心分支。
- `moss_present` 的工具卡片显示持久化回执。`pending`、`deferred` 与 `shown` 分开；App 工作台入口不会被报告为业务页面已显示。

自动展示不改变键盘焦点。关闭、手动切换、固定、关闭跟随或存在草稿时，资源仍登记到结果，但不自动替换当前内容。新用户回合解除本轮手动抑制，固定和草稿仍生效。重复回合开始、历史恢复、后台会话和过期回执不能重新打开面板。原生浏览器先创建后台标签，再由展示控制器决定何时激活。

明确 Markdown 链接、经过存在性验证的行内代码路径、正文中明确的绝对路径、工具文件按钮和附件进入同一入口。全路径链接使用短文件名显示，保留完整目标和行号。普通正文中的路径先检查存在性；既有链接、URL、代码围栏不会重复处理。HTTP 链接沿用系统浏览器行为。

聊天文件卡片彻底移除旧的 Write/Edit 适配推断，只使用宿主文件观察和展示资源。已核实的新增/修改标记为“已创建 / 已更新”；显式展示的现有文件标记“可查看”。未核实、已删除、改后还原的文件不冒充生成成果。Bash/Python/其他写入方式走相同数据源。历史恢复读取已有观察，不通过工具名称补猜。

`moss_present` 和其他工具统一遵循展开、折叠、合并设置；展开时显示详细状态，合并时仅保留一行摘要。提示明确要求根据回执描述展示，`deferred` 不得说“已打开”。提示约束不能保证模型永不误述，工具状态卡仍显示宿主事实。

## 编辑与窗口

`preview-ownership.mjs` 按真实本地文件协调编辑权，`use-preview-document.ts` 将右侧及独立窗口接入同一草稿。编辑客户端与 Electron sender / Web 连接绑定，并校验 generation。

弹出或“在此编辑”先冻结原编辑器、等待已排队的草稿持久化和 ACK，再交接。失败或超时保留原编辑权；旧 generation 不能写入。窗口销毁或 Web 断开释放编辑权，脏草稿仍保存在 `MOSS_HOME/preview-drafts`，重新打开同一文件可恢复。

保存前比较磁盘内容摘要；外部内容变化时保留草稿并提示冲突。写入前保存恢复副本。现有预览历史、快照、撤销草稿、多标签独立窗口和关闭保护继续使用。没有本地所有权 adapter 的远程预览沿用原远程能力。

## 回合文件观察

`turn-observation-service.mjs` 在真实发送队列中捕获回合前后内容，成功、失败和取消都经过结束处理。文件内容先固定，模型的工具记录用于补充未核实候选，不作为已核实清单。

子会话历史不生成主会话的文件变化与回退卡片；没有独立观察记录的 worker 不会因此显示“文件变化未核实”。主会话仍按实际观察覆盖情况报告。

- 使用 moss 版本服务已有的独立 bare Git 内容存储；不修改用户 workspace 的 `.git`、HEAD、index 或分支，也不自动安装 Git。
- 基线包含已有脏文件。改后还原不算净变化；新增、删除、二进制和文件模式变化保留。
- 扫描结束复查文件和目录状态。超时、权限失败、Git 缺失、远程无 adapter 或 workspace 变更标为覆盖不足，不能报告为完整零变化。
- 排除项不当作删除；已知同目录并发任务会注明。统计是本轮期间变化，不能证明所有文件均由 AI 独立修改。
- 默认每次捕获 5 秒，继承 10,000 文件、单文件 50 MiB、总量 512 MiB 边界。每会话保留最近 200 次观察，并保护仍打开或固定的历史变更；释放退休引用后由内部 Git 自动维护回收对象。手动版本引用保留。
- 观察结果在 `MOSS_HOME/turn-observations` 独立持久化，历史读取不重新扫描。文本差异按需加载；旧历史和未完成观察明确标为未核实。

新增观察不扩大原“回退本轮”的覆盖范围。UI 保留“回退已备份文件”的表述，避免暗示所有观察到的文件都可恢复。

## 验证

常规检查：`cd ui && bun run check`，构建：`bun run build:direct && bun run build:renderer`。

新增测试：`presentation-service.test.ts`、`preview-ownership.test.ts`、`turn-observation.test.ts`，并扩展 MossTool、浏览器、任务面板及预览生命周期测试。

`bun run build:electron-direct && node ui/tests/main-session-prompts.runtime.mjs` 使用本地模型桩验证主会话与独立 Agent 的提示词、工具隔离、续跑与恢复，以及无 UI 展示能力时的行为。

`cd ui && bun run test:presentation` 启动隔离的 Electron 实例，验证真实右侧预览、编辑、脏草稿交接、独立窗口保存、目录与版本入口。测试不调用模型，不使用用户数据。设置 `MOSS_PRESENTATION_SMOKE_OUTPUT` 可保存截图。主程序启动/重启验证继续用 `bun run test:main-services`。

`bun run test:presentation-ui` 在 Chromium 中使用实际 React 组件和受控宿主响应，验证三种写入方式的文件卡片、可点击路径、工具折叠、任务区域、草稿同步失败重试与保存期间继续输入。与真实桌面测试互补，不将受控响应当成真实模型调用。
