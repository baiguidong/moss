# OpenIM 独立 App 迁移记录

状态：Core 解耦与 Host API 2 适配完成，待真实环境发布验收

日期：2026-09-22

目标 App：`moss.openim@0.2.0`

## 最终边界

Moss Core 仅提供：

- 通用 App Runtime 与 owner/实例隔离。
- `moss.account/v1` 身份和组织目录。
- `moss.agent/v1` Binding、Session、Turn 与安全执行。
- `moss.desktop/v1` 文件、截图、外链和媒体权限。
- `moss.remote/v1` 同 App 的 Desktop → Server Action。

`moss.openim` App 自己提供：

- OpenIM Node SDK、各平台原生库、连接和重连。
- OpenIM 服务地址、管理 Secret、用户供应与 Token 签发。
- OpenIM 用户 ID、会话 ID、消息事件和自动回复扩展格式。
- 通讯录、单聊、群聊、附件、已读、撤回、RTC 和全部 UI。
- 发送幂等、回执持久化、失败退避和自动回复环路防护。
- OpenIM App 的 Desktop 与 Server Backend 运行逻辑。

Core 不再包含 OpenIM UI、preload、IPC、SDK 依赖、Server 路由、系统设置、RBAC 权限或数据库表。`deploy/im` 仍是与 Moss Server 一起部署的服务端基础设施，不属于 App Host API 或 App 迁移范围。

## 运行拓扑

```text
App UI
  -> Desktop App Action
  -> OpenIM Desktop Backend (Node SDK)
       -> moss.remote/v1 action.invoke
       -> OpenIM Server Backend
            -> moss.account/v1
            -> OpenIM Server API

OpenIM incoming event
  -> OpenIM Desktop Backend
  -> moss.agent/v1 turn.start
  <- turn.completed / turn.review_requested / turn.failed
  -> OpenIM sendMessage
  -> moss.agent/v1 turn.delivery.ack
```

Desktop 与 Server 使用相同的 App ID 和默认实例 ID。Server Backend 通过 `serverOwnerScope: "org"` 按组织共享配置和管理 Secret；Remote Host 只能在同一 App 内选择当前用户或当前组织 owner。Server HTTP 层按 `apps:invoke` 授权，并把认证用户作为 Action principal 传给 Account Host。

## 数据与安全

- SDK 数据、日志、媒体缓存和投递回执位于 App 实例数据目录。
- 平台文件方法只接受 Desktop Host 选择或物化到私有缓存的路径。
- App 不获得 Moss Bearer Token、模型密钥或 Connector 凭据。
- 联系人 Binding 与 Turn 由 Core 按 owner、App、实例和外部会话隔离。
- OpenIM 管理 Secret 只进入组织级 Server App Backend 的 Secret 配置，每个组织只配置一份。
- Moss 用户停用通过通用 `directory.user-changed` Account 事件通知 App，由 OpenIM App 撤销外部会话。
- 通讯录按页返回；文件内容通过 Desktop Host 分块写入，单个 Backend IPC envelope 保持在 1 MiB 内。
- 外部消息按不可信用户输入处理，稳定平台消息 ID 用于 Turn 幂等。

## 当前能力

- 单聊支持 `human_only`、`ai_draft_review` 和 `ai_auto`。
- 默认策略可由联系人策略覆盖；每个联系人拥有独立 Session 上下文。
- 人工消息可作为受限观察上下文，人工接管可取消未投递 Turn。
- 自动回复使用稳定消息 ID，失败后指数退避并在重启后恢复。
- 群聊保持人工处理；群级 Agent 策略不在本轮范围。

## 发布验收

- macOS arm64、macOS x64、Windows x64 和 Linux 对应原生库可加载。
- 两个真实账号完成登录、通讯录、单聊、群聊、文件、截图和已读验收。
- 人工、草稿和自动回复模式均验证不会重复投递或跨联系人串线。
- Desktop/Server App 实例配置、禁用、重启和重装行为符合预期。
- 现有 `moss/deploy/im` 服务端部署保持独立，不由 App 构建或发布流程管理。
- 签名 ZIP、Marketplace 元数据和 Core Host API 2 兼容性校验通过。

App 的配置和运行细节由 `moss-apps/apps/openim/README.md` 维护；OpenIM Server 部署仍由 `moss/deploy/im` 维护。
