# Moss App SDK

当前 SDK 对应 Host API `3.0.0`；App 声明 `hostApi: "^3.0.0"`。不提供旧 UI 调用签名兼容层。

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

## Host API 3

UI 使用浏览器可打包的 `@moss/app-sdk/ui`，Main 绑定当前 App 与默认实例。`window.mossApp` 是隔离桥接层；使用 SDK 处理跨 Electron 边界的结构化结果与错误：

```ts
import { createAppClient } from '@moss/app-sdk/ui'
const app = createAppClient(window.mossApp)
const controller = new AbortController()
const result = await app.actions.invoke('request.send', input, {
  signal: controller.signal, timeoutMs: 135000,
})
await app.host.request('moss.platform/v1', 'file.download', {
  url, fileName,
}, { signal: controller.signal, timeoutMs: 300000 })
// 组件/页面销毁时取消这个 client 的未完成调用。
app.dispose()
```

普通请求不传 `instanceId`。实例配置管理保留 `instances` API，运行状态使用 `app.getStatus()`。UI 与 Backend Host 调用共用权限复查、载荷限额、受限超时和取消机制；窗口关闭及 App 生命周期变化会取消所属 UI 请求。取消等待原请求结算，不自动重试有副作用的请求。

Tasks/Execution 与 MCP 的元数据、JSON Schema、权限、限额来自 [host-contracts](../host-contracts/README.md)，生成类型、校验器及文档。App Service v1、领域协议名称保持不变；Host API/SDK/Runtime 3.0 要求 App 重新构建。

`@moss/app-sdk/execution` 提供 `createTasksClient(host)`、`createExecutionClient(host)`、`ExecutionWatcher` 和 `validateExecutionHostInput`。`ExecutionWatcher` 复用一次底层订阅，支持并发等待、序号过滤、初始查询、5 秒兜底及关闭清理。`@moss/app-sdk/mcp` 提供 `createMcpClient(host)` 和方法输入/结果类型。

所有 SDK 子路径的值导出类型与实际模块对应。验证：

```sh
node packages/host-contracts/scripts/generate.mjs --check
node packages/app-sdk/scripts/export-types.mjs --check
```
