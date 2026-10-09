# Moss Host API 局部优化与实施记录

2026-10-09：本文记录第一批 Host API 2.9.0 优化，保留当时的实施边界。后续已按“未发布 App、不兼容旧版本或迁移旧数据”的新要求完成 Host API 3.0.0 与全部 10 个 App 适配，当前状态见 [Host API 3 迭代记录](host-api-3-iteration.md)。下文的版本、兼容别名和待办不代表当前状态。

## 判断与边界

原设计的基本架构合理：版本化协议、统一注册器、独立 Backend 进程、权限和 owner 隔离，以及业务 App 与 Core 执行能力的分工均保留。问题主要是部分新增能力的契约与接线不完整，以及具体取消窗口。

本方案取代之前的 Host API 3 全量改造方案。按用户要求优先修复明确问题，不重新设计架构，不迁移数据，不要求全部 App 适配。Manifest 2、App Service v1、现有协议名称与方法保留。

## 本轮已实现

| 项目 | 具体改动 | 收益 |
| --- | --- | --- |
| Execution/Tasks 契约 | 修复 SDK 声明引用不存在类型；补齐请求、响应、事件类型与两个 typed client；接入 Registry 输出校验 | TypeScript 可推导结果，协议偏差在边界被发现 |
| 稳定错误 | 参数错误、revision/幂等/状态冲突、资源上限、不存在资源使用明确错误码 | App 可按错误码处理，无需解析消息 |
| 任务事件 | 将 task.changed、execution.changed 接到 Host → Backend IPC；按 owner、实例、grant 发送；发送前再次检查状态与 generation | App 可订阅已有事件；停止的 Backend 不因状态提示被唤起 |
| 下载 | 透传 signal；流式执行 100 MiB 实际字节限制；目标同目录临时文件，成功才提交 | 取消/超限/失败不覆盖已有目标，不完整缓存整个下载 |
| 其他 Platform 操作 | 文件选择、物化、缩略图、截图和外链操作在相关异步边界检查 signal | 已取消的调用不会继续提交尚未发生的操作 |
| Action 取消窗口 | 调用进入 Runtime 后，在包加载和运行环境准备前登记取消；准备后检查取消和授权 | 启动前取消立即返回，准备完成也不再调用 Backend |
| 局部命名 | validateExecutionHostInput 与其他协议命名一致，旧 validateExecutionInput 保留别名 | 改善一致性，避免强制修改旧调用 |
| 版本与文档 | 同步 2.9.0、execution 子路径类型导出、事件/错误/分块单位说明 | 新能力可按版本声明，原 2.x 范围保持兼容 |

公开方法和原有合法返回字段未删除；不改变任务结果、Workflow Definition、App 私有存储格式。任务内部增加 owner 路由信息；旧记录可在既有授权读取时绑定，无独立迁移程序。

## App 影响与同步修改方案

Core 保留兼容性，因此没有必须重写的 App。按用户后续要求，已在 `moss-apps` 同步完成以下两项局部优化，其他 App 无需随之改版：

| App | 版本 / 影响 | 实施结果 |
| --- | --- | --- |
| moss.workflow | 0.1.11，最低 Host 2.9 | 使用两个 typed client；单个 execution.changed 订阅按执行 ID 分派，task.changed 及时停止对应运行；启动后查询当前状态、按 sequence 忽略旧进度，保留 5 秒查询兜底；停止/结束/关闭时清理等待、查询和监听。App 只消费当前快照，因此无需补拉 Core 历史事件；自身运行历史保持原有存储 |
| moss.http-client | 0.1.2，最低 Host 2.9 | 删除 250 ms 取消重发循环，一次 cancel 即可；保留 requestId、等待原调用结束的 UI 行为和 finally 清理。真实 Runtime 测试覆盖包加载、运行环境准备和网络请求期间取消 |
| moss.openim | 下载调用和返回结构保持不变，自动受益于流式限额与安全提交 | 回归下载与已有目标覆盖；UI 直调尚无独立取消入口，不把这项新增能力算入本轮 |
| moss.feishu、moss.drive、moss.library、moss.mcp、moss.audit、moss.trace、moss.devtools | 本轮没有各自领域协议变更 | 无计划内业务修改或强制重新发版 |

两个 App 的 Manifest、package.json、CHANGELOG 和 lockfile 已同步，均声明 `hostApi: '^2.9.0'`。`moss-apps/vendor/moss-core` 中的 SDK / Runtime 已同步为对应的本地 2.9 源码，尚未提交；Workflow 包集成验证使用 `MOSS_CORE_ROOT=/Users/bgd/repo/moss` 的实际 Core 工作区。正式提交发布时需先提交 Core，再更新 App 仓库的 Core 子模块引用，避免只提交 App 代码而继续锁定旧 SDK。

已生成 Workflow 0.1.11 和 HTTP Client 0.1.2 的本地安装包（`moss-apps/artifacts/<app>/<version>/`），未签名、未发布。

## 明确延后

- UI 直调与 Backend 请求统一超时、载荷和生命周期取消保障：当前只修改公共 Platform handler，不宣称已完整统一两条路径。
- 通用 Action signal helper、Execution 等待器：本轮只提供有类型的 request/on，避免引入新的订阅复用与等待语义。
- 其他新增协议的完整类型、SDK 所有子路径整理：本轮集中修复 Execution/Tasks。
- 全局文件引用、通用资源体系、存储重写、批量命名调整：需要独立收益依据，不纳入本轮。

## 验证与保证

- SDK 严格消费样例（skipLibCheck=false）验证根入口、execution 子路径、输入约束、结果推导、事件类型和旧函数别名。
- Host 契约测试覆盖实际任务/执行响应、嵌套结果、内部字段拒绝、稳定错误、所有权、幂等、并发、取消和恢复。
- 真实 Node Backend IPC 测试覆盖两种状态事件、进度字段、重启查询、序号补读、UTF-16 分块结果和授权；停止 Backend 不被事件启动。
- 启动前取消测试覆盖包加载与运行环境准备；取消能及时返回且不启动 Backend。
- 下载测试覆盖成功替换、取消清理、保存对话框期间取消、无 Content-Length 的实际限额、错误响应和流失败。
- Runtime 生命周期、进程恢复、hardening、watchdog、Host 协议回归及 UI check。
- Workflow 的 37 项测试与类型检查、生产构建通过；真实安装包经过 Node Backend → Core IPC 验证，覆盖事件驱动完成（一次初始 execution.get）、丢弃事件后查询恢复、Host 主动取消和 Backend 重启后的历史读取。
- HTTP Client 的 17 项 Node 测试与类型检查、生产构建通过；包含 UI send 包装到真实 Runtime/Backend 的取消链路，确认未启动时不发网络请求、执行中关闭 socket、完成后移除取消监听。
- HTTP Client 的 Playwright 超时/取消用例通过，验证界面取消会停止实际 Backend 请求；App 仓库公共脚本的 29 项测试及全部 10 个 App 的 Manifest 验证通过。

任务事件为状态提示，可能丢失或晚到，查询和有限事件历史用于恢复；没有新增永久重放保证。下载取消保护未提交的文件，无法撤回已经完成的导出。App UI 直调下载的取消入口未在本轮实现；Workflow 未重跑真实模型 / Electron 界面端到端验证，本轮使用实际 App 包与受控 Agent 执行器验证协议集成。
