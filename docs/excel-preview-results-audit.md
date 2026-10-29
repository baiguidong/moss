# 月度预算 Excel 预览与结果登记排查（2026-10-28）

检查对象是最新会话「创建一份带公式的月度预算表，按分类汇总支出。」（`f599aac6-6349-4ba0-a1d3-14da79dd8768`）。问题涉及表格 App 的值读取、宿主展示授权和交付清单三处；XLSX 文件本身没有丢失。

## 实际会话证据

- 成功任务为 `9bd716ce-f034-4695-944d-a850d93fb394`，文件在 `~/.moss/apps-data/moss.spreadsheets/instances/moss.spreadsheets--default/jobs/<任务 ID>/月度预算表.xlsx`。
- 原始 `preview.html` 包含 **34 处 `[object Object]`**。对应的 `workbook.json` 中，餐饮行的三项公式只有 `formula`，没有 `result`。
- 直接解包原始 XLSX，`分类预算!C5/D5/E5` 都有正确的 `<v>0</v>`。WPS 正常是因为工作簿缓存正确；坏的是独立生成的 HTML/JSON。
- 模型实际调用了 `moss_present`，并非忘记展示。返回 `ok:false`，资源错误是 `The resource App is not enabled in this session`。
- 随后的手动打开成功，持久化记录却是 `isResult:false`。这是既有“手动浏览不算交付成果”的规则，所以点击消息中的预览仍不能把它补进“结果”。
- 前两次任务都因“图表数值范围必须与标签等长且都是数值”失败。第二次预算已改成 0，公式的零值仍被读取为对象，图表因此失败；最后一次去掉图表才生成成功。首次输入还包含空预算，空值本身也不符合现有图表数值校验。

脱敏摘录和 XML 缓存见 [evidence.json](../output/excel-preview-audit-20261028/evidence.json)。没有修改原会话数据库、原工作簿或历史预览。

## 根因与修复

### 1. 表格 App 使用了会丢失假值的 ExcelJS 接口

ExcelJS 4.4 的 `FormulaValue._copyModel()` 使用 `if (value)` 复制字段。对于公式结果 `0`、`false`、`""`，`cell.value.result` 消失，但 `cell.result` 和内部写入 XLSX 的缓存仍在。旧预览函数退回整个 `cell.value` 对象，转成 HTML 时变成 `[object Object]`。

已在 `moss-apps/apps/spreadsheets/src/backend/engine.mjs` 改用公式单元格的 `cell.result`，同时修复 HTML、图表取值、JSON 导出和导入后编辑的公式缓存写回。共享公式使用 `cell.formula` 解析；没有缓存的导入公式显示公式文本，不伪造为 0。

界面复查还发现预览未使用 `numFmt`，导致日期变为 `46296`、百分比只显示 `0`。已增加 SSF 0.11.2 格式化预览，日期显示 `2026-10-01`、金额显示 `0.00`、使用率显示 `0.0%`；图表与公式继续使用数值，避免把格式化字符串送进计算。验证也覆盖导入 XLSX 后公式缓存变成 Date 对象的情况。

### 2. 展示入口没有采用 App 的有效作用域

`ui/src/main.mjs` 的旧检查只接受 `sessionRecord.appIds.includes(provider.appId)`。表格 App 已是全局常驻工具，因此可以生成文件，但没有被手动加入会话列表，导致展示被拒绝。手动点击预览走另一条路径，不带该会话检查，因而表现不一致。

已将检查集中到 `resolveAppResourceFile(runtime, uri, session)`：全局启用的 provider 或当前会话选中的 provider 可用。使用 runtime 返回的有效 `toolScope`，包括用户覆盖设置；禁用、未授权、重复 provider 和 App 数据目录边界校验仍生效。

### 3. 交付清单只有 HTML，原始文件没有登记

`moss-apps/packages/creation-apps/src/index.mjs` 原来的 `result.presentation.items` 只有 `works://` 预览引用，XLSX 仅出现在另一份 `downloads` 清单。即使修好授权，右侧也只会登记预览。

已让交付清单同时包含主预览和原文件（supporting），排除内部 JSON。表格任务现在登记两个结果：预览与 XLSX。

### 工作区为什么仍为空

App 的任务文件写入 App 数据目录，工作区文件树只列当前会话 workspace。现有 `spreadsheet_export` 会让用户选择导出目录；生成任务不会自动复制到工作区。这是存储设计，不是文件创建失败，也不是 `moss_present` 应隐式执行的文件搬运。

本次修复保证原文件进入结果列表，未引入自动复制。若产品要求“每个成果都在工作区”，应明确增加统一的成果落盘步骤：将原文件安全导出到 workspace、处理重名并持久化来源关系，再登记该路径。不要让每个预览组件各自复制，也不要将是否写入工作区交给模型猜测。

## REA 对照 Codex 桌面实现

检查的是本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 内的 Codex 桌面相关前端产物；只做静态分析，没有推断远端服务行为。

REA 对已有哈希校验的两个 JS 文件重新分析成功（57,878 个 AST 节点、0 解析失败）：

- `artifact-tab-content.electron-9650652b6e42.js`：读取 XLSX 字节后导入为 spreadsheet/Workbook；导入的本地作品记录包含 `publicFilePath`、`workspaceRoot`、`publicFileHash`。导出先应用变更并 `recalculate()`，再生成 XLSX 字节。
- `artifact-session-tab-content.electron-232eac6007dd.js`：通过 `artifactRef` 打开作品会话，验证 kind，再解码 `initialWorkbookProto`，交给工作簿预览器。
- 侧栏通过 `openArtifactSidePanelTab` 打开已标识的作品。文件实体、作品身份、预览及编辑状态分开管理。

因此，Moss 现有“资源 provider + 持久结果登记 + 预览”方向可继续使用。此次应修正资源授权、完整交付清单和表格值读取，不需要因为 HTML 中出现对象字符串就替换整个结果展示工具。静态证据不能证明 Codex 一定由某个特定工具自动收集所有生成文件。

完整 ASAR 分析碰到一个不相关的 unpacked 原生模块完整性不一致；未忽略该校验执行原生模块，改为分析已校验的 JS 源文件。文件及哈希来源见 [manifest.json](../output/moss-conversation-design-20261028/manifest.json)，REA 结果见 [rea-display-sources.json](../output/excel-preview-audit-20261028/rea-display-sources.json)。

## 验证与生效范围

- 宿主资源授权、结果登记/恢复及展示生命周期：24 个测试通过。
- 表格 App：3 个测试通过，包含零值、false、空字符串、新建图表、读取和导入修改；新包通过 backend 握手。
- 共享交付清单影响的 PPT/模板：3 个测试通过。
- UI TypeScript 检查通过。
- 真正启动隔离 Electron 的展示冒烟测试通过：文件预览、编辑、未保存草稿转移、独立窗口保存、工作区版本和目录导航。首次运行被当前开发桌面的单实例锁阻挡；修复测试夹具的 Chromium userData 隔离后通过，没有关闭用户的桌面。
- 对原会话输入使用新包执行真实 native create/status，再通过真实资源解析、结果服务和 React 组件检查会话内与右侧预览。脚本、截图和结果保存在 [审计目录](../output/excel-preview-audit-20261028/)。传输与会话外框使用夹具；不等同于在用户当前会话中重新跑模型。
- 下载 URL 返回的 XLSX 与磁盘生成文件逐字节一致；刷新后重新打开“结果”仍保留两项；窄窗口及深色预览通过文字校验和截图检查。详见 [validation.json](../output/excel-preview-audit-20261028/validation.json)、[预览截图](../output/excel-preview-audit-20261028/preview-fixed.png) 和 [结果截图](../output/excel-preview-audit-20261028/results-fixed.png)。

修改在 `moss` 与相邻 `moss-apps` 两个源码仓库。已重新构建表格 App 的 ZIP；尚未替换正在运行的 App，也未重启用户的 Moss。现有 App 安装和旧任务 HTML 不会因为源码修改自动更新；使用新包需更新安装并重启宿主，旧成果需重新生成预览/重新登记。内置 App 当前只做首次安装，不能把重启误当成现有 App 的自动升级。
