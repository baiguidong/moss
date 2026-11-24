# Moss Apps

App 源码位于独立仓库：<https://github.com/baiguidong/moss-apps>。

Moss 主仓库通过 [`builtin-apps.json`](../packages/app-sdk/src/builtin-apps.json) 选择随安装包提供的 App，目前包含可视化、文档创作、PDF 创作、表格、演示文稿、模板、应用构建、Buddy、网页操控和电脑操控十个 App。工具命名使用同一清单识别内置 App。
打包时 `ui/scripts/prepare-builtin-apps.mjs` 从官方市场下载清单锁定版本的在线 ZIP，按目标平台选择附件，并校验大小、SHA-256、包身份、源码和发布者签名。网页操控在首次使用专用浏览器时准备内核。每次打包将 ZIP 和版本、大小、SHA-256 清单放入客户端资源目录。

可视化默认全局常驻，Buddy 按会话选择，其余内置 App 默认全局按需。用户设置的工具使用范围优先于默认值。

本地验证可用 `--local-archive=moss.buddy=/absolute/path.zip` 替换指定版本的 ZIP。

首次启动使用普通 App 安装流程提供内置 App。既有安装、停用和卸载决定会保留；
应用管理页可恢复已卸载的内置 App。Moss 升级不会覆盖用户已有的 App 版本。
应用市场仍用于安装其他 App 和更新 App。

App 及其 Backend 安装后默认启用。Host API 契约见
`ui/docs/app-host-capability-api.md`，安装、进程和数据模型见 `ui/docs/app-runtime.md`。

本批交付及验证方式见 `docs/builtin-creation-apps.md`。
