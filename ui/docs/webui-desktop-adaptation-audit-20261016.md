# WebUI / Desktop 适配审计与完成记录（2026-10-16）

按用户确认的分批方案完成实现，并在完成后 review、修复和回归。2026-10-19 已随 `0.0.1-webui.20261019.3` 的 CI 镜像部署到 181，两台已有云电脑原地升级，容器及 HOME 保留。完整云端 Chromium 远程视图按此前约定暂缓；配置前提和当前限制见下文。

设计约束见 [适配方案](webui-desktop-adaptation-plan.md)，运行架构见 [环境说明](desktop-webui-cloud-environments.md)。

## 已完成的适配

| 批次 | 范围 | WebUI 的实际行为 |
| --- | --- | --- |
| 前置 | 主会话、工作区、附件、技能导入、定位文件 | 可浏览云电脑目录，不再只能手填绝对路径；支持路径跳转、搜索、隐藏项、分页、选定时重新校验；文件可以从浏览器设备上传 |
| A | Host 能力契约 | 握手、启动状态和 `host:capabilities` 提供版本及功能开关；入口据此选用 Web 流程，Host 独立校验调用 |
| A | 权限与确认 | 完整详情独立于通知摘要；默认焦点为取消；取消、关闭和 Escape 拒绝；“稍后处理”独立；刷新和重连重新加载；多标签仅一次有效响应 |
| A | ZIP、市场、创作安装及预览授权 | 浏览器选择 ZIP；披露身份、权限、工具、skills、原生适配器及摘要；确认后复核内容、安装版本和 grants；市场 `acceptPermissions` 不能绕过 Host 确认 |
| A | App 修改配置、证书更换 | 接入同一确认服务，保留配置脱敏、revision 校验及回执；证书确认展示目标地址和旧/新指纹 |
| A | 终端 | 稳定逻辑 ID、退出状态及 generation；刷新重接，退出后可重启；并发重启去重、旧输入拒绝；关闭视图仅 detach，终止按钮显式停止 |
| A | 输入草稿 | IndexedDB 按用户/Host/会话隔离，恢复文字和上传附件引用；不同页面的写入保留独立副本，可手动合并；登出清理当前身份的数据 |
| A | 外链、下载、日志 | 点击时预留页面并检查弹窗拦截；文件和日志使用浏览器下载；Web 不初始化桌面更新弹窗 |
| B | 标准 MCP 与 Remote Server OAuth | 用户浏览器授权，Host 保存 state、PKCE 和结果；HTTPS 回调经 Gateway 精确路由；重复、错误、取消和过期回调拒绝；同一 MCP 服务并发授权互斥 |
| B | HTML、App 资源及独立预览 | 受限资源树支持相对 JS/CSS/图片，本地与远端分别读取；独立预览有可刷新的页面句柄；HTML 保持 opaque origin，不能读取主页面或管理 API |
| B | 预览编辑权 | 断线冻结编辑/保存；未同步内容存入浏览器；重连以新 client/generation 获取 Host 状态；冲突展示对比并手动恢复，旧响应不能覆盖新状态 |
| C | App 页面、设置、工作台、小组件 | 共用隔离 iframe 和 MessageChannel；Host 绑定 App/版本/用户/连接并复用 Runtime grant 校验；iframe 不获得根客户端；关闭、导航、断线或更新撤销上下文 |
| C | App 创作预览 | 隔离运行实例可通过浏览器打开；页面刷新重新接入；“结束预览”显式关闭实例；24 小时到期回收 |
| C | App 文件和截图 | 主页面待办提供选择文件/目录、下载、定位和外链；展示资源位置；截图必须由用户点击并经过浏览器设备选择器，返回 PNG 到 App 缓存，随后停止采集 |
| C | 云电脑端口预览 | 随机 token 独立子域名路由到所属 Host 的 loopback 端口；保留路径、重定向和 WebSocket；开发站点 Cookie 改为当前主机范围；屏蔽 Moss Cookie，登出撤销路由和连接 |

Desktop 保留原生选择器、窗口、浏览器与系统设备权限。共用的是业务和权限校验，显示位置及资源位置各自适配。

通知修复同时保留：待授权项不受普通历史 200 条上限影响，不与其他授权或普通文案合并；重连重新取权威列表；Web 决策来源记为 `web`。权限模式确认绑定会话与当前值，切换会话、禁用和外部值变化会取消旧确认。

## 完成后 review 修复

- 确认框的自动焦点曾落到关闭图标，现明确落到取消；摘要渠道不能代替完整内容批准敏感变更。
- 安装包和创作 artifact 在确认后可能变化，补齐再次校验与最终提交校验；市场目录声明的权限须与验证后的 manifest 一致。
- Desktop 目录选择框曾误用“云电脑”文案，已限定为 Web 展示。
- App 创作预览曾在页面刷新时关闭运行实例，改为视图断开与显式结束分别处理。
- 异步打开 App 期间发生断线可能遗留上下文，现占用并发名额并在创建完成前检查连接和版本。
- 编辑器迟到的 acquire/save/update 结果可能跨过断线边界，增加连接版本校验、重新取权威状态和本地冲突恢复。
- 截图在别的标签取消或当前组件卸载后可能继续采集，现标记失效、停止 tracks，过期结果不继续上传或回复。
- 端口代理曾剥离全部 Cookie，开发站点登录无法保持；现保留开发 Cookie，去除 Domain、强制 Secure，并过滤 Moss Cookie。WebSocket 升级后取消握手超时，退出/停止时清理连接。
- 未配置公开 Origin 的独立 Host 原先无法生成 App 媒体 URL，改用可在浏览器解析的同站资源路径。
- OAuth 取消/完成后清理计时器和 AbortSignal 监听；HTML 重复装饰复用资源，独立预览关闭不破坏主预览。

## 部署配置

181 已配置实际 Web Origin，并在当前 Server 配置 `MOSS_OAUTH_WEB_CALLBACKS=https://10.0.1.181:8444/api/oauth/callback`；HTTP 验证该回调通过、未知 HTTPS 回调拒绝、Desktop loopback 保留。独立预览泛域名尚未配置，对应入口显示配置原因；第三方 OAuth 仍需提供方注册回调。

| 位置 | 配置 | 用途 |
| --- | --- | --- |
| Web Host / Gateway | `MOSS_WEB_ORIGIN=https://moss.example.com` | 精确公开 Origin，无路径或末尾斜杠；Web OAuth 要求 HTTPS |
| 被连接的 Moss Server | `MOSS_OAUTH_WEB_CALLBACKS=https://moss.example.com/api/oauth/callback` | 逗号分隔的精确 HTTPS 回调白名单；原 Desktop HTTP loopback 规则保留 |
| 标准 MCP 提供方 | 注册同一个 Web HTTPS 回调 | 提供方须允许该回调及现有 OAuth/PKCE 流程 |
| Gateway / 独立 Host | `MOSS_WEB_PREVIEW_DOMAIN=preview.example.net` | 专用预览泛域名，建议独立站点；`*.preview.example.net` 的 DNS/TLS 和反向代理须指向 Gateway/Host，保留 Host 头并支持 WS |

Gateway 将预览域名传给新环境，已有 Host 启动时也可通过受控配置接口发现它。未配置时入口说明原因。端口只接受显式的 `http://localhost:端口`、`127.0.0.1` 或 `[::1]`，端口必须至少为 1024，且不能是 Host 管理端口。

OAuth 事务和资源/端口映射为内存状态。Host 或 Gateway 重启后用户重新打开；不会自动批准内存确认或重放未知副作用。资源与端口链接是最长 24 小时的只读资源/预览访问凭据，应视为可访问对应内容的链接；退出会撤销 Host 侧资源与端口授权。

## 当前边界

- 完整“Agent 控制云端 Chromium + 远程视图”仍暂缓；当前交付是公网链接和云电脑开发端口预览。
- 需要原生页面 Cookie 捕获或只接受 loopback 的第三方登录不能直接套用 Web OAuth，继续提供已有 API key 方式。
- App iframe 直接调用摄像头/麦克风或屏幕 API 仍受隔离策略禁止。已适配的截图通过主页面受控流程完成；没有把云电脑设备权限当作用户设备权限。App 使用浏览器原生存储/Service Worker 的场景也不等价于 Desktop webview，应使用 SDK 存储。
- 预览资源上限为 64 MiB；App UI 导航到另一文档后需要重新建立上下文。云电脑端口代理屏蔽 Authorization/代理认证头，不承诺支持所有开发服务器认证和硬编码 localhost 地址。
- 浏览器草稿依赖该设备的 IndexedDB；保留其他页面副本避免误删仍在编辑的数据，登出清理。它不是跨设备同步或云端备份。
- App 原生依赖须兼容 Host 的 OS/架构；本轮未逐个验收全部市场 App、第三方 OAuth 提供方及预览泛域名 DNS/TLS。

## 验证证据

- Node：Web 确认、目录选择、认证 Host、请求去重、通知重连、终端、OAuth、资源隔离、App 上下文、截图、HTML 复用、端口代理，以及 Gateway/环境管理回归共 31 项通过。
- Bun：安装、市场、平台文件、配置、决策、通知、编辑权、Remote OAuth、真实创作安装/发布等 95 项定向回归通过。组合运行与 Renderer 构建并行时有 1 项发布测试超过 30 秒；构建结束后按原断言单独重跑，6.4 秒通过，未放宽超时或修改测试。Server OAuth 13 项通过，包含精确 HTTPS 回调白名单。
- 实际 Chrome：真实 WebSocket 与 Host 决策服务验证完整详情、取消/默认焦点、刷新恢复和跨标签单次批准；App iframe SDK、父页面/API 隔离、相对资源、草稿和附件恢复、不同标签副本及登出清理。
- 实际 Chrome 组件夹具：延迟 Host 响应下的编辑器冻结/重连/冲突及旧响应拒绝；受控设备流下截图授权、拒绝、跨标签取消和采集清理。此项没有自动操作 OS 设备选择器或真实第三方登录。
- `cd ui && bun run check` 通过（包含契约一致性、语法、Renderer 与 MCP App TypeScript 检查）。Renderer 与 Electron direct 构建通过；Renderer 有现存的大 chunk 提示。

可复现入口：

```sh
node --test ui/tests/web-confirmations.test.mjs ui/tests/web-adaptations.test.mjs ui/tests/web-host.test.mjs ui/tests/web-file-browser.test.mjs ui/tests/web-notification-sync.test.mjs cloud/tests/gateway.test.mjs cloud/tests/environments.test.mjs
cd ui
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-web-adaptations.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-web-permissions.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-web-recovery.mjs
```

浏览器脚本默认使用 Chrome，可用 `MOSS_WEB_TEST_BROWSER` 切换。`test-web-file-browser.mjs` 单独覆盖浏览目录、上传与主会话工作区选择。

2026-10-19 的 181 Chromium 复验通过目录选择（含移动端）、上传/下载、工作区、权限取消/Escape/焦点、刷新与跨标签确认、App SDK/资源隔离、草稿及附件恢复。生产 URL 的实际浏览器验收通过目录选择、WebUI 快照设置及 Server 策略面板，无页面异常。CI 与部署证据见 [环境快照交付记录](webui-environment-snapshots-plan.md#实现与验证记录2026-10-19) 及仓库 `output/webui-snapshots-20261019/`。
