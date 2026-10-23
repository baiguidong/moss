# 上下文统计与压缩修复方案

日期：2026-10-22。参考本机 Claude Code 2.1.303 发布产物，经 REA 6.5.0 静态检查及嵌入 JS 校验。

## 目标与明确例外

- 最终请求 input/cache/output 与 Claude 的原生流式合并结果相同。
- 当前上下文遵循 Claude 的有效 usage/iteration 锚点与新增消息估算规则，不能用累计账单或不同阶段的 MAX 拼接。
- 已知容量时，常规主动阈值为 `contextWindow - min(maxOutputTokens, 20000) - 13000`；达到阈值（`>=`）即具备主动压缩条件。百分比覆盖只允许降低阈值。保留关闭压缩、递归保护、失败熔断等既有约束。
- **用户指定例外：未知容量不主动压缩，也不按 200K 本地阻断；等待服务端实际上下文超限错误，再走既有被动压缩、同轮重试。既不猜 200K，也不猜 1M。** Claude 2.1.303 有自己的 unknown-model 容量策略，本项并不宣称与其默认策略逐项一致。

## 根因与改动

### 1. 用量归一化

`src/services/api/claude.ts` 的 OpenAI 账单识别此前把 `source=oai_responses`、缺少真实 `input_tokens`、只有 `prompt_tokens=0` 占位的元数据当作权威数据，从而将有效原生 input/cache 清零。

修复：账单来源与字段形状必须匹配；全零账单输入不能覆盖同事件的正数原生输入/缓存，或与正数 total 矛盾。无效元数据回退原生字段；完整真实全缓存用量仍允许未缓存 input=0。保持正常 Chat/Responses 的缓存不重复计算。

### 2. 最终用量同步与持久化

- API 层将最终 usage/stop_reason 回写同响应全部 assistant 分块。
- QueryEngine 同步内部与已规范化 SDK 副本；对 SDK 发送已经归一化的 usage，避免前端再次解释网关账单扩展。
- 流式模式经现有 message_delta 更新主进程与 renderer 中同响应、同父工具作用域的分块；不追加重复 assistant 消息、不重复计费。
- 非 partial 模式等待最终事件再发出 assistant，避免客户端拿不到修正的最终用量。
- 正常流在最终事件后记录 transcript，避免依赖 100ms 延迟序列化碰巧捕获最终字段。用户输入仍立即持久化，异常终止保留可用的未完成状态；未完成响应不宣称拥有最终输出统计。

### 3. 统一计数口径

`shared/context-token-usage.ts` 在引擎与 UI 共享 Claude `MX/bI` 对应的用量选择：有效最后 iteration 描述当前上下文，top-level 仍用于请求累计账单。

`tokenCountWithEstimation` 跳过输入与缓存均为零的锚点，支持纯缓存输入，回溯同 response ID 的分块锚点，并在 compact boundary 重置。新内容粗估遵循 Claude 的文本/工具/图像/文档规则；不会跨请求找回旧 221624 作为这次最终值。

会话累计按请求 ID 去重；明确完成的最终快照优先，未完成片段采用流式合并而非分量 MAX，较晚到达的旧 provisional 不能覆盖已完成用量。

### 4. 未知容量仅被动压缩

`autoCompact.ts` 对容量解析的 `isDefault=true` 返回无有限主动/阻断阈值。warning/compact/block 判定均不使用兜底 200K。未知容量时不向模型注入猜测的 token budget 附件。

SDK `modelUsage.contextWindow=0` 表示未获知容量，避免远端 UI 将默认 200K 当成提供方元数据。UI 展示“容量未知”，不显示容量百分比。

`compactAfterPromptTooLong` 继续使用既有 compactor；它不要求本地达到阈值，成功后重试同轮请求，失败只展示一次错误，保留原来的关闭压缩选项。

## 验收矩阵

| 项目 | 预期 |
| --- | --- |
| 09:43 真实 usage 回放 | input=3，read=191863，write=2565，output=1122，总计195553，与提取的 Claude 函数相同 |
| 09:46 真实 usage 回放 | input=3，read=202773，write=737，output=404，总计203917，与 Claude 相同 |
| 12:26 旧会话最后一条 | input=3，read=212184，write=46，output=147，总计212380；不是已用147 |
| SDK/UI/transcript/账本 | 同请求最终字段一致；分块只计一次；输出不再固定为0 |
| 流式最终 delta 延迟超过100ms | 落盘仍为最终 usage，不依赖队列定时器 |
| 全缓存请求 | 未缓存输入可以为0；缓存总量有效，不取旧 provisional 输入 |
| iterations 与累计账单 | 当前上下文取最后有效 iteration；累计账单不改成 iteration 用量 |
| output-only/并行工具结果/压缩边界 | 与 Claude vf/kqe 静态函数差分一致 |
| 已知200K | 常规主动阈值167000；阈值前false、达到阈值true |
| 已知1M | 常规主动阈值967000；阈值前false、达到阈值true |
| 未知容量，当前超过1.2M | 不按200K主动压缩或阻断；实际服务端超限后压缩一次并重试 |
| 压缩失败 | 一次失败后退出，无无限循环 |

对照范围是上述纯函数与 Moss 查询流程，不代表完整 Claude 程序所有模型、实验策略、服务端清理、precompute 分支均已动态验证。

## 重启后的旧会话与新会话复查

2026-10-22 14:21 只读核验，未修改历史数据：

- 当前运行包已于14:16构建，应用于14:17启动，包含本次用量修复；不能把旧数字归因于未重启。
- 旧会话 `a9378311-846d-4e26-a16e-4d9b0b5c5a9f` 的最后请求在12:26完成，早于当前运行版本。SQLite history和usage_events保存的是旧版清零后的用量；重启不会恢复已丢失的字段。
- 原始完整trace包含118个成功请求，累计 input=354、output=60460、cache read=15901824、cache write=500287。账本同样118条，output=60460吻合，但输入和缓存全为0。输出累计正确不代表当前上下文只有147。
- 最后请求 `d7368a89-4129-4293-b1c9-1ac62e3d25fb` 的原始最终usage为 input=3、cache read=212184、cache write=46、output=147，共212380。start输入243494也不是最终值。history已清零，不能仅靠这份history恢复输入/缓存。
- 新会话 `053d4008-0608-483b-9281-6c60aa9b1afd` 在14:21产生3次请求，最后请求 input=3、cache read=22777、cache write=687、output=13，共23480，UI显示23.5K正确。输入包括系统提示、工具定义和本轮消息，不只是“你好”。这3次请求累计 input=9、output=258、cache read=45352、cache write=23464；累计账单和最后一次上下文不是同一指标。
- 不要求新建会话：修复后的新请求使用同一代码路径，会在旧会话中生成正确最终usage；但不会自动修正其旧累计账单。历史恢复必须依照完整trace按请求ID匹配，另行确认及备份，不能靠最新一次输入量推算旧请求。

不能由这一个会话推断所有历史会话都错误；是否受影响取决于网关响应是否触发零占位账单覆盖。

## 数据与交付边界

- 不自动改历史 SQLite 或正在运行的会话。历史错误只有在保留完整 raw trace 时才能重建，需另行确认、备份及按请求去重。
- 不重启正在运行的 Moss，也不提交 git。源代码修复后需重新构建并重启/发布对应运行产物才能生效。
- 回归测试使用本地 HTTP/SSE fixtures 与临时目录，不调用付费模型。Claude 对照仅执行从已校验产物提取的纯函数，不启动 Claude CLI。

## 复查命令

```sh
bun test ./src/services/api/__tests__/usageCompatibility.test.ts
bun test ./src/services/api/__tests__/streamingFallback.test.ts
bun test ./src/QueryEngine.usage.test.ts
bun test ./src/utils/__tests__/contextTokenUsage.test.ts
bun test ./src/utils/model/modelCapabilities.test.ts
bun test ./src/queryPromptTooLong.test.ts
bun test ./ui/tests/context-usage.test.ts ./ui/tests/session-info.test.tsx ./ui/tests/assistant-usage-reconcile.test.ts
bun test ./output/moss-context-usage-review-20261022/acceptance.test.ts
```

## 验收结果

- Claude 发布代码差分：6项通过，104个断言。三条实际响应（包含旧会话最后输出147的响应）的四项计数及缓存写入TTL明细完全相同；9种上下文样例，以及200K/1M容量、百分比覆盖、主动/阻断边界匹配。
- SDK端到端：partial开启/关闭两种模式均通过，最终UI/SDK结果/transcript/用量账本事件一致。最终delta特意延迟160ms，排除100ms队列时序巧合；另有流中断内容与错误保留测试，共3项通过。
- 当前相关回归：usage compatibility 11项、streaming fallback 16项、上下文计数5项、model capabilities 10项、被动恢复2项、并发落盘2项、压缩与边界10项、UI/历史同步43项全部通过；与前述差分/端到端合计107项。
- 14:21复查后的追加回归：usage compatibility、UI上下文、会话信息、Claude差分共34项通过，179个断言。新增同一旧会话后续响应的上下文与累计账单隔离测试，确认无需新建会话，但不会虚构缺失的历史输入/缓存。
- UI TypeScript检查、主进程/同步模块语法检查、git diff --check通过。
- 隔离构建通过：运行包 `/tmp/moss-context-electron-direct-20261022.mjs`；renderer `/tmp/moss-context-renderer-20261022`。没有覆盖现有运行产物或重启应用。renderer有现有的大分块告警，不影响构建成功。
- 根仓库全量 `tsc --noEmit` 不能作为通过项：当前仓库存在大量缺失重建类型模块、宏声明及依赖类型问题。没有为了消除这些无关诊断改动配置；本次以相关实际运行测试、UI类型检查与隔离构建交叉验证。
