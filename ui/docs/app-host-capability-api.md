# Moss App Host Capability API

Host Capability API 是 Moss App Backend 访问宿主能力的唯一通用入口。App 不能导入 Desktop、Server、Session 或 Project 内部模块；它只能声明协议和权限，再通过 `@moss/app-sdk` 发起受控请求。

`moss.channel/v1` 继续提供原有 Channel SDK，但底层已复用同一套 Registry、授权、超时、取消和进程协议。

## Manifest 声明与授权

Backend 在 `protocols` 中声明它会使用的版本化协议，App 在 `permissions` 中声明所需权限。声明只是权限申请，实际可用权限来自 installation grants；Host 在每一次请求和事件发送前同时检查两者。

```json
{
  "schemaVersion": 2,
  "id": "example.catalog",
  "version": "1.0.0",
  "displayName": "Example Catalog",
  "hostApi": "^1.1.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "on-demand",
    "instanceMode": "single",
    "targets": ["desktop"],
    "protocols": ["moss.resources/v1"],
    "actions": [
      {
        "name": "catalog.search",
        "inputSchema": "schemas/search-input.json",
        "outputSchema": "schemas/search-output.json"
      }
    ]
  },
  "permissions": ["resources:read"],
  "contributes": {
    "tools": [
      {
        "id": "search",
        "title": "Search Catalog",
        "description": "Search the installed catalog.",
        "action": "catalog.search",
        "inputSchema": "schemas/search-input.json",
        "outputSchema": "schemas/search-output.json",
        "effect": "read",
        "permission": "resources:read"
      }
    ]
  }
}
```

本地 ZIP 和 Catalog 安装默认不授予权限。用户可在 App Center 按项授权；撤销 grant 会停止并以新 generation 重启相关 Backend，旧进程不能继续使用已撤销能力。

## Backend 调用 Host

```js
import { defineAppBackend } from '@moss/app-sdk'

const backend = defineAppBackend({
  'catalog.search': async (input, context) => {
    const resource = await context.host.request(
      'moss.resources/v1',
      'resolve',
      { uri: input.uri },
      { signal: context.signal },
    )
    return { resource }
  },
})

backend.host.on('moss.resources/v1', 'changed', async (event, context) => {
  await refreshIndex(event.uri, context.signal)
  return { refreshed: true }
})
```

Host 注册协议定义和实现：

```js
const unregisterProtocol = runtime.registerHostProtocol({
  protocol: 'moss.resources/v1',
  methods: {
    resolve: {
      permission: 'resources:read',
      validateInput(input) {
        if (typeof input?.uri !== 'string') throw new TypeError('uri is required')
        return { uri: input.uri }
      },
    },
  },
  events: {
    changed: { permission: 'resources:read' },
  },
})

const unregisterHandler = runtime.registerHostHandler(
  'moss.resources/v1',
  'resolve',
  (input, context) => resourceService.resolve(input.uri, context),
)
```

Handler context 中的 `appId`、`version`、`instanceId`、generation、target 和 owner principal 都由 Host 注入，不能由 App 自报。注销协议会同时注销该协议的 handler。

## Contributions

Manifest 可声明以下静态贡献点：

| 类型 | 当前 Phase 1 行为 |
| --- | --- |
| `views` | 已启用 App 可向 Desktop 侧栏或“更多”菜单添加带 `#/route` 的页面入口 |
| `settings` | 可发现的 App 设置入口，引用同一 Manifest 中的 View |
| `commands` | 可发现并通过统一 contribution broker 调用的 Backend Action |
| `tools` | 注入本地 Desktop Agent Tool Pool；输入/输出继续由 Action schema 校验 |
| `resourceProviders` | 按 URI scheme 查找并调用唯一 Provider |
| `widgets` | 已验证和可发现；具体 Overlay/Status 容器在后续阶段接入 |

完整 contribution ID 为 `<app-id>/<local-id>`。Tool 对外名称由 Host 生成，限制在 64 字符内并包含稳定摘要，避免不同 App 或标点归一化后的名称冲突。

Tool 的 `effect` 映射到 Core 策略：

- `read`：只读且可并发。
- `write`：非只读，默认进入用户确认和规则管线。
- `destructive`：标记为破坏性并默认确认，不提供永久授权建议。

Tool 调用仍经过 Moss 的通用 Tool 校验、权限 hook、审计、Action schema、队列、超时和取消链路。App、grant 或实例在调用前被停用时，Runtime 会在 Backend handler 之前拒绝请求。Phase 1 只把 App Tool 注入本地 Desktop Session；Remote Direct 的 Server Tool 注入在后续阶段实现。

## Server owner

Server 上的 installation、instance、deployment、密钥、数据目录和日志均绑定到以下 owner 之一：

- `user`：默认值，绑定当前认证用户和组织。
- `org`：绑定当前组织，只允许管理员选择。
- `host`：绑定整台 Server，只允许管理员选择。

HTTP API 使用查询参数 `owner_scope=user|org|host`；带 JSON body 的变更请求也可使用 `ownerScope`。路由从认证上下文生成 owner，忽略 App 自报身份。相同 App ID 和实例 ID 可在不同 owner 下并存，查询、Action、日志、密钥、事件和 deployment lease 均隔离。

## 包签名与 Catalog

可选的 `app-signature.json` 使用 Ed25519 签署由 App ID、版本、publisher/key ID 和规范化 `checksums.json` 组成的载荷。Runtime 将包标记为 `trusted`、`untrusted` 或 `unsigned`；要求可信发布者的 Catalog source 会拒绝未签名、未知密钥或验签失败的包。

`checksums.json` 覆盖除自身和 `app-signature.json` 之外的所有包文件，因此 Manifest 和运行代码都进入签名载荷。App Center 会展示 trust 状态；当前 Backend 进程不是 OS sandbox，只有第一方或明确可信来源的 Backend App 才应被启用。

## 传输保证

- 消息使用 App Service v1 envelope，并校验 generation 与每次启动随机生成的 launch token。
- 普通 payload 必须是可序列化 JSON 对象，默认消息上限为 1 MiB；大文件和流应使用后续资源 handle API。
- Host 请求及事件均有限流、超时、取消和重复 ID 防护。
- 处理器在 schema、Manifest protocol、permission、installation grant、owner 和运行状态校验通过后才会执行。
- Backend 退出、App 停用、grant 撤销或 deployment generation 改变时，等待中的工作会失败，旧进程消息会被拒绝。

Channel 专用方法、事件及幂等要求见 [Channel Host API](./channel-host-api.md)。整体拆分顺序和模块边界见 [App 模块化迁移计划](./app-modularization-migration-plan.md)。
