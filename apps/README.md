# Moss Apps

App 源码已迁移到独立仓库：<https://github.com/baiguidong/moss-apps>。

Moss 主仓库不保存 App 版本锁，也不在 CI、Desktop 安装包或 Server 镜像中预装 App。
应用市场索引由 GitHub Pages 提供，用户安装和更新 App 时由客户端下载并校验签名包；
Moss 自身升级不会安装或替换任何 App。

App Backend 的 Host API 契约见 `ui/docs/app-host-capability-api.md`，运行位置模型见
`ui/docs/app-runtime.md`。每个 Backend 必须显式声明只支持 Desktop、只支持 Server 或同时支持两者；
Server 是非默认的 7×24 部署能力，声明两者时同一 instance 仍然只在一个 target 上 active。
