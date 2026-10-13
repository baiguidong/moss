# Browser Use 独立 App 抽取规划

> 2026-10-12 更新：本文记录最初抽取方案。系统 Chrome 自动启动设计已由 0.1.3 的[双模式浏览器修复](browser-use-chrome-fix.md)取代。

日期：2026-10-10。状态：已实现并完成本地安装包验证，见 [实现与验证](browser-use-app-delivery.md)。本方案按用户要求收窄为现有实现的直接抽取。

目标：把 MCP 管理 App 内置的 Playwright CDP 能力抽成独立的「网页操控 · Browser Use」App，保留现有 MCP 注册、启动、工具发现和执行方式。启用新 App 后自动注册并检查连接，触发已有启动器开启或连接浏览器。

本次不做旧配置迁移、凭据转存、工具权限引用迁移、归属切换记录、旧版本兼容过渡或 Core MCP 生命周期改造。Browser Use 从自己的默认配置开始，后续只管理自身配置。

## 1. App 定义

| 项目 | 方案 |
| --- | --- |
| App ID | `moss.browser-use` |
| 名称 | 网页操控 · Browser Use |
| 源码目录 | `moss-apps/apps/browser-use/` |
| 形态 | 独立 UI + persistent Backend |
| Host 协议 | 现有 `moss.mcp/v1` |
| 权限 | `mcp:read`、`mcp:manage`、`mcp:connect` |
| 内部服务名 | `playwright-cdp` |
| 执行引擎 | 随包提供现有 `@playwright/mcp@0.0.83` 及生产依赖 |
| 分发 | 沿用独立官方 App 的安装、签名和市场更新方式 |

首版提供一个默认实例和一套浏览器配置。App 运行与 MCP 管理 App 相互独立，无需安装或启用 MCP 管理 App。

## 2. 直接复用现有实现

| 现有 MCP App 中的实现 | 抽取方式 |
| --- | --- |
| `src/builtins.ts` 的 Playwright 默认配置 | 放入 Browser Use，作为新 App 自己的默认服务 |
| `src/backend/backend.ts` 的初始化注册逻辑 | 复用 list/save 和幂等注册，读取和更新本 App 的服务 |
| `src/backend/builtin-config.ts` 的启动路径定位 | 保留当前 Node 和 App 包路径定位，重启和升级时定位到自身安装版本 |
| `src/playwright-cdp/browser.cjs` | 复用 Chrome 查找、CDP 检查、自动启动、专用用户目录和并发启动锁 |
| `src/playwright-cdp/cli.cjs` | 复用 stdio 启动和错误反馈 |
| `scripts/build.mjs` 的依赖打包 | 在 Browser Use 中独立打包 Playwright MCP、生产依赖、资源和许可证 |
| 连接配置、工具目录与检查 UI | 复用现有逻辑，整理成单个浏览器的独立页面 |

使用现有默认值：

- CDP 地址：`http://127.0.0.1:9222`。
- 输出目录：`~/.moss/artifacts/playwright`。
- 默认浏览器用户目录：`~/.moss/browser-profiles/playwright-cdp-9222`，端口变化时沿用现有对应目录规则。
- 系统 Chrome 由现有启动器查找，Node 由 Moss 提供。运行阶段使用随包依赖。

沿用默认浏览器目录是复用现有路径规则，不进行目录搬运或账号数据复制。新 App 不读取 MCP App 或旧 `settings.mcp` 的配置与凭据，也不保留接管旧 npx 预设的逻辑。

## 3. 启用与运行流程

1. 用户启用 Browser Use，现有 App Runtime 启动 persistent Backend。
2. Backend 通过 `servers.list` 读取自身服务；不存在时，通过 `servers.save` 创建默认启用的 `playwright-cdp`。
3. 若已有自身配置，保留其连接选项，仅按现有方式定位当前受管启动器路径。
4. Backend 完成握手后主动执行 `servers.inspect`，无需等待用户打开页面。
5. 现有启动器检查 CDP：已可用则复用；默认本机端点未开启则启动 Chrome；失败则返回现有错误。
6. 检查结果进入 App 页面和动态工具目录。普通对话通过现有 ToolSearch 和 MCP 工具进行导航、截图、读取、点击与输入。

相较现有实现，新增的运行行为仅为：把连接检查放到新 App 启用后的 Backend 流程中，满足“启用后就开启浏览器控制”。浏览器准备在 Backend 握手完成后执行，避免阻塞握手；失败提供重试，重复初始化不重复注册。

| 操作 | 行为 |
| --- | --- |
| 启用 App | 自动注册自身服务并检查连接，启动或连接浏览器 |
| 关闭 App 页面 | 保持 App 和浏览器能力可用 |
| 修改连接配置 | 保存自身 MCP 配置，重新检查连接 |
| 重启 App 或 Moss | 按已有启用状态恢复，复用配置并重新检查 |
| 停用 App | 沿用现有 App MCP 规则：不再向新运行时注入；空闲会话刷新，忙碌会话完成后刷新 |
| Chrome 未安装、端口占用、路径错误 | 展示原因，提供重新检查或修改配置入口 |

首版用 App 管理页现有主开关控制启停，浏览器服务默认开启，独立页面不再增加第二个默认关闭的开关。停止 MCP 后保留 Chrome 窗口和专用目录，沿用现有行为。本次不新增忙碌会话的即时中断机制。

## 4. 独立页面

页面围绕一套浏览器配置展示：

| 区域 | 内容 |
| --- | --- |
| 标题 | 网页操控 · Browser Use，官方标识 |
| 状态 | 正在配置、正在连接、检查通过、连接失败，附最近检查时间 |
| 浏览器 | 当前连接目标、系统 Chrome 与专用用户目录说明 |
| 操作 | 重新连接、编辑连接配置、查看工具 |
| 使用说明 | 启用后在对话中描述网页操作；网站登录在受控 Chrome 中完成 |
| 高级配置 | CDP 地址、Chrome 路径、用户目录、输出目录及现有兼容参数 |
| 工具详情 | 现有动态工具目录、工具说明和排除状态 |

移除通用 MCP 服务列表、添加服务、删除服务和服务名称管理。连接检查继续表达“最近检查结果”，不新增持续健康监控。对远程 CDP 沿用现有仅连接行为，不把 MCP 工具目录检查成功等同于浏览器已验证可操作。

页面说明受控 Chrome 与 Moss 内嵌浏览器的区别。Computer Use 和 Moss 内嵌浏览器本轮保持现有实现。

## 5. MCP App 与 Core 配套调整

MCP 管理 App 移除 Playwright 的内置注册、专用标识、内置服务编辑限制及相关依赖打包，保留客户自建 MCP 服务的管理功能。更新其说明和测试，使全新安装不再自动出现 Playwright 服务。

已保存的旧服务记录不做自动搬运、删除、重写或兼容处理；仍在 MCP App 中的记录按普通服务管理。新 App 使用自身默认配置和 App 命名空间，不承诺旧工具名称或旧权限引用自动沿用。

Core 复用现有 `AppMcpHost`、凭据存储、生命周期、工具目录和 MCP 客户端。新 App 的运行时服务名按现有规则生成为 `moss_browser_use__playwright-cdp`，最终工具名称由现有 `buildMcpToolName` 生成。

必要的配套工作只有：

- 更新 `src/tools/MossTool/MossTool.ts` 中浏览器自动化的服务指引，使 ToolSearch 能定位 Browser Use 提供的工具。
- 确认“设置 → 工具”按现有动态目录把工具展示在 Browser Use 下。
- 保持按真实 `mcpInfo.serverName` 分组的工具发现，继续使用标准 MCP 调用与结果处理。
- 更新 `ui/docs/mcp-app.md` 及两个 App 的 README、市场描述。

不新增 BrowserUseTool、静态工具包装、通用 call_tool 代理、Host 协议或跨 App 数据接口。

## 6. 实施步骤

| 阶段 | 工作 | 交付 |
| --- | --- | --- |
| P1：抽取 | 新建 Browser Use App，抽取默认配置、Backend 注册、启动器和依赖打包；移除 MCP App 的对应内置能力 | 两个 App 各自构建，新 App 可独立注册 Playwright MCP |
| P2：页面与自动连接 | 整理独立页面，启用后主动检查连接，接通状态、配置和重试 | 不打开页面也能启动浏览器控制，页面能管理自身配置 |
| P3：验证与说明 | 更新工具搜索指引、说明和市场信息，完成真实安装包与浏览器验证 | 可安装的独立 App 及实际验证记录 |

主要改动集中在 `moss-apps/apps/browser-use/` 和 `moss-apps/apps/mcp/`。Moss 主仓库只做必要的工具指引、展示验证和文档调整。

## 7. 验收

1. 全新安装 MCP App 不再自动注册 Playwright；普通 MCP 的添加、编辑、连接与启停正常。
2. 仅安装 Browser Use，未安装 MCP App，也能完成注册和真实网页操作。
3. 启用 Browser Use 后不打开页面，Chrome 仍自动启动或复用，连接检查完成。
4. 重启、重复初始化和并发连接不重复注册服务、不重复启动同端点 Chrome；自身配置保存后能恢复。
5. Chrome 缺失、端口占用、配置错误可在页面看到原因，修复后能重试成功。
6. 停用、重新启用、关闭页面和会话刷新符合现有 App MCP 行为；MCP App 的启停不影响 Browser Use。
7. 工具目录归属正确，ToolSearch 找到新 App 的真实 MCP 工具；用本地测试网页验证导航、读取、输入、点击和截图。
8. 使用打包后的 App 和 Moss Node，在无需 npm 缓存或在线下载依赖的条件下完成运行验证。

优先搬用现有 Backend、浏览器启动器和真实安装包验证脚本，新增覆盖只针对独立注册、启用自动检查及新工具归属。验收使用独立测试数据，不加入旧配置兼容测试。

本方案已落地，实际测试范围、安装包和证据以 [实现与验证](browser-use-app-delivery.md) 为准。
