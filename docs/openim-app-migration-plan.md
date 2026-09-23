# OpenIM App 边界

状态：Desktop App 与 Moss Server integration 分层

日期：2026-09-23

## 运行模型

`moss.openim` 只支持 Desktop：

```text
App UI
  -> OpenIM Desktop Backend
       -> moss.openim/v1
       -> Moss Server OpenIM integration
            -> OpenIM 管理 API
       -> OpenIM Node SDK
            -> OpenIM API / WebSocket
```

Moss Desktop 退出后，OpenIM SDK、消息接收和 AI 自动回复随之停止。OpenIM App 不创建 Server deployment，也不依赖同 App ID 的 Server instance。

## 职责边界

Moss Server OpenIM integration 负责：

- 保存 OpenIM 服务地址、管理密钥和 webhook 密钥。
- 将 Moss 组织用户映射并供应为 OpenIM 用户。
- 签发当前认证用户的短期 OpenIM Token。
- 准备单聊和群聊所需的平台用户与群 ID。
- 在 Moss 用户停用后撤销其 OpenIM 平台会话。
- 通过 OpenIM webhook 强制组织边界和即时消息权限。

`moss.openim` Desktop App 负责：

- OpenIM Node SDK、平台原生库、登录、长连接和重连。
- 通讯录、单聊、群聊、附件、已读、撤回、RTC 和全部 UI。
- 收到消息后的 Agent Turn、审核、投递、重试和防回环。
- SDK 数据、日志、媒体缓存和本地发送幂等记录。

Moss Core 的 Desktop Host 仅提供：

- `moss.openim/v1`：使用当前 Moss 登录身份访问服务端 OpenIM integration。
- `moss.agent/v1`：Binding、Session、Turn 与投递确认。
- `moss.desktop/v1`：文件、截图、下载、外链和媒体权限。

OpenIM 管理密钥和 Moss 登录 Token 都不会进入 App Backend。

## 配置

OpenIM 只使用 Moss Server 系统设置中的 `openIM` 配置。没有 App Server instance 配置、旧字段兼容或配置迁移路径。

`deploy/im` 负责部署 OpenIM 服务、生成密钥、写入 Moss Server 的 `openIM` 设置并配置 webhook。

## 发布要求

- Moss Server 必须包含 OpenIM integration 和相关 HTTP API。
- Moss Desktop 必须提供 `moss.openim/v1` Host capability。
- `moss.openim` Manifest 的 target 只能是 `desktop`。
- Server 与 Desktop 升级完成后再发布对应的新 App 版本。
