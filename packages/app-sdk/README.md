# Moss App SDK

当前 SDK 对应 Host API `2.1.0`。2.1 新增 Desktop-only 的 `moss.openim/v1` 管理协议，兼容要求 `^2.0.0` 的 App。

## Backend target 契约

Manifest 必须为每个 Backend 显式声明支持的运行位置：

- `targets: ["desktop"]`：只支持 Desktop，只有客户端运行时 Backend 才可用。
- `targets: ["server"]`：只支持 Server，可由 Server 7×24 运行。
- `targets: ["desktop", "server"]`：支持在两个位置之间迁移；同一 instance 同一时刻只在一个位置 active。

`targets` 不是进程角色列表。支持两种 target 的 Backend 必须在任一位置独立运行，不能依赖另一端同时在线；两种模式的实现和适用功能可以不同。`context.target.type` 用于选择当前模式的实现。

不要从其他属性推导 target：有 UI 不代表 Backend 必须包含 `desktop`，有 Backend、使用 `persistent`、访问网络或未来可能远程部署也不代表应包含 `server`。Desktop UI 搭配 Server-only Backend 是合法组合；需求不明确时使用 `["desktop"]`。`["desktop", "server"]` 仅表示同一实例可迁移，不表示前后端、双进程、主备、同步或跨端分工。

`protocols` 按 target 声明，例如 `{"desktop": ["moss.desktop/v1"], "server": ["moss.agent/v1"]}`。Host 只向 Backend 下发当前 target 的协议列表。`moss.desktop/v1`、`moss.openim/v1` 和 `moss.remote/v1` 不能用于 Server。旧数组格式暂时兼容现有 App，并视为所有 target 共用同一列表；新 App 不应使用。

UI 与 Backend placement 独立。UI 应调用逻辑 instance，由 Host 路由到 active deployment。`moss.remote/v1` 仅为现有实现保留，新 App 不应使用它构造同时运行的 Desktop/Server Backend。
