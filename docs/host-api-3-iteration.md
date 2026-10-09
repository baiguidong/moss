# Host API 3.0 迭代与 App 适配记录

2026-10-09。Core 与相邻 `moss-apps` 已完成本轮实现和验证，分别提交源码与 App 适配。依据 [后续优化评估](host-api-next-stage-review.md)，本轮落地调用保障、增量存储、首批统一契约及 SDK 公共封装。

按当前未发布阶段要求，Host API / SDK / Runtime 为 **3.0.0**，10 个 App 均声明 `hostApi: "^3.0.0"`。删除旧 UI 调用签名和 `validateExecutionInput` 别名，不提供旧任务数据导入。Manifest 2、App Service v1、已有领域协议名称和业务分工继续沿用。

## 已完成的 Core 改动

| 项目 | 实现 | 收益 |
| --- | --- | --- |
| UI / Backend 调用保障 | Runtime 共用 Host 请求登记、载荷检查、受限超时、取消与权限复查；异步包加载及 handler 派发前重新检查授权、版本和 generation | 撤权后不能利用旧授权继续执行；取消在准备阶段也有效 |
| UI 身份与错误 | Main 从受信任窗口绑定 App 和默认实例；按窗口隔离请求 ID；preload 传结构化结果，SDK 恢复错误 `code/details` | 普通调用无需查询实例；跨窗口不能互相取消，Electron 不再丢失业务错误码 |
| 生命周期 | 窗口导航、崩溃、关闭，以及 App 停用、配置/授权/版本变更和退出取消相关请求 | 降低悬挂请求和失效页面继续执行的问题 |
| 统一契约首批 | 新增 `packages/host-contracts`，集中 Tasks/Execution、MCP 输入输出、事件、权限、允许调用端、错误和限额；生成声明、AJV 校验器及方法文档 | 类型与边界校验有共同来源；CI 检查生成文件是否最新 |
| SDK 规范 | `@moss/app-sdk/ui` 提供浏览器可用的 `createAppClient`；MCP typed client；ExecutionWatcher；所有 SDK 子路径声明匹配实际值导出 | App 复用信号取消、事件分派、监听清理和类型约束 |
| 任务存储 | 独立 Worker 中使用 SQLite，任务、执行和事件分表；状态与事件同事务提交；按 owner/更新时间分页 | 进度更新只写相关记录，移除主进程同步重写全部任务历史 |
| 执行结果 | 独立 UTF-16 文件，按实际范围读取；结果文件先提交，再持久化完成状态 | 分块不再反复读取全文，保持公开 offset/limit 单位明确 |

调用取消尽力停止尚未完成的工作，不撤回已提交的副作用。请求超时后底层尚未退出的 handler 仍受 Registry 并发限制；SDK 不自动重试有副作用的 Action。方法可以声明允许 `ui` / `backend` 的调用端，统一调用保障不会取消权限边界。

## App 同步适配

全部 App 的普通 Action / Host UI 调用均使用绑定 client；版本、Manifest、CHANGELOG、最低 Host 要求及 lockfile 已同步。Feishu 和 OpenIM 仍按需读取实例配置，这是配置页面的功能。

| App | 当前版本 | 本轮适配 |
| --- | --- | --- |
| Audit | 0.1.2 | 绑定 client，保留现有结果分块读取逻辑 |
| DevTools | 0.1.2 | 普通 Action 调用移除实例查询和传参 |
| Drive | 0.3.1 | 绑定 Action 调用，保留云端传输业务 |
| Feishu | 0.4.8 | HTML 使用浏览器 SDK 模块，构建复制依赖并调整 CSP；配置读取继续保留 |
| HTTP Client | 0.1.3 | 公共 AbortSignal 包装替代手写取消；保留真实网络请求取消验证 |
| Library | 0.1.4 | 绑定 client，沿用 Local Files / Runtime 业务协议 |
| MCP | 0.1.4 | UI 绑定 client，Backend 使用 MCP typed client，测试返回完整 DTO |
| OpenIM | 0.2.9 | 删除过时桥接声明，使用 SDK 类型；下载支持取消按钮与组件卸载取消 |
| Trace | 0.1.1 | 绑定 client，保留现有结果分块读取逻辑 |
| Workflow | 0.1.12 | 绑定 client；SDK ExecutionWatcher 替代 App 内部等待器；生成 Manifest 固定 Host 3 要求 |

本地安装包位于 `../moss-apps/artifacts/<appId>/<version>/`，10 个 ZIP 内 Manifest 均已核对为上述版本及 `^3.0.0`；均未签名、未发布。

`moss-apps/vendor/moss-core` 的 SDK、Runtime、host-contracts 源码与 Core 保持一致。提交顺序为先提交 Core，再将 Apps 的 Core 子模块引用更新到对应提交，确保干净检出能取得对应依赖。两个仓库的提交需要配套推送。

## 性能验证

使用 [基准脚本](../ui/scripts/benchmark-execution-store.mjs) 调用实际 `AppExecutionHost.event()` 和 `flush()`。每个任务含 8 个执行、每执行 50 条历史事件与约 5 KiB prompt，初始化后测 5 次更新。数据位于临时目录，不使用业务数据库。

| 历史任务数 | 旧 JSON 同步更新中位耗时 | 新方案主线程调用中位耗时 | 新方案提交完成中位耗时 | 新方案主线程最大耗时 |
| --- | --- | --- | --- | --- |
| 10 | 5.28 ms | 0.03 ms | 0.21 ms | 0.50 ms |
| 100 | 66.98 ms | 0.12 ms | 1.65 ms | 0.18 ms |
| 250 | 184.35 ms | 0.02 ms | 0.26 ms | 0.07 ms |

旧值来自前一轮相同规模的合成基准，新旧内部存储结构不同，未作逐字节相同数据或生产 SLA 对比。结果支持的结论是：单次进度写入已不再同步序列化全部历史；绝对耗时受本机负载和存储缓存影响。

## 验证结果与复现

- Core App / Host 相关测试套件通过；最终针对本轮改动的 26 项回归通过，覆盖真实 Runtime 在包加载期间撤权、取消、超时、窗口关闭，以及跨窗口请求隔离。
- 实际 Electron BrowserWindow + preload + contextIsolation 验证通过：绑定身份、业务结果中的 `ok` 字段、错误 `code/details`、AbortSignal、超时及更新期间拒绝调用的错误传递。
- Task / Execution 测试覆盖真实 Node Backend IPC、状态事件、owner 隔离、幂等、取消、重启、SQL 事务回滚、任务来源持久化、观察者失败及 UTF-16 代理对边界读取。
- SDK 严格 TypeScript 消费检查（`skipLibCheck=false`）及生成文件新鲜度检查通过。
- 10 个 App 的类型检查、完整测试、生产构建和 Manifest 校验通过；全部安装包内 Manifest 复核通过。
- Workflow 0.1.12 实际安装包通过 Node Backend → Core IPC 验证，覆盖执行推送、漏推送后查询恢复、任务取消、短 Action、Backend 重启历史及归档恢复。Agent 使用受控执行器，未调用真实模型。

```sh
# Core，测试从 ui 目录运行
cd ui
bun run check
bun test tests/app-*.test.* tests/agent-host-protocols.test.ts tests/openim-host-protocol.test.ts
bun run test:app-ui-bridge
node scripts/benchmark-execution-store.mjs

# 相邻 App 仓库
cd ../../moss-apps
bun run check
bun run test
bun run validate
bun run build
MOSS_CORE_ROOT="$PWD/../moss" node apps/workflow/scripts/verify-package.mjs
```

## 仍需按价值逐项推进

1. **历史容量管理**：SQLite 消除了全量重写，但启动仍加载任务历史到内存；未增加历史任务、结果文件自动清理或崩溃孤立文件回收。下一步应明确保留窗口，并把历史读取逐步下沉到 Store。
2. **可靠状态恢复**：Execution 事件已持久化且每个执行保留最近 2000 条；推送在持久化后发送，仍是可能丢失的状态提示。尚无跨任务全局游标、持久 outbox 或永久重放保证；Watcher 用初始查询、序号过滤和 5 秒兜底恢复当前状态。
3. **契约继续覆盖**：首批覆盖 Tasks/Execution 与 MCP。Local Files、受管 Runtime、Cloud、Audit/Trace 按具体修改逐个纳入，未宣称所有 Host 协议已统一生成。
4. **公共大结果辅助函数**：Audit/Trace 的重复传输代码以及 Workflow 的资源读取仍可单独收敛；全局 ResourceRef 暂未实施。
5. **能力发现与领域命名**：`moss.host`、Desktop/Observability 提取、`channels` / `executions` 全面改名均未纳入本轮。后续以实际复用收益推进。

本轮不导入旧 `tasks.json`，也不自动删除旧文件。未修改现有用户数据，所有存储测试和集成验证均使用临时目录。
