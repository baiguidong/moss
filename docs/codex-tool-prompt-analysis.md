# Codex 插件工具与提示词传递核查

核查日期：2026-10-30。本次只分析来源与传递方式，不修改 Moss 工具、App 安装包或权限配置。

后续已进一步从 Electron 代码与 Rust 执行器反汇编定位具体拼接函数，见[Codex 提示词拼接逻辑](codex-prompt-construction.md)。其中确认了 MCP 准备阶段追加插件来源、code mode 生成调用签名和 exec 描述，以及请求构建的协议分支。

## 用户指定的最新会话与 HTTP 请求

已检查用户确认的 15:35 桌面会话 `01a18bbb-ea6d-7f70-91f4-f7708941c27f`，以及其中 15:55:34 发出的“使用 spreadsheets 创建一个表格，mock 一些随机数据”。[实际提示词与调用摘录](../output/codex-prompt-analysis-20261030/latest-session-prompt.md)和[完整 additional_tools 记录](../output/codex-prompt-analysis-20261030/latest-session-tools-context.json)已经保存。

`~/.codex/logs_2.sqlite` 中能关联到该会话的真实 HTTP 请求：`POST https://napi.sudorouter.ai/v1/responses`，返回 `200`。[仅含非敏感元信息的摘录](../output/codex-prompt-analysis-20261030/latest-http-log-metadata.json)保留了请求时间、方法、目标和状态。已检查的 HTTP 日志没有保存 `input` / `tools` 请求体，rollout 也不能当作 HTTP 抓包。

随包实际执行器含 `CODEX_ROLLOUT_TRACE_ROOT`、`inference_started`、`request_payload`、`raw_request_payload_id` 等原始追踪实现标记；当前桌面 app-server 进程没有设置该追踪环境变量。此开关尚未通过实际捕获验证，不能宣称已获取原始请求。后续检查中磁盘出现 `No space left on device`；没有清理用户文件或重启桌面应用。

## 结论

Moss 的表格、PDF 创作能力来自 Codex 插件的适配。不能把整个插件说成“与 Codex 无关、完全自写”，也不能把 Moss 当前的 `spreadsheet_export` 等工具定义当作 Codex 原版工具原文。

表格的适配记录明确写着“宿主调用替换为 Moss App tools、任务记录与资源引用”。记录中的原版 Skill SHA-256 与本机 Codex spreadsheets 26.1007.11041 的文件完全吻合。当前 Moss 的 `spreadsheet_export` 是这层适配后的工具接口，调用 Moss 的 `artifacts.export`；Codex 原版 Skill 的导出示例是 JavaScript 库调用 `SpreadsheetFile.exportXlsx(workbook)`。

`获取此 App 的导出作品信息。` 是 Moss App manifest 中的描述；`This tool is provided by the installed Moss App "表格".` 是 Moss Core 统一追加的后缀。这两段都不能作为 Codex 原版工具提示词引用。

**真实会话核查补充：Codex 也会附加插件来源。** 2026-10-29 的真实 Excel 文件操作会话记录中，`load_workspace_dependencies` 的描述以 `This tool is part of plugin \`codex-app-tools\`.` 结尾。不能根据无插件的隔离测试，得出“Codex 只传功能、不传插件身份”或“应当照 Codex 删除来源”的结论。

## 已安装版本与证据

- 桌面包：`/Applications/ChatGPT.app`，bundle ID `com.openai.codex`，版本 `26.1023.51421`，build `22530`。
- `app.asar` SHA-256：`1c8ef1bef66e5fc416ae66eff8e6529972aa3601e27a1c7b5f61d6a292b957d3`。
- 随包执行器：`Contents/Resources/codex-cli/bin/codex`，版本 `0.165.0-alpha.1.2`，SHA-256 `50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8`。
- REA 6.5.0 证据 ID：`ev_190842cb72e25fee74380d5e399a709cff7e8f3de168fda149f0955f3e33dc82`。
- [提取清单与哈希](../output/codex-prompt-analysis-20261030/manifest.json)、[REA 结果](../output/codex-prompt-analysis-20261030/rea.json)、[隔离请求摘要](../output/codex-prompt-analysis-20261030/probe-summary.json)、[完整本地测试请求](../output/codex-prompt-analysis-20261030/request.json)、[插件来源核验](../output/codex-prompt-analysis-20261030/plugin-origins.json)。

提取的 6 个 JS 模块均逐文件核对 ASAR 声明哈希；Babel 仅格式化，没有执行提取代码。REA 保留静态与模块事实，但大型 main 模块的语义图触及结果预算，不能视为完整调用图。随后用随包真实 app-server 连接本机回环地址的模拟 Responses 服务，验证最终发送的请求结构；测试使用临时配置与工作区、虚构提示和工具，没有调用在线模型或执行业务工具。

## 工具来源的正面证据

| 位置 | 观察 |
| --- | --- |
| `../moss-apps/apps/spreadsheets/resources/skills/moss-spreadsheets/references/adaptation.md:3` | 来源 OpenAI spreadsheets 26.1007.11041；宿主调用替换为 Moss App tools |
| 同文件第 5 行 | 源 Skill 摘要为 `dd22f4bae5bf3f76457c80eb1f079ba7a47b87db52b144edeb1e5f4585dc8f34`，本次重新计算完全一致 |
| 本机原版 `spreadsheets/26.1007.11041/skills/spreadsheets/SKILL.md:17` | 使用 `@oai/artifact-tool` JavaScript 创作表格 |
| 同文件第 381 行 | `const output = await SpreadsheetFile.exportXlsx(workbook);`，随后 `output.save(...)` |
| `../moss-apps/apps/spreadsheets/app.moss.json:167` | `spreadsheet_export` → `artifacts.export`，输入 `id/index`，effect 为 write |
| `../moss-apps/packages/engine-apps/src/backend.mjs:166` | 打开宿主目录选择器、复制已有产物、同名时另取名称，返回路径或取消状态 |
| `../moss-apps/apps/spreadsheets/src/backend/engine.mjs:3` | 实际使用 ExcelJS / HyperFormula；并未直接调用原版 artifact-tool |

Moss Apps 提交 `34653c5c9474f97eea767448399e5ba3996a25c5` 将表格 App、schema、适配 Skill 与执行引擎一起加入。该提交本身是合并后的开发记录，不能还原此前每一步编写过程；接口适配的判断主要依据明确的适配说明和两侧实际调用代码。

本机原版 PDF 插件声明 Skills，表格插件声明 Skills 和 `connected_documents` 连接器。逐文件搜索这两个版本没有命中 `spreadsheet_export`、`spreadsheet_guide` 或 `pdf_create`。此搜索只覆盖本机这两个插件版本，不代表所有历史版本或云端连接器均不存在类似工具。

## 真实桌面会话中观察到的传递

来源：`~/.codex/sessions/2026/10/29/rollout-2026-10-29T14-10-54-01a18648-66cd-7903-9f5a-dc1cae1d2ce9.jsonl`。首行标明 `originator=Codex Desktop`、`cli_version=0.165.0-alpha.1.2`。该会话确实接收了 Excel 文件操作请求，读取了表格 Skill、调用了依赖定位工具，随后编写了使用 `@oai/artifact-tool` 的脚本。

[相关记录摘录](../output/codex-prompt-analysis-20261030/real-session-evidence.json)仅保留工具定义、Skill 目录、环境和依赖加载信息，不复制表格业务内容。这里的证据是实际运行的 rollout 记录，**不是线上 HTTP 请求抓包**。

| 记录位置 | 实际内容 |
| --- | --- |
| 第 3 行，`response_item / additional_tools`，role=developer | `functions` 命名空间内的 `exec` 为 custom tool；其 description 包含嵌套工具原文和 TypeScript 调用签名 |
| 第 5 行，developer message | Skill 名称、适用场景、路径和根目录映射；另有 Workspace Dependencies 指令要求使用依赖定位工具 |
| 第 8 行，user message | `<environment_context>`：cwd、shell、日期、时区、workspace roots 和权限配置 |
| 第 34 行，`custom_tool_call` | 模型通过 `exec` 同时读取表格 `SKILL.md` 并调用 `tools.mcp__codex_app__load_workspace_dependencies({})` |
| 第 38 行，`custom_tool_call_output` | Skill 正文与依赖目录通过工具结果返回给模型 |
| 第 295 行，`custom_tool_call` | 模型编写的脚本实际包含 `SpreadsheetFile.exportXlsx(wb)` 和 `output.save(finalPath)` |

实际工具定义原文：

```text
### `mcp__codex_app__load_workspace_dependencies`
Locate the configured bundled workspace dependency runtime paths for this local desktop thread, including Node.js, Python, and useful libraries for working with spreadsheets, slide decks, Word documents, and PDFs. This is read-only and takes no arguments. This tool is part of plugin `codex-app-tools`.

exec tool declaration:
declare const tools: { mcp__codex_app__load_workspace_dependencies(args: {}): Promise<CallToolResult>; };
```

这一会话中的表格能力链路是：插件 Skill 目录 → 模型读取 Skill → 工具返回运行库位置 → 模型通过通用执行工具运行 JavaScript → 库函数导出文件。该会话的工具定义中没有 `spreadsheet_export`、`spreadsheet_guide` 或 `pdf_create`。

真实记录中的插件安装路径出现在 Skill 根目录映射，Node/Python 依赖路径由工具结果返回；环境的 workspace roots 包含工作区和当前会话的可视化输出目录，没有列出这些插件安装目录。这只描述已检查的会话，不能推广为所有配置下都不出现插件目录。

2026-10-30 的桌面会话 `01a18bbb-ea6d-7f70-91f4-f7708941c27f` 第 3 行还记录了相同的依赖定位工具描述及插件后缀。

## 静态链路与隔离请求验证（辅助证据）

桌面包格式化代码中，`main-UOTY8NmV.js:47641` 的 `AEe` 分别组装 `baseInstructions`、`developerInstructions` 和 `dynamicTools`；第 47722 行追加桌面开发者指令。第 15397 行的 `Que` 将宿主工具转换为 MCP 描述时保留 `description: t.description`、`inputSchema: t.inputSchema`，另带 `name/namespace`。

隔离 app-server 测试向 `thread/start` 传入基础指令标记、开发者指令标记和一个导出工具；随后发送 `turn/start`，本地 HTTP 服务保存真正的模型请求。得到：

| 信息 | 此次实际请求中的位置 | 结果 |
| --- | --- | --- |
| 基础指令 | `input[0]`，role=developer | 收到原样的基础指令标记；本次没有顶层 `instructions` 字段 |
| 开发者指令与 Skill 目录 | `input[1]`，role=developer | 开发者标记后包含 `<skills_instructions>`、Skill 根目录映射及 name/description/path |
| Skill 正文 | 首次请求没有自动装入测试 Skill 正文 | 目录标记存在，正文标记不存在 |
| 环境 | `input[2]`，role=user | `<environment_context>`，含 cwd、shell、日期、时区、workspace roots 与权限配置 |
| 用户本轮内容 | `input[3]`，role=user | 用户测试文本 |
| 动态工具 | 顶层 `tools[]` | `type=function`、name、description、parameters；测试 description 与输入完全相同 |

测试工具描述：

```json
{
  "type": "function",
  "name": "rea_export_probe",
  "description": "Export the selected spreadsheet artifact to a user-chosen directory. Requires a task ID and artifact index."
}
```

这个测试证明随包执行器对所测动态工具的描述没有自动追加 App 归属句。实际插件可通过自身说明、命名空间或专门的插件上下文表达来源；不能推断 Codex 永远不让模型知道插件身份。其他模型、provider 与功能开关可能采用不同的 API 承载方式，本次请求不能推广为全部 Codex 请求协议。

## Moss 当前传递链路及问题

```text
App manifest 的 contributes.tools
→ App Runtime collectManifestContributions / listContributions(loadSchemas=true)
→ AppContributionTool
→ toolToAPISchema
→ 模型请求中的 tool description
```

`src/tools/AppContributionTool/AppContributionTool.ts:104` 的 `prompt()` 优先使用 `instructionsText`，否则使用 `description`，然后统一追加英文 App 来源句。`src/utils/api.ts:159` 把这个结果赋给 API schema 的 description；UI 使用的 `description()` 与此不是同一方法。

当前导出描述存在两个问题：

1. “获取……信息”误述了实际会打开目录选择器并写文件的行为，也没有说明任务 ID / 产物索引的含义。
2. 来源后缀与功能描述是两个独立问题。真实 Codex 工具也带插件来源；Moss 是否保留、精简或移到统一插件上下文，需要单独设计，不能用无插件的隔离测试作为删除依据。App 归属还用于路由、权限与 UI。

适合现有实现的描述示例：

> 将指定表格任务的产物导出到用户选择的目录。传入任务 ID（id）和产物索引（index）；打开目录选择器，返回保存路径或取消状态，同名文件自动另存。

环境段另有独立问题：`ui/src/apps/app-skills.mjs` 返回 App 安装目录和数据目录；`ui/src/main.mjs:2617` 将它们加入 `addDirs`；`src/QueryEngine.ts:405` 又将权限上下文的所有 additionalWorkingDirectories 传给提示词；`src/constants/prompts.ts:556` 统一展示为 Additional working directories。

因此内部 App 目录被描述成了工作目录。Codex 的实测同样会传 cwd 和文件系统环境，不能由此得出应删除全部 Environment。合理的后续修复是分离用户工作目录与 App 执行所需目录：环境提示展示用户工作区并去重；Skill 所需路径留在 Skill 上下文，权限按实际需求管理。单纯删掉目录授权可能使 Skill 读取或 CLI 执行失效。

## 后续修改位置

- Core：保留插件提供的功能描述/详细说明；来源信息的表达方式待设计，暂不删除。
- Apps：按实际输入、输出和副作用修正表格等工具的空泛描述；修正源仓库后正常发布升级，不直接改已签名安装目录。
- 环境：分离提示词中的工作区与执行权限目录；保留文件工具需要的 cwd，去掉重复 cwd 和误标为工作区的 App 内部目录。

本次已完成 REA 静态核查、原版文件摘要核对、隔离执行器的本地请求捕获，以及真实桌面会话记录核对。尝试只读查询运行中桌面的 tools/list 时，宿主以 `untrusted-process-ancestry` 拒绝了外部进程连接，因此没有取得实时 socket 工具清单；没有绕过该校验。上述修复建议尚未应用。
