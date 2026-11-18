# Moss 企业共享智能体方案

状态：方案草稿

## 1. 背景与目标

Moss 当前有本地电脑和云电脑两种工作方式。企业中还需要一种公共的智能体：由一个用户或管理员创建和配置，其他成员可以使用；创建者负责维护配置、技能、连接器和密钥，普通成员只能使用自己被授权的能力。

本方案解决以下问题：

- 项目如何发布为企业共享智能体。
- 用户如何继续使用自己的本地电脑或云电脑。
- 每个用户如何拥有独立会话和工作区。
- 企业如何控制用户可以使用哪些 Tool。
- 不同 App 如何执行各自的业务权限。
- 密钥如何只留在企业侧，不能泄露到用户运行环境。
- Agent 如何版本化、发布、回滚和审计。

核心原则：

> 项目负责创建和配置，Agent 负责发布和共享，Session 负责用户使用，企业能力网关负责 Tool 和业务数据权限。

## 2. 总体方案

公共智能体不直接做成一台大家共用的云电脑，而是做成一个可发布的 Agent。用户可以在自己的本地电脑或云电脑中使用它；涉及企业 App 的调用统一经过企业 MCP Gateway。

```text
创建者
  → Moss 项目
  → 发布 Agent 版本
  → 企业共享范围

普通用户
  → 自己的本地电脑或云电脑
  → 自己的 Agent / Session
  → 企业 MCP Gateway
  → 财务、CRM、OA 等 App
```

对于需要无人值守、定时执行、A2A 或长时间运行的任务，再提供企业托管运行模式。托管运行模式为每个 Session 创建独立运行环境，不能让多个用户共用同一台可变云电脑。

## 3. 核心对象

### 3.1 Project

项目是创建和编辑来源，归创建者所有，可以存在于本地电脑或云电脑中。项目中可以包含：

- System Prompt
- Skills
- MCP 连接器
- App 配置
- 模型配置
- 工作流和脚本
- 项目文件

项目是可变的，不直接作为公共运行对象。

### 3.2 SharedAgent

SharedAgent 是企业内可被发现和使用的智能体身份。它包含名称、描述、头像、创建者、企业归属和共享范围。

一个项目可以发布成一个 SharedAgent；一个 SharedAgent 可以有多个版本。

### 3.3 AgentVersion

AgentVersion 是项目某次发布的不可变快照，包含：

- 模型
- System Prompt
- Skill 引用
- Connector 引用
- Tool 清单
- Sandbox 模板引用
- 行为元数据

建议支持 `draft`、`test`、`prod` 三类版本，并支持固定版本、跟随最新版本、按权重灰度和回滚。

### 3.4 AgentMember / Policy

AgentMember 描述用户或部门与 Agent 的关系；Policy 描述用户可以使用哪些 Tool、访问哪些资源以及执行哪些操作。

### 3.5 Session

Session 代表一次用户使用过程，绑定：

- 用户
- SharedAgent
- AgentVersion
- 运行方式（本地电脑、云电脑、托管运行）
- 工作区
- 会话权限快照

每个用户只能默认访问自己的 Session。管理员是否可以查看或接入其他用户 Session，需要单独的管理权限和审计记录。

### 3.6 Connector / CredentialRef

Connector 表示对外部 App 或 MCP 服务的连接方式。CredentialRef 只表示凭证引用，不保存明文密钥。

密钥放在企业侧的凭证存储中，由 Gateway 或 Connector 在运行时换发短期令牌。密钥不进入 Project、Agent Manifest、用户文件、模型上下文和普通日志。

## 4. 运行方式

### 4.1 本地电脑

用户在本地运行自己的 Agent，使用本地文件和本地工作区。企业智能体只下发配置引用和 Tool 描述。

敏感企业 App 不直接把公共密钥注入本地进程，而是调用企业 MCP Gateway。

### 4.2 云电脑

用户在自己的云电脑中运行 Agent。云电脑可以继承公共智能体的配置，但仍然是用户自己的 Session 和工作区。

不建议所有成员直接进入同一个共享云电脑。若需要共享环境，应使用模板、快照、容器或微型虚拟机为每个 Session 创建隔离实例。

### 4.3 企业托管运行

用于定时任务、A2A、IM Bot、长任务和无人值守运行。每个任务执行创建独立 Session 和隔离 Sandbox，支持任务追踪、产物管理、成本统计和审计。

## 5. 权限模型

权限分为五层：

```text
企业层：谁能发现和使用 Agent
Agent 层：Agent 绑定哪些 Skill、Connector 和 Tool
Tool 层：当前用户能调用哪些 Tool
资源层：当前用户能访问哪些业务数据
操作层：只读、写入、导出、审批、删除
```

### 5.1 Agent 可见范围

支持：

- 全员可见
- 指定部门可见
- 指定用户可见
- 全员不可见

可见范围只解决“谁能看到和使用 Agent”，不能代替 Tool 和业务数据权限。

### 5.2 角色和 Tool 权限

建议使用角色、部门和用户三种主体叠加授权：

```text
普通员工：finance.query.self
部门负责人：finance.query.department、finance.budget.read
财务管理员：finance.export、finance.approve
```

Tool 权限策略示例：

```json
{
  "agentId": "finance-agent",
  "rules": [
    {
      "subject": "role:employee",
      "tool": "finance.query",
      "action": "read",
      "resourceScope": "self",
      "effect": "allow"
    },
    {
      "subject": "role:department_manager",
      "tool": "finance.query",
      "action": "read",
      "resourceScope": "department",
      "effect": "allow"
    },
    {
      "subject": "role:employee",
      "tool": "finance.export",
      "effect": "deny"
    }
  ]
}
```

当前 Session 的有效 Tool 集合为：

```text
项目工具
∩ Agent 版本工具
∩ 用户企业权限
∩ 当前 Session 策略
```

用户侧的工具过滤用于改善体验和减少模型误调用；真正的安全边界必须在企业 Gateway 再次强制执行。

### 5.3 高风险操作

以下操作默认需要更严格的策略：

- 写入或修改业务数据
- 导出大量数据
- 发起付款
- 审批
- 删除
- 代表用户发送外部消息

可以配置人工确认、二次认证、审批流、批量限制和更严格的审计等级。

## 6. 企业 MCP Gateway

MCP Gateway 是所有企业敏感 Tool 的统一入口。它不是一个让模型主动调用的“权限 MCP”，而是位于 Tool 调用链路上的强制执行点。

```text
用户自己的 Agent
  → MCP Gateway
  → 认证用户身份
  → 检查 Agent 和 Tool 权限
  → 检查资源数据范围
  → 获取短期凭证
  → App Connector
  → 业务 App
```

Gateway 包含以下模块：

- Auth Middleware：验证用户、企业、Agent 和 Session。
- Tool Registry：保存 Tool 的名称、App、动作、资源类型和风险等级。
- Policy Enforcement Point：拦截每次 Tool 调用。
- Policy Decision Point：根据用户、Tool、资源和上下文做出允许或拒绝决定。
- Resource Resolver：解析部门、客户、项目、单据等资源范围。
- Secret Broker：换发短期令牌，隐藏长期密钥。
- App Connector：将标准 Tool 调用转换成具体 App API。
- Result Filter：过滤敏感字段和超出范围的结果。
- Audit Pipeline：记录调用人、Agent、Tool、资源、结果、耗时和拒绝原因。

每个 Tool 不需要重复实现认证和通用权限逻辑，只需要登记权限元数据：

```json
{
  "name": "finance.query",
  "app": "finance",
  "action": "read",
  "resourceType": "expense",
  "riskLevel": "low"
}
```

已有 MCP 服务可以先通过 Proxy 接入，不要求逐个改造 Tool：

```text
Moss → MCP Gateway → 原有 MCP 服务 → 业务系统
```

如果下游 App 已经有自己的权限系统，Gateway 做第一层判断，App 继续做最终的资源权限判断。

## 7. 密钥和身份

密钥处理原则：

- Manifest 中不允许出现 headers、env 和明文凭证。
- Project 和用户本地配置只保存 CredentialRef。
- Gateway 使用短期令牌访问外部 App。
- 用户身份不能由模型或客户端自行填写，必须从登录令牌中解析。
- 日志、Trace、模型上下文和 Tool 返回值中不能出现密钥。
- 支持凭证轮换、撤销、过期和按 Connector 隔离。

支持三种 App 身份模式：

1. 用户身份透传：适合财务、CRM、OA 等需要按员工权限过滤的系统。
2. 企业服务身份：适合公共只读数据，但必须由 Gateway 做数据范围限制。
3. 用户确认授权：适合写入、审批、付款和外部消息操作。

## 8. 发布流程

```text
1. 创建者在本地或云电脑编辑项目
2. 点击“发布为企业智能体”
3. 系统检查云端兼容性、Tool、Connector 和凭证引用
4. 生成 AgentVersion 草稿
5. 创建者测试运行
6. 发布 test 或 prod 版本
7. 选择全员、部门或用户范围
8. 用户在“企业智能体”中发现并使用
9. 新配置发布新版本，支持灰度、固定版本和回滚
```

发布检查至少包括：

- 是否包含本地绝对路径。
- 是否把密钥写入了 Prompt、Skill 或环境变量。
- Tool 是否声明权限和风险等级。
- Connector 是否已配置凭证引用。
- 是否允许用户身份透传。
- 是否包含不适合共享的桌面工具。
- 是否设置了数据范围和高风险操作策略。

## 9. Moss 现有能力的复用

Moss 已有的能力可以直接作为实现基础：

```text
AppToolPolicy / allowedTools
  用户侧工具池过滤和 Session 工具白名单

Host API capabilities
  App 能力发现和授权状态检查

Remote Permission Bridge
  远程运行时的工具确认和拒绝

Moss Server Auth / Roles
  企业、用户、部门和管理员权限

MCP Server Approval
  本地和项目 MCP 的启用确认

Desktop / Cloud Host
  本地电脑和云电脑运行环境
```

需要新增的是：

- SharedAgent 和 AgentVersion 数据模型。
- Agent 发布、可见范围和版本路由。
- Tool Policy 和资源范围策略。
- 企业 MCP Gateway / Proxy。
- CredentialRef 和 Secret Broker。
- Agent Session 与用户、AgentVersion 的绑定。
- Tool 调用审计和管理员查看入口。

## 10. 第一阶段 MVP

第一阶段先实现完整闭环，但控制范围保持简单：

1. 项目发布为企业共享智能体。
2. 支持全员、部门、指定用户三种可见范围。
3. 用户在本地电脑或云电脑创建自己的 Session。
4. AgentVersion 继承 Prompt、Skill 和 MCP Connector 配置。
5. 企业 MCP Gateway 代理已有 MCP 服务。
6. 不向用户环境下发明文密钥。
7. 支持 Agent 级和 Tool 级 allowlist。
8. 支持用户级短期访问令牌。
9. 记录 Tool 调用审计。
10. 支持 test、prod、回滚和停用。

第一阶段可以先支持“用户身份透传”或“企业只读服务身份”两种连接模式，暂不做复杂的字段级策略。

## 11. 后续阶段

第二阶段：

- 部门和角色级资源范围。
- Tool 的只读、写入、导出、审批权限。
- 高风险操作二次确认和审批流。
- 用户 OAuth 身份管理。
- 细粒度审计和用量统计。

第三阶段：

- A2A 委托链和跨 Agent 权限。
- 企业托管运行、定时任务和 IM Bot。
- Agent 灰度发布和自动回滚。
- 共享知识库和组织级记忆。
- Agent 市场、配额和成本中心。

## 12. 关键结论

Moss 不应把公共智能体设计成一台共享云电脑，也不应让每个 Tool 自己实现一套权限系统。

推荐的最终结构是：

```text
Project
  → SharedAgent
  → AgentVersion
  → User Session
  → MCP Gateway
  → App Connector
  → 企业业务系统
```

用户侧负责 Agent 的运行体验，企业侧负责身份、凭证、Tool、数据范围和审计。这样可以保留 Moss 的本地电脑和云电脑优势，同时支持企业级公共智能体的安全治理。
