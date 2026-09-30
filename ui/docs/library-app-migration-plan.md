# 知识库 App 迁移记录

状态：已实现并完成本地验证。更新：2026-09-30。

## 交付

App 源码位于相邻仓库 `../moss-apps/apps/library/`，ID 为 `moss.library`，版本 `0.1.2`。
安装包：`../moss-apps/artifacts/moss.library/0.1.2/moss.library-0.1.2.zip`。
使用说明与完整契约见 App 的 `README.md`、`app.moss.json` 和 `schemas/`。

- [x] App 管理资料集、文件副本、SQLite/FTS5、解析缓存、索引任务与检索。
- [x] 查询默认覆盖全部已入库的资料集，可显式传 `collectionIds` 筛选。
- [x] 5 个 AI 工具（list/search/read/write/delete）通过标准 contributions 注册；不接收 sessionId/projectId，没有隐式项目过滤或项目资产自动同步。
- [x] AI 写入仅接收明确的文件绝对路径；Agent 先整理文件及展开目录，同一路径重导入更新副本。页面保留目录导入和文本编辑；页面编辑、AI/页面删除有 revision 冲突保护。
- [x] Python 解析器与固定版本 pypdf 随 App 发布。运行时无需 pip、LLM 或 embedding。
- [x] 持久化单实例 Backend；关闭 UI 不停止索引，重启恢复未完成索引（包含文档编辑后的刷新）；任务可查看和取消。
- [x] 文档 URI 通过 App Resource Provider 解析。
- [x] 界面提供资料集管理、全库搜索、正文阅读与编辑、导入及索引任务。

## Core 变化

只增加通用能力，协议定义见 [Host Capability API](app-host-capability-api.md)：

- `moss.runtimes/v1/python.get` 报告受管 Python 的路径与状态。
- `moss.local-files/v1` 选择文件/目录、打开/定位 App 文件。打开操作校验真实路径属于调用 App 实例。
- 通用 App 资源解析用于 Markdown 引用与显式文件附件。由已启用的唯一 provider 处理 URI，Core 校验导出路径，不解释知识库业务参数。

清理了原生知识库服务、扩展安装器、IPC/preload/types、UI 页面、设置开关、侧边栏、四个原生工具及其注册/加载项、项目自动同步、文件树专用保存菜单、旧解析器资源打包和开发监听。
原生实现测试已移至 App 并去除历史迁移/项目绑定用例。移除了过时的原生设计文档，更新了项目数据布局说明。

未迁移或删除用户已有资料、数据库与历史文件；未修改当前用户的 App 安装状态。没有旧接口兼容层，也未增加资料集 ACL 或授权系统。App 沿用现有安装启停和通用文件能力声明。

## 验证结果

- App：Node 22 下 36 项测试通过，覆盖中英文检索、排行与上下文、真实 PDF/Office 解析、CRUD、目录层级、重复内容、重复导入、失败保留旧索引、任务取消/恢复、引用与导出清理。
- App：TypeScript 检查、Manifest 校验、构建和 ZIP 打包通过。
- 实际 ZIP 在隔离 Moss Runtime 中安装；验证 15 个工具、显式筛选、默认全库、拒绝 projectId、引用解析、并发 revision 冲突、重启持久化和停用工具撤销。
- 实际 Core EmbeddedAppView + preload + App Backend：资料集/文档创建、编辑、目录导入、检索、阅读、打开副本、取消/确认删除、任务列表通过；无 renderer error，包含浅色/深色及较小窗口截图。
- Core 桌面：987 项测试通过，类型检查与 renderer/direct 构建通过。迁移相关定向测试另有 35 项通过。
- Core/Server 扩大范围：491 通过、1 跳过、1 个现有失败。失败为 `server/src/__tests__/boundary.test.ts` 检出 `traceRoutes.ts` 的两个应用源码导入；在独立临时目录使用 Git HEAD 原文件复现同一失败，本次未修改这些文件。

App 桌面验证报告及截图保存在 `../moss-apps/artifacts/moss.library/verification/0.1.0/`。
验证使用临时数据目录，原生文件选择/打开使用确定性响应；实际 parser、SQLite、App Runtime、preload 和嵌入式容器均参与执行。
执行平台为 macOS；Windows 安装包内容为跨平台 JS/Python，但尚未在 Windows 实机运行。

## 发布前代码审查

已补做文件/版本一致性、索引取消和恢复、Host 资源边界、Action 输入输出、前端异步状态与 Core 删除差异审查。发现的问题及修复详见相邻 App 仓库 `apps/library/REVIEW.md`，包含 9 项新增回归测试。App 的 CI 使用 Node 22，PDF 测试独立准备依赖，不依赖本地旧构建产物。

发布范围仅为 `moss.library@0.1.0`；Core 修改保留在本地，本次不发布 Moss 桌面安装包。市场安装后需要在包含本次通用 Host 协议的 Moss 中运行。

## 首次发布

`moss.library-v0.1.0` 已通过 GitHub Actions 构建、签名并部署应用市场，发布提交 `cc193a042f471b57a59b6345ecedebc0a519ce7e`。

- CI：https://github.com/baiguidong/moss-apps/actions/runs/36664375374
- 签名/市场发布：https://github.com/baiguidong/moss-apps/actions/runs/36664619929
- Release：https://github.com/baiguidong/moss-apps/releases/tag/moss.library-v0.1.0
- 市场详情：https://baiguidong.github.io/moss-apps/v1/apps/moss.library.json
- ZIP SHA-256：`b418a43809ab63b7dece625ebb8bb8144424101a2f9aea90c93e72bd47d99e45`（543,780 字节）。

发布包下载与隔离安装验证记录位于 `../moss-apps/artifacts/moss.library/published/0.1.0/published-verification.json`。本轮额外执行 Core 49 项定向测试，全部通过。

## 0.1.1 工具收敛与下载修复

AI 工具仅保留 list/search/read/write/delete；write 统一导入、新建和更新。资料集管理、来源刷新和任务管理仍是页面 Action。App 39 项测试、整仓 CI 和桌面验证通过。

签名 ZIP 改由应用市场同域分发，CI 校验后复制原始发布包：
https://baiguidong.github.io/moss-apps/v1/packages/moss.library/0.1.1/moss.library-0.1.1.zip

已使用 Core 原始 `createAppMarketplaceService` 和 `downloadFileBuffer` 完成真实网络下载、校验、安装及激活，再通过 5 个 AI 贡献工具完成增删改查。验证记录：`../moss-apps/artifacts/moss.library/published/0.1.1/marketplace-install.json`。

- CI：https://github.com/baiguidong/moss-apps/actions/runs/36666585480
- 签名/目录发布：https://github.com/baiguidong/moss-apps/actions/runs/36666822146
- SHA-256：`41acaabac06e502b8345a1054204794e6bdcaaa3c4fe54d193463d46a3e71b84`。

## 0.1.2 文件写入与删除 ask 验证

AI 写入只接受 `collectionId` 和明确的普通文件绝对 `paths`，可批量列出文件。Agent 负责生成/整理文件及展开目录；同一资料集内重复导入同一路径更新原文档，内容未变跳过复制。目录、符号链接和旧的正文 create/update 输入被拒绝，页面内部管理 Action 保持可用。删除要求非空版本号，拒绝旧版本误删。

删除继续使用 Core 通用 destructive 权限映射。本次只补充权限回归测试，不改变权限策略：default/acceptEdits/plan 请求 ask，dontAsk 拒绝，显式 ask/deny 规则有效，用户主动开启 bypassPermissions 时遵循其选择。ask 不提供持久允许建议。

App Node 22 的 41 项测试、Core 权限相关的 14 项测试、整仓 CI、实际 ZIP 桌面验证均通过。发布后的签名包通过原始 Core 市场服务真实下载、校验、安装及激活，随后验证 5 个工具的按文件写入/搜索/读取/重导入/删除，以及目录和正文参数拒绝、旧版本删除保护、原文件保留。将实际安装包的删除工具定义送入 Core 权限链路，确认 default/acceptEdits 返回 ask、dontAsk 返回 deny；全部安装和验证约 4.6 秒。

- 发布提交：`141608298c1804b08c0eb1b3d61f215a68039799`。
- CI：https://github.com/baiguidong/moss-apps/actions/runs/36669665410
- 签名/市场发布：https://github.com/baiguidong/moss-apps/actions/runs/36669887727
- Release：https://github.com/baiguidong/moss-apps/releases/tag/moss.library-v0.1.2
- ZIP：https://baiguidong.github.io/moss-apps/v1/packages/moss.library/0.1.2/moss.library-0.1.2.zip
- SHA-256：`6eb802721ae2b2c2ca83d0006d6ec9eacfa49a3544907de4dc61061373a024e4`。
- 发布验证记录：`../moss-apps/artifacts/moss.library/published/0.1.2/marketplace-install.json`。

Core 修改仍保留本地，本次仅发布 App。
