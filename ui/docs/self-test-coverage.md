# AI 自测覆盖扩展（0.1.3）

按当前 Core 实现将清单从 10 项扩展到 59 项、10 个模块，默认 31 项。每项记录代码来源、前置条件、独立执行步骤、逐条标准与时间预算。完整映射在 moss-apps/apps/self-test/resources/self-tests/README.md。

增加模块筛选、步骤关键词搜索、整组选择及只重测问题项。15 项常用检查提供 CDP 批量脚本；8 个本地样例覆盖 TXT、Markdown、HTML、CSV、JSON、JavaScript、SVG、PDF。既有环境文件未变化时，版本用例验证无需保存提示及版本数量不变。

## 验证

- 单元及构建脚本检查：20 项通过；生产打包、源码恢复、冻结依赖安装、类型检查、后端握手通过。
- App 界面：深浅主题、390px 宽度、筛选搜索、整组选择、重测问题、运行锁定及错误展示通过。
- 真实 Electron CDP：10 项连续检查通过，共 17.193 秒。包括启动、字体设置、会话信息、搜索、项目创建、版本历史、Markdown、HTML、CSV、JSON/代码；计入 MCP 连接和脚本执行，不计开发、探索及实例启动。
- 安装 App 的脚本化调度验收通过（启动、截图、结果提交、报告、重开、停止保留目标、停用回收）。
- 安装 App 的真实控制模型 gpt-5.5：会话搜索、信息、项目创建、Markdown 预览共 4 项通过，52.934 秒，计入本轮环境准备与控制模型决策。

验证数据：output/self-test-coverage/verification.json。直接批量结果、截图及脚本在 direct/；真实模型报告、截图和控制记录在 model/；App UI 验证在 ui/。

本轮没有执行全部 59 项；工作流、团队、Office、外部服务和原生系统等扩展项目需要对应前置条件，未执行不算通过。CDP UI 用例不宣称覆盖全部内部代码分支。验证安装在临时隔离环境完成，用户主 Moss 尚未安装本地新版。

安装包：/Users/bgd/repo/moss-apps/artifacts/moss.self-test/0.1.3/moss.self-test-0.1.3.zip
SHA-256：99487ca4ec95c47e78b2aea689f1acb061bcc9cce5a3178596e3c84eb2960ae2
