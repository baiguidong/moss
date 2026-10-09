# MCP App 与 Desktop Host

MCP 管理界面位于独立仓库 `moss-apps/apps/mcp`。Desktop 不再提供设置页内嵌的 MCP 编辑器，也不再暴露旧的 list/upsert/remove/set-enabled renderer IPC。原有对话和连接器的 OAuth IPC 继续可用，并能解析 App 管理的服务。

## Host API 2.4

`moss.mcp/v1` 是 Desktop 注册的版本化 Host 协议，App 用 SDK 的 `backend.host.request(protocol, method, input)` 调用。协议不接受调用方传入 App ID、实例 ID、存储路径或跨应用目标。

| 方法 | 权限 | 输入 |
| --- | --- | --- |
| `servers.list` | `mcp:read` | `{}` |
| `servers.save` | `mcp:manage` | `{ name, previousName?, enabled, config }` |
| `servers.remove` | `mcp:manage` | `{ name }` |
| `servers.set-enabled` | `mcp:manage` | `{ name, enabled }` |
| `servers.inspect` | `mcp:connect` | `{ name }` |
| `auth.start` / `auth.clear` | `mcp:auth` | `{ name }` |

所有方法返回 `{ servers, resetSessionCount?, skippedBusySessionCount? }`。服务条目包含名称、启用状态、去除敏感值的 config、修改时间、是否缺少凭据和最近一次检查结果。连接失败作为 `check.state = failed` 返回脱敏原因，取消或权限失败作为操作错误返回。检查结果仅保存在 Host 内存。

`config` 沿用 `validateMcpServerConfig`，支持 stdio 的 command/args/env 和 HTTP/SSE 的 url/headers/oauth，以及 disabledTools。读取时 env/headers 的值为空字符串；更新时已有同名字段的空字符串保留旧值，移除键删除对应值。App 的 secrets schema 声明可选的 `mcpSecrets` 字符串，由 Host 维护。

stdio 的 command 和 args 支持当前用户目录缩写 `~`、`~/`、`~\`，参数也支持 `--output-dir=~/...`。Host 在向对话提供配置、查询单个服务和检查连接时展开路径；存储、列表和迁移比较保留原始值。不启动 shell，不展开环境变量或其他用户的 `~user`。

每个 App 最多新建 100 个服务；配置文件上限 256 KB，密钥暂存上限 512 KB，列表中的工具描述共享 400 KB 预算。连接检查最多展示 200 个工具，实际 AI 工具链路不受展示上限影响。

## 数据和生命周期

配置保存到当前 App 实例私有目录的 `mcp-servers.json`，凭据值保存在同一 App/实例的 Credential Vault。更新先写新旧密钥集合，再原子提交配置，最后回收过期密钥，避免中途失败造成旧配置失去凭据。

官方 `moss.mcp` 保留历史服务名；其他 App 使用带 App 前缀的运行时名称，并检查工具名称规范化后的冲突。Host 按安装启用状态、实例启用状态、版本及 `mcp:manage`/`mcp:connect` grant 筛选会话接入。运行中的会话仍使用现有 `scheduleMcpRuntimeReload` 延后重建规则。

启动及安装状态变化时加载已安装 App 的服务。官方 App 获得管理和连接授权后迁移 `settings.mcp`；新配置和凭据持久化后才清空旧设置。迁移前沿用旧配置，迁移失败保留原值。卸载或停用后不再注入 App 服务；是否删除私有数据和凭据由既有卸载选项决定。

MCP App 自己在后端初始化阶段通过 list/save 注册内置 `playwright-cdp`，不覆盖已有同名配置；Desktop Host 不硬编码内置服务名单。

MCP 客户端、工具发现/调用、资源和 prompt 处理仍在 Core。App 不通过 `contributes.tools` 静态包装 MCP 工具，也不增加通用 `call_tool` 代理。`servers.inspect` 在独立 session cache 中短暂连接并关闭，避免干扰对话连接。OAuth 沿用既有授权客户端与 token 存储，新增取消信号传递。

## 工具目录展示

MCP App 首次打开、启用和编辑服务后，会自动对当前可见且已启用的服务执行 `servers.inspect`。检查结果只合并到相同配置版本，取消、切换和停用后的旧响应不会覆盖当前状态。已有失败或待授权结果不会反复自动重试。

Desktop 的 `app:list` 同时返回静态 `agentTools` 与动态 `mcpServices`，动态目录不包含启动参数或凭据。设置 → 工具会按服务加载缺失目录，通过仅面向 Desktop 的 `app:inspect-mcp-tools` IPC 复用 Host 检查流程，并展示启用、授权、连接失败和排除状态。Host 按 App/实例/服务版本复核权限，目录更新单独发送 `app:changed` 事件，不重建对话运行时。此展示修复需要更新 Desktop，单独升级 MCP App 不会更新 Desktop 设置页。

工具搜索命中后，MCP 按 `mcpInfo.serverName` 激活同一服务的全部可用工具；其他 App 的静态工具按 Host 注入的 `appInfo.appId` 整组激活。分组使用真实来源元数据，不从展示名称或规范化前缀推断。`max_results` 仅限制搜索命中数，整组展开不截断；已排除或不在当前工具池内的工具不会加入。整组工具沿用会话内的发现状态，后续请求和上下文压缩后继续可用，新会话仍按需发现。

## 验证

`ui/tests/app-mcp-host.test.ts` 覆盖迁移失败保护、加密与脱敏、跨 App 隔离、并发保存、权限与生命周期、凭据清除和错误状态。App 仓库提供真实 Core Backend/Host IPC 的安装包验证脚本，并通过临时 HTTP、SSE、stdio 服务检查实际连接、分页工具发现和凭据传递。

App 仓库 `apps/mcp/scripts/verify-tool-ui.mjs` 使用实际安装包、Host、Desktop IPC 和 Chromium 验证两处工具目录，包括首次发现、启停、配置更新、排除项、失败重试和过期结果处理。
