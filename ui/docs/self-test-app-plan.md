# AI 自测 App 抽取方案

状态：已按首版范围实施。2026-10-12 用户要求「按照规划迁移，功能暂时按照现在的，后期单独优化 App」。

首版保留原有十项用例、八项默认选择、固定测试实例、逐项执行、停止保留数据和自动独立 HTML 报告。已迁移设置入口、session 工具、测试内容、Backend 调度、校验、引擎与报告；Core 仅保留宿主基础能力。本文中提到的依赖版本自动检查、完整历史管理及 App 内报告详情重设计列入后续优化，不作为本次新增功能。实际使用和验证命令见 [AI 自测 App](self-test.md)。

## 已确定的产品要求

| 项目 | 约定 |
| --- | --- |
| App | 官方 `moss.self-test`，名称「AI 自测」，分类 `diagnostics` |
| 操作入口 | `设置 → Apps → AI 自测`；使用现有动态 App 设置导航 |
| 工具范围 | 显式声明 `toolScope: "session"`；只有当前会话选择该 App 才能发现、加载和调用工具 |
| 启动方式 | 在设置内点击「开始自测」，或者在选择了自测 App 的会话中让 AI 发起 |
| 页面风格 | 跟随 Moss 的主题、背景、字体、按钮、卡片、间距与状态表达 |
| 内容归属 | 测试清单、提示词、通过标准、样例、调度、结果校验、报告和自测配置由自测 App 维护 |
| 发布 | 自测内容和执行依赖随 App 版本发布；Core 只维护所需宿主能力 |
| 旧数据 | 不兼容旧自测目录、报告、配置、运行记录、测试会话标记或工具名称；不编写迁移流程 |

用户明确指定将操作入口放在设置，本 App 按此要求声明位置。`contributes.settings.group` 使用 `apps`，不增加独立的 Core 高级设置项，也不在「更多」登记重复入口。

“测试内容由 App 管理”指内容随自测 App 维护和发布。测试范围仍包含 Moss 基础功能及所选业务 App；需要工作流等 App 的用例，由清单声明依赖并按实际安装环境检查前置条件。首版不增加各业务 App 自行贡献测试用例的新扩展协议。

## Manifest 与两种启动方式

以下为关键字段片段，完整 Manifest 还需声明 UI、Actions、Tools、权限和新增 Host 协议。最低 Host API 应使用实际发布新协议的版本，不能仅因已有导航支持就填写旧版本。

```json
{
  "id": "moss.self-test",
  "displayName": "AI 自测",
  "category": "diagnostics",
  "toolScope": "session",
  "navigation": { "location": "settings", "viewId": "self-test" },
  "backend": { "runtime": "node", "apiVersion": 1, "lifecycle": "persistent" },
  "contributes": {
    "views": [{ "id": "self-test", "title": "AI 自测", "route": "#/self-test" }],
    "settings": [{ "id": "manage", "title": "AI 自测", "viewId": "self-test", "group": "apps" }]
  }
}
```

设置页通过 `createAppClient(window.mossApp)` 调用 Backend Action。打开页面不把 App 加入当前聊天；点击开始后，由 Host 创建明确关联 `moss.self-test` 的专用控制会话。用例执行期间的浏览器工具和结果提交工具在该控制会话可用。

会话工具同样调用 Backend 的运行服务，返回 `runId`、状态与控制会话信息。发起请求的普通会话不直接承担整轮控制；它可以继续查询和停止自己可访问的运行。未选择自测 App 的会话不能通过 ToolSearch、旧内置工具或历史工具缓存获得自测能力。

页面和会话入口共用启动、查询、取消和结果状态机；同一 App 默认实例同时最多运行一轮。开始操作快速返回，Backend 在后台继续调度，不将整轮测试挂在一个长时间 UI Action 上。

## App 与 Core 的职责

| 能力 | 所有者 | 实施约束 |
| --- | --- | --- |
| 清单、依赖条件、提示词和样例 | App 包 | 从当前安装版本读取，开始时保存本轮快照 |
| 用例选择、顺序、超时、推进和结果判定 | App Backend | 迁移现有 `service.mjs` 的业务逻辑，移除对私有 IPC 的依赖 |
| 观察、截图校验、报告渲染与历史列表 | App Backend / UI | 报告、截图和配置存入 App 私有数据目录 |
| 页面与交互 | App UI | 在 Moss 设置中嵌入，自测操作与结果在 App 内完成 |
| 隔离测试实例 | Core | 控制可执行文件、profile、单实例锁、CDP、父进程关系和退出回收 |
| 复制当前主 Moss 环境 | Core | 复制已安装版本和授权配置、重加密凭据；只返回环境摘要 |
| 控制会话与临时浏览器连接 | Core | 绑定 App、运行和控制会话；结束后撤销连接，重启后不自动恢复旧 CDP |
| 自动化引擎依赖 | App 包 | 固定 Playwright MCP 版本，随包携带生产依赖与许可证 |

首版建议复用 Browser Use 已有的 Playwright MCP 构建方式，将引擎依赖打入自测 App。Core 根据已校验的自测安装包启动该引擎，不再读取另一个 App 的内部文件布局。自测用例、提示词和浏览器工具名称由 App 维护；Core 不维护测试项目 ID 或业务通过标准。

首版保留现有行为：App 内展示本轮结果，结束后自动打开独立 HTML 报告，并能从 App 重开。渲染和导出归 App，Host 使用通用本地 HTML 预览。完整 App 内报告详情页后续优化。Core 不保留专用自测报告业务窗口模块。

## 需要补充的 Host 契约

已增加 `moss.testing/v1`，统一落入 `host-contracts`、SDK、Runtime 校验和开发契约目录。SDK/Runtime/Host API 为 3.7.0。除下表外，`environment` 提供不含凭据的环境摘要、`target.attach` 关联本轮目标、`controller.caller` 提供可信工具来源、`controller.open` 打开所属历史会话。

| 接口组 | 能力 |
| --- | --- |
| `target.status/open/close/sync/reset` | 查询、打开、关闭、同步和重置当前 App 拥有的测试实例 |
| `controller.create` | 创建绑定测试实例与本轮运行的本地控制会话，关联自测 App 和受限生命周期的浏览器工具 |
| `controller.turn.start/status/abort` | 异步提交、查询和终止单个控制回合；支持逐项提交结果后结束当前回合 |
| `controller.dispose` | 停止在途执行并释放本轮工具连接，保留用户可查看的会话记录 |
| 事件 | `target.changed` 提供实例状态与准备进度；回合状态通过异步查询获取 |

会话、模型和工具执行复用现有 Host 实现，不另建模型客户端。已存在的 `agent:permissions:bypass` 授权检查继续适用；新协议另声明对应权限、方法限额和调用面。App 的请求必须通过 Manifest、实际 grants、实例和进程 generation 校验。

接口使用 Host 生成的 target / controller 引用绑定所有权；不允许 App 任意指定主程序可执行文件、主数据目录或凭据输出路径。临时 MCP 启动入口必须解析到当前已校验的 App 安装包，输出目录由 Host 约束到本轮证据目录。

结果提交由 Backend 根据 Host 传入的可信工具调用来源核对控制会话和当前运行。UI Action 或模型输入自行填写的 `sessionId` 不能充当授权依据。只有当前项目可提交结果，`passed` 仍要求全部预期的实际观察和本轮截图。

关闭页面只释放页面订阅，不停止后台运行。停止自测结束 AI 操作并保留测试窗口和产物；App 停用、撤权、换版本、Backend 异常退出或 Moss 退出时，Host 必须终止所属控制执行、撤销浏览器连接并回收测试进程。后续启动将未结算运行显示为中断，不自动重连旧端点。

测试实例保留明确标识，禁止再次创建测试实例或发起嵌套自测。复制自测 App 到目标环境也不能触发自动运行。同步、清理和关闭与运行操作串行化，保持现有测试环境隔离语义。

## 数据、配置与测试内容

新数据布局使用 App 的标准私有目录，例如：

```text
apps-data/moss.self-test/instances/<instance-id>/
  runs/<run-id>/catalog.json
  runs/<run-id>/report.json
  runs/<run-id>/report.html
  runs/<run-id>/evidence/
  target/                       # 由 Host 管理的隔离 profile 与描述符
```

新安装从默认配置和空运行历史开始，不读取或搬运旧 `<MOSS_HOME>/self-tests/`。不兼容旧数据并不要求主动删除用户磁盘中的旧文件。

此要求不改变“新测试实例继承当前主 Moss 环境”的功能：主 Moss 的模型、现有 App 授权与凭据仍由 Host 用于准备独立测试环境；它们不是需要兼容的旧自测配置。自测 App 不额外保存一套模型 API Key。

首版保留现有 `id/title/default/requiresModel/prerequisites/steps/expected` 字段，由执行 AI 检查清单声明的前置条件；未满足时提交具体原因并记为阻塞，不计入通过。机器可检查的 App 依赖及版本条件后续在 App 中优化。尚未定义的业务 App 测试不凭空生成通过结论。

每轮记录 Moss 版本、自测 App 版本、自动化引擎版本、清单摘要与所测 App 版本。首次发布不读取旧格式；新 App 自己产生的历史报告应在后续 App 升级后继续可查看。旧十项用例可以作为首版内容来源，步骤必须按当前导航与 App 选择方式修订，不能原样假设工具全局可用。

## Moss 风格与页面

页面复用现有 App 的主题接入方式，通过 `window.mossApp.app.getInfo().appearance` 读取主 Moss 的明暗与背景偏好。复用 Moss 语义颜色、字号、按钮和表单样式；主 Moss 手动选择深色而系统为浅色时，App 仍应服从主 Moss 设置。页面重新获得焦点或重新显示时刷新外观，系统模式监听系统变化。

页面保留设置布局：环境状态与管理、测试项目选择、开始/停止与进度、本轮结果，以及最近一次报告入口。完整历史列表后续优化。Moss 已保留左侧设置导航，App 不添加重复的整页导航或大标题区域。不提供与主 Moss 冲突的独立主题开关。

App 内报告跟随当前主题；导出的独立 HTML 保留同一视觉规范、截图查看与可读排版。错误、阻塞、取消和未执行分别展示。

## 代码迁移与清理

App 工程放在相邻仓库 `moss-apps/apps/self-test/`，沿用标准构建、校验、源码随包和签名发布流程。

| 现有位置 | 处理 |
| --- | --- |
| `ui/src/self-test/catalog.mjs`、`service.mjs`、`report.mjs` | 迁至 App，调整宿主调用和数据目录 |
| `ui/resources/self-tests/` | 迁至 App 资源，清单与样例由 App 包校验 |
| `ui/src/renderer-react/components/self-test-control.tsx` | 替换为 App UI，移除原高级设置入口及专有类型 |
| `instance.mjs`、`profile.mjs`、`reusable-instance.mjs`、`browser.mjs` | 提取必要宿主实现；引擎依赖、用例名和提示词迁出 Core |
| `ui/src/main.mjs` | 移除业务服务装配和专有 UI IPC，保留新 Host 协议及通用生命周期挂钩 |
| `ui/src/preload.mjs` 的 `selfTest` | 删除；App 使用标准 SDK 桥接 |
| `MossSelfTestTool` 及内置工具加载配置 | 删除；由 App Tools 提供，不保留旧名别名 |
| `ui/package.json`、`after-pack.mjs`、`verify-package.mjs` | 移除 Core 自测内容资源打包和清单校验，移交 App 构建 |
| 现有验证脚本与文档 | 改为以安装后的 App 发起和观察运行 |

## 实施顺序与验收

1. 提取 Host 测试实例和控制会话能力，完成版本化契约、权限、取消和生命周期实现。
2. 建立自测 App，迁移清单、调度、结果校验、自动化依赖及新数据模型。
3. 接入设置页、session 工具与 App 内按钮，完成 Moss 外观和报告页面。
4. 删除 Core 内置入口、工具、资源和旧数据读取；更新 App 打包、验证脚本及文档。
5. 用隔离安装环境完成实际 App、控制会话、测试实例和报告的全流程验证。

关键验收包括：

- 设置及 Apps 管理页能进入同一 App 页面；「更多」和原高级设置无重复入口。
- 未选 App 的会话没有自测工具；选中后可用；移除后历史缓存不恢复工具；两个会话的选择互不影响。
- 未在当前聊天选择 App 时，仍可从设置内点击自测；Host 创建的控制会话明确关联自测 App。
- 页面关闭和重新打开不丢失运行；重复点击不会并发启动两轮；停止、停用、撤权与崩溃回收符合上述语义。
- 全新目录正常运行，无旧自测数据和配置也不受影响；Moss 主环境与隔离目标的业务数据不互相覆盖。
- 用例和报告确实来自已安装 App 包；更换自测 App 内容版本不要求重新构建 Core。
- 依赖缺失明确阻塞；结果要求实际观察和截图；旧运行产物不能冒充本轮证据。
- 浅色、深色、系统模式、背景偏好、窄设置面板和报告页视觉一致。
- 使用打包后的 App 与受管 Node 完成真实模型及 CDP 验证，运行时不依赖仓库或在线安装 npm 包。

迁移前已保留原行为测试基线；测试已拆分到 Core 宿主测试和 App 服务测试。首版实际验收结果见 [迁移交付记录](self-test-app-delivery.md)。
