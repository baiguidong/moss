# Trace App 架构

本地 Trace 已拆到独立仓库 `~/repo/moss-apps/apps/trace`（`moss.trace@0.1.0`）。Moss Desktop 保留 fetch 生命周期观察、脱敏和文件写入；App 负责索引、列表、搜索、详情、工具时间线、诊断和删除。需要 Host API 2.5.0。

## 采集与存储

- 未安装、未启用或撤销 `trace:capture` 授权时不采集。启用 App 及其默认实例即自动采集后续请求，无单独采集开关。
- 窗口与按需 Backend 的运行状态不影响采集。停用、撤权或卸载会撤销当前写入器，排空在途写入；再次启用不会恢复旧请求的写入器。
- Host 根据可信 App 身份确定输出路径：`<MOSS_HOME>/apps-data/moss.trace/instances/<instanceId>/trace/`。App 不能通过协议指定其他目录。
- Core 将模型调用与事件写入 `traces/<sessionId>.jsonl`，会话标题、工作区及消息快照写入 `sessions/<sessionId>.json`。每条记录含 `schemaVersion: 1`。请求在 pending 阶段保存完整语义内容，结束时保存最终状态、响应、耗时与用量；关闭采集后不会补写终态。
- 每文件写入有序，写入队列有界，失败不改变模型响应。常见认证字段脱敏；队列溢出或写入错误可在 App 查看。
- App 自行维护 `db/trace-index-v1.sqlite`，JSONL 是事实来源；删除索引后可重建。Core 不为本地 Trace 打开 SQLite 或提供查询接口。

## 生命周期与迁移

`AppTraceHost` 监听安装/实例变更，`beforeAppDeactivation` 在停用、撤权和卸载删除数据前完成写入器撤销。模型请求经 `traceFetch` 解析当前 scope 的输出，持有本次请求的写入器，避免跨 scope 或开关代际混用。

首次启用复制旧 `<MOSS_HOME>/traces/*.jsonl` 到 App 数据目录，保留源文件，以标记文件确保只导入一次。旧 `trace-settings.json` 不再控制 Desktop。卸载时按标准 App 选项保留或清除数据。

已移除设置中的 Trace 分类、聊天头部旧入口、内置 Trace 组件、旧 `trace:*` IPC 和独立采集开关。打开应用市场中的 Trace App 即可使用。解析器、视图模型和页面回归测试迁至 App 仓库。

## 接口边界

`moss.trace/v1` 仅支持无参数 `status`，授权为 `trace:capture`，返回采集状态、队列字节数、丢弃数和写入错误。所有 list/get/call/revision/delete 都由 App Backend 读取自己数据目录实现，不回调 Core 查询。大结果以受限分块传输，防止超过通用 App IPC 上限。

服务器 Trace 的鉴权 API 和用户 scope 保留现状，由 server 入口显式安装旧采集服务。服务端采集、读取、索引及消息适配放在共享的 `packages/trace`，`src/services/api/traceCapture.ts` 保留兼容导出；本地 Desktop 不加载该采集查询服务。服务器 Agent 入口负责注册服务端采集器。首版 App 仅显示本地记录。

## 验证

- Core：真实 fetch → 文件、默认不采集、App 生命周期、脱敏、停用与旧写入器失效、迁移、status 权限。
- App：增量索引、pending/terminal 合并、不完整 JSONL、重建、revision、搜索、删除、大中文内容分块、协议解析及页面渲染。
- 集成：真实 AppRuntimeHost 启动打包 Node Backend，读取 Core 生成的请求文件，通过 App action 分块返回完整提示词；验证停用、撤权、实例开关和卸载。
- 浏览器：真实 App 数据读取驱动列表、错误筛选、详情懒加载、提示词展开、刷新、删除、窄屏和主题。
- 发布：`moss.trace-v0.1.0` 触发独立仓库 CI，检查后签名打包、创建 Release 并更新市场目录。
