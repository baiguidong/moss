# 2026-11-10 分支收敛记录

本次将本地与 origin 的历史工作分支收敛到 main。用户明确要求暂不处理 dev：本地及 origin/dev 保留，其 234 个独有历史提交不在本次合并范围内。

当前工作区的存储管理、缓存清理、App 数据目录注入、Python MCP 配置升级已作为正常代码提交进入 main，并通过 UI 完整检查及 60 项针对性测试。

## 已被主线后续实现覆盖的历史提交

下列旧分支与 main 存在历史分叉，不能仅通过提交哈希判断功能缺失。比较三方合并结果及当前实现后，以保留当前 main 实现的历史合并纳入其提交，避免重复声明、降级版本或恢复已退役代码。

| 原分支 / 提交 | 核对结论 |
| --- | --- |
| codex/app-source-packaging · 810b42e8（含 8867f948） | main 已有源码包、运行时验证、authoring 契约和后续 Windows 启动修复。自动合并会向 generated-validators.mjs 重复追加 5,054 行旧生成器输出；保留当前契约及通过生成一致性检查的文件。 |
| codex/app-tool-schema-contract · fa75fe06 | main 的 packages/app-sdk/src/schemas/index.mjs 已存在同一 validateAppToolInputSchema 实现；自动合并会重复声明函数。 |
| codex/webui-snapshots-20261019 · b1ffa52a | 快照、恢复入口和测试宿主功能已在 main 后续实现中存在；自动合并残余为重复的 controller.turn.finish、旧提示词/文件链接 UI、重复 import 和旧局部状态，保留当前实现。 |
| feat/control-plane-hosts · 8952cdea | main 的 781f9002 及后续提交已完成个人电脑执行、控制面和统一登录。保留当前版本号、主窗口切换与用量实现，不恢复 1e6d955e 后已删除的 server/src/usageService.ts。 |
| origin/codex/moss-apps-tool-app-release · f5970698（含 6eedaac2） | main 已有 Tool App 契约及类别；Node 网络权限检测已改成带超时的异步 process.allowedNodeEnvironmentFlags 检测，不添加旧的同步辅助函数。 |

以上头提交全部成为 main 的祖先，代码仍可通过 Git 历史访问。其余本地及 origin 分支的头提交原本已是 main 祖先，验证后删除分支引用。

旧 worktree 的文件、未提交历史草稿和 stash 不因删除分支而被清除；仍存在的分支 worktree 改为 detached HEAD。旧依赖目录、输出文件和发布副本中的二进制删除不作为产品改动提交。后续新工作直接在 main 提交。
