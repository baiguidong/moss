# Codex 宿主工具与 Excel 实时控制借鉴方案

> 状态（2026-10-29）：用户决定暂不实施 Excel 实时控制；当前优先完善主会话文档引用、精准修改、对比和核验。本文保留作后续规划参考。

分析日期：2026-10-29。本文为方案，不代表功能已实现。

## 结论

两项能力分开建设，共用 Moss 的调用上下文、能力发现、取消和结果展示机制。

- `codex-app-tools` 对应 Moss Core 的宿主工具入口。复用现有 Host Contracts 和主会话工具，不新增一个“宿主桥接创作 App”。
- Excel 实时控制适合新增内置 App `moss.excel-live`，源码仍放在相邻 `moss-apps` 仓库，打包时附带。配套一个最小 Excel 加载项，并提供内置 `excel-live-control` skill。
- 用户持续在 Moss 主会话下达指令，修改发生在已连接的真实 Excel 工作簿中。Moss 右侧显示连接状态、目标区域和核验结果；App 使用通用详情页。

## 已核实的 Codex 机制

本机 `codex-app-tools@0.1.6/server.mjs` 是 MCP stdio 到桌面进程的适配器：

1. 从桌面宿主动态获取 `tools/list`，并缓存工具名称及内部 namespace。
2. `tools/call` 携带执行器提供的 thread、turn、call 和 host 标识转发；没有 thread 元数据会拒绝执行。
3. 通过 `CODEX_APP_TOOLS_PIPE_PATH` 指向的本地 socket/命名管道调用宿主，使用带长度前缀的 JSON-RPC 帧。
4. 转发 `tools/cancel`，断开连接时拒绝仍待处理的请求，转换文字/图片/音频返回值。
5. 插件说明覆盖聊天、项目、侧栏/置顶、自动化、worktree、面板及随附创作库定位；实际工具清单由宿主决定，不能只复制 server 文件获得这些功能。

本机 Spreadsheets 插件的 `.app.json` 另外声明 `connected_documents`，连接器 ID 为 `connector_openai_codex_document_control`。Excel 并非由上述管道文件实现。

`excel-live-control/SKILL.md` 的实际流程是：

1. 确定用户指定的工作簿和选区，验证 Excel、ChatGPT 加载项及已登录的加载项面板。
2. 调用 `list_document_sessions(surface="excel")` 找到目标工作簿连接。
3. 用 `get_document_tool_schemas` 获取该连接支持的命令。
4. `execute_document_command` 使用精确的 `executor_session_id`、符合 schema 的参数及稳定的 `idempotency_key` 执行。
5. 优先使用 `read_ranges`、`write_range`、`format_range`、`chart`、`table`、`pivot_table` 等结构化命令；必要时才使用 `run_officejs`。
6. 回读公式和值；布局或图表改变后用 `read_range_image` 核验。工作簿或加载项重启、另存为、失联时重新发现连接。

技能明确将 Computer Use 限定为启动、准备和焦点管理；文件创作不能替代失败的实时编辑。Office.js 批操作非事务，报错后需检查已发生的修改。

**能直接借鉴的是接口契约、状态机、路由与核验规则。** 已查看的本地包没有提供 Excel 加载项执行器和连接服务的完整实现，不能声称复制 skill 或填写连接器 ID 就能获得实时控制；也不能假定 Moss 的模型地址/API key 能接入 OpenAI 的连接服务。

## Moss 宿主侧的复用与缺口

| 能力 | 当前基础 | 建议 |
| --- | --- | --- |
| 主会话结果展示 | `moss_present`、资源解析、右侧预览、标注回传 | 继续复用；增加已连接文档资源，不另建结果 UI |
| 工具发现与能力判断 | `moss.host/v1` 的 capabilities、contracts、info；工具常驻/按需机制 | 区分“宿主支持”“有权限”“当前可用”；把需要的宿主能力暴露给模型 |
| 会话身份和取消 | 主会话上下文、App invocation、AbortSignal、任务记录 | 由宿主绑定当前会话/轮次/调用，工具参数只指定目标资源 |
| 会话查找与打开 | `moss.session-source/v1`；Agent 绑定会话 API | 补充面向主会话的窄接口；Agent 绑定会话不等于全部桌面聊天管理 |
| 项目、侧栏、置顶、面板导航 | 已有桌面业务服务和 UI 路由 | 按实际需求增补模型可调用接口；避免靠模型点击侧栏完成管理 |
| 自动化 | 现有 CronCreate/CronList/CronDelete | 复用现有调度，不再平行实现第二套自动化 |
| SDK 与依赖定位 | info、contracts、sdk.export、python.get | 按需要增加本机渲染器/库的能力描述；优先调用 App 工具，避免模型猜安装路径 |
| 已连接文档 | 未发现工作簿连接注册及 Office.js 执行器 | 新增通用连接管理，小范围服务 Excel，后续可承接其他 Office 文档 |

宿主工具的实现留在 Core；App 通过 SDK/Host Contracts 使用它们。模型侧沿用现有原生工具入口，不必为了模仿 Codex 再套一层 MCP。以后若需让外部 CLI 或其他 Agent 访问 Moss，可另加薄 MCP 适配器。

工具名称继续直接使用声明名，来源由元数据和 UI 展示。全局可发现不等于所有 schema 全常驻：保留已有 `moss_present` 常驻，管理工具和 Excel 业务命令按需加载；连接状态变化应刷新可用性。

## Excel 的推荐分工

```mermaid
flowchart LR
  U[Moss 主会话] --> T[Excel 实时工具]
  T --> H[Moss 已连接文档服务]
  H <--> A[Excel 加载项 / Office.js]
  A <--> W[正在打开的工作簿]
  H --> R[主会话结果与右侧区域预览]
```

- **Moss Core**：连接注册与断开、当前会话绑定、能力发现、命令路由、取消、执行回执、通用结果展示。
- **`moss.excel-live` App**：Excel 工具 schema、业务命令、连接资源解析和帮助文案。默认全局按需，使用通用详情页展示状态。
- **Excel 加载项**：注册当前工作簿、读取当前选区、调用 Office.js、在 Excel 内计算/修改/取区域图片，并返回结果。
- **内置 skill**：判断文件创作或实时操作、识别目标、选择命令、分阶段执行和核验；不承担连接和执行代码。

已有 `moss.spreadsheets` 使用 ExcelJS/HyperFormula 操作文件；另一个 `moss.excel` 配置型 App 使用 openpyxl，同样没有接管 Excel 内存中的未保存状态。三者应按目标路由，不能都宣称“正在控制打开的 Excel”。

实时模式由 Excel 自己计算公式并修改原生对象。模型继续使用 Moss 主会话的配置；加载项只负责执行，不再配置第二套模型或 API key。

## 用户看到的效果

用户首次在 Excel 打开 Moss 加载项并连接。此后在 Moss 说：

> 把当前选中的金额统一保留两位小数，检查合计公式，并显示修改后的区域。

主会话引用目标，例如 `预算.xlsx · 费用 · D5:D30`。执行后显示简洁结果，例如“已调整 26 个单元格格式，合计公式核验通过”，右侧展示从 Excel 读取的区域图片及工作簿/工作表/范围/更新时间。可以定位回 Excel。

该图片是一次核验快照；连接断开或文件被用户继续修改后，应标记失效或刷新，不能把缓存图片当成实时镜像。截图上的局部标注应绑定工作簿连接、工作表、区域与快照版本，后续修改前重新读取目标。

Moss App 不增加独立聊天或编辑工作台。Excel 中保留最小“连接 Moss / 当前工作簿 / 断开”面板，它用于运行桥接。不能提前承诺加载项面板关闭后仍能稳定驻留，需要按 Excel 版本验证生命周期。

## 首期范围与实现顺序

1. **宿主能力收口**：复用已有工具桥和契约；明确上下文、来源、可用性与错误返回。优先补需要的面板/会话/连接查询，不一次迁移所有聊天管理功能。
2. **连接原型**：本机 Excel 加载项连接桌面 Moss；识别唯一目标工作簿，读取未保存单元格和选区。先验证加载项部署、HTTPS/WSS 或等价本地通信、配对以及面板生命周期。
3. **完整最小闭环**：发现连接 → 获取命令 schema → 范围读取 → 写值/公式/格式 → Excel 重算 → 回读 → 区域截图 → 主会话展示。
4. **扩展功能**：表格、图表、透视表、批处理；最后增加受能力发现约束的 Office.js 补充入口。保存/导出按实际支持能力提供。

建议首期仅支持桌面 Moss 与本机 Excel。Office.js 有利于复用 Windows/macOS 实现，但接口与截图能力需要逐版本核验；远程 Moss/Web 访问用户本机 Excel 需要额外连接路由，不能把服务器上的 localhost 当作用户电脑。

## 必须实际验证的边界

| 场景 | 期望 |
| --- | --- |
| 两个同名工作簿、多窗口、切换焦点 | 绑定连接身份；不能凭标题或前台窗口误操作 |
| 用户在模型思考期间更改选区 | 本轮使用已确定的目标范围，不追随鼠标漂移 |
| 工作簿未保存、另存为、改名、关闭重开 | 读到真实内存状态；连接失效后重新识别 |
| 重复调用、响应丢失、断线重连 | 稳定操作 ID 与回执；不确定时先回读，不能盲目重复写入 |
| 用户同时改动目标区域 | 写入前校验目标状态；检测冲突后重新读取 |
| 只读、受保护、合并单元格、筛选及隐藏行列 | 返回明确能力/范围结果，不扩大修改区域 |
| 公式、日期、区域设置、图表与透视表 | 检查 Excel 实际结果与对象；布局核验使用区域图片 |
| 中途报错或取消 | 区分未执行、部分执行、结果未知；取消不等于撤销，不能假定自动回滚 |
| 断连后仍展示旧区域 | 明确离线/快照状态，停止依赖旧连接执行写入 |

跨重启的幂等性不能只靠内存中的 key；需要回执和写后核验。首期不承诺通用撤销、宏执行、打印设置或整本工作簿事务。

## 证据与限制

- `/Users/bgd/.codex/plugins/cache/openai-bundled/codex-app-tools/0.1.6/server.mjs`，尤其 24776 起的适配实现。
- `/Users/bgd/.codex/plugins/cache/openai-bundled/codex-app-tools/0.1.6/.mcp.json`。
- `/Users/bgd/.codex/plugins/cache/openai-primary-runtime/spreadsheets/26.1007.11041/.app.json`。
- 同包 `skills/excel-live-control/SKILL.md` 与 `officejs.md`。
- Moss `packages/host-contracts/src/{host,local,apps}.mjs`、`src/tools/MossTool/`、`src/tools/AppContributionTool/`、`ui/src/apps/app-task-session.mjs`。
- 相邻 moss-apps 的 `apps/spreadsheets/src/backend/engine.mjs` 与 `tool-apps/excel/README.md`。

还对当前桌面安装包 ASAR 的相关 JS 做了只读静态检查并验证命中文件的完整性；未运行 Codex 宿主命令、未连接用户的 Excel。官方插件文档请求返回 403，因此 Codex 的具体行为判断以上述本地版本为依据。Excel 服务端的传输、身份认证及加载项内部代码尚未由本次材料证明。
