# Moss Apps

App 源码已迁移到独立仓库：<https://github.com/baiguidong/moss-apps>。

Moss 主仓库只在 `config/bundled-apps.lock.json` 记录预装 App ID 和固定版本；CI 从
`moss-apps` 发布索引解析对应的 GitHub Release ZIP、SHA-256 和签名信息，校验后再打入安装包。本地源码
启动不会下载或自动安装预装 App。应用市场索引由 GitHub Pages 提供，客户端运行时
不会从本目录编译 App 源码。

App Backend 的 Host API 契约仍见 `ui/docs/channel-host-api.md`。
