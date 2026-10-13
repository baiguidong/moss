# Core 托管的配置型 MCP App：Draw.io

2026-10-13，macOS arm64。Core 已支持配置型 MCP App：只安装 Draw.io，Core 直接提供公共设置页、MCP 注册与运行管理。无需安装基础 App。按本轮要求，不实现老数据迁移或旧客户端兼容。

## 实现

| 组成 | 位置 | 职责 |
| --- | --- | --- |
| Draw.io 定义 | `moss-apps/mcp-apps/drawio/app.json` | 名称、说明、示例、图标路径及 `npx -y @drawio/mcp` |
| Draw.io 资源 | `moss-apps/mcp-apps/drawio/resources/` | 图标与 README |
| Core 生成器 | `packages/app-runtime/src/packages/generate-mcp-app.mjs` | 校验定义与资源，生成配置包 |
| Manifest / 包校验 | `packages/app-sdk/src/schemas/`、`packages/app-runtime/src/packages/` | 识别内置 UI，校验配置，限制配置包中的执行入口和权限 |
| 公共 UI | `ui/src/apps/mcp-app-ui/` | Git、Filesystem 风格的服务页和设置弹窗，内容来自 App 定义 |
| UI 解析 | `ui/src/app-platform.mjs` | 从 Core 构建目录加载公共页面，保留 Draw.io 的身份和图标 |
| MCP 注册 | `ui/src/apps/app-mcp-host.mjs` | 从包内配置注册服务，复用已有凭据、工具目录和会话接入 |

公共页面编译到 `ui/dist/mcp-app/`，由开发启动及 Desktop 构建脚本自动生成，并纳入 Electron 包资源检查。浏览器 SDK 只打包进这一份 Core 页面。每个配置型 App 均复用此页面，其 Host 请求绑定各自 App 身份，服务、凭据和使用范围独立保存。

## 格式

配置输入最小示例：

```json
{
  "schemaVersion": 1,
  "id": "moss.drawio",
  "version": "0.1.3",
  "displayName": "Draw.io",
  "mcpServers": {
    "drawio": { "command": "npx", "args": ["-y", "@drawio/mcp"] }
  }
}
```

可选 `description`、`category`、`keywords`、`icon`、`toolScope`、`runtime` 和 `presentation`。`presentation` 提供 `headline`、`examples`、`usage`，用来生成服务说明和使用指南。无需为新服务编写 UI。

生成的 Manifest 使用：

```json
{
  "hostApi": "^3.9.0",
  "ui": { "builtin": "mcp" },
  "mcpApp": { "config": "mcp.json" }
}
```

内置 UI 不声明包内 `ui.entry`，不引用其他 App。MCP 配置型包没有 Backend 或 native adapter，只请求 `mcp:read`、`mcp:manage`、`mcp:connect` 权限。Draw.io 生成包含六个文件：

```text
app.moss.json
mcp.json
definition.json
assets/icon.svg
README.md
checksums.json
```

`definition.json` 保存可重新生成的原始定义。`mcp.json` 是规范化后的 MCP 配置，服务名称为 `moss_drawio__drawio`。用户设置跨刷新和重启保留；Host API 3.10 起，包内 MCP 配置修订时按原默认值、用户设置和新默认值合并，保留用户目录、禁用工具、凭据、启停状态及服务身份。

## 复现与使用

在 Moss Core 仓库执行：

```sh
node ui/scripts/build-mcp-app.mjs
node scripts/verify-mcp-app.mjs
cd ui
./node_modules/.bin/electron tests/mcp-app.electron.mjs
```

验证脚本使用隔离的临时 `MOSS_HOME`，测试结束后清理。MCP Host 使用现有 `ui/electron-direct.mjs` 构建产物；新环境先按仓库文档构建运行时。应用定义默认取自相邻 `moss-apps`，可用 `MOSS_APPS_ROOT` 覆盖。

只生成安装包：

```sh
drawio_output="$(mktemp -d)"
node scripts/generate-mcp-app.mjs \
  --definition ../moss-apps/mcp-apps/drawio/app.json \
  --resources ../moss-apps/mcp-apps/drawio/resources \
  --out "$drawio_output/package" \
  --zip "$drawio_output/moss.drawio-0.1.3.zip"
```

使用当前仓库的 Core 启动 Moss，在应用管理导入单个 Draw.io ZIP，然后打开其设置页或在会话中选用。要求包含本次功能的 Host API 3.9；已安装的旧版客户端不能仅通过导入 ZIP 获得 Core 功能。

## 实测

- 在空的临时环境只安装 `moss.drawio`，安装、应用身份、会话选择与公共 UI 加载通过。
- 原样运行 `npx -y @drawio/mcp`，解析到 `drawio-mcp 1.6.3`，发现 7 个真实工具。
- 实际调用 `open_drawio_mermaid` 返回 Draw.io 编辑器 URL；用 `set_page` 保存图表，关闭并重新启动服务后，通过 `get_page` 读回的 XML 完全一致。其余工具为 `open_drawio_xml`、`open_drawio_csv`、`list_pages`、`get_page`、`set_page`、`search_shapes`。
- 完整 Desktop 使用实际安装 IPC、App 协议和 preload，验证页面、设置保存、工具搜索、工具排除、范围修改、服务启停、无效 JSON、连接失败及恢复。
- 应用启停、权限撤销、重启恢复、卸载通过。
- 5 项配置包测试，以及 MCP 生命周期、会话回收、设置和远程会话的相关回归测试通过。Desktop UI 与公共页面 TypeScript 检查、SDK 类型导出和 Host 契约一致性检查通过；Core 根目录全量 TypeScript 检查仍有仓库原有错误，不能视为通过。与 HEAD 的隔离快照比较，诊断数从 4096 降为 4093，去掉路径和行号差异后没有新增诊断。
- 浅色、深色、窄窗口和设置弹窗截图已人工检查。

[Host 证据](../../output/mcp-app-proof/verification.json)、[Desktop 证据](../../output/mcp-app-proof/desktop-verification.json)、[真实工具返回](../../output/mcp-app-proof/drawio-tool-result.json)、[当前安装包](../../output/mcp-app-proof/moss.drawio-0.1.3.zip)。交付包和截图同时位于相邻 `moss-apps/artifacts/moss.drawio/0.1.3/`。

## 连接生命周期与会话隔离

`toolScope: "global"` 表示每个会话都可使用该 App。MCP 连接仍属于各自的会话运行时，每次运行时重建都有新的生命周期标识；两个会话不会因为选择全局而共用本地 stdio 服务进程。HTTP/SSE 同样各建连接，但远端服务是否按连接隔离业务数据取决于服务端。

配置型 App 没有常驻 Backend。只提供 tools 的服务首次发现目录时会短暂启动，取完目录即关闭；缓存命中后，实际调用工具才启动会话连接。只缓存工具说明和 schema，不缓存结果或服务状态。目录按配置、工作目录和启动环境区分，最多 128 项、8 MiB、有效期 10 分钟。提供 resources/prompts 的服务保留连接式发现流程，不承诺延迟启动。

运行时关闭、会话删除、App/服务停用或撤销访问时，Core 回收对应连接、发现缓存和 stdio 子进程树，包括 `npx` 的子进程。启动中取消也会回收。修改 App 只刷新使用它的会话；新增全局工具则刷新所有本地会话。受影响的忙碌会话在本轮结束后重建运行时，访问撤销立即生效。会话运行时重建会清除该运行时中的服务内存状态。

Core 进程内统一限制 64 个活跃连接（含启动中）、4 个并发启动、128 个等待启动。达到上限会返回错误，关闭不使用的会话或停用服务后可以重试。不会为腾出位置自动关闭有状态服务。

默认 `runtime.state` 为 `session`：使用后保留连接，并阻止所属会话运行时自动回收。Core 无法判断第三方是否保存了内存数据，只有确定重启不丢业务状态的服务才声明以下配置，生成器将其写入 `mcpApp.runtime`。Draw.io 0.1.3 已声明可安全重启，当前验证版本为 `@drawio/mcp` 1.6.3：

```json
{ "runtime": { "state": "stateless" } }
```

可安全重启的服务默认空闲 60 分钟回收。App 可提供 `idleTimeoutMs` 建议值（1 秒至 1 小时）；Desktop 使用用户设置的全局回收时间（1–1440 分钟），覆盖 App 建议值。设置修改会应用于现有连接，不会重新计算最后使用时间；执行中的请求结束后才重新计时。下次工具调用自动连接。该声明不会改变工具可用范围，也不会让不同会话共用进程。

独立进程只隔离进程内状态，不能隔离同一 Git 工作区、同一路径文件、数据库或远端账号的业务数据。并发修改仍须依靠独立 workspace/worktree、资源标识或服务端并发控制。

可执行 `node scripts/verify-mcp-lifecycle.mjs` 验证实际 `ClaudeSession` 的关闭、撤销、初始化中取消与同一会话 ID 的运行时代次替换，结果保存为 [生命周期证据](../../output/mcp-app-proof/lifecycle-verification.json)；配合 `src/services/mcp/lifecycle.integration.test.ts` 验证目录缓存、延迟连接、两个全局会话的独立状态、长请求期间不回收及空闲重连。子进程树测试在 macOS 通过，Windows `taskkill /T` 分支未实机验证。

## 会话运行时回收

“设置 → 高级设置 → Agent 与执行”新增三个可保存的配置：

| 配置 | 默认 | 范围 |
| --- | --- | --- |
| 会话运行时空闲回收 | 60 分钟 | 1–1440 分钟 |
| 最多保留会话运行时 | 15 个 | 1–100 个 |
| MCP 服务空闲回收 | 60 分钟 | 1–1440 分钟 |

`settings.json` 保存为 `runtimeLifecycle: { sessionIdleMinutes: 60, maxSessionRuntimes: 15, mcpIdleMinutes: 60 }`。设置失焦后保存，无需重启。池每 30 秒检查一次；数量达到上限时，启动新会话前优先释放空闲最久的运行时。正在创建和异步关闭的运行时也占用名额，避免短时间超量启动。

忙碌、准备请求、同步记录、等待用户确认、后台任务和保留第三方 MCP 状态的会话不会被自动回收。全部受保护时，启动队列最多 32 个，等待最多 60 秒，超时提示重试、停用闲置服务或调整数量上限。降低上限不会中断正在工作的会话，因此现有忙碌运行时可能暂时超过新上限。未知服务使用保守保留策略；这不能承诺所有第三方进程都在一小时后退出，但进程连接总数和会话数都有预算限制。

释放前先刷新 transcript，并验证存在可恢复记录。保存失败则保留运行时；保存期间有新请求到达，即使请求已完成，也取消本次回收。历史记录和工作区文件不删除。下次发送消息自动通过原会话 ID 和 transcript 恢复；单纯浏览历史无需启动模型。会话运行时回收也释放它持有的可安全重启 MCP 连接；如果希望 MCP 保留更久，还需相应增大会话回收时间。首次恢复可能多一次初始化/进程启动耗时。

数量上限约束 Desktop 管理的会话运行时；项目收尾与记忆整理使用各自短期运行时并在任务完成后释放。当前仓库没有 ACP 通道；Remote Direct 只释放本地连接并按既有流程重新附加远端会话，远端进程生命周期由服务端负责。

可在 `ui/` 执行 `./node_modules/.bin/electron tests/runtime-recycling.electron.mjs`。隔离 Desktop 调用本地模拟模型，推进时钟验证 59 分钟保留、60 分钟回收、恢复原聊天内容和会话 ID、数量上限下恢复正确会话、执行中不回收以及设置页面保存生效。没有等待真实一小时，也没有调用云模型。[结果](../../output/mcp-app-proof/runtime-recycling-verification.json) · [设置截图](../../output/mcp-app-proof/runtime-recycling-settings.png)。单元测试另外覆盖 50 个会话最多保留 15 个、保存失败、回收竞争、启动中退出、繁忙队列和服务状态保护。

## 当前范围

这是 Draw.io 最初的 Core 验证记录。后续市场构建流程已接入，分步思考及 Filesystem 已转换为配置型 App；Git 仍为普通 App。远程 HTTP/OAuth 使用现有协议接口，本记录仅实测 Draw.io stdio。

npx 命令保留用户指定的未锁版本形式，首次连接可能下载依赖，上游版本可能变化。这里的 App 资源指图标与说明；网页内嵌 MCP Apps 扩展与 MCP resources/read 不在此次验证范围。

此前 `0.1.0`、`0.1.1` 是独立基础 App 方案的历史产物，不用于当前实现。
