# Desktop IPC 增量整理

本次沿用 `agentDesktop → preload → Electron IPC → Main`，适用于当前 Desktop。

## 接口与类型

- `renderer-react/lib/desktop-api-types.ts` 定义发送参数及返回分支、取消和审批参数、会话事件外层结构。`types.d.ts` 将这些类型挂到现有 `window.agentDesktop`。
- `send()` 仍等待任务结束才返回。正常对话、直接命令、会话删除、规划失败分别建模；运行时或通信异常仍通过 Promise rejection 返回。
- Desktop 对话模式仍为 `chat | boss`。Main 内部兼容的其他模式不因此开放到 Desktop API。
- 技能市场使用 `skillHub`，专家市场使用 `expertHub`；本地技能选择使用 `getInstalledSkills()`。保留各自原有数据源和返回结构。
- 定时任务使用 `sessionCron.list/toggle/remove/runNow(source, ...)`，`source` 只允许 `local | cloud`，preload 同时校验来源。
- 连接器变更改为 `onConnectorsChanged(callback)`，返回独立的退订函数，接入 React effect 清理。
- Renderer 业务代码不再直接调用 `ipcInvoke/ipcOn/ipcOff`；preload 的通用入口暂留兼容。新增业务应补具名方法。
- 项目资源同步依赖只包含所需技能、专家具名方法的小接口，方便直接测试错误中止和按需安装。

SDK 内层历史事件仍保持可扩展类型；市场目录内容仍由已有视图逻辑解析，没有宣称所有远端数据都经过了运行时 schema 校验。旧 `onPermission` 没有当前生产者，保留为 `unknown`；当前问题和工具审批通过已有 `onQuestionRequest` 传递。

## Main 的拆分边界

`session-control-ipc.mjs` 注册取消、回答和拒绝问题三个处理器。Main 注入现有会话、运行时、持久化和决策函数。保留会话归属检查、过期审批处理、App 决策路由、停止工作流顺序，以及项目根任务和子会话的区别。

随后已继续提取数据库、会话持久化与历史恢复、项目存储、远程 runtime、后台任务、工作区文件与监听、项目资产及输入准备模块，详见 [Main 模块拆分](main-module-split.md)。发送调度器和历史存储语义保持不变。

## 已复现并修复的问题

远程重连发出 attach 请求后，用户主动断开，迟到的响应原本仍能重新打开 WebSocket。连接管理器新增连接批次标记，断开、重新连接或最终关闭都会让旧异步操作失效；Node WebSocket 模块加载期间的取消也使用同一标记保护。

保留“不自动重发已发送提示词”的语义。重连只重新挂接会话，不能当作上一次发送成功的确认。

## 回归覆盖

- 实际 preload 的重复订阅、独立退订和事件参数转发。
- 实际 preload 到提取后 Main 处理器的取消、审批归属、过期问题、拒绝原因和失败返回。
- 类型编译检查：缺少会话或请求 ID、错误参数、错误来源、未收窄结果等不能通过编译。
- 断线清理控制请求、旧响应不能完成新请求、清理 socket 监听和重连计时器、主动断开后的迟到 attach。
- JSONL 历史读取中更换路径、确认本次写入、释放同步器，以及同一会话关闭再打开时，旧快照不能覆盖当前历史。

相关测试纳入现有 `bun run --cwd ui test`；远程管理器测试位于 `src/remote/directConnectManager.test.ts`。静态检查和构建继续使用 UI 的 `check`、`build:renderer`、`build:direct`。

`bun run --cwd ui test:main-services` 使用隔离数据目录验证真实 Electron 启动、退出与重启后的会话和项目恢复。

自动化测试不等同于真实 Electron 窗口、真实模型或 Windows 安装包的端到端验收。
