# Dead Code Follow-up TODO

更新日期：2026-09-01

本文件记录本轮未直接删除的疑似无效代码。这些项目仍连接到现有功能、协议或构建流程，处理前需要先确认期望行为。

## P0：恢复或移除被硬禁用的功能

- [ ] 决定 Verify Plan 功能的去留。
  - 位置：`src/utils/attachments.ts` 中的 `getVerifyPlanReminderAttachment`。
  - 现状：`true || !isEnvTruthy(process.env.CLAUDE_CODE_VERIFY_PLAN)` 使提醒永久关闭，但 plan verification 的状态、工具和消息链仍然存在。
  - 验收：要么移除 `true ||` 并补充开关启停测试，要么删除完整的 verification 状态和工具链，不能只删入口。

- [ ] 决定 VS Code `file_updated` 通知的去留。
  - 位置：`src/services/mcp/vscodeSdkMcp.ts`。
  - 现状：`notifyVscodeFileUpdated` 由 `true || !vscodeMcpClient` 永久短路，调用方仍把它当作有效通知接口。
  - 验收：恢复通知并覆盖未连接、发送成功、发送失败三种情况，或删除通知函数及所有调用点。

## P1：恢复 SDK 类型生成链

- [ ] 恢复 SDK 生成类型或将内部类型迁移到可维护的本地定义。
  - 位置：`src/entrypoints/sdk/coreTypes.generated.ts`、`src/entrypoints/sdk/runtimeTypes.ts`、缺失的 `src/entrypoints/sdk/controlTypes.ts`。
  - 现状：前两个文件是空 stub，`controlTypes.ts` 不存在；Bun 构建会擦除类型导入而继续成功，但根目录 TypeScript 检查会产生大量缺失导出和缺失模块错误。
  - 验收：恢复生成脚本产物或完成内部 import 迁移，并使根目录 `tsc --noEmit` 在安装声明依赖后可以作为可靠的 CI 门禁。

## P2：修复构建期环境常量

- [ ] 统一测试环境判断，避免源码中的 `process.env.NODE_ENV` 被构建器提前替换为固定的 `"production"`。
  - 位置：`src/tools/testing/TestingPermissionTool.tsx`、`src/hooks/useTypeahead.tsx`、`src/interactiveHelpers.tsx`。
  - 风险：测试专用工具永久关闭；测试运行时仍可能启动后台文件索引；测试/演示环境可能进入 onboarding。
  - 验收：测试产物和生产产物分别验证分支行为，并为三个入口补回归测试。

## P3：确认旧产品路径后再简化

- [ ] 审核 `"external" !== "ant"`、固定布尔值和同类构建常量形成的不可达分支。
  - 重点位置：`src/main.tsx`、`src/tools/AgentTool/AgentTool.tsx`、`src/tools/TaskOutputTool/TaskOutputTool.tsx`、`src/commands/status/status.tsx`。
  - 验收：确认不再产出 `ant` 版本后，删除旧分支及其专用依赖；若仍需多产品构建，改成显式 feature 或构建参数。

- [ ] 审核会改变用户可见行为的常量条件。
  - 位置：`src/components/messages/SystemTextMessage.tsx`、`src/components/LogSelector.tsx` 中默认关闭的 deep search、`src/state/AppState.tsx`、`src/utils/effort.ts`、`src/tools/EnterPlanModeTool/prompt.ts`、`src/tools/FileEditTool/prompt.ts`、`src/utils/settings/types.ts`、`src/utils/shell/shellToolUtils.ts`。
  - 验收：逐项确认保留哪一侧行为，再删除无效分支并补对应单元测试或快照测试。

## P4：启用前验证已登记的 Feature

- [ ] 为 `COMMIT_ATTRIBUTION` 补提交、worktree、session restore 和 compact 清理的集成测试。
- [ ] 为 `HOOK_PROMPTS` 补交互、非交互、取消和超时测试。

上述两个 feature 已在 `scripts/features.js` 的 `EXPERIMENTAL` 中登记，当前均为 `false`，因此不会改变现有构建行为。

## P5：契约型 No-op 审计

- [ ] 审核组件或接口为满足签名而传入的空回调。
  - 重点位置：`src/components/Settings/Config.tsx` 的只读控件 `onChange={() => {}}`，以及 React 编译产物风格代码中的空 effect 回调。
  - 验收：确认组件支持只读/可选回调后移除 no-op；若接口要求保留，则增加原因注释并避免把它误判为可用交互。

## P6：空异常处理审计

- [ ] 分批审计生产代码中的空 `catch`。
  - 优先范围：认证与凭据、配置持久化、MCP/服务进程生命周期、文件写入。
  - 验收：可忽略的异常增加简短原因注释；影响状态或数据一致性的异常增加 debug 日志、上报或向上传递。测试夹具和明确的 best-effort 清理可保留。
