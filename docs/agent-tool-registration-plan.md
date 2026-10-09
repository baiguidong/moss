# Agent 工具注册与图片执行

本轮完成会话环境过滤和图片生成/编辑迁移。内置浏览器打开工具更名为 `moss_browser_open`，输入参数及宿主打开行为沿用现有接口；MossMail 的调用及展示行为保持现状。

## 注册规则

宿主创建或恢复 `ClaudeSession` 时提供 `executionEnvironment: desktop | server`。默认 desktop 兼容已有嵌入调用；服务端入口固定设置 server，客户端 runtimeOptions 不能覆盖。环境和图片配置保存在会话异步上下文中，子 Agent、恢复后的 worker 和动态刷新继承同一环境，不使用进程级开关。

工具通过 `supportedEnvironments` 声明适用环境，未声明的工具不因环境被排除。现有 Moss 桌面工具工厂默认仅支持 desktop，moss_browser_open 显式允许两端。统一过滤作用于内置工具池与动态合并后的工具池，因此 allowedTools、延迟加载和 ToolSearch 无法重新启用被排除的工具。

| 服务端注册结果 | 工具 |
| --- | --- |
| 不注册 | App 组：app_build、app_preview、app_publish、app_launch、app_update、app_extract_to_workspace、app_get_versions |
| 不注册 | library_write |
| 不注册 | connector_cli_setup、connector_mcp_authenticate（当前操作桌面环境的实现） |
| 不注册 | App 扩展贡献的动态工具 |
| 不注册 | WorkflowCreate、WorkflowEdit、WorkflowManage、WorkflowRun |
| 保留原条件和回调 | moss_browser_open、MossMail、library_list/search/read |
| 按图片配置注册 | image_generate；OpenAI 配置还可注册 image_edit |
| 保留原条件和实现 | 文件、Bash、网络、Agent、任务、团队、Skill、ToolSearch、通用 MCP 工具 |

主 Agent 和新建/恢复 worker 使用同一个工具组装入口。ToolSearch 从当前已过滤的工具池检索，组展开也只激活池内成员。现有桌面处理端拒绝规则继续作为兜底。

内置浏览器工具仅保留 `moss_browser_open`，用于打开 Moss 右侧浏览器供用户查看和手动操作。`browser_snapshot`、`browser_click`、`browser_type`、`browser_press`、`browser_scroll`、`browser_wait`、`browser_reload` 已从桌面和服务端工具注册、加载分组及设置列表移除。网页自动化由启用的浏览器 MCP 服务提供，Playwright 工具仍按服务整组激活；目前 `playwright-cdp` 连接独立 Chrome，不能操作 `moss_browser_open` 打开的 Moss 页面。内置浏览器及连接器授权回调链路继续保留。

`moss_browser_open` 的描述明确限定内置浏览器，自动化任务需搜索 `playwright-cdp` 的 `browser_navigate` 并持续使用该服务。工具打开的页面加载失败时返回错误，不再回退到系统浏览器。旧 `browser_open` 加载设置自动映射到新名称；宿主事件仍使用 `browser_open`，以保留已有桌面、远端及连接器授权调用链路。

工作流目前全部仅限桌面会话，服务端开关或 allowedTools 不能重新启用。工作流命令也通过会话内的启用检查从服务端命令列表中排除；发现缓存不保存某个会话的启用结果，以免影响同进程的桌面会话。桌面创建、编辑、管理和运行保持原有行为。云端定义传递、运行状态同步和独立运行生命周期留待后续完整设计。

## 图片执行

`src/services/imageGeneration.ts` 直接请求图片 provider，`src/tools/ImageTool/ImageTool.ts` 负责工具定义、权限及工作区文件。图片执行已从桌面事件处理器移除，不依赖 emitAppEvent、Moss Desktop 或 Moss Server API。

- 桌面注入桌面图片配置；服务端注入服务端 image 配置。Docker 配置快照及 runner manifest 解析也传递该配置。桌面图片凭据不通过远端 runtimeOptions 上传。
- 缺少图片模型或凭据时不注册；MiniMax 只支持生成，OpenAI 支持生成及编辑。
- OpenAI 编辑上传当前工作区的源图；结果支持 base64 或下载 URL。请求与下载支持取消及 180 秒总超时。
- 输出写入当前 Agent 工作区，检查目录穿越和符号链接，使用现有文件读写权限规则。out_path 必须是新文件，避免覆盖已有文件。
- 单次请求保存一张图片，返回 ok、fileKind、filePath、filePaths、mediaType；不返回图片字节或服务凭据。UI 使用已有文件附件逻辑展示，不由 Agent 构造 moss-media 地址。
- 图片配置在会话启动/恢复时注入；配置更改在新建或重新恢复运行时生效。

## 验证

回归覆盖主/worker 工具池、动态贡献、ToolSearch 的直接选择/搜索/组展开、异步会话隔离、恢复参数、Docker manifest、无桌面桥生图与编辑、provider 能力限制、路径边界、权限及取消。图片 API 使用本地测试端点，没有调用付费模型。

## 后续独立处理

工具过滤不等于服务端已经实现完整无人值守。MossMail、moss_browser_open、资料库读取仍依赖桌面在线；客户端断开中断活动轮次、服务端 Cron 调度接入是另外的生命周期问题。

远端 HTTP 静态预览暂未修改：现有文件代理可以按需取多个文件，但 JS/CSS MIME、根路径资源及预览内容与管理端的来源隔离仍需处理。若继续建设，应复用 Moss Server HTTP 服务的标准静态文件能力，独立确定访问范围和隔离规则；不向 moss_browser_open 增加框架识别或 HTML 重写补丁。
