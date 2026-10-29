# Moss Apps

App 源码位于独立仓库：<https://github.com/baiguidong/moss-apps>。

Moss 主仓库通过 [`builtin-apps.json`](../packages/app-sdk/src/builtin-apps.json) 选择随安装包提供的 App，目前包含可视化、文档创作、PDF 创作、表格、演示文稿、模板、应用构建、Buddy、网页操控和电脑操控十个 App。工具命名使用同一清单识别内置 App。
打包时 `ui/scripts/prepare-builtin-apps.mjs` 为清单中 `downloadLatest` 指定的 Buddy、网页操控、电脑操控查询官方市场，下载适配目标平台及当前 Host API 的最新稳定版本，校验大小、SHA-256、包身份、源码与发布者签名后原样内置。电脑操控不支持的平台会记录为省略；下载或验证失败则中止打包，不静默使用旧包。
其余 App 仍从相邻 moss-apps 仓库（或 `MOSS_APPS_ROOT`）构建 ZIP。每次打包记录实际版本、大小和 SHA-256，放入客户端资源目录；用户启动时直接安装随包资源。

Buddy、网页操控和电脑操控默认采用全局按需工具加载；内置身份不使工具常驻模型上下文。用户后续手动选择的范围和加载方式优先于默认值。默认值由 Host 提供，无需修改下载包的签名内容，也不改变具体操作权限。

本地验证可用 `--local-archive=moss.buddy=/absolute/path.zip` 替换某个包；`--reuse-packages` 复用其余本地构建产物，三个下载项仍查询最新市场版本。`--build-local` 显式将全部内置 App 改为本地源码构建。

首次启动使用普通 App 安装流程提供内置 App。既有安装、停用和卸载决定会保留；
应用管理页可恢复已卸载的内置 App。Moss 升级不会覆盖用户已有的 App 版本。
应用市场仍用于安装其他 App 和更新 App。

App 及其 Backend 安装后默认启用。Host API 契约见
`ui/docs/app-host-capability-api.md`，安装、进程和数据模型见 `ui/docs/app-runtime.md`。

本批交付及验证方式见 `docs/builtin-creation-apps.md`。
