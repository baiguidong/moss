# Office 导入架构对照

## 结论

Codex 的 Office 预览不是调用桌面 Office，也不是把 LibreOffice 静默打包进应用。当前逆向样本显示，它在 worker 中启动 .NET WASM，加载 `DocumentFormat.OpenXml` 和自有 `Walnut` 程序集，把 OOXML 导入 protobuf 形式的内部模型，再由 document、workbook 和 presentation renderer 展示。

这条链路可以移植到 Moss，但不能把 ChatGPT.app 中的程序集、WASM 或 renderer 直接复制进来。那些是目标应用的构建产物；Moss 需要自己的 OpenXML 依赖、模型 schema、worker 和 renderer。

## 逆向证据

`output/codex-pptx-import-audit-20261030/readable/artifact-preview-loaders.electron-2963f03f954e.js` 的导入分发为：

| 格式 | 导入入口 | 结果模型 |
|---|---|---|
| `docx` | `DocxReader.ExtractDocxProto(bytes, false)` | `Document.decode(proto)` |
| `pptx` | `PptxReader.ExtractSlidesProto(bytes, false)` | `Presentation.decode(proto)` |
| `xlsx` | `XlsxReader.ExtractXlsxProto(bytes, false)` | `Workbook.decode(proto)` |
| `csv/tsv` | JS workbook `fromCSV` | workbook proto |

同一文件还会按需加载 `document-*`、`presentation-*`、`spreadsheet-*` renderer。WASM 资源包含 `DocumentFormat.OpenXml`、`Walnut`、.NET runtime 和基础类库，说明导入发生在应用资源内的 worker/WASM 运行时，而不是用户的本机 LibreOffice。

## Moss 当前状态

Moss 已经具备“浏览器内解析、内部传输、renderer 展示”的第一阶段：

- DOCX/PPTX 使用 OFV 内置的 `docx-preview`、`pptx-renderer` 和本地 OpenXML ZIP 解析，不启动 `soffice`。
- XLSX/XLS/XLSM/XLSB/ODS 使用主进程的 `excel-json`，把单元格、公式、显示值、合并、图片和样式传给 `SpreadsheetGrid`。
- 已随创作资源保存的高保真 PDF 直接交给 PDF.js；普通工作区文件不会临时转换成 PDF。
- LibreOffice 仍保留为可选的创作核验、导出和已有 PDF 生成链路。

因此，当前版本已经解决“普通用户必须安装 LibreOffice”和“预览时桌面弹出 LibreOffice”的问题，但它的模型层还没有达到 Codex 的统一 OpenXML/.NET/WASM 内部模型。

## 改造量

完整复刻属于中大型改造，至少包含四个独立部分：

1. 在 worker 中加入可离线加载的 .NET WASM runtime 和自建 OpenXML importer，处理字体、关系、批注、图表、主题、分页和二进制兼容边界。
2. 定义 Moss 自己的版本化内部模型（文档块、段落、页面、表格、工作表、单元格、幻灯片、形状、图片和诊断信息），不能继续让 Viewer 直接依赖 SheetJS 或 XML 节点。
3. 为三类模型编写统一 renderer、定位协议和虚拟化策略，并把编辑/请求修改绑定到模型中的稳定对象 ID。
4. 加入 WASM 资源完整性、worker 取消、内存上限、跨平台构建和大文件回归；否则浏览器解析失败会卡住桌面 UI。

仅把一个现成的 .NET DLL 放进 `dist` 不会得到 Codex 的能力：没有配套 runtime、资源加载器、JS interop、模型编码和 renderer，它不能在 Chromium 中运行。

## 推荐迁移顺序

先保留当前可用链路，按模型边界逐步替换：

1. **先统一接口。** 把现有 `excel-json`、`ppt-json` 和 DOCX 读取封装为 `moss.office-model/v1` importer contract，返回 `kind`、`format`、`revision`、`diagnostics` 和模型数据；Viewer 只接收模型，不再直接知道解析库名称。
2. **先迁移 XLSX。** 现有 `SpreadsheetGrid` 已有冻结窗格、格式、合并、图片、条件格式和引用定位，最适合先替换为 OpenXML/WASM 导入，风险小且能马上验证性能与模型兼容。
3. **再迁移 DOCX。** 以页面、段落、表格、图片和文本框为最小模型，保留 OFV 作为无法导入时的降级 renderer。
4. **最后迁移 PPTX。** 形状、主题、图表和嵌入对象最多，先接入读取模型，再逐步增加可编辑对象和动画之外的静态布局。

在自建 importer 完成前，OFV 和当前工作表网格继续作为默认 renderer；LibreOffice 只在用户明确需要高保真转换或资源本来就携带 PDF 时参与。这样每一步都能独立发布和回退，不会把一次大改造变成新的安装前置条件。

## TODO：复杂排版评估后的后续工作

复杂排版实测记录在 [`office-complex-preview-review-20261030.md`](./office-complex-preview-review-20261030.md)。当前结论是：常见的 DOCX、PPTX、XLSX 和 PDF 内容已经可以在浏览器内打开，但这还不能证明分页、主题继承和专有对象与 Codex 或桌面 Office 一致。因此先完成低成本问题和可重复验收，再决定是否投入 .NET/WASM importer。

| 优先级 | TODO | 验收条件 |
|---|---|---|
| P1 | 修复带 `#`、`%`、`&`、`?` 等字符的 Office 文件名在 OFV 中被误判为格式未知的问题；文件 URL、传给 viewer 的显示名和扩展名需要分别处理。 | 复杂 DOCX/PPTX 使用原始特殊文件名时，正文、图片和表格均能加载；不依赖改名或 LibreOffice。 |
| P1 | 为 DOCX/PPTX 模型补充页面边界、页码、稳定对象 ID 和诊断信息。当前 OFV 能显示连续内容，但无法提供 Codex 风格的逐页定位和版式差异报告。 | 同一文件在不同窗口尺寸下页数、页面定位和对象引用稳定；长文档不会把所有内容当成一个未分页容器。 |
| P1 | 建立复杂排版回归样本和视觉对比流水线，覆盖中英文混排、字体回退、页眉页脚、分页、表格跨页、图片裁剪、主题、母版、图表、SmartArt、批注和超链接。 | 每个样本同时保存解析结果、截图、加载耗时和失败原因；与基线比较时能区分内容丢失、版式降级和可接受字体差异。 |
| P1 | 评估 Excel 工作表与页面版式的边界：隐藏页、打印区域、分页符、重复标题、条件格式、图表和公式错误。 | 工作表模式完整保留值、公式和定位；没有缓存 PDF 时明确显示页面版式不可用；有缓存 PDF 时切换不丢状态。 |
| P2 | 做 XLSX 的 OpenXML/WASM importer proof of concept，先映射到 `moss.office-model/v1`，保留现有 `SpreadsheetGrid` 作为 renderer。 | 与当前 SheetJS 结果逐单元格对照，覆盖样式、合并、图片、条件格式、日期系统和公式缓存；失败时能回退。 |
| P2 | 做 DOCX importer proof of concept，先覆盖页面、段落、表格、图片、页眉页脚和文本框。 | 与 OFV/LibreOffice 基线逐页对照，记录字体度量、换行和分页差异；不影响现有普通预览。 |
| P2 | 做 PPTX importer proof of concept，先覆盖主题、母版、文本框、图片、表格、图表和嵌入资源。 | 多页、竖版和窄窗口下页面尺寸、对象位置及资源关系稳定；复杂对象缺失时给出诊断。 |
| P2 | 设计 worker/WASM 的取消、内存上限、资源完整性和跨平台加载策略。 | 大文件解析不会阻塞 Electron UI；取消、超时和损坏包都能回收 worker 并显示可操作错误。 |
| P3 | 补齐旧版二进制 Office、ODF、宏、外部链接、数字签名和密码文件的产品策略。 | 每种格式明确标为完整、基础、结构或系统应用打开，并有对应回归样本。 |

在 P1 的文件名和回归基线问题解决前，不启动完整 .NET/WASM 迁移；如果真实样本仍主要是“内容正确但分页/对象定位不够”，再按 XLSX → DOCX → PPTX 的顺序推进。
