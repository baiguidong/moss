# 审计中心 App 迁移

审计中心迁入相邻仓库 `../moss-apps/apps/audit/`，ID `moss.audit`，本地首版 `0.1.0`，正式签名版 `0.1.1`，需要 Host API `^2.6.0`。

## 职责

App 拥有规则引擎、SQLite 数据库、增量与全量扫描、发现项处理、严重发现通知策略，以及会话／发现／工具／操作事件／规则／审计记录六个页面。沿用七类规则、子 Agent 工具去重和整轮撤销归档。

Core 移除原生服务、规则引擎、定时扫描、审计 renderer IPC、preload/types、内置页面和侧栏入口。保留 `AppAuditHost`，只负责脱敏源快照、撤销事件落盘、首次旧库备份、会话导航和通知投递；不执行审计规则或查询结果。

Host API 2.6 新增 `moss.audit/v1`，见 [Host Capability API](app-host-capability-api.md)。会话导航通过通用 `app:open-session` renderer 事件，可定位工具调用。工具权限执行逻辑不依赖审计 App。

## 数据与生命周期

首次读取前使用 SQLite 在线备份，将 `<MOSS_HOME>/audit.db` 复制到 App 实例，包含 WAL 数据并保留原库。已存在的 App 数据库不覆盖；迁移标记原子写入，失败可重试。

Host 将快照正文写入实例目录，IPC 只返回版本、时间和数量。大页面结果通过 App Action 分块读取。撤销事件按 Host 生成的 ID 幂等导入，Backend 重启不重复生成事件。

App 启用后 Backend 常驻，每 30 秒增量扫描，关闭页面继续执行。停用、撤权和卸载先使旧写入代际失效并排空在途写入，阻止卸载后重建已删除目录。再次启用扫描当前本地会话，停用期间已移除的历史不能补录。App 不存在时会话撤销正常执行，`auditRecorded` 返回 false。

首版仅审计本地会话，不注册 AI 工具，遵循现有 App 信任和数据保留机制。

## 验证与交付

- App：原有 18 项引擎、排序和 SQLite 回归测试；类型检查、构建、Manifest 校验和 ZIP 打包。
- Host：8 项测试覆盖脱敏、大快照、WAL 备份、迁移幂等、事件保留、代际失效、路径约束和授权。
- 实际 ZIP：真实 AppRuntimeHost + Node Backend，覆盖迁移、持久化、告警去重、大事件分块读取、导航、输入校验、停用与撤权恢复。
- 页面：真实 SQLite 数据驱动浅色／深色测试，覆盖查询、批量处理、定位、规则校验与保存、重新审计、事件、窄屏和缺少 Host。
- Desktop：全量 UI 测试、类型检查、Direct 与 renderer 构建。旧 Agent Mail 测试桩缺少工作区通知的两个依赖；使用 Git HEAD 复现后补齐测试桩，未改动邮箱生产逻辑。

ZIP 位于 `../moss-apps/artifacts/moss.audit/<version>/`，集成报告位于 `../moss-apps/artifacts/moss.audit/verification/<version>/`。正式版本通过 Moss Apps 的 `moss.audit-v<version>` 标签触发校验、测试、签名和 GitHub Release，再更新应用市场目录。

2026-10-08 已在更新到 Host API 2.6 的本机开发版 Moss 中通过原生安装流程安装并启用 `moss.audit@0.1.0`。Apps 显示运行中，独立窗口已成功显示迁移后的审计数据。安装目录的 16 个文件逐字节匹配通过集成测试的 ZIP；旧库仍保留，规则和已有发现项处理状态核对一致。安装核验结果保存在上述验证目录的 `installation.json`。
