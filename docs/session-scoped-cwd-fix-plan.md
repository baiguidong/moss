# 会话级工作目录修复方案

状态：方案，当前不实施代码修改。

## 背景和结论

Moss 当前采用单进程、多会话架构。会话运行时通过 `AsyncLocalStorage` 保存当前会话的 `cwd`、`originalCwd`、`projectRoot` 和附加目录；Shell 子进程启动时由运行时显式传入 `cwd`。

因此不需要把每个会话改成独立进程，也不应要求模型在工具参数中传递绝对路径。模型需要确认目录时可以生成 `pwd` 的 Bash 调用，但真正决定子进程工作目录的是 session runtime。

最新会话中工具调用已经拿到了 `/Users/bgd/repo/moss`，其中多次失败主要来自模型生成了错误路径、错误 Git revision 或当前平台不支持的命令参数。不过当前实现仍有一个真实风险：`QueryEngine` 保存了创建时的 `config.cwd`，每轮提交消息时重新调用 `setCwd(cwd)`，可能把会话已经切换到的 worktree cwd 覆盖回旧目录。

## 目标

1. 每个工具调用都使用发起该调用的 session 的有效工作目录。
2. 两个并发会话的 cwd、project root、权限目录、MCP 配置和 transcript 路径互不串扰。
3. EnterWorktree、ExitWorktree、resume 和复用 QueryEngine 后，下一轮仍使用正确的目录。
4. CLI 单会话路径继续支持进程级 cwd 兜底。
5. 保持内置 tool 的实现、schema、提示词和模型调用协议不变。

## 非目标

- 不把每个会话拆成独立 Node 进程。
- 不让模型负责传递 `workdir`。
- 不修改 Bash、Read、Edit、Glob、Grep 等内置 tool。
- 不因为模型生成了错误命令而增加无条件重试。

## 修复设计

### 1. 统一 session context 入口

在 `ClaudeSession` 内收口现有的上下文包装逻辑，形成一个统一的 session runtime wrapper。以下入口都必须通过同一个 wrapper 执行：

- `send`
- `askSideQuestion`
- `executeAppAgent`
- 文件历史和任务控制操作
- `stopTask`
- 记忆维护等会话控制操作

wrapper 每次调用开始时解析当前 session 的有效 cwd：

```text
worktreePath（如果当前 session 在 worktree 中）
否则使用 session.options.cwd
```

随后建立该 session 的 cwd、original cwd、project root、附加目录、session id 和 runtime context。不能从进程级全局状态反推嵌入式会话目录。

### 2. 阻止 QueryEngine 使用旧 cwd 覆盖 session cwd

`QueryEngine.submitMessage()` 中的 `setCwd(config.cwd)` 需要改为条件行为：

- 没有 session ALS 上下文时，保留该调用，兼容 CLI 和旧的单会话 headless 路径；
- 已经存在 session ALS 上下文时，不写回 `config.cwd`，保留外层 session 当前 cwd。

这样可以保证旧 QueryEngine 被复用时，不会把已经切换到 worktree 的会话恢复到创建 engine 时的目录。

### 3. 保持 worktree 生命周期按 session 隔离

EnterWorktree、ExitWorktree 和 resume 继续使用按 `sessionId` 保存的 worktree 状态：

- 嵌入式多会话路径不能调用影响整个 Node 进程的 `process.chdir()`；
- 只更新当前 session 的 ALS cwd 和 worktree registry；
- 切换后清理依赖 cwd 的缓存；
- 下一轮请求重新计算 effective cwd，而不是依赖上一轮的局部变量。

CLI 没有 ALS 上下文时继续使用现有的 `process.chdir()` 和全局状态逻辑。

### 4. 限制全局 cwd 的使用范围

审计 session/runtime 路径中的 `process.cwd()`、`setCwdState()`、`setOriginalCwd()` 和全局 project root 写入点：

- CLI 启动、CLI resume 等单会话初始化路径可以保留；
- Desktop/SDK 多会话请求路径必须通过 session context；
- 后台任务、事件回调和 generator 继续运行时，要捕获并传递创建它们的 session context；
- 不能因为某个会话初始化失败而把全局 cwd 改成该会话的目录。

### 5. 增加运行时诊断

在 session/runtime 和 Shell spawn 边界增加结构化诊断字段，不改变 tool 协议：

```text
sessionId
requestedCwd
effectiveCwd
engineConfigCwd
actualSpawnCwd
```

这些字段用于区分 cwd 串会话和模型命令本身错误。模型生成的错误路径、错误 revision、平台不兼容参数不应通过自动重试掩盖。

## 计划修改的代码范围

实现时预计只涉及以下 session/runtime 层和测试：

- `src/electron-direct.ts`：统一 session wrapper 和 effective cwd 来源；
- `src/QueryEngine.ts`：避免 ALS 上下文内被旧 `config.cwd` 覆盖；
- `src/utils/cwd.ts`、`src/utils/cwdContext.ts`：必要时补充 session 标识和上下文断言；
- 相关 session、cwd、worktree 和 QueryEngine 测试；
- 可选的 runtime 诊断日志。

不修改 `src/tools/*` 的内置工具代码和工具 schema。

## 验证方案

### 并发隔离

创建两个临时工作区，启动两个 session 并发执行 `pwd`、相对路径读取和 Shell 命令，验证每个结果都属于自己的工作区。

### QueryEngine 复用

使用目录 A 创建并运行 engine，模拟当前 session 切换到目录 B，再复用同一个 engine 发起下一轮，验证 Bash、文件工具和系统环境信息都使用 B。

### Worktree 和 resume

覆盖 EnterWorktree、ExitWorktree、resume、worktree 被删除后的恢复路径，并验证不会修改其他 session 的 cwd。

### CLI 兼容性

在没有 ALS 上下文的 CLI 测试中验证原有全局 cwd 行为仍然成立。

### 防回归断言

验证 session A 的工具调用不会使用 session B 的 project root、权限目录、MCP 配置或 transcript 目录。

## 验收标准

- 任意工具调用的实际 spawn cwd 等于发起调用的 session effective cwd；
- session 间并发执行不出现 cwd、权限或 transcript 串线；
- worktree 切换后复用旧 engine 不会回退到旧 cwd；
- CLI 现有行为保持不变；
- 内置 tool 无代码和协议改动；
- 日志可以明确判断一次失败是 runtime cwd 问题还是模型命令错误。

## 实施顺序

1. 先补 session cwd 并发和 QueryEngine 复用测试。
2. 再修改 QueryEngine 的 cwd 写入条件。
3. 收口 ClaudeSession 的上下文入口并审计控制操作。
4. 增加诊断字段，验证最新会话日志。
5. 通过测试后，再决定是否需要增加更严格的 session context 断言。
