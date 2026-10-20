# 审计中心 App 边界

审计中心源码位于相邻仓库 `../moss-apps/apps/audit/`。规则引擎、SQLite 数据库、扫描定时器、风险发现与告警策略均由 App 维护，Core 不包含审计专用 Host 协议或扫描实现。

Host API 3.16 提供通用 `moss.session-source/v1`：App 先调用 `session.list` 获得每个本地会话的 revision 和更新时间，再只对变化的 ID 调用 `session.export`。Host 在写入 App 实例私有目录前脱敏历史；正文不经过 IPC。会话撤销等操作事件写入获授权 App 的 `session-source/events/`，App 负责幂等导入与分析。

会话定位使用同一通用协议的 `session.open`，通知使用 `moss.notifications/v1` 的 `publish`。停用、撤权与卸载使在途导出和事件票据失效。App 不存在时会话撤销正常执行。接口细节见 [Host Capability API](app-host-capability-api.md) 与 [App SDK 接入说明](../../../moss-apps/docs/app-sdk.md)。
