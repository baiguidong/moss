# Moss 独立实例 AI 自测

安装 `moss.self-test` App 后，打开「设置 → Apps → AI 自测」，勾选测试项后开始。也可以先在当前会话选择 AI 自测 App，再让 AI 使用 `app__moss_self_test__self_test`：`list` 查看项目、`start` 启动、`status` 查看结果、`stop` 停止。App 显式声明 `toolScope: "session"`，未选择的会话没有自测工具。

需要支持 Host API 3.7 的 Moss、已配置的文本模型和已启用的 AI 自测 App。App 内置 Playwright MCP，无需另外安装 Browser Use。Host 为自测 App 管理一个使用独立数据目录的测试实例，每轮创建一个关联该 App 的控制会话负责执行。从设置内启动不依赖当前聊天的 App 选择。被测窗口标有「测试实例」。主 Moss 无需开启 CDP；CDP 在测试进程启动时打开。

测试窗口继承启动时的完整设置（包含真实模型、思考配置、主题、工具配置等）、已安装 App 的当前版本、启用状态、授权、实例配置和配置凭据，以及个人技能和助手。App 包复制到测试目录，凭据用测试目录自己的密钥重新加密；安装的 Node/Python 等工具链通过 `MOSS_RUNTIME_HOME` 复用，避免复制整个运行环境。会话、数据库及 App 业务数据从独立目录开始。

首次准备、单独打开和同步环境期间显示当前阶段、正在复制的 App、已完成数量和等待秒数。之后直接复用同一目录与已打开的进程。测试完成或停止 AI 操作后，窗口、会话、团队、工作流和产物都保留，便于用户查看。可随时点击「打开测试实例」；「关闭测试窗口」只关闭进程，「同步主 Moss 环境」更新配置和 App，「清理测试数据并重启」清理测试业务数据并保留安装环境和历史报告。管理操作依次执行；关闭时可取消尚未完成的环境准备。

## 测试清单

配置位于相邻 `moss-apps` 仓库的 `apps/self-test/resources/self-tests/catalog.json`，字段说明见同目录 README；样例位于 `resources/fixtures.json`。清单、提示词、调度、校验、报告及浏览器引擎均随 App 发布，Core 不再打包测试内容。每轮保存清单快照、版本和 SHA-256。首版保留现有十项用例、八项默认选择，不增加用例或重新设计交互。

| 默认 | ID | 验证范围 |
| --- | --- | --- |
| 是 | startup | 启动、页面可见、新建会话及设置入口 |
| 是 | session-switch | 在两个会话发送真实消息并等待 AI 回复，切换后验证消息保留及隔离 |
| 是 | appearance | 浅色／深色主题及设置保存 |
| 是 | apps-list | 已安装 App 与继承清单一致、启用状态、分类筛选、返回聊天 |
| 是 | file-preview | 预置工作区文件、内容预览、关闭预览 |
| 是 | chat-response | 真实模型回复、结束状态、会话消息保留 |
| 否 | chat-stop | 停止生成、再次发送及回复 |
| 否 | model-selector | 当前模型、思考强度选择及保存 |
| 是 | workflow-demo | 创建并实际运行两个真实模型 Agent 节点的订单分析工作流，核对 580 总额及报告产物 |
| 是 | agent-team-demo | 两个独立队友真实执行分析、复核任务，核对成员记录、任务状态及汇总文件 |

控制 AI 和被测实例均使用主 Moss 的真实文本模型、接口和凭据，权限均为 `bypassPermissions`（完全放行）。`requiresModel` 标记涉及被测实例模型调用的项目。报告显示本轮模型名称、权限模式和继承的 App 清单，不保存凭据。

测试实例自动创建「自测样例」会话和 `self-test-note.txt`，用于实际工作区文件预览。真实聊天项会点击发送、等待 AI 回复，并通过侧栏切换检查消息保留与隔离；仅输入草稿不算创建会话。原生系统文件选择框、系统菜单及其他 OS 控件不属于这一组 CDP 测试。完整业务 App、远程会话、连接器及升级安装等用例可在清单中扩展，但需要提供相应测试数据或前置条件。

## 执行与报告

- App 自带离线 Playwright MCP；Host 只接受当前 App 安装包内的引擎入口，并将输出限制到本轮证据目录。控制会话通过临时 `moss_test_browser` 服务连接独立 Moss 的 CDP，运行时无需从网络安装引擎。
- 启动器只接受带固定测试实例 UUID 标识的页面；不同数据目录隔离单实例锁、数据库、缓存及会话。每轮测试另有独立运行 ID，用于区分新建数据与历史记录。
- 测试控制会话提供普通工具集、自测结果工具和本轮浏览器工具，自动放行工具权限。大页面快照返回文件链接时可继续读取。界面操作沿用原生 MCP，测试提示要求通过界面完成步骤；连接失效后禁止继续调用本轮浏览器工具。
- 完成、停止或超时后结束控制会话的工具连接，保留测试实例和数据。App 停用、撤权、换版本、Backend 退出或主 Moss 退出时关闭测试进程，之后可用原目录重新打开。被测实例不允许嵌套启动自测；主进程异常退出后，目标进程检测父进程并退出。
- 默认每轮最多运行 45 分钟，每项在同一控制会话里单独执行一轮。提交有效结果后，Host 结束当前控制回合并派发下一项，避免模型继续操作其他项目而进度停在上一项。模型或工具错误标记阻塞并继续后续项目；已经提交的观察与截图会保留。未执行、阻塞和失败项目均不会计入全通过；`passed` 要求全部预期标准有实际观察，且本轮证据目录内存在截图。

数据全部使用 App 私有目录 `<MOSS_HOME>/apps-data/moss.self-test/instances/<instance-id>/`。固定实例位于 `target/home/`，日志在 `target/instance.log`；每轮产物位于 `runs/<run-id>/`：

```text
catalog.json       本轮清单快照
report.json        逐项结果、证据、版本与时间
report.md          可读报告
report.html        截图内嵌的独立 HTML 报告
evidence/          页面截图及 MCP 输出
```

结束后，Moss 自动在独立报告窗口打开 `report.html`。报告包含概览、问题与阻塞、逐项预期和实际表现、复现步骤、截图和运行环境；支持筛选、搜索和截图放大，可单独分享 HTML。App 页面可重新打开该 App 保存的报告。窗口开启失败不会丢弃报告，界面显示原因并提供重试入口。

测试的目标是发现可复现的问题。失败记录应说明实际复现步骤、差异、影响，以及产品问题、环境问题或用例错误的判断依据。报告中的判断由执行测试的 AI 提交，App Backend 校验结果完整性和证据路径，并根据 Host 提供的可信工具来源核对提交会话；失败线索仍需结合证据复核。重启后可查看上轮报告；未完成的历史运行显示为中断，旧测试会话不会重新连接到普通 Chrome。

不读取、不搬运旧 `<MOSS_HOME>/self-tests/` 数据、配置、测试会话标记或工具名称，也不主动删除旧文件。关闭设置页面不会中止常驻 Backend；重新打开可查看本轮或上轮结果。停止只结束本轮 AI 操作，保留目标窗口及测试数据。

## Host 边界

`ui/src/app-testing/` 负责 profile 隔离、当前环境复制、目标进程、临时 MCP 与控制会话生命周期。`moss.testing/v1` 仅向 `moss.self-test` Backend 开放，要求 `testing:control` 和 `agent:permissions:bypass`。`environment` 只输出版本、模型名和外观；模型凭据留在 Host，并由 Host 准备隔离环境。

目标管理和单回合执行是异步操作。App Backend 查询状态并推动用例，UI Action 及时返回。`controller.caller` 从工具调用上下文获取会话标识，UI 传入的内容不能伪造结果来源。App 升级/停用等生命周期变化使旧 generation 失效，回收在途准备、控制连接与目标进程。

HTML 由 App 生成，Host 仅用通用 `moss.local-files/v1.preview` 打开 App 私有 HTML 文件。预览窗口没有 Node 或 App 桥接权限。

## 开发验证

在 Core 仓库根目录运行：

```sh
bun test ui/tests/app-testing-host.test.mjs ui/tests/app-testing-instance.test.ts ui/tests/app-local-host.test.ts ui/tests/tool-loading-settings-view.test.tsx ui/tests/tool-loading-settings.test.ts src/tools/MossTool/MossTool.test.ts
```

在 `moss-apps/` 构建可安装包（包含源码、固定 SDK 和离线引擎）：

```sh
node scripts/package-app.mjs --app self-test
```

在 Core 的 `ui/` 目录构建并验证，参数为打包输出的 `package/` 目录，旁边应存在对应 ZIP：

```sh
node scripts/build-direct.mjs
node scripts/build-renderer.mjs
node scripts/test-self-test.mjs /path/to/moss-apps/artifacts/moss.self-test/0.1.0/package
node scripts/test-self-test-real.mjs /path/to/moss-apps/artifacts/moss.self-test/0.1.0/package /path/to/settings.json startup apps-list chat-response
```

前者使用本地脚本化模型验证真实 Electron 中的安装、设置入口、主题、session 工具范围、App 按钮、CDP 截图、可信结果提交、自动报告、页面重开、目标复用和停用回收；该结果只证明运行链路，不代表 AI 验收了全部功能。后者使用指定设置中的真实文本模型，默认运行启动、应用列表、真实聊天三项；业务用例的持久化证据校验从 App 源码包加载。单元测试和 App 服务测试覆盖停止、准备取消、异常退出、错误结果和过期证据。

验证使用独立临时主环境，仅安装待测自测 App，不复制个人业务 App。测试后保存截图、报告与 `verification.json`，移除临时 profile 的模型凭据。业务 App 演示需在已安装依赖的环境中另行运行。

报告页面的桌面/窄屏布局、筛选、搜索、图片放大和无特权预览可用 Electron 验证：

```sh
electron tests/self-test-report.electron.mjs /path/to/report.html
```
