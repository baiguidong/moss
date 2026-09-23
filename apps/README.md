# Moss Apps

App 源码位于独立仓库：<https://github.com/baiguidong/moss-apps>。

Moss 主仓库不保存 App 版本锁，也不在 CI 或客户端安装包中预装 App。
应用市场索引由 GitHub Pages 提供，用户安装和更新 App 时由客户端下载并校验签名包；
Moss 自身升级不会安装或替换任何 App。

App 及其 Backend 安装后默认启用。Host API 契约见
`ui/docs/app-host-capability-api.md`，安装、进程和数据模型见 `ui/docs/app-runtime.md`。
