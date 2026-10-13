# Buddy 0.1.2 交付记录

日期：2026-10-12。产品与后续路线见 [规划](buddy-app-plan.md)。

## 可使用的交付物

- [Buddy 0.1.2 安装包](../../output/buddy-release/moss.buddy-0.1.2.zip)，附 [SHA256](../../output/buddy-release/SHA256SUMS)。
- [App 源码与说明](../../../moss-apps/apps/buddy/README.md)，可单独构建和更新。
- 最新界面：[聊天](../../output/buddy-tests/chat-light.png)、[窄窗口](../../output/buddy-tests/chat-narrow.png)、[桌面悬浮图标](../../output/buddy-tests/desktop-widget.png)、[挂件展开](../../output/buddy-tests/desktop-expanded.png)、[完整 Host 独立窗口](../../output/buddy-tests/full-host.png)。

需使用本次代码构建的 Moss，Host API 为 **3.6.0**。在 Moss 的 Apps 中导入本地 ZIP，再从 Buddy 页面或挂件打开。模型沿用已有 Moss 配置；首次安装或升级按现有 App 安装流程展示所需权限。包包含源码、SDK 依赖快照与校验文件，已完成本地打包及源码重建/后台握手验证。本次测试安装在临时 profile，未替换用户日常环境中的 App。

## 0.1.2 风格对齐

- 对齐 Moss 的主题色、背景、字体、按钮、输入框、圆角及聚焦样式；换宠物形象不再改变界面配色。
- 跟随 Moss 深浅色与背景设置，跟随系统模式也能实时切换。聊天字号、行高和消息间距使用 Moss 外观参数。
- 聊天直接融入页面，取消内层背景卡片；紧凑头部和透明悬浮图标继续保留。
- 新安装包完成构建、源码重建、后台握手、App Electron 与完整 Desktop 集成验证，并检查深浅色、窄窗口和挂件截图。

## 0.1.1 反馈调整

- 收起后只显示 **56 × 56** 宠物图标，支持点击展开、拖动移动。页面路由直接跟随展开状态，避免快速切换后残留页面导航。
- 去掉 App 外层卡片边框和重复标题。导航高度 44px，宠物头部高度 40px，只保留小头像、名字和伙伴设置入口；聊天占据主要空间。
- 空闲陪伴文案不再常驻；陪伴天数移入伙伴设置。打开设置时替换聊天区域，返回后继续原对话。快捷提示仅在首次聊天前出现。
- 移除 Moss 个性化里的 Buddy 专属分组，伙伴偏好统一由 App 管理。
- 默认全部可用工具与全部执行权限，可在伙伴设置改为确认模式或手选工具。Host 分别检查 `agent:permissions:bypass` 和 `settings:write:unrestricted` 授权，撤销授权后立即拒绝越权操作。
- 人设按实际会话初始化一次，普通续聊只传用户原文；更改名字、性格、口吻或回应者后更新一次。新会话、重启补查和失败恢复都有处理。
- Moss 设置使用中文功能名称、用途、当前状态和直接操作，不要求用户理解配置领域或内部字段。终端配色、终端编辑快捷键、详细输出与桌面外观明确区分。
- 配置覆盖桌面、Agent 用户/项目/个人覆盖、会话、App、MCP、助手规则及通用/终端偏好。配置冲突仅在目标字段未被修改时自动重试一次；保留实际回执和撤销。
- 修复合法 App 工具名称被通用权限校验器误拒绝的问题。

## 基础能力与实现边界

App 自带陪伴助手规则与手册。孵化在本地完成，固定问候有明确标识；后续对话走真实 Agent Channel。可选择已有 Agent/助手、聊天口吻和三种图形形象。宠物身份、生日、独立记录会保留；发送去重、停止、失败重试与中断恢复都有处理。

Host 提供 `moss.settings/v1` 的 catalog/read/apply/undo，以及通知读取/已读协议。修改检查实际 schema、作用目标、授权和 revision；敏感字段脱敏，返回实际保存/应用状态与可撤销回执。默认全部权限仅跳过配置确认，不绕过校验、凭据保护和撤销保护。写前记录意图，重试核对结果；撤销不会覆盖后续编辑。

Desktop 与 Agent 共用设置文件时，模型等共享默认值走 Desktop 保存流程，Agent 专属字段走运行时校验。后续刷新只重读设置，不用旧 Desktop 快照覆盖 Agent 修改。项目文件保留未知字段；对象替换、删除覆盖和数组修改具有明确语义。

主界面通过 manifest 的 widgets/views 加载隔离 App 页面。旧 ASCII 组件退出活动入口；旧宠物名字、性格、生日与用户标识迁移到 App 私有数据，原记录保留。旧位置与可见性选择兼容，挂件显示开关使用统一设置。

主要 Host 代码：

- [配置服务](../src/moss-settings-service.mjs)、[配置适配器](../src/moss-settings-adapters.mjs) 与 [中文目录](../src/moss-settings-labels.mjs)。
- [Agent/通用配置运行时](../../src/services/mossConfiguration.ts) 与 [协议定义](../../packages/host-contracts/src/settings.mjs)。
- [Widget Host](../src/renderer-react/components/app-widget-host.tsx) 与 [App 嵌入视图](../src/renderer-react/components/embedded-app-view.tsx)。
- [update-config 集成说明](../../src/skills/bundled/updateConfig.ts)。

## 验证

| 验证 | 结果 |
| --- | --- |
| Buddy 控制器 8 项 | 孵化、独立记录、连续会话、人设初始化/更新、重启恢复、权限切换、配置冲突重试通过 |
| 配置服务 8 项 | 并发版本、幂等、预览、敏感值、路径保护、撤销、中断回执、实际保存及全部权限授权检查通过 |
| Core/Agent Channel/权限回归 | 相关 49 项通过，包括 App 工具名、全部权限授权与撤销 |
| App SDK/manifest 回归 | 相关 42 项通过；Host API、SDK、运行时版本与生成合约更新到 3.6.0 |
| 设置 UI 回归 | 个性化入口移除后的相关测试通过 |
| App 导航 Electron 回归 | 设置入口、分组、路由、搜索、配置保留、停用/启用、窄布局和嵌入页面释放通过 |
| `ui` check | Host 合约与类型生成检查、主进程语法、TypeScript 检查通过 |
| 构建与打包 | Core runtime、Desktop renderer、Buddy UI/Backend 和可重建 ZIP 通过 |
| 隔离 Electron App 集成 | 最终简洁布局、无外层边框、紧凑头部、窄窗口、56px 图标、会话续聊、实际配置写入/撤销及撤销授权后拒绝操作通过 |
| 完整 Desktop 集成 | ZIP 安装、挂件展开/收起与内部页面状态、独立窗口、7 类配置、Agent 修改/撤销、通用偏好、MCP、助手规则、会话权限与停用清理通过 |
| 真实模型验收 | 临时 profile 中完成宠物聊天、第二轮通过配置工具把桌面从深色改为浅色；默认全部权限无配置确认，改为确认模式后出现一次确认 |

[真实模型验收结果](../../output/buddy-tests/live-model-evidence.json) 与 [完整 Host 验收结果](../../output/buddy-tests/full-host-evidence.json) 分别保存。真实模型验收使用 0.1.1，在最后一轮纯布局精简之前，后端没有再变更；其 [聊天截图](../../output/buddy-tests/live-model.png) 用于模型能力验收，不代表最终布局。最终布局经过隔离 App 与完整 Desktop 集成和截图检查。

复现命令：

```sh
# 在 moss-apps 仓库
node scripts/package-app.mjs --app buddy

# 在 moss 仓库
bun test src/services/mossConfiguration.test.ts src/utils/settings/permissionValidation.test.ts
node --test ui/tests/moss-settings-service.test.mjs

# 在 moss/ui
bun run check
bun run build:direct
bun run build:renderer
bun run test:buddy
bun run test:buddy-main
# 可选：实际调用本机已配置的模型，所有写入仍在临时 profile
MOSS_BUDDY_LIVE_MODEL=1 bun run test:buddy-main
```

## 后续范围

当前是可独立更新的 Moss App，具有普通独立窗口及 Moss 窗口内挂件。退出 Moss 后不运行；系统级透明置顶、语音与完全独立程序尚未实现。

通知读取已有消息并同步已读；自定义订阅、任务提醒创建、跳转、免打扰策略尚未实现。手册是随包提供的基础指南；完整文档自动同步、历史分页/导出属于后续工作。

凭据与登录继续使用原页面。可管理本地连接默认值和远端会话已经提供的参数，远端服务器/项目管理需要对应服务 API。App 参数适配器当前操作默认实例；多实例选择和连接器专属业务参数后续接入。目录与错误会给出实际支持范围。

现有规则保持原有生效语义：忙碌会话延后刷新，部分参数需新会话或重载。跨存储语义的混合变更拆成单独回执；回执保留最近 500 次，App 页面显示最近 200 条聊天，完整聊天数据保存在 App 私有文件。
