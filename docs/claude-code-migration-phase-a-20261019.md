# Claude Code → Moss 第一批交付记录

日期：2026-10-19。范围：迁移计划 H1–H3、R2a，以及 R1 的搜索完整性和 `Grep -o` 子集。设计依据见[迁移计划](claude-code-migration-plan-20261019.md)及其中的新旧版本对照证据；实现沿用 Moss 的工具、提供方能力、会话及展示体系。

## 已完成

| 范围 | 现在的行为 | 主要代码 |
| --- | --- | --- |
| 搜索失败 | 非法正则、路径/权限错误、超时、输出溢出不能返回成功的空数组或片段；保留取消语义。异常中的部分行不代表完整结果 | [ripgrep.ts](../src/utils/ripgrep.ts) |
| 搜索计数与按需输出 | Grep/Glob 区分已展示数量和分页前总数；页码超出末尾不再宣称无匹配。Grep 支持 `-o`，明确匹配行数与出现次数；提示被省略的长行。模型输出和 CLI 摘要使用相同统计 | [GrepTool](../src/tools/GrepTool/GrepTool.ts)、[GlobTool](../src/tools/GlobTool/GlobTool.ts) |
| 图片读入边界 | Read 在解码前限制压缩文件输入为 20 MiB；调用者可降低上限。按实际句柄分块读取，检测文件增长，拒绝非常规文件，支持取消；解码尺寸限制为 6400 万像素，超限不能走原图回退 | [fsOperations.ts](../src/utils/fsOperations.ts)、[FileReadTool](../src/tools/FileReadTool/FileReadTool.ts)、[imageResizer.ts](../src/utils/imageResizer.ts) |
| 小窗口模型 | 32K/64K 等合法提供方上限生效，UI 与运行时共享解析。能力元数据优先于 `[1m]` 后缀；缺少元数据时保留默认标记；小输出上限也生效 | [context.ts](../src/utils/context.ts)、[desktopModelContext.ts](../src/utils/model/desktopModelContext.ts) |
| 队列完整回填 | 分开“撤回编辑”和“移除”。回填文字、附件/资源引用、Skill、App、Agent 和 Chat/Boss 等意图。Stop 保留各条独立草稿；已有输入不被覆盖，工作区变化时阻止错误回填 | [composer-queue.ts](../ui/src/renderer-react/lib/composer-queue.ts)、[queued-messages.tsx](../ui/src/renderer-react/components/chat/queued-messages.tsx)、[App.tsx](../ui/src/renderer-react/App.tsx) |
| 队列竞争与恢复 | 同会话同步占用待发送项，防重复结束事件；Stop 使异步预检查失效；发送未确认保留草稿，不自动重放。本地附件发送前重新核实，失效 Agent 保留并提示重新选择。发送失败不能覆盖刚添加的新附件或 Skill | [App.tsx](../ui/src/renderer-react/App.tsx)、[chat-area.tsx](../ui/src/renderer-react/components/chat-area.tsx) |
| 草稿持久化 | 复用 IndexedDB 草稿存储，覆盖 Desktop 与既有 Web 身份范围；保留完整元数据。恢复后的待发送项变成手动草稿；当前草稿不重复列出，清空后旧项不会因组件重挂载重新出现 | [web-composer-draft.tsx](../ui/src/renderer-react/components/web-composer-draft.tsx) |

本批没有删除 Workspace、Task list、Team/Boss、Workflow App、文件观察或 presentation。没有引入自动 `git init`，也没有恢复按 Write/Edit 工具调用推断本轮改动文件数的旧逻辑。现有工具调用和历史结果字段继续兼容。

## 验证

- **61 项测试通过，0 失败，12 个文件。** 覆盖真实 rg 的正常/零结果/非法正则/部分输出错误，受控超时和缓冲溢出；普通 PNG、文件增长、FIFO、目录、取消和像素上限；提供方窗口、并发身份隔离和压缩；队列竞争/发送失败，以及既有文件卡片、零改动隐藏、路径链接。
- 随后补充 App 消息异步准备前先入队的竞态修复；**最新队列专项 11 项通过**，新增用例确认 Stop/turn-end 不会漏掉这条消息（上述组合回归与专项合计 62 个不同用例）。Host 在实际发送时继续解析和校验 App 资源。
- **5 组 Electron 队列交互通过。** 使用真实 React 组件、Electron 与 IndexedDB，Host 为隔离 fixture：完整撤回并验证发送回调参数；已有输入与 Stop；重开恢复；切回会话不重复草稿；清空后不复活。
- **4 组 Electron 展示回归通过。** 三个已核实文件卡片和唯一 Task list；Markdown/裸路径按所属会话打开；`moss_present` 跟随折叠和合并模式；编辑保存、失败恢复及卸载提交。
- **UI 完整检查、CLI/Desktop 核心构建和 renderer 生产构建均通过。** 最终状态及日志见下方证据目录。
- 对本批涉及的 tracked 文件执行 `git diff --check`，通过。

测试未调用真实付费模型，也未重启用户正在运行的 Moss。构建与类型检查并行期间，一次 Electron 冷启动复测触发了测试超时；待构建结束后单独复测，5 组场景全部通过。生产构建仍提示部分 chunk 较大。

**根目录 `bunx tsc --noEmit` 未通过。** 仍有大量缺少 React/lodash/原生模块声明、缺失历史 message 类型、旧 Sharp import 类型等报错；本批曾发现的新类型错误已修正并重跑，但没有对整个旧工作树做独立基线编译，不声称全仓类型检查通过或全仓零新增错误。

## 边界与后续

1. 本批实现的是本地队列与草稿保护。R2b 的 Host 持久接收回执、稳定客户端消息 ID、跨崩溃去重尚未实现；“发送未确认”需要核对会话记录，不能承诺跨崩溃恰好执行一次。
2. R1 的所有工具共享结果契约、累计输出落盘预算、Read `allow_large` 和 WebFetch 续读不在本批范围。新增搜索字段也不作为文件观察或展示资源的替代事实源。
3. MCP 目录增强、提示词诊断、有界重试、运行预算继续依照后续批次实施。未恢复 Anthropic 账号、遥测或远程 gate。
4. 用户现有工作树包含其他并行改动，本批未提交、重置或清理它们。要在运行中的客户端体验变更，需要重新启动使用本工作树构建的 Moss；已安装的其他副本不会自动更新。

## 可复查证据

日志与最终校验摘要保存在 [first-batch 目录](../output/claude-upstream-review-20261019/first-batch/)。主要用例入口：

- [搜索用例](../src/tools/GrepTool/searchResults.test.ts)、[超时/溢出用例](../src/utils/ripgrep.errors.test.ts)
- [有界读取用例](../src/utils/fsOperations.readBytes.test.ts)、[图片用例](../src/tools/FileReadTool/imageRead.test.ts)
- [模型能力用例](../src/utils/model/modelCapabilities.test.ts)、[队列与实际 App 回调用例](../ui/tests/composer-queue.test.ts)
- [Electron 队列测试入口](../ui/scripts/test-composer-queue-ui.mjs)、[Electron 展示测试入口](../ui/scripts/test-presentation-ui.mjs)
