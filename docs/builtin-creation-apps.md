# 主会话内置创作 Apps

本批启用六个内置 App：Visualization、文档创作、PDF 创作、表格、演示文稿、模板。具体清单见 `packages/app-sdk/src/builtin-apps.json`。
所有 App 源码位于 `../moss-apps`；Moss Core 提供通用宿主，不包含具体图表引擎或创作模板。

## 使用体验

用户在主会话说“用可调节的演示解释复利”。模型直接获得常驻的可视化工具，并从全局 App skill 读取生成规范和模板，创建作品。
成功后调用现有 `moss_present` 动态展开右侧，并在回复使用实际返回的 `displayMarkdown`；交互 HTML 使用 `moss-visualization`，Office 使用原始文件引用。
消息和右侧都是同一作品的可交互展示，滑块与筛选无需模型请求，交互状态按会话和版本保存、同步。

宿主只提供“标注修改”：选择元素、文字或框选区域，在选区旁填写要求，直接发送至当前主会话。会话显示“1 处标注”卡片；作品引用、版本、选区与当前状态独立传递给模型，不填入用户输入框。已有草稿保留，忙碌时排队，失败可重试。正常工具栏没有“重新载入”或整体“继续修改”。
模型修改时创建带 `parentId` 的新任务；旧文件和消息不变。再次 `moss_present` 展示新版本，尊重固定内容、关闭跟随和用户选择。

App 无自定义工作台。从“插件”（原“常用”）或应用列表“打开”进入 Core 通用详情页：名称、开发者、简介与试用示例，下方依次是基本信息、应用设置、技能、MCP 服务、工具、资源与展示能力；无内容的模块不显示。点击技能在右侧读取包内声明的 SKILL.md。
可视化默认全局常驻，不需要在主会话手动选择 App；“试用”和示例返回主会话，保留已有草稿，示例只填入自然语言，不自动发送。
详情页可启停、切换“全局按需 / 全局常驻 / 按会话选择”及管理权限。停用后仍可打开详情页并重新启用，读取信息和技能不启动 App 后端。
App 可独立扩充 skill、运行说明、HTML/CSS/JS 模板及数据转换功能，无需增加 App 专属页面。

## 已确认的后续统一要求（2026-10-28）

- 所有 App 后续统一采用上述详情入口；从“常用”点击与“打开 App”必须展示同一个详情页。参考用户提供的 `~/Downloads/126.jpeg` 和 `127.jpeg`。
- 本次先接入可视化及无独立 UI 的 App。已有业务工作台和设置页暂保留现有导航，后续迁移时从详情页进入，不能直接移除已有能力。
- App 提供声明式介绍、自然语言示例与技能内容，Core 负责统一渲染；不要求 App 编写介绍页 UI。`overview.description` / `overview.examples` 为可选展示元数据，旧 Host 可忽略。
- 用户的主要工作留在主会话和右侧成果区。不要把资源 URI、坐标或 JSON 拼到用户可见的输入框。
- 标注修改的目标交互：点选/文字选择/框选 → 选区旁输入 → 直接发送至当前主会话，显示简洁的“1 处标注”；定位信息和作品版本作为后台上下文。整体修改在主会话输入，不提供整体“继续修改”按钮。
- 上一条已实现并通过真实组件浏览器测试；后续 App 使用同一宿主标注能力，不复制编辑工作台。

## 通用宿主接口

- 资源 provider 返回 `presentation.type = interactive-html`，宿主在沙盒 iframe 展示；普通 HTML 预览保持原行为。
- `window.mossVisualization.getState()` / `setState(json)`：保存至当前会话和作品版本，最多 16 KiB UTF-8 JSON。
- `requestFollowUp(prompt)`：在触发位置请求宿主显示标注输入框，用户确认后进入当前会话队列；页面调用本身不自动发送。
- `moss:state` 事件：同步其他展示位置的选择；明暗主题由宿主同步。
- iframe 使用 `allow-scripts`，不开放同源、父页面或宿主工具，CSP 限制连接和外部资源加载。宿主校验消息来源窗口、通道及实例 token。
- 完整作品最多 2 MiB；超限报错，不运行截断的脚本。只有作品运行出错时才显示“重试”。

能力、图表和模板在 App 中；展示、会话输入、主题和成果导航在 Moss 中。
导出 HTML 可在普通浏览器离线操作；与主会话有关的按钮在独立文件中隐藏。

## 打包和验证

从 `moss-apps` 执行 `node scripts/package-app.mjs --app moss.visualize`。
App 在 `moss-apps` 仓库独立提交、构建、签名并发布。发布完成后，在 `packages/app-sdk/src/builtin-apps.json` 的 `versions` 中填写每个内置 App 的精确版本；Moss 打包只下载这些版本的发布 ZIP 并放入安装包，不检出或构建 App 源码，也不自动选择最新版本。下载时验证版本、平台、SHA-256、签名和随包源码；缺少指定版本会使打包失败。

从 `moss/ui` 执行 `bun run apps:bundle` 可按相同规则下载并暂存内置包。Mac 和 Windows Release CI 自动执行此步骤。App 明确不支持目标平台时会记录到内置清单的 `omitted` 中。
Electron Builder 的 beforePack 自动下载并暂存指定版本的 App 发布包。

从 `moss/ui` 执行 `bun run test:visualization`，需在相邻 moss-apps 安装 Playwright 和 Chromium，或通过 `PLAYWRIGHT_MODULE` 指定 Playwright 模块。
该验证安装真实 ZIP、运行真实后端、资源解析和成果服务，并构建生产版 React 组件进行浏览器交互；只有传输与会话外框是测试夹具。
验证生成、模板、全局 skill、右侧自动展示、状态同步与重开、带隐藏上下文的选区标注、版本保留、用户固定、错误、隔离、主题、窄屏及导出。
截图、导出作品和验证报告输出至 `output/visualization-integration`。

还需执行 `bun run check` 和 App 自身测试。浏览器集成验证不等同于真实模型完整会话测试，也不等同于完整桌面安装包验收。

详情页验证：`bun run test:app-details`，使用真实 ZIP、App Runtime 和信息/设置 IPC，检查常用/应用列表入口、导航历史、技能预览、启停、作用域、草稿保留及深浅色/窄屏。页面外框和传输为测试夹具。截图与报告在 `output/app-details`。

## 工具加载策略（2026-10-28）

Manifest 用 toolScope 表达 global/session，用 toolLoading 表达 always/on-demand。旧包默认按需。详情页组合展示三种模式：全局按需可被模型搜索，全局常驻在初始工具集合提供完整 schema，按会话选择只在选中后加载。可视化 0.1.2 默认 global + always。

用户覆盖写入 App Runtime 的 app-tool-scopes.json，按 owner/App 隔离，不修改签名包；作用域和加载模式一起原子保存。禁用、实例可用性、权限和服务选择仍先执行，常驻不绕过这些限制。修改后刷新会话工具策略，正在运行的会话在后续轮次采用新策略。全局常驻在工具选择器中显示已可用，无需重复勾选。

技能是中文适配版，非逐字翻译。原版创作规范已补到 App 的 SKILL.md 和 references/design.md，宿主差异记录于 references/adaptation.md，尤其是 CDN/样式库、状态私有字段和宽屏标记当前不等价。

## App 工具名称

内置 App 的原生工具与 MCP 工具按声明名称注册（例如 visualize_create），Core 工具也保持原名。非内置 App 统一增加 `appname_` 前缀：取稳定 App ID 的最后一段并去掉分隔符，例如 `moss.qq-mail` 的 `SendMessage` 注册为 `qqmail_SendMessage`，不使用本地化显示名称。内置清单同时用于打包与命名，不能仅凭 `moss.` 发布者前缀判定内置。超过 API 64 字符限制时保留截断名称及稳定指纹。

内部 App ID、contribution ID 和 MCP 服务归属仍负责路由与权限，MCP 调用继续使用上游原始工具名。同一工具重复进入工具池时只保留一次；按当前会话可用范围过滤后，仍然重名的不同来源会明确报错，不静默覆盖。旧的带归属前缀权限规则与工具白名单继续按原 App 匹配，但不会注册旧名别名；内置 `SendMessage` 的授权不会匹配 `qqmail_SendMessage`。

工具名称与来源分别展示：主会话、App 工具清单显示“可视化 · App”“浏览器 · MCP”等来源。每次调用的来源按调用 ID 写入独立的 tool_sources 元数据，随流式事件、完成消息和历史恢复传递，不进入模型 API 的消息内容。没有记录来源的旧调用显示“来源未记录”，不根据当前安装状态猜测历史归属。

详情页按「基本信息、应用设置、技能、MCP 服务、工具、资源与展示能力」排序，使用相同的标题、分隔线和行间距。MCP 服务与工具分开，工具统一显示来源；资源模块描述 App 声明的可引用资源和小组件，不承载业务工作台。设置与工具信息默认展开，顶部不提供展开设置的齿轮；没有内容的区域不展示。详情页不再嵌入运行管理，运行管理保留在应用管理中。


## 六个内置 App（2026-10-28）

| Codex 插件 | Moss App | 实际能力 | 展示与适配边界 |
|---|---|---|---|
| visualize | moss.visualize | HTML 交互演示、数据图表、状态同步、标注修改 | 沙盒交互 HTML |
| documents | moss.document | Markdown 创作 DOCX/PDF/HTML/EPUB、已有格式转换、DOCX 原生修订和批注 | Word 内容预览、PDF 原生预览；修订定位需唯一且在同一文字片段，批注按段落定位 |
| pdf | moss.pdf | 中文 PDF 创作、页面合并/重排/旋转/拆分、文字提取、离线 OCR、表单填写/展平、逐页 PNG | PDF 使用宿主文件预览；逐页 PNG 用于核对，不宣称支持 HTML 式文字标注 |
| spreadsheets | moss.spreadsheets | 创建/读取 XLSX/CSV/TSV，公式重算，原生柱形/折线/饼图，按单元格修改 XLSX | 交互表格和新建图表预览；导入编辑保留原样式/图表，预览为数据视图 |
| presentations | moss.presentations | 原生可编辑文字/表格/图表/图片/形状/备注，读取和替换既有 PPTX 文字 | 新建幻灯片按布局预览；导入 PPTX 提供明确标注的内容预览 |
| template-creator | moss.templates | 保存参考文件和说明、文本占位符应用、更新版本、跨 App 复用参考 | 模板说明与参考内容预览；Office 模板需交给相应 App 生成成品 |

六个 App 均为 global + always，原生工具直接按声明名称加载，总计 33 个工具。没有 App 独立工作台，也没有自建的整体“继续修改”按钮。HTML 作品统一使用宿主选区标注；Office 和 PDF 使用宿主分页阅读器，生成作品支持页码与区域标注。App 内的工具、技能和资源声明展示在通用详情页。

依赖随包交付：文档沿用 Pandoc/Typst；PDF 沿用 pdf-lib、PDF.js、Canvas、Tesseract；表格使用 ExcelJS/HyperFormula 及原生 OOXML 图表；PPT 使用 PptxGenJS；模板生成包含参考文件、代表页预览、复用规则的个人技能目录和 ZIP。无需 Codex 私有 artifact-tool 或 Codex 容器运行时。

这些技能是面向 Moss 的功能适配，不是原文逐字翻译。每个技能附来源版本、源文件摘要和宿主差异。Google Docs/Sheets/Slides 连接、Excel 实时控制等能力需要外部连接，未伪装为本地 App 的能力。内容预览不能代替 Word/PowerPoint 原生排版核验；Office 通过 LibreOffice 渲染实际文件，复杂字体、动画和专有对象仍可能与 Microsoft Office 不同。

文件始终写入新的任务目录。统一结果包含 workId、version、parentId、resourceUri、presentation、displayMarkdown 和 downloads。模板更新传 parentId=templateId。App resource provider 支持重新打开历史结果，导出同名文件自动生成新名称。表格公式报错、找不到修改目标、模板缺少变量都会明确失败。

限制：表格最多 30 个工作表、100000 单元格；预览最多显示 300 行/40 列。PPT 最多 80 页；既有 PPTX 替换定位到同一文字片段。交互 HTML 最大 2 MiB。文档和 PDF 当前声明 darwin-arm64/linux-x64；其他四个 App 为通用包，打包时按目标平台筛选并记录 omitted。当前实际验证平台为 darwin-arm64。

## 本批验证和演示

- `cd ../moss-apps && node scripts/package-app.mjs --app <App ID>`：独立源码快照安装依赖、check/test/build、后端握手、ZIP 和校验信息。
- `cd ui && bun run apps:bundle`：下载版本清单中已发布的内置 App 包，校验后暂存，供 Moss 安装包内置。
- `cd ui && bun run test:creation-apps`：安装全部真实 ZIP，调用原生工具，检查跨 App 模板复用、版本、导出、资源、主会话和右侧展示、状态同步、标注、窄屏及详情页。
- `cd ui && bun run test:creation-desktop`：用独立配置启动真实 Electron，以 CDP 检查六个内置 App、技能、作用域持久化、启停、示例返回主会话及原生 PDF 预览。先运行 `test:creation-apps` 生成测试文件，两个脚本顺序执行。
- `cd ui && bun run test:creation-exports`：用独立 LibreOffice 配置打开真实 Word/Excel/PPT，转换 PDF 后检查页数、中文和公式结果，Poppler 生成核对图片。需要 LibreOffice 和 `pdftoppm`。
- `cd ui && node --test tests/builtin-apps.test.mjs`：校验内置包安装、恢复、平台筛选及用户选择保留。

浏览器集成使用真实 React 组件和宿主服务，传输和会话外框为夹具；另有真实 Electron 桌面 CDP 验证。两者均不调用模型、不继承用户凭据，不修改正在使用的 Moss 配置；仍不等同于真实模型完整会话或已签名安装包验收。

本轮已通过的检查：

- 六个真实 ZIP 安装与重复同步，33 个不带 App 前缀的全局常驻工具、六个技能；源码与包内源码核对，只有文档/PDF 的目标平台字段按打包规则收窄。
- 五种 HTML 成果分别对主会话和右侧沙盒建立 CDP 会话，验证内容、独立来源、布局和截图；原生鼠标事件切页和发送标注；状态同步、重开、深色和窄屏均通过，未捕获 Runtime 异常。
- 独立 Electron 自动安装六个 App，统一详情页和技能可读；全局按需在刷新后保留，按会话/全局常驻可切换，停用可恢复；示例只填自然语言，不自动发送；PDF 在宿主原生查看器显示中文页面。
- Word 修订/批注、两条中文 PDF 生成路径、Excel 公式与图表、可编辑 PPT、模板跨 App 交接及原文件保留。LibreOffice 打开 Word 1 页、Excel 2 页、PPT 2 页；PDF.js 检查中文和结余 42,000，Poppler 图片核对排版。PDF 字体已改为完整静态 TTF 嵌入，回归检查逐个中文字形确实绘制。

输出、截图、可下载示例和报告保存在 `output/creation-apps/`；真实桌面证据在 `output/creation-desktop-cdp/`。其中 `validation.json` 记录测试范围，`native-validation.json` 记录实际导出文件摘要。表格内置包已包含 0.1.1 的零值公式和数字格式修复。

可直接在主会话演示：

1. “写一份项目周报，包含本周成果、风险、下周计划，生成可编辑 Word 并展示。”
2. “把这份报告生成 PDF，检查中文显示，并给我第一页预览。”
3. “创建季度预算 Excel，收入 12 万、支出 7.8 万，结余用公式计算，添加收入与支出柱形图。”
4. “根据预算做两页 PPT，第一页展示图表和关键指标，第二页说明下一步计划，保留可编辑图表。”
5. “把这份周报保存成模板，以后保留结构，只替换每周内容。”
6. “用可调节的演示解释复利，让我比较时间和利率对收益的影响。”

## 创作 App 身份（2026-10-29）

文档创作使用 `moss.document`，PDF 创作使用 `moss.pdf`。两者独立于旧版 `moss.document-converter`（文档格式转换）和 `moss.pdf-tools`（PDF 工作台），不复用旧版安装状态与数据。模板交接、内置打包和工具归属统一使用新 ID；原生工具名称仍为 `document_*` 与 `pdf_*`。


## Office 页面预览与个人模板技能（2026-10-29）

本轮参考本机 Codex 逆向产物 `pdf-preview-panel` 的分页阅读、缩略图、缩放及文档选区标注交互，使用 Moss 自有实现。没有引入 Codex 私有运行时。以下行为取代前述初版的 HTML Office 预览描述。

- 文档 0.4.0、表格 0.2.0、演示文稿 0.2.0、模板 0.2.1 保存在 `moss-apps`；打包时自动附带。
- Office 结果主引用指向原始可编辑文件。Core 用 LibreOffice 转换，PDF.js 分页显示，支持缩略图、前后翻页、页码跳转、适合宽度/整页/比例缩放、文字选择和重新打开时恢复阅读位置。Excel 可切换页面版式和工作表。
- Office/PDF 的 App 资源支持选区旁输入要求；标注携带原文件、版本、页码及 PDF 点坐标进入现有主会话队列，仍显示简洁的「1 处标注」。不增加整体继续修改按钮。
- 转换使用独立临时 LibreOffice profile，不占用用户已打开的实例；保留原生打印设置，按路径与文件元数据缓存，文件变化或输出失效自动重建。异步加载丢弃已切换文件的旧结果。
- App 在生成原件后创建页面 PDF 和首批 PNG（默认 8 页，剩余页标记 partial，可用 *_verify 分批续跑）。`result.visualReview` 提供源文件 SHA-256、总页数、各页图片路径及状态。`visuallyVerified: false` 明确模型还须查看图片，不能将转换成功冒充视觉核验完成。
- 完整 Office 渲染需要主机安装 LibreOffice，逐页 PNG 需要 Poppler；不随 App 捆绑这些系统程序。没有依赖时保留原件、提供基础预览并明确核验缺口。已有 PDF 可交给 PDF App 的 render 模式。PDF.js worker、字体、CMap 和 WASM 随 Moss 前端离线打包。
- 保存模板返回可移植的 `skillBundle`，包含 SKILL.md、参考原件、代表页预览和复用要求。模型继续使用内置 skill-installer 的 inspect→digest 安装流程，确认个人技能可发现后交付。生成 ZIP 本身不等于安装；App 返回 `installed: false`。更新保留旧任务，安装器拒绝覆盖已有个人修改，需沿用既有备份/恢复流程。
- Web PDF 的版本号使用独立查询参数，保留中文和特殊文件名。PDF.js 原生链接层负责旋转、裁剪及链接范围，外链通过 Moss 打开，目录和页内链接在现有阅读器跳转；无效目标显示提示，框选批注时链接不响应鼠标。适合宽度和整页允许低于 10% 的缩放比例，避免超大页面被裁切。
- 模板更新持久化并继承 `skillDescription`，兼容旧任务的 input/skillBundle；只有显式传入新的说明才替换原触发范围。

验证命令：`cd ui && bun run test:office-preview`。使用真实 ZIP/App Runtime 创建原件，随后用隔离 Electron/CDP 打开真实资源，验证首次渲染、翻页、缩放、重开、工作表、局部标注，以及模板技能安装和发现。标注请求使用本地 HTTP 模型夹具，不调用在线付费模型。截图、页面 PNG 和验证记录输出到 `output/office-preview-cdp/`。

PDF 适配回归：`cd ui && bun run test:pdf-preview`，需要相邻 moss-apps 仓库的 Playwright、pdf-lib 及 Chromium（可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定）。测试真实 React/PDF.js 组件、与 Web Host 等价的文件接口、特殊文件名版本参数、实际鼠标链接点击、旋转裁剪、键盘导航、局部批注和 12000×9000 pt 页面，输出到 `output/office-preview-fixes/`。外链出口和批注接收端使用本地夹具。


本轮验证通过：UI TypeScript 检查与生产构建；分页、缓存、文件来源和标注边界测试；四个新版 App 的隔离构建/测试/握手；真实 Office 输出渲染；创作流程浏览器回归；Office 专项 Electron CDP（含真实文字选择、框选主会话回传、重开、损坏 PDF 恢复、窄屏/深色、个人模板技能安装与保护）。详细检查项以 `output/office-preview-cdp/validation.json` 为准；未进行 Windows/Linux 桌面验收或签名安装包发布。

## 主会话文档工作流补充（2026-10-29）

文档 0.4.1、PDF 0.3.1、表格 0.2.1、演示文稿 0.3.0 新增原文引用与核验工具。右侧统一显示版本、核验状态和修改对比入口；Word/PDF/PPT 引文与 Excel 区域可从主会话直接定位。PPT 导入编辑扩展为对象级局部修改，Word 修订支持同段落跨文字片段。详情、支持范围及验证见 [office-conversation-workflow.md](office-conversation-workflow.md)。Excel 实时控制按用户决定暂缓。

文档 0.4.2、PDF 0.3.2、表格 0.2.2、演示文稿 0.3.1 进一步增加段落内容对齐、文字/表格变化高亮、PPT 图片前后预览、检查问题点击定位和可续跑的分批页图。主会话右侧优先复用与源文件匹配的 App 页面 PDF；具体限制及测试记录见上述工作流文档。

## 内置升级与当前版本（2026-10-29）

内置同步已支持升级既有的原版内置安装，而不仅是首次安装。当前包为文档 0.4.3、PDF 0.3.3、表格 0.2.3、演示文稿 0.3.2、模板 0.2.2；其他内置包保持各自版本。完整校验通过后才升级，保留权限、停用状态、实例和用户内容；本地修改、手动卸载及回退不会被覆盖。激活失败按安装修订号条件回退，较新或市场来源的版本保持原状。

主会话右侧的工作表显示文件中的数字格式与公式，核验进度自动刷新。具体行为和测试入口见 `office-conversation-workflow.md` 的第三轮记录。
