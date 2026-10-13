# Browser Use 独立 App 实现与验证

> 2026-10-12 更新：本文是 0.1.0 的历史验收。0.1.3 提供专用浏览器与日常 Chrome 两种模式，专用浏览器使用独立应用身份，不再占用系统 Chrome；见[修复与验证](browser-use-chrome-fix.md)。

日期：2026-10-10。状态：已实现，已生成并验证本地安装包。

按照用户确认的范围，直接从 MCP App 抽取内置 Playwright 实现。没有添加旧浏览器配置迁移、兼容过渡、Core MCP 生命周期改造或新的浏览器工具协议。

## 实现

- 新增 `moss.browser-use@0.1.0`，显示名称为“网页操控”，独立页面展示 Browser Use、连接状态、连接设置、重连和工具目录。
- persistent Backend 初始化时通过已有 `moss.mcp/v1` 注册自己的 `playwright-cdp`。Backend 握手完成后主动检查连接，触发现有启动器启动或复用 Chrome，无需先打开页面。
- 启动与重连共享准备任务；保存配置取消旧检查，旧结果不覆盖新配置。检查失败可重试；重连请求本身失败时保留错误提示。
- 保留 Playwright MCP `0.0.83`、原 Chrome 查找/启动逻辑、专用用户目录、并发启动锁和随包依赖。由 Moss 的 Node 运行时启动 stdio 服务。
- 新 App 使用自身配置与凭据作用域，运行时服务名由现有 Host 生成为 `moss_browser_use__playwright-cdp`，工具仍通过 Core 原生 MCP 发现和调用。
- MCP 管理更新为 `0.1.8`，移除浏览器内置注册、专用展示/编辑限制和 Playwright 依赖打包。已有记录按普通服务管理，不做搬运、删除或重写。
- Core 仅更新浏览器工具指引，并补充新 App 与客户同名服务的工具分组测试。既有注册、权限、生命周期和工具目录实现继续复用。

主要源码入口：

- [Browser Use Manifest](../../../moss-apps/apps/browser-use/app.moss.json)
- [独立页面](../../../moss-apps/apps/browser-use/src/App.tsx)
- [连接设置](../../../moss-apps/apps/browser-use/src/components/browser-editor.tsx)
- [Backend 注册与连接准备](../../../moss-apps/apps/browser-use/src/backend/backend.ts)
- [现有 Chrome 启动器](../../../moss-apps/apps/browser-use/src/playwright-cdp/browser.cjs)
- [MCP 管理 Backend](../../../moss-apps/apps/mcp/src/backend/backend.ts)

## 验证结果

| 验证 | 结果 |
| --- | --- |
| Browser Use TypeScript / Manifest | 通过 |
| MCP 管理 TypeScript / Manifest | 通过 |
| Browser Use Backend、配置与启动器测试 | 15 / 15 |
| MCP 管理 Backend 测试 | 3 / 3 |
| Core MossTool / ToolSearch 分组测试 | 21 / 21 |
| Browser Use 页面测试 | 4 / 4，含重连失败、配置保存、明暗主题、320px 窗口 |
| MCP 管理页面测试 | 17 / 17 |
| 两个 App 源码快照重建、安装包和 Backend 握手验证 | 通过 |
| Core 本地运行时构建 | 通过 |

相关自动化测试合计 60 项通过，不包含打包时对同一套测试的重复运行。

真实执行在 macOS Apple Silicon（`darwin-arm64`）完成：

1. `apps/browser-use/scripts/verify-host.mjs`：在临时 Host 安装实际 ZIP，不安装 MCP App，也不打开页面，自动完成浏览器启动和工具检查；发现 25 个原生 MCP 工具。
2. 使用该包的 MCP 服务操作本地测试网页，完成导航、内容读取、输入、点击和截图，验证页面结果 `Saved Browser Use`。运行时清空 PATH/npm 缓存，并阻断 MCP 进程的外部网络连接。
3. 实际安装包页面由 Chromium 加载，连接真实 App Backend、Host 和 MCP；完成工具展示、设置保存和自动重连。App 停用后不再向新运行时提供服务，Chrome 窗口保留；重新启用后自动检查。
4. `apps/browser-use/scripts/verify-browser-startup.mjs`：使用包内启动器验证关闭端口下的冷启动、两个 MCP 进程并发复用一个 Chrome、实际网页操作和 MCP 重启复用。
5. `apps/mcp/scripts/verify-host.mjs`：验证通用 HTTP、SSE、stdio 连接、凭据与生命周期；保留原通用 MCP Host 测试，不涉及浏览器跨 App 迁移。
6. `apps/mcp/scripts/verify-tool-ui.mjs`：用显式创建的测试 MCP 服务验证 App 与 Desktop 设置页的动态目录、启停、工具排除、失败重试和过期结果处理。

Browser Use Host 测试在注册边界将默认 CDP 端口、用户目录和输出目录替换为临时测试值；实际 Backend、Host 存储、MCP 客户端与包内启动器均正常运行。测试不使用用户已有浏览器配置。页面验证使用 Chromium 和真实 Backend/Host 桥接，不等同于整个 Electron Desktop 的全流程测试。

验证记录与截图：

- [Browser Use Host 验证](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.0/host.json)
- [冷启动与并发复用](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.0/browser-startup.json)
- [真实安装包页面](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.0/installed-app.png)
- [真实网页操作截图](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.0/browser-form.png)
- [MCP 两处工具目录验证](../../../moss-apps/artifacts/moss.mcp/verification/0.1.8/tool-ui.json)

## 安装包与运行边界

本地安装包包含可重建源码，当前为未签名产物：

- [Browser Use 0.1.0](../../../moss-apps/artifacts/moss.browser-use/0.1.0/moss.browser-use-0.1.0.zip)，SHA-256：`8bde82324896293e017325ecbd127e593b616b18c605de87da00f46f564abc5e`。
- [MCP 管理 0.1.8](../../../moss-apps/artifacts/moss.mcp/0.1.8/moss.mcp-0.1.8.zip)，SHA-256：`4e8caeeedc7062112f20ef8b645a7e61885941370d2f2ecdba7cb6383d7d1644`。

系统需要安装 Chrome。App 停用沿用现有 MCP 会话刷新规则，忙碌会话结束后刷新；停止 MCP 保留 Chrome 和浏览器用户目录。远程 CDP 仅沿用原连接能力，工具目录检查成功不代表远程浏览器已经验证可操作。Windows 与 Intel macOS 保留启动器原支持逻辑，本轮未在这些平台实测。
