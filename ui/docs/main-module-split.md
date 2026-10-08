# Main 模块拆分

持续按职责拆分 `src/main.mjs`。Main 从最初的 14,205 行，经前两轮降到 11,745 行，本轮进一步降到 **10,535 行**，本轮减少 **1,210 行**，累计减少 **3,670 行**。采用显式依赖注入，模块不反向导入 Main，也不接收一个可以任意访问 Main 全部状态的对象。

| 模块 | 职责 | 状态归属 |
| --- | --- | --- |
| `session-database.mjs` | 会话表迁移、预编译读写 SQL | Main 持有并关闭数据库连接；初始化顺序保持原样 |
| `session-persistence.mjs` | SQLite 行与 manifest 序列化、延迟保存、删除、启动加载、搜索索引同步 | Main 持有数据库和会话 Map；保存计时器仍在 session record 上；设置与 Trace Host 通过 getter 读取 |
| `session-history-service.mjs` | 中断恢复、JSONL/快照/远端历史加载、回退分支和回合后历史同步 | 使用原 session record；内部组装 `localTranscriptSync`，由 Main 在退出时释放 |
| `project-store.mjs` | 项目记录、目录、记忆与结项结果读取、会话关联文件、运行目录清理 | 显式复用 Main 的项目记录队列，与资产、决策和结项提交共用同一把锁 |
| `remote-session-runtime.mjs` | 创建和挂接远程会话、事件流、审批转发、取消和释放 | 每个 runtime 私有连接和当前 turn；通过 getter 读取最新设置 |
| `session-task-service.mjs` | 后台任务、工作流记录、清单快照、监听、任务输出和相关 IPC | 私有输出路径缓存；沿用 Main 的会话 Map 和 session record |
| `workspace-files.mjs` | 本地/远程文件读写、目录列表、预览、上传与附件缓存 | 私有且受限的附件缓存；工作区版本锁通过 Main 注入 |
| `workspace-watcher.mjs` | 递归文件监听、兼容回退、通知、清理 | watcher 仍挂在原 session record 上 |
| `project-assets.mjs` | 项目资产扫描、导入、内容去重、索引更新和删除 | 模块持有资产串行队列；复用 Main 的项目记录串行队列 |
| `session-prompt-preparation.mjs` | 直接命令、图片附件、长输入落盘、项目附件本地化 | 更新传入的 session record，通过回调持久化和通知 |

`session-paths.mjs` 提供会话 ID 校验与路径构造。`workspace-paths.mjs` 和 `shared/file-path-utils.mjs` 提供工作区路径检查、文件哈希、存在性与目录包含关系检查。`shared/json-files.mjs`、`shared/keyed-queue.mjs`、`shared/string-list.mjs` 复用原有文件与队列操作；项目、会话字段归一化和历史显示规则也分别放入共享模块。`session-control-ipc.mjs` 继续负责取消和问题审批。

Main 在完成基础状态初始化后统一组装这些服务。任务 IPC 仍在原位置注册，数据库迁移仍在其他存储初始化后的原位置执行。已有 IPC 频道、发送完成语义、历史存储和执行位置保持不变。

## 本轮保留的状态与时序约定

- 项目存储在 `memoryCatalog` 接收 `getProjectMemory` 之前组装，避免把原先可提前引用的函数声明改成尚未初始化的变量。
- 会话持久化服务先于历史服务组装；加载 SQLite 和启动中断恢复仍由 Main 在原来的初始化阶段调用。服务构造时不读取会话或启动恢复任务。
- SQLite 与 `session.json` 继续缓存元数据/历史，JSONL 继续作为本地历史来源。保存仍合并 200ms 内的请求；立即保存会取消延迟计时器；已删除记录不会被延迟回调重新写回。
- Trace Host 启动较晚，设置可能在运行中更新；两者均在实际保存时读取，避免捕获旧值。会话忙碌时仍跳过搜索索引更新。
- 恢复保留父子会话区别、远端删除标记、远端工作区与标题映射，运行态、忙碌标记和 watcher 不从缓存恢复。中断恢复不重发提示词。
- 项目资产目录仍为项目的 `workspace`；项目记录写入仍使用原子文件替换，并与设置、资产和结项提交共用原队列。没有增加第二套项目记录锁。

## 验证

- 逐段核对迁出的函数体，保留原行为；远程设置通过 getter 获取，避免把可变设置捕获成旧快照。
- 原工作区监听测试直接调用新模块；任务测试直接调用新快照实现并验证 Main 的 IPC 接线。
- 新测试覆盖旧数据库迁移、重复初始化、父子任务作用域、并发资产导入、同名附件、文件越界和符号链接、远程 ID 映射、断线时取消当前 turn、不重发旧消息。
- 本轮新增真实 SQLite 关闭重开、manifest 与子会话字段恢复、延迟保存后删除、动态设置与 Trace Host、远端删除标记、损坏缓存容错测试。
- 历史测试直接调用新服务，覆盖中断后选择有效 transcript、无关 transcript 不覆盖缓存、快照回退、回退分支替换、后台任务期间延后同步、部分历史不覆盖完整回合。
- 项目测试使用真实临时目录，覆盖并发修改、失败后队列继续执行、资产导入与重命名共用锁、记忆/会话关联文件重读和运行目录清理。
- 运行 `bun run --cwd ui check` 和 `bun run --cwd ui test`。
- 使用 `bun run --cwd ui test:main-services` 启动并重启真实 Electron：先验证本地会话创建、文件读取、直接命令、任务 IPC、项目修改与资产导入，再验证会话持久化、中断 transcript 恢复、项目/资产/记忆读取与归档。脚本创建临时 `MOSS_HOME` 并在结束后清理，不使用日常数据目录。运行前需有 `build:renderer` 的构建产物；该检查需要桌面环境，不包含真实模型、云端服务和 Windows 的端到端验收。

本轮最终结果：983 个 Bun 测试、14 个 Node 测试、`check` 和 Electron 启动/重启检查通过。中间一次全量运行中，既有 App Runtime 的错误脱敏测试触发了 5 秒超时；该文件单独复查 10 项通过，最终全量复跑也通过。没有修改该测试或放宽超时阈值。

## 尚在 Main 中的主要职责

Main 仍然偏大。项目创建/更新的权限与资源校验、项目协调和结项、发送编排、问题决策、子会话同步、App 窗口与启动生命周期仍在 Main 中。项目存储已经迁出，但项目业务编排尚未迁出；会话持久化与历史恢复已经迁出，但 runtime 创建与发送编排仍在 Main。

后续优先拆项目协调/结项，再整理 App 窗口与启动生命周期。发送与审批编排需要保留队列、取消、删除及决策状态的时序测试后再拆，不以行数目标替代职责划分。
