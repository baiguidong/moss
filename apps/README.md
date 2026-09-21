# Moss Apps

App 源码已迁移到独立仓库：<https://github.com/baiguidong/moss-apps>。

Moss 主仓库只通过 `config/bundled-apps.lock.json` 锁定预装版本；构建时从
GitHub Releases 下载 ZIP，校验 SHA-256 和发布者签名后再打入安装包。应用市场
索引由 GitHub Pages 提供，客户端运行时不会从本目录编译 App 源码。

App Backend 的 Host API 契约仍见 `ui/docs/channel-host-api.md`。
