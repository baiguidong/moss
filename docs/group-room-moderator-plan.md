# Moss Group Room 主持人架构计划

状态：核心实现与自动化回归已完成（2026-09-02）；真实模型/连接器 CDP 验收作为发布前环境门禁  
适用范围：桌面端本地 Group Room  
替代设计：`docs/group-room-implementation-plan.md` 中由用户选择收件人、讨论/并行模式和固定轮次的调度模型

## 1. 产品结论

Group Room 必须只有一个面向用户的入口：房间主持人。用户表达目标、补充约束或要求停止，不负责选择哪个成员发言，也不负责决定串行、并行或讨论轮数。

```text
用户
  ↓ 目标 / 反馈 / 中止
主持人（持久主 Agent、唯一对话入口）
  ├─ 直接回答
  ├─ 委派一个成员
  ├─ 委派一组互相独立的成员并行执行
  ├─ 根据结果继续追问、验证或换人
  └─ 汇总并向用户给出最终答复
```

成员不接管用户会话。主持人必须观察真实执行结果后再决定下一步，不能预先生成固定轮次。一次请求的结束条件是主持人判断已经可以回答用户，而不是用完用户指定轮数。

## 2. 设计来源

本方案吸收以下开源项目的稳定模式，但不引入它们的运行时依赖：

- [OpenAI Agents SDK：Manager（agents as tools）与 Handoff 的区别](https://openai.github.io/openai-agents-python/multi_agent/)：Group Room 采用 manager 模式，由主持人保留控制权并汇总结果，不把对话永久移交给专家。
- [AutoGen SelectorGroupChat](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py)：下一位发言者由模型根据角色与历史选择，而不是由用户操作控件指定。
- [AutoGen Magentic-One Orchestrator](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py)：编排器持续读取进度、选择下一位执行者、在停滞时重规划，并由编排器生成最终答复。
- [LangGraph Supervisor](https://github.com/langchain-ai/langgraph-supervisor-py)：中心 supervisor 负责委派和跨专家汇总；专家返回 supervisor，而不是直接接管主会话。
- [CrewAI Hierarchical Process](https://github.com/crewAIInc/crewAI/blob/main/docs/edge/en/learn/hierarchical-process.mdx)：manager 负责分配工作和验证结果，同时保留最大迭代次数等安全边界。

Moss 保留自己的关键优势：每个房间成员独立会话、明确资源授权、连接器隔离、Electron 主进程工具审批、SQLite 崩溃恢复和可审计执行记录。

## 3. 不变量

1. 主持人是系统拥有的虚拟成员，固定 id 为 `moderator`；不能被删除、替换或由用户冒充。
2. 用户消息固定发送给主持人，公共消息 author 为 `human/user`，audience 为 `moderator`。
3. 主持人不拥有工具、连接器或文件写权限。它只能输出受校验的控制决策。
4. 主持人只能委派房间 roster 中的成员；成员仍只能使用自身获授的资源。
5. 成员只返回证据和结论；只有主持人回答用户并判断收敛。
6. 并行是内部优化：同一决策返回多个互相独立的 assignment 时才并行执行。
7. 不存在产品层“轮数”。系统保留不可见的步数、时间、token、重复委派和并发上限，防止失控。
8. 软插话在安全边界交给主持人重新规划；硬中止立即停止运行，不自动重放有副作用的任务。
9. 主持人的结构化输出、成员输出和错误都必须经过服务端校验/脱敏后才能影响房间状态。

## 4. 主持人决策协议

主持人每一步只能返回以下动作之一：

```json
{
  "action": "respond",
  "response": "面向用户的完整答复"
}
```

```json
{
  "action": "delegate",
  "assignments": [
    { "memberId": "房间成员 id", "task": "具体、可验收的任务" }
  ],
  "reason": "简短调度说明"
}
```

约束：

- `respond.response` 必须非空，作为 `authorType=moderator` 的公共消息发布。
- `delegate.assignments` 为 1 到内部并发上限个；成员必须存在，成员 id 在同一批次内唯一，任务必须非空。
- 多 assignment 表示主持人确认它们不互相依赖，可并行执行；有依赖时必须一次只委派一个，拿到结果再决策。
- 主持人达到安全上限时只能 `respond`，并明确说明已有结论、缺失证据和未完成事项。
- JSON 解析或校验失败不执行任何成员任务；最多进行一次无工具格式恢复，仍失败则安全结束并显示可理解错误。

## 5. 控制器状态机

```text
idle
  └─ user message → compact context → create orchestrated run
       ↓
     moderating
       ├─ respond → publish moderator answer → completed
       └─ delegate → append reserved turns
                        ↓
                     executing
                        ├─ collect completed/failed/interrupted results
                        ├─ soft intervention → promote user message
                        └─ return to moderating

任何状态：hard stop / timeout → abort active members → interrupted
安全预算耗尽：force-finish moderation → completed/superseded
```

每次主持决策前都读取数据库中的当前事实，而不是相信内存里的预计状态：房间摘要、公共消息、当前 run 的所有 assignment、结果、失败和插话。这样才能在并行失败、权限拒绝、成员被停止或恢复后正确重规划。

## 6. 持久化和兼容

- 新 run 写入 `mode=orchestrated`；数据库仍接受旧 `conversation`/`parallel` 记录，保证历史可读。
- orchestrated run 允许零个初始 turn；成员 turn 由主持人在运行中通过 `appendRunTurns` 动态添加。
- 不修改现有 SQLite 表结构，因此不需要破坏性迁移。
- 新建/更新房间不再写 `mode`、`discussionPolicy`、`discussionRounds`。旧 settings 中这些键读取时忽略，下一次设置更新时自然清理。
- 旧消息 author 和旧 run mode 继续渲染；新消息区分 `human`、`moderator`、`agent`、`system`。
- 主持人会话以 `roomId` 隔离并持久复用；删除房间或 dispose registry 时必须释放。
- 主持人和成员在持久会话有效时只接收新的公共消息/执行结果；摘要水位变化后重建会话，避免重复注入完整历史或让旧上下文抵消压缩效果。
- 模型返回的是会话累计 usage，控制器只计入相邻调用的增量；成员失败、主持协议失败或上下文压缩后要释放对应会话，避免上下文与计量水位失配。
- 主持人、成员与摘要输入都有字符/条目上限；超长待摘要消息保留首尾和消息身份，原始消息仍完整保存在 SQLite 中。

## 7. UI/API 调整

移除：

- “讨论 / 并行”按钮；
- 固定轮数 / 持续至收敛；
- 用户选择接收成员；
- 用户填写每位成员 assignment；
- “主持”建议按钮和 `suggest-moderation` IPC；
- “发送给 N 位”的状态表达。

保留：

- 用户给主持人的单一输入框；
- 主持人、用户、专家的清晰身份；
- 当前由主持人委派、正在执行的成员状态；
- 查看成员私有执行记录；
- 房间权限、成员资源配置、单成员停止、整房间停止；
- 软插话与硬中止，但文案明确它们是“补充给主持人”和“立即中止”。

创建房间至少需要一位专家；主持人是隐式成员，因此无需人为凑够两个专家。

## 8. 安全与收敛策略

默认内部边界（不在主 UI 暴露）：

- 最多 16 次主持决策；
- 每次最多 3 个并行 assignment（与房间执行器并发上限一致）；
- 沿用房间 run timeout、turn timeout 和 token budget；
- 同一成员 + 同一任务连续重复两次视为停滞，强制主持人总结；
- 主持人不能调用工具，不能修改资源授权，不能创建房间外执行者；
- 一个成员失败不直接伪装成全局失败：错误回到主持人，由其换人、降级回答或说明缺失；
- 连接器授权失败保持现有可见提示和 Connector Hub 恢复路径。

这些上限属于故障保险，不代表讨论语义。正常收敛完全由主持人根据用户目标和证据决定。

## 9. 验收矩阵

- [x] 简单问题由主持人直接回答，零成员 turn。
- [x] 主持人委派一个成员，读取结果后给最终答复。
- [x] 主持人一次委派多个独立成员，执行共享快照且输出槽顺序稳定。
- [x] 主持人根据第一位成员结果再委派第二位，不需要预设轮次。
- [x] 成员失败后主持人仍能换人或给出带缺口的答复。
- [x] 软插话进入当前 run 的下一次主持决策，不丢失已完成结果。
- [x] 硬中止不会发布迟到结果，也不会自动重试副作用。
- [x] token、时间、步数、重复委派边界可收敛。
- [x] 用户不能通过公开 renderer API 指定 memberIds、mode、rounds 或 assignments；旧调用中的字段会被忽略。
- [x] UI 不存在收件人、并行和轮数控件，且主持人身份可见。
- [x] 旧房间、旧 run 和旧 settings 可读取。
- [x] 主持人与成员会话按 room/member 隔离，工具权限不泄漏。
- [x] 持久会话的上下文按水位增量投递，usage 按调用增量记账，压缩后重建会话。
- [x] 超长公共上下文、成员提示、主持 ledger 与摘要输入均有显式边界。
- [x] 资源解析等调度前失败也会把预留 turn 落为 failed，不遗留 pending run。
- [x] Group Room 单测、IPC/运行时测试、TypeScript、renderer build 和仓库相关回归全部通过。

发布前环境门禁：

- [ ] 在配置真实模型的桌面进程中运行 `ui/scripts/group-room-e2e.mjs` 的完整 CDP 场景。
- [ ] 使用至少一个有效连接器和一个失效授权连接器分别验证审批、只读边界与恢复提示。

## 10. 后续扩展原则

- 若增加主持人模型、风格或策略配置，只能影响决策质量，不能改变资源安全边界。
- 若增加显式 `ask_user`，它仍应表现为主持人的普通公共提问；下一条用户消息启动或续接工作，不把状态机控制暴露给 UI。
- 若增加更复杂的 DAG、投票或辩论模板，它们是主持人的内部策略，不恢复轮数/并行/收件人按钮。
- 若未来复用通用 Coordinator，应复用委派、等待和结果审查语义；Group Room 仍必须通过房间 roster 白名单与成员资源解析器，不能直接开放通用 `Agent` 工具。
