# 配置驱动的插件详情

Core 提供统一详情模板，不按 App ID 判断展示方式，也不包含 DBX 或可视化的业务文案。
App 维护内容和能力声明，Core 根据配置决定显示哪些区域。使用说明合并在介绍中，不单独设标题或折叠卡片。详情页按「基本信息 → 应用设置 → 技能 → MCP 服务 → 工具 → 资源与展示能力」排列。所有模块复用同一套标题、分隔线、文字大小与行间距，默认展开，没有内容的模块不展示。顶部保留介绍与自然语言试用示例；带独立 UI 的 App 在“试用”旁统一显示“打开”，进入 App 工作区。通用操作统一放在顶部“管理”菜单，正文不再展示“应用管理”区块。插件卡片先打开统一详情，原有“更多”快捷入口和显式路由仍直达 App。

MCP 服务模块使用与技能相同的整行入口，展示服务名称、连接状态和右侧箭头；点击后在右侧面板查看连接设置和主动检查服务，主列表不放操作按钮。工具数量在工具模块展示。工具模块合并 App 原生工具和 MCP 工具，统一展示名称、来源、用途、搜索、可展开说明及状态，原生工具保留操作类型。资源与展示能力仅依据资源提供器及小组件声明展示，不读取资源或加载 App 页面，也不凭资源类型推断交互、导出等能力。权限归入应用设置，版本归入基本信息，运行管理从顶部“管理 → 后台服务”打开。

App 打开后的 Host 顶栏只提供返回详情、应用名称与刷新页面，不再显示设置、迭代或 AI 工具清单，也不主动检查 MCP 服务；独立窗口的右键迭代入口同样移除。全局设置中的 App 页面保留业务页面切换和返回管理的链接，不重复提供通用设置按钮。旧包注入的保留路由 `#/moss-settings` 不再进入设置列表或作为默认工作页，历史主窗口路由转到插件详情；无需按 App ID 处理或重新打包已安装 App。普通 App 的其余声明式设置页面在详情的“应用设置”中打开，继续遵守设置与页面权限；`navigation.location: "details"` 的多页面业务导航仍由 App 工作区提供。

| App 配置 | Core 展示 |
| --- | --- |
| `displayName`、`icon`、`publisher`、`description` | 名称、图标、开发者和简介 |
| `overview.description`、`overview.examples` | 详细介绍、可点击的自然语言示例 |
| `mcpApp.presentation` | 兼容声明式 MCP App 的标题、示例和使用说明；优先使用 `overview.examples` |
| `contributes.skills` | 技能列表，点击后在右侧读取声明的技能文件 |
| `navigation.location: "details"` | 从插件入口打开 Core 详情，保留按声明打开的专用页面 |
| `ui.entry`、`navigation` | 顶部“打开”进入声明的 App 页面；`ui.builtin: "mcp"` 不生成此入口 |
| `contributes.settings[].viewId` | 为详情型 App 解析业务页；只有一个顶部入口，多页面在 App 工作区内切换 |
| `contributes.settings[].form` | 声明式设置入口，点击后在右侧渲染保存 Action 的输入 Schema |
| `ui.builtin: "mcp"`、`mcpServices` | MCP 服务状态与检查；配置型 MCP App 提供连接设置，不加载 App UI |
| `agentTools`、MCP 工具目录 | 合并的工具清单，来源与名称分别展示 |
| `contributes.resourceProviders`、`contributes.widgets` | 可引用的资源、声明的创作能力与小组件展示方式 |
| `toolScope`、安装状态、权限声明 | 使用范围、启停和授权设置 |

所有 App 从“插件 → 常用”与应用列表的“打开”进入同一个 Core 详情页。停用或不兼容时仍可阅读详情；顶部 App 页面入口按安装状态和授权禁用。
内置 MCP App 不再出现在全局“设置 → Apps”；已有包的 `navigation: settings` 继续保留以兼容旧 Host。
其他自定义工作台在详情顶部按原有主路由打开；“更多”和显式深链仍保留直接进入工作台的能力。

打开详情只读取工具缓存与连接状态，不连接 MCP 服务，不自动发现工具，也不创建 webview/iframe。已有工具的名称、用途、搜索和数量直接展示在工具模块，也可主动点击“检查服务”。实际调用仍由会话运行时连接，工具目录继续持久化到原有缓存。

连接设置与技能说明复用 `AppDetailsSidePanel`：点击后在详情右侧展开，每次展示一个面板；窄窗口采用上下布局，表单独立滚动，保存按钮固定在底部。切换到技能会关闭连接设置，保存期间不能关闭或切换面板。

普通 MCP 使用 Core 原生表单，通过 `app:manage-mcp` 调用既有 MCP Host。Host 校验当前用户、App/实例/版本、配置型能力和权限，保留加密凭据、状态及生命周期约束。Core 不传入任意路径或 App 执行上下文。表单根据连接类型展示启动命令、逐项参数、环境变量或服务地址、请求头，支持公共目录、Git 路径、浏览器授权和清除授权；其他参数放在高级 JSON 中。环境变量和请求头可逐项添加、修改和删除；已保存的值不回显，留空保留原值，删行移除该项。全部服务输入通过校验后才开始保存，未改动的配置跳过写入，避免使工具缓存失效。

配置式 MCP/CLI 连接器在详情顶部的“连接设置”打开同一个右侧面板，由包内 `credentialSchema`、CLI/MCP 能力和认证声明决定展示字段、凭据创建、登录与授权操作，复用原有 `app:connector` 接口。查看详情不执行安装、登录或认证；授权按钮沿用独立授权会话流程，不占用当前项目会话。

带 Backend 的工具 App 可声明 `contributes.settings[].form: { readAction, saveAction }`，无需提供 `ui` 或视图路由，最低 Host API 为 3.21.0。两个 Action 必须在 Backend 中声明，`saveAction.inputSchema` 定义表单；读取返回 `{ values, configuredFields? }`。Core 支持标量字段、枚举、布尔值，以及按字段 `const/enum` 匹配的 `allOf/if/then/else` 条件分支；`title/description/examples` 提供文案，字符串 `contentMediaType: "text/plain"` 使用多行输入，`writeOnly` 字段不回显。已保存密钥通过 `configuredFields` 显示占位，留空保留的语义由 Backend 实现。`app:settings-form` 绑定当前版本、声明的 Action 和权限，经原有 Runtime 调用；保存配置与检查服务分开。网页操控的三种模式使用这套声明，Core 不包含其专用判断。

工具使用范围仅在外层基本信息设置；连接表单不展示服务开关、范围和排除工具，保存不会覆盖已有开关、排除项、密钥或全局加载方式，也不启动服务。
旧包中的 `ui.builtin: "mcp"` 是 Core 模板声明，不代表包里包含前端；保留旧 Host 兼容路由，新详情页不使用它。

“试用”和示例回到主会话；按会话使用的 App 自动加入选择，示例追加到已有草稿，不自动发送。

DBX 的源配置仍位于 `moss-apps/tool-apps/dbx/app.json`。其生成的 `app.moss.json` 与 `mcp.json` 继续提供元数据和原版服务启动配置，无需新增 DBX 专用前端。

验证：`cd ui && bun test tests/app-navigation.test.tsx tests/app-details.test.tsx`、`bun run check`。
实际 MCP 验证：先构建 renderer，再运行 `electron tests/mcp-details.electron.mjs`。
测试用 `MOSS_DBX_PACKAGE` 指定现有 DBX 包目录（默认本机已安装的 0.1.1），复用其中的原版 runtime，结合 App 仓库的最新配置生成临时包并安装至隔离 Profile，使用独立空数据库目录和只读配置，不发送模型请求。
截图和结果位于 `output/dbx-details`。

## 应用卡片与操作位置

插件 → Apps 默认打开市场，顶部固定提供“应用市场 / 已安装”切换。搜索、分类、卡片间距和字号与技能、专家保持一致；桌面端每行三张卡片，窄窗口降为两列或一列。从已安装应用详情返回时保留“已安装”页签。

市场与已安装共用卡片，只展示图标、名称、来源和简介，点击整张卡片进入详情。列表统一包含应用和工具，不再提供顶部“工具 / 应用”筛选，也不沿用该筛选的旧偏好。启用状态、连接状态、工具数量、版本、兼容性提示及所有操作都放在详情中，卡片不重复展示。市场详情承接安装、权限确认、可用版本与更新说明，返回时保留列表筛选和滚动位置。顶部“添加应用”保留本地 ZIP 安装。“内置应用”切换为同样的三列卡片列表；已安装项打开原有详情，未安装项在 Core 详情顶部恢复，版本和安装状态仅在详情展示。

| 原卡片操作 | 统一入口 |
| --- | --- |
| 打开 App UI | 详情顶部“打开”；普通 MCP 无此入口 |
| 在会话中使用 | 详情顶部“试用”，沿用会话选择及全局范围规则 |
| 认证 / 配置、重新授权、连接 / 授权 | 顶部“连接设置”；状态、凭据字段、文档链接、创建凭据、CLI 登录和授权由配置决定 |
| 启用 / 停用、范围、权限 | 详情“基本信息”和“应用设置” |
| 工具与技能能力弹层 | 详情“技能”和“工具”，只读取缓存 |
| 管理、后台配置、清除密钥、重启与日志 | 详情顶部“管理 → 后台服务”，保留原有配置校验与操作限制 |
| 版本历史与回滚 | 详情顶部“管理 → 版本历史”，展示时间、说明和当前版本；回滚前确认 |
| 更新版本 | 详情顶部“管理 → 更新应用”，打开应用市场 |
| 迭代 | 详情顶部“管理 → 迭代此 App”，遵循创作能力是否可用 |
| 删除 / 卸载 | 详情顶部“管理 → 卸载应用”，默认保留数据和凭据，可分别勾选删除；提交前确认 |
| 签名与更新时间 | 详情“基本信息” |

连接表单复用 Core 的标题、分隔线、字号、间距和圆角操作按钮。字段区独立滚动，底部保留主要操作；已保存的密钥不回显，输入框留空可保留。保存与连接授权分开执行，提交时阻止关闭或切换面板。版本和卸载失败显示在当前面板，可重试。

## 本轮迁移范围与保留 UI

2026-10-28 核对 `moss-apps/tool-apps` 的 121 份源配置：7 个普通 MCP 和 114 个配置式连接器均可由 Core 的详情页和右侧设置面板承接。普通 MCP 为 DBX、Draw.io、Excel、Filesystem、Git、MarkItDown、Sequential Thinking；连接器按配置自动展示，不写 App ID 分支。这是源配置覆盖范围，不代表本机安装的旧包已经全部更新。配置已声明内置 MCP/连接器的包可直接使用新 Core；仍带独立 UI 的旧包需要升级。本机分步思考旧版仍带自定义页面，本次生成 0.1.6 配置包替换。

网页操控 0.1.9 移除自定义前端，使用声明式浏览器连接表单，保留 MCP Backend、内置 Playwright/Chrome、扩展令牌和 CDP 模式。打开及保存设置不检查 MCP；主动检查刷新工具清单，实际操作时才启动专用浏览器。新版本不沿用旧版本工具目录，未改动的配置保存保留当前版本缓存。

剩余六个设置 App 已迁移至 Core 详情入口，业务 UI 从顶部“打开”按需进入完整工作区，不再列入全局「设置 → Apps」。普通 MCP 仍使用 Core 原生表单。新增契约与验收见 [自带 UI 的迁移实现](app-details-embedded-ui-plan.md)。

| 应用 | 新版本 | App 内保留的业务页面 |
| --- | --- | --- |
| MCP 管理（`moss.mcp`） | 0.1.15 | 管理服务：多连接增删改、凭据、OAuth、主动检查 |
| 电脑操控（`moss.computer-use`） | 0.2.3 | 系统权限与控制：系统授权、应用授权、控制启停 |
| 数据库查询（`moss.database`） | 0.2.3 | 数据库连接：连接编辑、凭据、只读策略、主动测试 |
| 飞书（`moss.feishu`） | 0.4.15 | 连接与配对、执行权限；进入 App 后切换 |
| 记忆（`moss.memory`） | 0.2.5 | 记忆图谱：实体、关系、检索与存储位置 |
| AI 自测（`moss.self-test`） | 0.1.21 | 自测工作台：用例、执行/停止、测试窗口、结果及报告 |

其他保留独立工作台 UI 的 19 个应用也统一使用详情顶部的“打开”入口，内部业务页面沿用原有实现：应用构建、审计中心、备份与恢复、Buddy 伴侣精灵、代码地图、本地数据工作台、开发工具、网盘、文件清理、HyperFrames 动画工坊、图片工具、语义知识库、知识库、音视频工坊、即时消息、TAKT 工作流、调用追踪、语音转写、工作流。

当前另有 7 个无独立 UI 的应用已在源码中接入通用详情页：文档、PDF、演示文稿、表格、模板、可视化、网页操控。这 7 个不计入 121 个普通 MCP/连接器的数量；本机是否生效还取决于实际安装的包和 Core 版本。

Host API 3.22 支持配置驱动的专用视图承载：Core 校验设置和视图声明、当前版本、启用及权限，复用既有隔离桥接。App 用 `view.setState({ dirty, busy })` 报告未保存和操作状态；返回与页面切换受保护，调整窗口尺寸不会重新加载页面。复杂业务继续由 App 实现，不要求 Core 知道每个 App 的内部结构。

补充验证：`bun test tests/mcp-connection-form.test.ts tests/connector-auth-flow.test.ts`、`electron tests/connector-authorization.electron.mjs`。后者验证连接器右侧面板、技能切换、凭据保存和独立授权会话，截图位于 `output/connector-details`。

浏览器迁移验证：`bun test tests/app-settings-form.test.tsx`、构建 renderer 后运行 `electron tests/browser-settings.electron.mjs`，使用真实包和隔离 Profile 检查分步思考入口、浏览器三种模式保存、凭据保留、工具目录及查看/保存不连接的行为。截图位于 `output/browser-settings`。App 仓库的 `node apps/browser-use/scripts/verify-host.mjs` 验证真实页面导航、填写、点击、截图及延迟启动 Chrome；`node scripts/verify-sequential-thinking.mjs` 验证真实工具、独立会话历史与重启恢复。

## 配置式连接器完整清单

以下 114 个连接器按现有配置使用 Core 通用详情和右侧连接设置，未逐个重写 App UI。此清单按源码目录统计，区别于本机已安装应用数量。

| 应用 | App ID |
| --- | --- |
| 铱云AI供应链 | `moss.77ircloud` |
| AI-HIVE | `moss.ai-hive` |
| 向日葵远程控制 | `moss.awesun` |
| 百度网盘 | `moss.baidu-netdisk` |
| 八爪鱼 | `moss.bazhuayu` |
| 北森AI · HR专家 | `moss.beisen-cli` |
| Bugly 质量概览 | `moss.bugly-token` |
| 扫描全能王 | `moss.camscanner-mcp` |
| Canva可画（中国） | `moss.canva` |
| Canva可画（海外） | `moss.canva-ai` |
| 水滴征信 | `moss.cisp-mcp` |
| 腾讯云 CloudBase | `moss.cloudbase` |
| CNB | `moss.cnb-api` |
| 携程问道 | `moss.ctrip-wendao` |
| DCS Cloud | `moss.dcs-cloud` |
| 美图设计室 AI设计 CLI | `moss.designkit-buddy-cli` |
| 钉钉 | `moss.dingtalk` |
| 深知可信工作台 | `moss.dknowc-mcp` |
| 夺冠蜂巢 | `moss.duoguan-fengchao` |
| EdgeOne Makers | `moss.edgeone-pages` |
| 弹性MapReduce | `moss.emr-query` |
| EzyJoin智慧会议 | `moss.ezjoin-meeting` |
| 同花顺法律AI助手 | `moss.fazhi-law` |
| 福帮手 | `moss.fbs-connector` |
| 飞书工具 | `moss.feishu-cli` |
| 粉笔 | `moss.fenbi-baokao-decision` |
| 进门投研 | `moss.finenter` |
| Flova | `moss.flova` |
| 福马AI外呼任务 | `moss.fuma-ai-callout` |
| 法研·法律法规检索 | `moss.fyopen-lawsearch` |
| Gangtise投研 | `moss.gangtise-mcp` |
| 高顿•实习就业助手 | `moss.gaodun-job` |
| 恒生聚源 MCP | `moss.gildata` |
| 新华三Cloudnet灵犀AI助手 | `moss.h3c-cloudnet` |
| 氚云 | `moss.h3yun-connector` |
| i人事AI·HR专家 | `moss.ihr-cli` |
| 极睿电商生图 | `moss.infimind-ecommerce-image` |
| 极睿视频 | `moss.infimind-video` |
| 零信任安全 iOA | `moss.ioa` |
| 金数据 | `moss.jinshuju` |
| 九数云BI | `moss.jiushuyun` |
| Kling AI（中国） | `moss.kling-ai-plugin` |
| Kling AI（海外） | `moss.kling-ai-plugin-ai` |
| 同花顺快查企业数据 | `moss.kuaicha-search` |
| LemonClaw | `moss.lemonclaw` |
| 乐享知识库 | `moss.lexiang` |
| Linear | `moss.linear-mcp` |
| 领星ERP | `moss.lingxing-mcp` |
| Linkfox 选品 | `moss.linkfox-product-selection` |
| Lovrabet CLI | `moss.lovrabet-cli` |
| MasterGo 莫高设计 | `moss.mastergo-vibe-mcp` |
| 芒果灵创 CLI | `moss.mglc` |
| 秒哒应用搭建 | `moss.miaoda` |
| Moka HR 智能体 | `moss.moka` |
| 晨星 Morningstar | `moss.morningstar` |
| 东方财富妙想MCP | `moss.mx-ds-mcp` |
| 摩知轮商标查询 | `moss.mzl-trademark` |
| 销售易CRM | `moss.neo-crm` |
| 网易邮箱 | `moss.netease-mail` |
| Notion | `moss.notion` |
| 及刻智能·时空数据MCP | `moss.opendata` |
| PandaData 金融数据 | `moss.pandadata` |
| 智慧芽专利&文献融合检索 | `moss.patsnap-search` |
| Picset AI 电商图片 | `moss.picset-commerce-images` |
| Picset AI 视频创作 | `moss.picset-video-generation` |
| 北大法宝·法律智能检索 | `moss.pkulaw` |
| OpenBoost 跨境数据 | `moss.proboost` |
| 企查查 | `moss.qcc-company` |
| 企查查·法律数据 | `moss.qcc-legal` |
| 轻流 | `moss.qingflow` |
| QQ邮箱 | `moss.qq-mail` |
| RAGFlow 企业知识库 | `moss.ragflow` |
| 致远互联协同办公服务 | `moss.seeyon-office-marketing-suite` |
| 用友智能服务（AI BaaS） | `moss.shanglv-mcp-gateway` |
| 商龙经营洞察 | `moss.shanlong-claw` |
| 纷享销客CRM | `moss.sharecrm` |
| ShareOne | `moss.shareone` |
| 上奇产业通-企业动态追踪 | `moss.sq-company-dynamic` |
| TDC 文化智能体 | `moss.tanyuan-assistant` |
| TAPD | `moss.tapd` |
| 同程程心 | `moss.tc-chengxin` |
| Tec-Do 2.0 广告与增长情报 | `moss.tec-do` |
| 腾讯文档 | `moss.tencent-docs` |
| 腾讯文档企业版 | `moss.tencent-docs-oa` |
| 腾讯健康NGES | `moss.tencent-health-nges` |
| 腾讯地图 | `moss.tencent-map` |
| 微云 | `moss.tencent-weiyun` |
| 腾讯营销投放 | `moss.tencentads` |
| TextIn xParse·智能文档解析 | `moss.textin-xparse` |
| TextIn xParse·智能文档解析 | `moss.textin-xparse-ai` |
| TikTok for Business | `moss.tiktok` |
| 腾讯会议 | `moss.tmeet` |
| 同舟金融研究 | `moss.tongzhou-fin-research` |
| 畅捷通T+ | `moss.tplus-api` |
| Tushare | `moss.tushare` |
| 天眼查 | `moss.tyc-mcp` |
| UU跑腿 | `moss.uupt` |
| 企业微信 | `moss.wecom` |
| 微盛企微管家SCRM | `moss.weisheng-scrm` |
| Wind 金融数据 | `moss.wind-finance` |
| 百智WiseNote | `moss.wisenote` |
| 威科先行 | `moss.wk-workbuddy` |
| 微盟 WOS CLI | `moss.woscli` |
| WPS知识库 | `moss.wps-knowledgebase` |
| 小鹅通 | `moss.xiaoe-cloud-cli` |
| 天创信用星图MCP | `moss.xingtu-claw-risk` |
| 盈米MCP | `moss.yingmi-mcp` |
| 智客AI · 对公(To B)营销助手 | `moss.youshu-bd-mate` |
| 华宇元典法律数据 | `moss.yuandian-mcp` |
| 云客AI工作手机 | `moss.yunke-cli` |
| 云帐房AI财税 | `moss.yzf-general-mcp-server` |
| 云帐房AI开票 | `moss.yzf-invoice-mcp-server` |
| 中兴新云AI智报 | `moss.zfs-fssc-ai` |
| 知识星球 | `moss.zsxq` |
