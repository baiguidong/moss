# Workflow Definition v3

Moss 使用结构化状态机 Definition 描述 Workflow。Definition 同时驱动校验、执行、实时进度和可视化；不解析 JavaScript 或日志来猜测流程。

Workflow 位于相邻 `moss-apps/apps/workflow` 的独立 App，要求 Host API 2.8。旧 Core 引擎、工具、模板、原生画布、运行历史扫描与 `workflow:*` IPC 已删除。参见 [交互与验证记录](../ui/docs/workflow-app-experience-plan.md) 和 [通用执行接口](../ui/docs/app-execution-host.md)。以下 Definition v3 节点和数据流规则保持适用。

```text
普通会话描述需求 → App 创建/修改草稿 → 按要求发布
                                      ↓
选择资源或 @ → 自然语言输入 → App 调度 → Core 通用 Agent 执行
                                      ↓
                            会话左侧流程与聊天结果
```

## 使用入口与工具

安装工作流 App 后即可使用；启停统一由 App 管理控制，没有独立的 Workflow 设置开关。App 提供 `workflow_read/create/edit/manage/run/remove` 六个工具，使用时带 `app__moss_workflow__` 前缀。创建、修改、使用分别按需准备 read/create、read/edit、read/run 两个工具。

App 提供目录、只读画布、流程与运行详情和低频管理菜单。创建、修改及运行输入通过普通会话完成；App 只准备未发送的会话草稿，用户发送后才开始执行。默认使用已发布快照，明确要求试跑时可执行草稿。

不提供旧数据迁移、内置业务模板、人工 Definition 编辑器或 JSON 参数输入框。App 持久维护运行状态快照与分页事件，会话左侧嵌入 App 流程页，最终结果保留在普通会话供追问。Core 只负责通用会话、执行权限、任务、取消和资源上限。

## 顶层结构

```json
{
  "version": 3,
  "kind": "state-machine",
  "meta": {
    "name": "process-request",
    "title": "处理请求",
    "description": "按明确步骤处理输入并返回结构化结果"
  },
  "defaults": { "concurrency": 2 },
  "limits": {
    "maxAgentCalls": 32,
    "maxNodeExecutions": 64,
    "maxConcurrency": 2,
    "maxDurationMs": 1800000
  },
  "graph": {
    "entry": "input",
    "nodes": [],
    "edges": []
  }
}
```

根图必须恰好包含一个 `start` 和一个 `end`。每个节点使用全局唯一的小写 `id` 和面向用户的简短 `title`。

Definition 只表达用户要求的业务流程，不内置 Review、计划、测试、总结或并行等固定套路。一次运行失败也不会自动改写 Definition、切换模型、放宽超时或合并节点；这些都必须由用户明确要求。

## 节点类型

| 类型 | 用途 |
| --- | --- |
| `start` | 声明并校验运行输入 |
| `agent` | 完成一件可理解的自治任务 |
| `code` | 执行确定性的同步 JavaScript 数据转换 |
| `condition` | 根据结构化数据选择一个出口 |
| `parallel` | 显式启动多个独立分支 |
| `join` | 等待指定 `parallel` 的全部分支 |
| `merge` | 合并互斥条件分支的结果 |
| `foreach` | 对数组元素执行一个受控子图 |
| `workflow` | 调用已保存的子 Workflow |
| `end` | 组装并返回最终结果 |

Agent 内部可以调用主会话已有的常规 Tool，这些调用展示在节点详情里，不成为主流程节点。Workflow、Team、Agent 等嵌套编排工具不会暴露给节点。

`condition` 至少包含一个显式 IF/ELIF 分支和一个必需的 `default`（Else）分支，因此实际出口至少有两个。`branches` 数组不包含 default；画布会把两者都显示为完整分支。

## 条件循环

条件循环直接使用回边，不使用 Loop 容器：

```text
生成草稿 → 是否达标？
              ├─ 否 → 改进草稿 ─┐
              └─ 是 → 输出      │
                    ↑            │
                    └────────────┘
```

回边必须显式声明上限：

```json
{
  "source": "improve-draft",
  "target": "quality-check",
  "kind": "back",
  "maxTraversals": 8,
  "label": "重新检查"
}
```

移除回边后，剩余图必须无环。超过回边上限时运行失败，不能把最后一次结果冒充成功。

## 并行与 Foreach

并行必须显式使用配对的 `parallel` 和 `join`。普通节点不能通过多条默认边隐式并行，普通节点也不能通过多个入口隐式汇合。

`foreach` 仅用于数组迭代。其 body 使用 `$complete` 结束，不允许嵌套另一个 foreach。不同数组项使用独立 Agent 会话。

## Agent 会话与权限

同一个 Workflow Run 中，同一个逻辑 Agent 节点只创建一个 Agent 会话。节点通过回边再次执行时，在原 agentId 和完整对话上下文上继续；画布保留每次执行记录，但 Agent 数只计算一次。不同节点和不同 foreach 项使用独立会话。

Agent 继承主会话的常规工具和权限模式：

- 主会话完全放行时，Agent Tool 调用直接通过。
- 默认权限模式下，请求由主会话展示和处理。
- 持久授权规则会被后续节点复用。
- 拒绝、取消和不可恢复的 Tool 错误会使节点失败并停止 Workflow。

V3 核心不增加目录白名单；随机会话目录不是安全边界，因此 Agent 可以按输入中的绝对路径处理一个或多个仓库。

## 节点结果和失败

Agent 的 `outputSchema` 只描述业务结果。运行器会在模型侧包装统一状态：

```json
{
  "status": "completed",
  "output": {}
}
```

缺少输入、文件、权限或前置条件时返回：

```json
{
  "status": "blocked",
  "reason": "缺少必需的输入文件"
}
```

`blocked`、技术错误、超时、权限拒绝和输出校验失败默认立即停止，不隐式重试、跳过或继续。

## 数据绑定

```json
{
  "target": ["request"],
  "source": { "kind": "workflow-input", "path": ["request"] }
}
```

`target: []` 表示绑定整个值。Source 类型包括 `literal`、`workflow-input`、`node-output`，以及 foreach 中的 `iteration-item`、`iteration-index`。Agent、Code、子 Workflow 和 End 只能读取显式绑定的值，不会隐式获得全部运行参数。

## JavaScript 节点

JavaScript 只能位于 `code.script`，用于一个节点内的同步数据转换。脚本可读取显式绑定的 `input`，在 foreach body 内还可读取 `item`、`index`，并可调用 `log()`；不能访问全部运行参数、模块、文件系统、网络、当前时间或随机数，不能返回 Promise。流程控制必须写在 Definition 中。

## 取消和运行保护

- 用户停止主会话时，级联取消其正在运行的 Workflow 和 Agent。
- Workflow 页面也提供独立停止按钮。
- 每个回边、节点总执行数、Agent 调用数和总运行时间均有限制。
- `limits.maxDurationMs` 是整个运行的硬截止时间；`execution.timeoutMs` 是显式的单节点硬截止时间。两者都是安全上限，不是预计耗时，不能把总时限机械拆成多个很短的 Agent 超时。
- 停止后不再调度新节点，正在执行的 Agent 收到同一取消信号。

## 可视化与导出

画布直接读取 Definition，并用 Runtime 事件更新状态。重复节点显示执行次数，当前节点和当前连线动态高亮，回边单独绘制。节点详情展示任务、每次执行状态和错误。

App 可导出定义与运行记录 JSON；图与 Mermaid 由 App 内的 v3 引擎生成。仓库示例 [`examples/workflow-decision.workflow.json`](../examples/workflow-decision.workflow.json) 展示显式并行、结构化 Agent 输出和汇合。
