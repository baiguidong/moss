# Host API 2 与外部集成 App 迁移记录

状态：代码迁移完成，待最终全量测试与两个 App 发布验收

日期：2026-09-22

> 本文记录既有迁移过程，其中 OpenIM 的 Desktop → Server Remote 拆分是待迁移的过渡实现，不作为新 App 的架构示例。当前规范以 `ui/docs/app-runtime.md` 为准：每个 App instance 单 target 单活，Server 能力由 App 显式声明。

## 目标

- Core 只提供可复用的 App Runtime、身份、目录、Agent、桌面和跨 Host 调用能力。
- 飞书、OpenIM 等平台连接和业务规则全部位于独立 App。
- 不保留 Host API 1.x、`moss.channel/v1` 或平台专用协议的兼容层。
- Backend 统一以 Node 子进程运行；Bun 仅可作为构建器并输出 Node 目标。

## Host API 2

公开协议收口为：

| 协议 | Core 职责 |
| --- | --- |
| `moss.account/v1` | 当前 owner 身份和受权限约束的组织目录 |
| `moss.agent/v1` | Agent 目录、Binding、Session、Turn 和投递确认 |
| `moss.desktop/v1` | App 私有文件缓存、截图、下载、外链与媒体授权 |
| `moss.remote/v1` | 现有 App 的过渡兼容；新 App 不应使用 |

旧 Channel 的会话和消息能力已并入 `moss.agent/v1`：

- `conversation.*` 改为 `session.*`。
- `message.receive` 改为 `turn.start`。
- `delivery.ack` 改为 `turn.delivery.ack`，统一使用 `turnId`。
- Host 推送统一为 `turn.accepted`、`turn.review_requested`、`turn.completed` 和 `turn.failed`。

连接状态、配对、平台通知和平台决策没有进入新协议；它们属于 App Action、App Event 或平台自身逻辑。

## Core 保留

- App 安装、授权、实例、进程、Action、Event、日志、Secret 和 owner 隔离。
- Agent 执行安全、Session/Turn 状态机、策略继承、资源收窄、取消和最小审计。
- Account 目录的组织边界与用户权限校验。
- Desktop 操作系统权限与每 App 私有文件目录。
- 过渡期保留同 App 的 Desktop → Server Action 路由，待现有调用方迁移后删除。

Core 不包含平台名称、SDK、Token、用户 ID 规则、Webhook、消息格式、自动回复扩展字段或平台部署配置。

## App 适配

### `moss.feishu`

- Manifest 升级到 Host API 2，只声明 `moss.agent/v1`。
- 飞书 Backend 直接使用标准 Agent 字段，不经过旧 Channel 请求映射。
- 私聊过滤、配对、去重、普通消息回复与飞书 API 均留在 App。
- Turn 完成后由 App 发送飞书消息，再调用 `turn.delivery.ack`。

### `moss.openim`

- Manifest 升级到 Host API 2，声明 Account、Agent、Desktop、Remote 四个通用协议。
- Desktop Backend 持有 Node OpenIM SDK、原生库、连接、事件转换和投递重试。
- Server Backend 通过 Account API 获取身份和目录，完成 OpenIM 用户供应与 Token 签发。
- Desktop 通过 Remote API 调用同一 App 的 Server Action；UI 只调用 App Action 和 Desktop Host API。
- OpenIM 标识、会话归属、SDK allowlist 与自动回复扩展全部位于 App；OpenIM Server 部署仍由服务端的 `moss/deploy/im` 维护。

## Server 权限

`apps:invoke` 专门控制 Action 和 Host API 调用，`apps:deploy` 只负责部署和重启。内置普通用户和部门管理员拥有 user-scoped App 的查看、管理、调用、部署和日志权限，但不能选择 `org` 或 `host` owner。

## 发布门槛

- Core 搜索不到旧 Channel/OpenIM 运行时代码或平台 SDK 依赖。
- App SDK 与 Runtime 均为 `2.0.0`，两个 App Manifest 使用 `hostApi: ^2.0.0`。
- Core UI、Server、SDK/Runtime 测试与构建全部通过。
- `moss-apps` 对两个 App 完成 validate、check、test、build 和 package。
- 现有 `moss/deploy/im` 属于服务端部署，本次不改动；App 不持有或发布 OpenIM Server 部署脚本。

API 详情见 [Host Capability API](../ui/docs/app-host-capability-api.md) 和 [Agent Host API](../ui/docs/agent-host-api.md)。
