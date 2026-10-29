# App 创建与迭代

用户默认在主会话使用 App。只有业务工作台才需要自己的 UI。工具和文件结果通过会话返回，交互成果使用当前 Host 的 presentation 契约；不要伪造媒体 URI、让用户输入 HTML 或复制另一套“继续修改”流程。

## 最小组成

- app.moss.json：schemaVersion=2、稳定 id/version、用途明确的名称与描述、category/keywords、所需 hostApi、navigation 和 toolScope。
- 工具：contributes.tools 引用已声明的 backend.actions 和实际存在的对象输入 Schema。Backend 注册相同 Action，校验业务参数，返回真实结果。使用有意义的工具名，来源与冲突由 Host 处理，不手工加 app_moss 前缀。
- 技能：contributes.skills 引用包内 SKILL.md，description 说明何时使用；参考资料按需加载，支持脚本必须随包包含。单独的流程知识直接创建技能，不必创建 App。
- 全部声明的入口、资源与依赖必须存在；可重建源码、锁文件和固定 SDK 随包保存。不要生成空实现、TODO 或假成功。

## 选择展示和加载

| 需要 | Manifest |
| --- | --- |
| 主会话工具、介绍、能力目录 | navigation.location=none；不声明 ui |
| 通用字段设置 | contributes.settings[].form 指向读写 Actions；Host >=3.21 |
| 详情中打开业务页面 | navigation.location=details，ui.entry，views 和 settings[].viewId；Host >=3.22 |
| 日常独立操作工作台 | navigation.location=more，viewId 引用已声明视图 |
| 会话手动选择 | toolScope=session；选中后工具常驻 |
| 所有会话按需发现 | toolScope=global，toolLoading=on-demand |
| 所有会话携带工具 | toolScope=global，toolLoading=always |

overview.description/examples 填写面向用户的能力说明与自然语言示例。通用详情统一展示基本信息、应用设置、技能、MCP 服务、工具、资源与展示能力，无内容的模块隐藏。设置表单从 Schema 渲染，普通 MCP 用宿主连接管理；不要生成重复设置页。密钥不放进 Manifest 或公开文案。

scope/loading 都由整个 App 决定；启用、授权和配置仍需满足，backend.lifecycle 只管理进程。独立可选服务使用 toolSelection=services（Host >=3.8）；原生工具绑定稳定 serviceId，MCP 子项由 Host 提供。全局常驻会覆盖所有可用子服务；全局按需只让明确选中的服务常驻。

有 UI 时从 @moss/app-sdk/ui 引入 createAppClient，不在浏览器引入 Node 根入口。通过 view.setState({dirty,busy}) 告知宿主未保存/提交状态，订阅 appearance 事件跟随主题；关闭页面清理请求与订阅。页面只展示业务内容，不重复通用信息、权限、工具范围和工具目录。具体尺寸和可访问性见 [布局约定](ui-layout.md)。

## 创建、构建与验证

使用应用构建的 builder_inspect 获取最新指引与 scaffold.mjs/app.moss.json；builder_prepare 绑定新项目并导出 .moss-sdk。先读取 Host info/相关 contracts，再使用固定 SDK 编写源码。SDK 契约路径可从其 package.json exports 和 contracts.get 查询，不猜测字段。

编辑已安装 App 时恢复其 sourceRoot/appRoot 和固定工具链，保留身份、设置、数据、源码和无关功能。源码缺失时请求匹配源码，不从运行文件重建替代品；需要新协议时明确迁移 SDK/锁文件。

修改后重新 source.inspect；builder_build 使用 sourceHash、contractHash、sdkHash，同一请求重试复用 submissionKey。轮询回执到终态，固定 artifact 上测试成功、非法输入和依赖失败。Backend-only App 测试真实 Actions 和会话结果；有 UI 才检查实际 Moss 外框、普通/窄窗口、浅/深主题和错误状态，不能以生成图片替代截图。

用户已要求安装时完成 release.prepare/commit/get，携带 baseVersion、installationRevision、dataCompatibility；更新递增版本，检查回执和源码恢复。仅创建或讨论则交付可审阅结果，不自动公开发布。不要把外部服务未配置的能力记为已测试。
