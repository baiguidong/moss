# Moss App SDK

当前 SDK 对应 Host API `2.3.0`，兼容要求 `^2.0.0` 的 App。

App 安装后自动启用。`backend.protocols` 是 Backend 需要的 Host 协议字符串数组，例如：

```json
{
  "protocols": ["moss.platform/v1", "moss.agent/v1"]
}
```

`persistent` Backend 只在 Moss 客户端运行期间常驻；`on-demand` Backend 在首次 Action 调用时启动，
空闲后退出。每个 App 最多运行一个由 Host 管理的 Backend 进程，使用 App 总开关控制。
如果缺少必填配置或密钥，App 保持启用，Backend 等待配置完成后运行。

`contributes.tools[].inputSchema` 必须是合法 JSON Schema，根节点必须声明 `type: "object"`，
且不得声明顶层 `oneOf`、`anyOf`、`allOf`、`enum`、`const` 或 `not`。在 `properties` 中声明参数，
在 `required` 中声明必填字段；字段内部的枚举和嵌套约束保持原样。
跨字段业务规则在 Backend 中校验，并通过参数或工具的 `description` 告知模型。
SDK 的 `validateAppToolInputSchema(schema, fieldName?)` 检查此根节点契约；App 包安装和 Core 工具注册
使用相同检查，错误包含工具标识和违规关键字。Core 原样发送合法 schema，不删除或改写约束。
未贡献为工具的普通 Backend Action，以及输出 schema，不受这项工具输入限制。

公共云端存储协议为 `moss.cloud-storage/v1`。契约、状态、错误和接入示例见 [云端存储文档](../../docs/cloud-storage.md)。

Host API 2.3 的 `moss.cloud-storage/v1` 新增 `shares.create/list/revoke`，使用独立的 `cloud-storage:share` 权限；创建分享还需 Server 账号的读取权限。契约、分享码和浏览器入口见 [云端存储文档](../../docs/cloud-storage.md)。
