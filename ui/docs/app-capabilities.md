# 跨 App 能力调用（Host API 3.18/3.19）

Host API 3.18 支持 App 明确导出的只读能力；Host API 3.19 还支持调用目标 App 已有的工具。Host 负责实例路由、双向授权、版本、超时、取消和审计；目标 App 保留自己的数据与凭据。跨 App API 不提供私有目录或凭据。

## Manifest

提供方声明版本化协议、方法到 Backend Action 的映射及每个方法需要的安装授权。Action 必须有输入和输出 JSON Schema。首版只允许 `effect: "read"`。

```json
{
  "hostApi": "^3.18.0",
  "permissions": ["dataset:share"],
  "appCapabilities": {
    "provides": [{
      "protocol": "moss.dataset/v1",
      "methods": [
        { "name": "describe", "action": "dataset.describe", "permission": "dataset:share", "effect": "read" },
        { "name": "query", "action": "dataset.query", "permission": "dataset:share", "effect": "read", "resourceReadMethod": "result.read" },
        { "name": "result.read", "action": "dataset.result.read", "permission": "dataset:share", "effect": "read" }
      ]
    }]
  }
}
```

调用方声明依赖的协议，并申请 `apps:invoke` 安装授权。`optional: true` 表示没有 provider 时 App 仍可提供其他功能。

```json
{
  "hostApi": "^3.18.0",
  "host": { "protocols": ["moss.app-capabilities/v1"] },
  "permissions": ["apps:invoke"],
  "appCapabilities": { "requires": [{ "protocol": "moss.dataset/v1" }] }
}
```

`contributes.services` 是同一 App 内的工具分组，与此协议无关。`resourceProviders` 用于资源贡献，也不会自动导出跨 App 方法。
本地 ZIP 和应用市场安装或更新时，确认页会列出跨 App 依赖及导出的方法、Action 和权限；已有安装增加或移除声明也会重新展示。

## 调用

SDK 的 `createAppCapabilitiesClient(context.host)` 提供 `list`、`invoke` 和 `read`。Host API 3.21 起，三者均可从 App UI 或 Backend 调用。纯 UI 组合 App 无需增加自己的 Backend；声明 `hostApi: "^3.21.0"`，使用 `createAppCapabilitiesClient(createAppClient(window.mossApp).host)`，由 Host 负责目标 App 派发。

```js
const capabilities = createAppCapabilitiesClient(context.host)
const { providers, unmet } = await capabilities.list({ protocol: 'moss.dataset/v1' })
const provider = providers.find(item => item.status === 'available')
const { sources } = await capabilities.invoke(provider.providerRef, 'sources.list', {})
const description = await capabilities.invoke(provider.providerRef, 'describe', { sourceId: sources[0].id })
const query = await capabilities.invoke(provider.providerRef, 'query', { sourceId: sources[0].id, limit: 100 })
let text = '', offset = 0
while (true) {
  const chunk = await capabilities.read(query.resourceRef, offset, 100_000)
  text += chunk.text
  if (chunk.nextOffset == null) break
  offset = chunk.nextOffset
}
const rows = JSON.parse(text)
```

`providerRef` 由 Host 签发，绑定 owner、调用方与提供方的安装及实例随机身份、publisher 和能力主版本。可保存在调用方的模型映射中；每次使用时 Host 重新检查安装、启用、授权和方法声明。兼容升级保留新引用；卸载后重新安装、publisher 变化或实例重建需要重新选择 provider。内部 v1 引用在此次身份升级后失效，调用方需重新执行 `providers.list`。调用方只能使用自己在 Manifest `requires` 中声明的协议。

当方法声明 `resourceReadMethod` 时，提供方返回短 ID `resourceId`，Host 将其换成调用方专属的 `resourceRef`。签发方法和读取方法必须使用同一权限，Host 在每次读取时复核两个方法及其授权。资源引用有效期 15 分钟；`resource.read` 最多读取 100,000 个 JavaScript 字符。大数据留在提供方，Host 不把完整结果载入内存。提供方负责保存不可变结果、验证资源 ID 和清理过期数据。

发现结果包含 `available`、`disabled`、`instance_disabled`、`permission_denied`、`configuration_required`、`backend_unavailable`、`crash_loop` 状态及 `unmet` 依赖。调用失败使用现有 `AppServiceError` 代码，并在 `details.reason` 中区分未安装、停用、实例缺失、版本不兼容、publisher 变化和过期。Host 脱敏日志包含调用双方、方法、耗时、结果状态和 trace ID，不记录业务输入或查询结果。

首版禁止跨 App 多跳调用；会话来源只从 Host 可信上下文传递。同一 Backend 正在处理入站跨 App Action 时，其独立发起的跨 App 调用也会暂时被拒绝。取消或超时后，若 Backend 在 5 秒内仍未结束该 Action，Host 会停止进程。3.18 自定义能力协议的业务写方法和直连数据通道尚未开放。

## 调用目标 App 已有工具（Host API 3.19）

目标 App 不需要增加 `appCapabilities.provides` 或更新自己的包。调用方在 Manifest 中精确列出目标 App ID 和允许的工具名，并申请 `apps:invoke`。例如，新 App 使用现有 `moss.database@0.2.2` 的 DBHub 工具：

```json
{
  "hostApi": "^3.19.0",
  "host": { "protocols": ["moss.app-capabilities/v1"] },
  "permissions": ["apps:invoke"],
  "appCapabilities": {
    "usesTools": [{
      "appId": "moss.database",
      "tools": ["search_objects", "execute_sql"]
    }]
  }
}
```

`usesTools.tools` 使用 MCP `tools/list` 返回的原始工具名；静态 `contributes.tools` 使用其本地 `id`。没有通配符。安装或更新调用方 App 时，确认页会显示每个目标与工具，并提示工具可能修改数据。授权以目标 App ID 和工具名为边界，覆盖该 App 当前及以后启用的实例与 MCP 子服务；`serviceId` 可用于选择连接，但不缩小 Manifest 授权范围。目标 App 仍管理自己的 MCP 连接、启用状态和权限；撤权或关闭服务会使调用失效。Host 不要求用户在聊天会话里选择目标 App，因为这里的授权来自调用方 Manifest 与安装确认。

Host API 3.21 起，SDK 在 UI 和 Backend 均提供 `listTools` 和 `invokeTool`。发现结果含来源 `source`、MCP 连接名 `serviceName`、服务 `serviceId`、实例、输入 Schema 和签名 `toolRef`；同名工具位于不同连接时会分别列出。调用方使用工具的实时 Schema 构造参数：

```js
const capabilities = createAppCapabilitiesClient(context.host)
const { tools } = await capabilities.listTools({ appId: 'moss.database' })
const query = tools.find(item => item.source === 'mcp' && item.name === 'execute_sql')
const result = await capabilities.invokeTool(query.toolRef, { sql: 'SELECT 1' })
```

上例按单连接演示。目标 App 有多个同名工具时，组合 App 应让用户选定 `serviceId`，并在重新发现后调用对应的 `toolRef`。

UI 调用与 Backend 调用使用同一 broker，不接受调用方自报 App 身份，不绕过 Manifest、安装授权、owner/实例绑定、实时派发前复核和嵌套调用限制。`signal` 会沿 UI SDK 和 Host 传递取消；页面卸载需取消在途请求并释放 client。可能写入或删除的工具应在 UI 展示明确确认，不能把 MCP 的 `unknown` 效果当作只读。

纯 UI 的浏览器安全入口：

```js
import { createAppClient } from '@moss/app-sdk/ui'
import { createAppCapabilitiesClient } from '@moss/app-sdk/app-capabilities'

const client = createAppClient(window.mossApp)
const capabilities = createAppCapabilitiesClient(client.host)
const { tools } = await capabilities.listTools({ appId: 'moss.database' })
const result = await capabilities.invokeTool(tools[0].toolRef, { sql: 'SELECT 1' })
```

Host 在发现、调用和实际派发前复核调用方的 `usesTools`、`apps:invoke` 与目标 App 当前授权。`toolRef` 绑定 owner、调用方与目标方的安装和实例、工具来源、服务 ID、工具名及结构 revision；有效期 15 分钟。MCP 工具目录来自实时 `tools/list`，配置或 Schema 变化后需重新发现。参数最多 256 KiB，结果最多 768 KiB；审计只记录双方、工具身份、耗时和状态，不记录参数或结果。MCP 工具效果按未知处理，可能读取、写入或删除目标数据。静态 Backend/Host 工具可经此接口调用；需要独立桌面授权的 native 工具不在此接口内。

实时参数校验支持显式 Draft-07（包括官方 Memory MCP）和 2020-12 Schema，按声明使用对应校验器，保留其原有语义，不通过删除 `$schema` 绕过验证。

Host 授权是 App API 边界。当前 Node Backend 进程仍以同一操作系统用户运行，尚无独立的文件系统沙箱；因此不能把此协议当作抵御恶意本地代码的 OS 级隔离。面向不受信任的第三方 App 开放前，需要补进程沙箱和受控文件访问，并验证平台差异。

## 本地数据工作台 provider

`moss.data-workbench` 导出 `moss.dataset/v1`：`sources.list`、`describe`、`preview`、`query`、`result.read`。用户在工作台中选择文件并点击“添加为共享数据源”，provider 才能按 source ID 读取。文件名中的 DuckDB 通配字符按字面读取，不会展开同目录的其他文件。调用方不能传文件路径或任意 SQL；`query` 只接受已选文件上的列、简单筛选、分页和行数上限。取消共享后，旧资源结果也不可再读，相关缓存会清理。结构响应提供 `revision` 与 `schemaFingerprint`；`preview` 和 `query` 可携带 `expectedRevision`，来源变化时返回 `APP_CONFLICT`。`revision` 是设备、inode、大小和时间戳的指纹，并非全文内容哈希。组合 App 应在映射检查和发布前重新核对。结果缓存单项最多 16 MiB、总量 256 MiB、最多 512 项；容量满时新查询返回 `APP_RESOURCE_EXHAUSTED`，已有未过期结果保持可读。过期文件在后续查询或读取时回收。

平台测试：`ui/tests/app-capability-broker.test.mjs`。真实 DuckDB provider 已用安装后的包验证 CSV 描述、预览、受限查询、结果读取与取消共享。

`moss-apps` 的本地 `vendor/moss-core` SDK 已同步 Host API 3.19，可用于构建声明 `usesTools` 的新组合 App。正式签名发布还需提交并固定 Core 子模块版本。现有 `moss.database` 和 `moss.data-workbench` 安装包无需为工具桥重建或更新；Host 可直接调用它们已有的 MCP 或静态工具。
