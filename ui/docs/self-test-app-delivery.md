# AI 自测 App 迁移交付

2026-10-12，按「先迁移、功能保持现状，后续独立优化 App」实施。

## 结果

- 新 App 位于相邻仓库 `moss-apps/apps/self-test/`，ID `moss.self-test`，版本 `0.1.0`。
- 入口为「设置 → Apps → AI 自测」。工具明确使用 session 范围；从设置点击启动时，Host 创建关联自测 App 的控制会话。
- 保留十项用例、八项默认选择、复用测试实例、环境同步、数据清理、停止保留窗口/产物、逐项结果提交和自动独立 HTML 报告。
- 清单、样例、提示词、调度、结果校验、报告和离线 Playwright MCP 都由 App 包提供。无须另装 Browser Use。
- Core 通过 `moss.testing/v1` 管理隔离 profile、目标进程和临时控制会话；通过通用 `moss.local-files/v1.preview` 预览 App 私有 HTML。SDK / Runtime / Host API 已更新为 `3.7.0`。
- 已移除内置自测 UI、IPC、工具、测试资源及旧数据读取。旧磁盘文件不迁移、不删除。

## 安装包

在更新后的 Moss 中导入：

`moss-apps/artifacts/moss.self-test/0.1.0/moss.self-test-0.1.0.zip`

包内包含源码、固定 SDK 和离线引擎。构建执行独立源码恢复、冻结依赖安装、类型检查、单元测试、构建及 Backend 握手验证。尚未发布应用市场。

SHA-256：`d584f4a6f8f00570e17cf1431704ec91762a02216174bceee51760e659e84850`。

## 验证

| 验证范围 | 结果 |
| --- | --- |
| Core 相关单元测试 | 49 项通过，覆盖实例隔离、会话绑定、权限、生命周期、预览路径和旧工具移除 |
| App 服务测试 | 17 项通过，覆盖清单、逐项推进、观察/截图校验、停止、超时/退出、历史中断和报告 |
| Core 检查与构建 | `ui/bun run check`、direct 构建、renderer 构建通过 |
| App 源码包恢复与构建 | 类型检查、测试、离线引擎打包与 Backend 握手通过 |
| 实际 Electron + 脚本化模型 | 安装、设置入口、session 工具、按钮启动、主题同步、可信结果、CDP 截图、自动报告、页面重开、运行中聚焦、停止保留及停用回收通过 |
| 实际 Electron + 真实模型 | startup、apps-list、chat-response 共 3 项通过，203 秒；独立核对了落盘 AI 回复 `MOSS_SELF_TEST_OK` |
| 独立 HTML 报告 | 桌面/窄屏排版、筛选、搜索、截图放大、窗口重用和无特权桥接检查通过 |

真实模型报告及证据索引保存在 [real-model/report.html](../../output/self-test-app-migration/real-model/report.html)。最终安装包的桌面链路验收见 [scripted/verification.json](../../output/self-test-app-migration/scripted/verification.json)，界面截图见 [浅色](../../output/self-test-app-migration/scripted/app-light.png) 与 [深色](../../output/self-test-app-migration/scripted/app-dark.png)。脚本化链路结果仅用于验证迁移链路，不表示 AI 验收了完整用例集。临时验证 profile 的模型凭据已移除。

本次未重跑全部十项的真实模型测试；工作流、Agent Team 等复杂演示保留现有内容和校验，后续需在具备对应依赖的环境中执行。机器可检查的依赖版本、完整历史管理和 App 内报告详情重设计按用户要求留到后续优化。

使用说明和复验命令见 [AI 自测 App](self-test.md)，范围决策见 [迁移方案](self-test-app-plan.md)。
