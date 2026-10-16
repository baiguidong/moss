# App 会话工作台

App 可以通过普通 view contribution 选择在会话正文展示专用视图：

```json
{ "id": "moss-conversation", "title": "工作流", "route": "#/conversation" }
```

这是 Moss renderer 的 opt-in 约定，不新增 Host 协议或 MCP 服务。App 必须启用、有 UI、满足兼容性及 view 权限；未声明此 view 的 App 继续沿用现有展示方式。

会话中 App 工具返回的 `presentation: { title, route }` 会保存成 `app_view` 事件。Core 合并本会话的这些事件、App task ledger 和当前资源选择，以 App ID 和完整资源 route 去重；固定修订使用不同 route，因此可以并列回看。真实 task 的状态优先于同 route 的静态 presentation。异步加载历史期间到达的事件也会合并；切换会话不复用前一个会话的 task 列表。

顶部入口打开工作台后，Core 将资源 route 编码到 view 的 `target` 参数，例如：

```text
#/conversation?target=%23%2Fflows%2Fone%3Frevision%3D2
```

Core 不解析流程图、工作流 ID 或运行语义。App 自己解析 target，并复用独立窗口的图和状态数据。资源地址限定为有界的本地 hash route。TAKT 将定义预览固定到具体修订，将运行固定到 runId。

工作台和聊天共享主输入框。发送消息后回到聊天；图的进度更新不会自动抢占当前视图。首次打开后保留一个 guest，图与聊天切换保留选择和缩放；切换会话会重新绑定 guest。权限请求、用户问题和计划审批在图打开时继续显示在主输入框上方。Agent Team 与工作台互斥打开。

App 从嵌入视图调用 `composer.prepare` 时，Host 使用该 guest 已绑定的 `state.sessionId` 返回原会话；不接受 App 自行指定另一个 sessionId。项目创作的恢复逻辑仍优先使用 Host 校验的 projectRef。独立 App 窗口无绑定会话时，继续准备未发送的新会话草稿。

节点讨论引用必须由 App 校验定义、修订、运行、节点、执行轮次的一致性。准备引用不代表发送或执行授权；TAKT 的新建和运行按钮均准备自然语言草稿，由用户在 Moss 主输入框发送后调用工具。

原 `moss.workflow` 的会话侧栏仍保留；新的工作台打开时暂时收起该侧栏。TAKT 由新顶部入口展示，不再混入原 App 的专用侧栏或重复显示底部大任务卡。

验证：`bun test ui/tests/app-conversation-workbench.test.ts ui/tests/app-task-session.test.ts`、`node --test ui/tests/app-composer.test.mjs`。真实桌面和模型链路见相邻 moss-apps 仓库的 `apps/takt/scripts/verify-conversation.mjs` 及交付报告。
