# AI 自测执行与界面优化

2026-10-13，App `moss.self-test` 0.1.2。

常规六项随 App 提供已验证的 Playwright 页面操作脚本。控制 AI 直接调用脚本，再核对实际观察和截图、提交本项结果；定位失败或条件不满足时返回部分证据并交回 AI 检查。脚本仅通过页面点击、输入、DOM 读取和截图操作，不调用内部 IPC 或直接修改应用状态。复杂演示仍由 AI 按页面阶段批处理。

同时停用零散点击、输入和固定等待工具；改用条件等待，结果提交返回简短回执，报告通过事件与 status 供 UI 查看。界面增加运行概览、逐项耗时、三种范围快捷选择和展开的观察详情，支持深浅主题及窄窗口。

## 实测

- 直接通过相同 Playwright MCP 引擎执行六项：主界面、主题、19 个 App 与分类、文件预览、真实聊天、双会话收发和切换；全部通过，共 **27.701 秒**。此时间包含程序执行、截图及三次真实 AI 回复，**不包含前期界面定位、编写脚本和启动测试实例**。
- 安装后由真实模型发起三项（startup、apps-list、chat-response），同一 Core、gpt-5.5、相同的独立安装环境：旧 App 0.1.0 **187.100 秒**；新 App 0.1.2 **39.135 秒**，此次用时减少约 **79%**。两轮全部通过，独立核对了落盘 assistant 回复。该三项比较环境只安装自测 App，与上面的 19 App 直接测试分开计时；模型延迟仍会波动。
- 19 项服务与构建后脚本语法测试通过；独立源码恢复、类型检查、构建、Backend 握手及实际 Electron 安装链路通过。脚本化链路验证了停止、保留实例与停用回收。
- UI 在深色、浅色和 390px 窗口验证了选择范围、运行锁定、停止、失败详情及错误反馈。

证据：`output/self-test-optimization/comparison.json`、`direct/recipe-verification.json`、`model-0.1.0/verification.json`、`model-0.1.2/verification.json`、`scripted/verification.json`、`ui/verification.json`。

本次没有重跑完整工作流和 Agent Team 演示；这两项仍需要等待目标中的真实任务执行，不能套用六项常规检查的时间。测量中失败的磁盘空间、旧工具名称和初版脚本打包记录保留为诊断材料，不计入最终通过的对比。最终包包含工具名称兼容和脚本打包修复。

新版 ZIP：`moss-apps/artifacts/moss.self-test/0.1.2/moss.self-test-0.1.2.zip`。本次仅生成并验证安装包，没有替换主 Moss 当前安装的版本；从 App 管理导入 ZIP 后生效。
