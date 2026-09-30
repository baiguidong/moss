# Trace 迁移方案

以 cc-haha 的实现为来源，保留采集、JSONL、可重建 SQLite 索引、revision 查询，以及会话树、调用详情、上下文解析和诊断规则。界面使用 Moss 的颜色、字体、控件和导航。普通 moss.log 保持独立。

状态：已完成实现、回归验证和构建。重启 Moss 后可使用新入口；远程 Trace 需要同步更新 Moss Server。

## 实施范围

1. 迁移 `src/services/api/traceCapture.ts` 与 localIndex 所需模块；Node/Electron 使用 `node:sqlite`，Bun 离线测试使用兼容驱动。
2. 从 `dumpPrompts.ts` 提取 Trace fetch 生命周期，在 Moss `client.buildFetch()` 接入，保留 fetchOverride，不引入 dump-prompts 的额外文件写入。
3. 设置与运行时按 scope 隔离。本地 scope 为 MOSS_HOME，服务器为当前用户 profileDir；独立 `trace-settings.json` 保存 `traceCapture.enabled`，默认开启，与 cc-haha 一致。JSONL 在 `traces/`，索引在 `db/trace-index-v1.sqlite`。
4. 每次新请求读取开关，切换不重启会话；已开始采集的调用补写最终状态。完整请求在 pending 阶段记录。写入失败不能改变模型响应或异常。
5. 本地 IPC 与带鉴权的服务器 API 提供 settings/list/get/revision/call/delete。区分界面 sessionId 与底层 transcriptSessionId。列表摘要裁剪，完整详情按需读取。
6. 迁移 cc-haha 的 request/SSE/semantic parsers、TraceViewModel、会话树、分栏、详情面板。设置增加独立 Trace 分类，聊天头部可打开当前会话 Trace；本地与服务器分别管理开关和数据。

## 来源与落点

迁移参考本机 `~/repo/cc-haha` 工作区（HEAD `0676c194`）。保留原有数据结构、解析和视图组织；适配 Moss 的运行时、会话身份、IPC、服务器鉴权和组件样式。

| cc-haha 来源 | Moss 落点 | 适配内容 |
| --- | --- | --- |
| `src/services/api/traceCapture.ts` | `src/services/api/traceCapture.ts` | 保留 JSONL、语义请求、脱敏、revision、缓存及索引降级；设置迁至独立 scope |
| `src/services/api/dumpPrompts.ts` | `src/services/api/traceFetch.ts`、`client.ts` | 提取调用生命周期，不接入额外的 prompt dump；保留原 fetchOverride、响应内容和取消行为 |
| `src/server/services/localIndex/trace*` 等 | `src/services/trace/localIndex/` | 保留可重建索引，适配 Node/Electron SQLite |
| `src/server/proxy/protocolTrace.ts` | `src/services/trace/protocolTrace.ts`、`responseCapture.ts` | 迁移有界协议观察器，补 Anthropic 终止事件和用量解析 |
| `desktop/src/pages/TraceList.tsx`、`TraceSession.tsx` | `ui/src/renderer-react/components/trace/` | 保留列表、会话树、两栏详情、筛选、诊断、刷新和按需读取正文 |
| `desktop/src/lib/trace/`、`traceViewModel.ts` | `ui/src/renderer-react/lib/trace/` | 保留请求、SSE、上下文分类和时间线语义，缓存按本地/服务器及 revision 隔离 |
| cc-haha 桌面 API 和服务接口 | `ui/src/trace-ipc.mjs`、`server/src/traceRoutes.ts` | 改接 Moss IPC 和已有服务器认证；通过 `traceMessages.ts` 适配聊天记录 |

## 请求与开关链路

1. 本地宿主将 `MOSS_TRACE_SCOPE` 设置为 `MOSS_HOME`；服务器强制使用会话所有者的 profileDir，覆盖桌面提交的路径。轻量 AsyncLocalStorage 隔离并发会话的采集上下文。
2. SDK 经 `client.buildFetch()` 发出请求时读取当前 scope 的开关。默认开启；关闭后停止采集新请求，历史记录仍可查看。无需重启当前会话。
3. 开启时生成 callId，异步写入带语义请求的 pending 记录。SDK 消费响应的同时观察流，保留背压，不额外持续读取一份克隆流。
4. 正常完成、协议错误、网络错误或取消时，按同一 callId 写入最终状态、耗时、用量、响应和诊断信息。中途关闭开关不影响已开始记录的收尾；采集故障不能替换模型结果或原始异常。
5. JSONL 是事实来源，SQLite 用于查询加速，可以重建。界面先读摘要和裁剪预览，打开调用详情时再读语义请求和较完整的响应预览。

本地 IPC 只接受主窗口主 frame 的请求。远程列表先从用户有权访问的会话开始查询；单会话读取和删除复用服务器的会话权限判断。服务器响应使用 `no-store`。

## 使用与接口

- 入口：**设置 → Trace**；聊天工具栏的 Trace 按钮可直接查看当前会话。
- 本地/服务器标签分别读取各自的开关与数据。本地保存在 `<MOSS_HOME>/traces/`，服务器保存在对应用户 `<profileDir>/traces/`。
- 每轮可查看系统提示词、消息、工具定义、工具参数与结果、模型响应、用量、耗时和错误。中断时保留已采集的部分响应。
- 列表搜索会话 ID、标题和工作区；会话内可搜索 Span 并按模型调用、工具或错误筛选。
- 删除只删除该会话的 Trace，不删除聊天。正在运行的会话之后仍可能产生新记录。

服务器需更新到包含本次接口的版本，桌面才能读取远程 Trace：

| 接口 | 用途 |
| --- | --- |
| `GET/PUT /api/v1/traces/settings` | 当前用户的采集开关 |
| `GET /api/v1/traces` | 授权范围内的会话列表；支持 `limit`、`offset`、`q` |
| `GET /api/v1/sessions/:id/trace` | 会话摘要、裁剪后的调用、事件、聊天记录 |
| `GET /api/v1/sessions/:id/trace/revision` | 查询是否发生变更 |
| `GET /api/v1/sessions/:id/trace/calls/:callId` | 按需读取完整调用记录，响应为 `{ call }` |
| `DELETE /api/v1/sessions/:id/trace` | 删除会话 Trace |

## 验收

- mock fetch 验证 JSON/SSE、错误、取消、截断、开关热更新、并发 scope、脱敏与写入故障。
- JSONL/index 验证 pending→terminal 合并、revision、缓存、删除、索引降级和迁移。
- IPC/API 验证目标路由、会话 ID 映射、权限隔离、空筛选、正文懒加载；不访问真实 provider 或用户配置。
- 迁移源 parser/viewmodel 测试；增加 Moss 页面接线与渲染测试，执行 TypeScript 与构建检查。
- 验证超 200 条列表刷新保留已加载窗口，慢请求不会被重复轮询覆盖，截断响应仍能显示独立保存的结束原因。

真实 Electron 界面使用隔离 fixture 验证：设置入口、开关成功与保存失败、列表进入详情、部分响应与中断、完整 system prompt 按需读取、工具/错误筛选、键盘调整分栏、服务器错误提示、同 ID 的本地与远程缓存隔离、聊天入口和删除确认。明暗主题均检查；测试不写真实用户配置、不调用真实模型。

2026-09-29 验证结果：

| 验证 | 结果 |
| --- | --- |
| Trace 与受影响接线的合并回归 | 19 个文件，160 项通过，0 失败，561 个断言 |
| 隔离 Electron 界面操作 | StrictMode 下 13 项交互检查通过，renderer 错误 0 |
| `bun run --cwd ui check` | JavaScript 语法和 TypeScript 检查通过 |
| `bun run --cwd server check` | TypeScript 和 Node 构建通过；HTTP fixture 使用真实 Node SQLite |
| `bun run build:electron-direct` | CLI 与 Electron 嵌入式运行时构建通过 |
| `bun run --cwd ui build:renderer` | 生产构建通过；Vite 提示部分产物超过 500 kB |

合并回归命令：

```sh
bun test ui/tests/trace-*.test.* src/services/api/trace*.test.ts \
  src/services/trace/protocolTrace.test.ts src/utils/__tests__/mossAuthToken.test.ts \
  server/src/__tests__/traceRoutes.test.ts server/src/__tests__/directEmbeddedBackend.test.ts \
  server/src/__tests__/sessionRunnerSettings.test.ts ui/tests/settings-agent-mail.test.tsx \
  ui/tests/remote-direct-client.test.ts
```

## 边界

保留 cc-haha 原有正文截断标记和语义请求，独立保留流终止与用量信息：

- 语义请求保留结构化文本，图片二进制内容压缩为描述；API 记录中的认证 header、URL 凭证和敏感字段执行脱敏。
- 普通正文预览最多 240,000 字符，会话快照中预览最多 2,048 字符；响应采集最多 1 MiB。超限或中断显示截断标记。
- 协议观察器继续分析预览范围之外的流，单帧上限为 65,536 字符。超大终止帧会被丢弃并计数；超过采集范围的非流式 JSON 也可能无法提取最终用量。
- 记录的是 Moss 运行时发出的请求。若外部模型网关再次改写请求，其内部内容仍需在网关侧关联；特殊二进制流协议不保证能解析成完整文本和用量。
- 首版不增加自动保留/清理策略、正文全文检索或分布式追踪。长期采集需要按需删除历史 Trace。
