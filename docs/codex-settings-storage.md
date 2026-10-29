# Codex 设置与 Storage 分析及 Moss 实现

分析日期：2026-10-29。目标是沿用 Codex 的设置展示方式，承载 Moss 已有配置，并引入真实的本机存储统计与旧会话清理。

## 证据与范围

使用本机 REA 6.5.0 分析已安装客户端中的 JavaScript。此安装包的应用路径是 `/Applications/ChatGPT.app`，bundle ID 为 `com.openai.codex`，包含 Codex 与 ChatGPT 共享模块。

- ASAR：`/Applications/ChatGPT.app/Contents/Resources/app.asar`
- SHA-256：`1c8ef1bef66e5fc416ae66eff8e6529972aa3601e27a1c7b5f61d6a292b957d3`
- 提取文件清单及逐文件哈希：[manifest.json](../output/codex-settings-analysis-20261029/manifest.json)
- REA 证据：[rea.json](../output/codex-settings-analysis-20261029/rea.json)
- 证据 ID：`ev_a64b9401e992624a6641c248e35ad13d2babc8b33c786352b0d6bcc02834b964`
- 原始文件位于 `output/codex-settings-analysis-20261029/raw/`，格式化后位于同级 `readable/`。提取时校验 ASAR 的文件完整性哈希；Babel 只用于解析和格式化，没有执行客户端代码。

REA 分析覆盖最初提取的 6 个模块：General、Appearance、Device Storage、导航标题、设置行 disclosure、共享设置组件。随后补充读取了 content-layout、group、rows 三个布局模块。REA 命令：

```sh
rea analyze-javascript-application output/codex-settings-analysis-20261029/raw \
  --max-semantic-nodes 3000 --max-semantic-nodes-per-file 800 --format json
```

这是已发布安装包的静态证据，不能证明每个功能在所有账号、功能开关和运行环境下都可见。官方 settings 文档在本次环境返回 HTTP 403，因此未作为细节依据。

## 展示结构

| Codex 证据 | 观察 | Moss 对应改动 |
| --- | --- | --- |
| `settings-content-layout-84a79a58d760.js` | 独立滚动内容区，默认 `max-w-3xl`，组间留白；标题与内容分离 | 设置内容居中限宽，统一页标题和留白 |
| `settings-group-a000a1481d56.js` / `settings-rows-23088f15a056.js` | 轻量分组，行间分隔，不需要每组再包一层醒目卡片 | 取消大圆角、渐变图标和卡片阴影；灰阶底色、左侧说明、右侧控件 |
| `appearance-settings-4b217993cd4c.js` / `general-settings-a845b656d403.js` | Appearance 为独立路由，复用共享主题与字体设置 | 外观从通用拆出；模式预览、主题色样菜单、配色、字体和交互设置分组，保留聊天显示和实时预览 |
| `settings-nav-title-message-166859dc0a63.js` | 设置按功能命名和导航 | 通用、外观、模型与搜索、Agents、工具与性能、记忆与上下文、存储、系统与服务、Apps |

采用这些信息层级与布局规则，没有复制 Codex 的业务开关。Moss 原有配置保存回调及 Apps 声明式设置入口继续使用；默认只展示通用，搜索可以跨分类定位设置。

## Storage 的实际功能

核心证据为 `device-storage-9f38809442ac.js`，SHA-256：`fb33632194d1460aaa7045e66ad40b8f460a9476f8cbe312639a443c6b57877c`。

1. **设备上的应用数据占用。** 分类为 Chats、Subagents、Archived chats、Worktrees、Other；`unclassified` 归并到 Other。显示总大小、分段占用条、分类大小及数据目录。
2. **测量状态。** 读取已有统计，可手动 refresh；区分测量中、部分完成和失败。查询缓存有效期为 60 秒，不因窗口重新聚焦而刷新。
3. **旧聊天清理。** 提供 30 / 90 / 180 / 365 天条件，默认 90 天、仅归档。先列出候选聊天和子 Agent 大小，逐项选择，再进行不可撤销的删除确认。
4. **删除前复查。** 重新枚举会话，比较父子关系、更新时间，检查活动状态，确认后代列表完整；删除时再读取会话。已更新或活动中的会话跳过，分别报告 deleted / skipped / failed。
5. **管理入口。** 跳转到 Worktrees 管理和 Archived chats 管理。工作树有独立的保留策略，归档聊天支持单独恢复或删除。

因此该页不应映射成云盘连接状态，也不应把聊天文件笼统当作可随意清除的缓存。

## Moss 的实现与边界

### 占用统计

`ui/src/storage-usage.mjs` 完整扫描 `MOSS_HOME`（默认 `~/.moss`），只读取元数据，包含隐藏目录与缓存。符号链接只计算自身分配空间，不递归目标；硬链接按设备和 inode 去重。

| 类别 | 主要来源 |
| --- | --- |
| 会话与文件 | `sessions` 中未归档的主会话、会话附件、会话环境 |
| 子会话 | `sessions` 中已识别的未归档子会话 |
| 已归档会话 | 归档会话及其后代的目录 |
| 项目与工作区 | `projects`, `workspaces`, `app-projects`, `app-authoring`, `artifacts`, `self-tests` 等 |
| 已安装应用 | `apps`, `generated-apps` |
| 应用数据 | `apps-data`, `generated-app-data`, `apps-runtime`, `app-tasks`, `browser-profiles` |
| 运行环境 | `runtimes`, `mcp`, `dbx-mcp`, `browser-binaries`, `whisper-models`, `server` 等 |
| 资源与记忆 | `skills`, `assistants`, `agents`, `connectors`, `library`, `memory`, `expert-hub` 等 |
| 缓存 | `cache`, `.cache`, `caches`, `app-authoring-previews`, `cloud-transfers`，以及嵌套的 Chromium / npm 等缓存目录 |
| 历史版本 | `workspace-versions`, `turn-observations`, `preview-drafts`, `backups`, `file-history` |
| 日志 | `logs`, `debug`, `traces`, `startup-perf` |
| 数据库与其他 | 数据库、配置、索引及其余文件 |

每个文件只归入一个分类；可展开分类查看真实目录及大小。`node_modules` / `site-packages` 内名为 cache 的源码目录仍计入安装代码。缓存是占用分类，没有附带自动删除。

统计优先采用 `stat.blocks × 512` 的磁盘分配空间；不提供 blocks 的平台退回逻辑大小并标明。它与 `du` 的口径相近，不等于 APFS 去重、压缩后独占的物理容量。数据位置之外的工作区、远端数据、Moss 安装包和外部系统缓存不计入。Web 页面统计 Web Host 的目录，显示“此云电脑”。

修复了原实现的 20 万条目 / 15 秒总扫描预算：大体积应用目录提前用完预算，导致其后的会话、项目显示 0 B、总量偏小。新实现使用 32 路受限并发，没有文件总数或时间截断；并发请求共享正在进行的扫描。文件在扫描中正常消失不记为错误，读取权限错误标记对应分类及目录，不将未读取数据伪装成 0 B。

2026-10-29 对本机实际 `~/.moss` 的只读测量耗时约 8 秒，总计 **17.45 GiB**，全部读取成功。应用约 4.82 GiB、应用数据约 5.35 GiB、运行环境约 5.77 GiB、缓存约 159 MiB；与系统 `du -sk` 的约 18,293,376 KiB 基本一致（活跃目录扫描时间不同会产生小幅变化）。此前展示的 5.9 GB 是不完整统计。

### 会话归档

`ui/src/session-archives.mjs` 在现有 SQLite 数据库中用独立 `session_archives` 表保存归档时间，不改动聊天内容或聊天更新时间。侧栏会话菜单增加“归档会话”；归档后主会话及后代从活动列表和搜索中隐藏。存储页的“管理归档”支持标题搜索、恢复和逐项删除。

- 目前支持本机独立聊天；项目、远端、特殊用途会话继续使用各自的管理流程。
- 正在运行、排队、等待审批、编辑预览或占用工作区的会话不能归档或恢复。
- 恢复保留原内容、文件和更新时间，并恢复后代在活动列表的可见性。
- 归档管理中的删除也进入文件扫描预览、显式勾选与二次确认，不直接调用无检查的删除。
- 用户已明确要求工作区 / Git worktrees 管理暂缓，本次不增加该管理界面或保留策略；工作区目录占用仍正常统计。

### 清理流程

支持 30 / 90 / 180 / 365 天条件，默认 90 天且仅查看已归档会话；可取消勾选以查看全部符合条件的独立本地会话。不自动选择，不定时清理。单独查看归档会话时不限制年龄，仍执行相同的使用状态、目录与修订校验。

- 排除项目、远端、特殊用途、运行中、等待输入/计划审批、正在写入/复制的会话，以及工作区仍被其他会话引用的会话。
- 父会话的直接子 Agent 一起计数和清理。现有删除链路只支持直接子会话，因此遇到更深层级时保留整个会话树。
- 编辑中的预览、后台任务、活动 Agent 团队、应用任务、工作区版本操作也阻止清理。
- 预览为每个候选保存服务端文件元数据指纹、会话修订、归档状态和父子关系；发出 15 分钟有效的单次令牌。客户端不能提交预览之外的 ID。
- 删除前重新扫描并校验；既有删除入口在任何副作用前执行同步 guard，复查活动状态、记录变化和目录边界。
- 复用普通会话删除链路，处理子 Agent、关联定时任务、数据库和 renderer 事件。实际删除的是 Moss 管理的会话目录，包含其中的工作文件；外部工作区不删除。对话框明确说明不可撤销。
- 一次预览最多 200 个候选并限制扫描时间；还有候选时提示处理后再次查看。失败或跳过分别显示，不把部分删除报告为成功。

跨进程文件操作不是事务：外部程序在最后一次扫描之后仍可能写文件；应用自身通过状态复查与删除标记降低竞争窗口。相关数据库、索引、历史版本等共享存储不在本次批量物理清理范围内，清理后也不承诺总占用按候选大小精确下降。

### 接口

- `storage:get-overview` → 分类、总大小、统计完整性、时间、根目录。
- `storage:review-chats` → 候选列表、字节数、子会话数、服务端预览令牌。
- `storage:delete-chats` → 所选预览的删除结果。
- `storage:list-archives` / `storage:set-archived` → 归档列表、归档与恢复。
- `storage:archives-changed` → 同步活动列表和归档状态。

桌面 preload 与 Web client 共用相同接口；浏览器模式不显示桌面“打开文件夹”按钮。

## Appearance：对照与实现

追加 REA 证据：`output/codex-settings-analysis-20261029/themes/rea.json`，ID `ev_050f974f6a39f6f3b64b3ec63a492e730c6c7e259caee445b9de552aad0028dc`。分析了 code-theme、app-theme-settings、themes、Codex Dark 和 Ayu Dark 五个模块。`themes/manifest.json` 记录所选脚本的 SHA-256 并逐个核对 ASAR 声明哈希；`palette-evidence.json` 记录主题种子颜色。仅解析静态 JS / JSON，没有执行提取代码。

直接分析完整安装包时，REA 报告一个无关的 unpacked 原生 `permissions.node` 与 ASAR 声明哈希不符，因此没有将整包认定为已验证。改用已单独核验的目标脚本进行分析；原错误保存在 `themes/rea-asar-integrity-error.json`。

Codex 主题目录包含：Ayu、Catppuccin、Absolutely、Codex、Dracula、Everforest、GitHub、Gruvbox、Linear、Lobster、Material、Matrix、Monokai、Night Owl、Nord、Notion、OG、Oscurange、One、Proof、Raycast、Rose Pine、Sentry、Solarized、Tokyo Night、Temple、Vercel、VS Code Plus、Xcode。主题可仅支持深色、仅支持浅色或同时支持两种模式；菜单按模式筛选。它从代码主题派生 surface、ink、accent，再叠加界面覆盖值，三个小色样表达当前配色。

Moss 先引入 **9 套有明确风格的配色**：Codex、GitHub、Catppuccin、Everforest、Gruvbox、Solarized、Ayu、Dracula、Nord。其中后 3 套仅支持深色。主题 ID 使用既有主题名称，浅色与深色分别采用对应色板；Ayu 深色的三色正是用户给出的 `#E6B450 / #10141C / #BFBDB6`。代码高亮采用主题相关语义色，界面层次由 Moss 根据色板和对比度生成，并非完整移植上游 Shiki 语法主题。

| 设置 | 原 Moss | 本次支持与实际作用 |
| --- | --- | --- |
| Mode | 单个下拉框 | 浅色 / 深色 / 系统三个小预览，系统变化即时切换 |
| Theme | 大部分只换纹理 | 9 套色板、带色样的菜单；旧默认 / 网格 / 圆点 / 渐变迁移为 Codex，旧 TAKT 苔绿迁移为 Everforest |
| Accent / Background / Foreground | 无 | 每种模式独立的色彩选择器与十六进制输入，可恢复主题默认值；验证颜色防止无效 CSS |
| UI font size | 无 | 12–18 px，调整界面字体比例及随 rem 缩放的控件 |
| Code font size | 固定大小 | 10–20 px，聊天代码、差异和文件预览即时生效 |
| Reduce motion | 无设置 | 跟随系统 / 开启 / 关闭；减少 CSS 动画、过渡和滚动动画 |
| Separate light and dark | 无 | 每种模式保存主题、颜色、字体、字号及对比度 |
| UI / Content / Code font | 无 | 分别选择系统 / 无衬线 / 衬线 / 等宽和常用代码字体；缺少指定字体时使用系统回退 |
| Translucent sidebar | 固定样式 | 窗口内半透明背景与模糊开关；不是透出桌面壁纸的 macOS 原生 vibrancy |
| Contrast | 无 | 0–100，调节边框、表面与次要文字相对底色的差异 |
| Diff markers | 固定颜色 / 符号 | 颜色 / +− / 两者，聊天和文件差异预览均支持 |
| Pointer cursors | 固定 | 控制按钮、菜单、链接等可操作元素的手形光标 |
| Dock icon | 固定 | macOS 桌面提供原版、石墨、反色三个 Moss 图标，通过 Electron 原生 Dock API 应用并持久保存；不会修改 Finder 安装包图标 |
| Font smoothing | 固定 | macOS 上切换原生自动抗锯齿与灰阶平滑 |
| 聊天字体、行距、消息间距、头像、边框、工具展示 | 已有 | 继续保留，并提供实际消息与代码预览 |

独立预览窗口和云环境页也采用新的主题解析。独立预览窗口订阅设置变化，字体与主题会同步更新。设置页不再覆盖一套私有灰阶色，整个应用使用同一色板。系统与服务页移除了 SkillHub / API 地址、专家中心 / 根地址的重复标题层级，系统提示只保留一个文本框。

外观设置保存在 `~/.moss/settings.json`。浏览器缓存仅用于启动时显示，持久设置为来源；颜色、字体、动画及 Dock 变体全部通过白名单和范围验证。

Dock 图标采用 `ui/build/icon.svg` 矢量源：绿色折叠 M、连续圆角、透明留白与轻阴影。三个变体使用预生成 PNG，设置预览与原生 Dock 加载同一资源，不再依赖 CSS 圆角或两套灰度算法。默认 PNG、ICNS、ICO 和网页图标均从同一源生成；在 macOS 的 `ui` 目录执行 `node scripts/generate-app-icons.mjs` 更新全部资源（ICNS 使用原生 `iconutil`）。变体选择仅影响运行时 Dock；安装包使用默认彩色图标。

## 验证

- `node --test tests/storage-service.test.mjs tests/storage-usage.test.mjs tests/session-archives.test.mjs`：15 项通过。覆盖 20 万以上条目完整扫描、与 du 对比、隐藏 / 嵌套缓存、硬链接去重、符号链接、权限错误、持久归档、后代恢复、归档状态变更、预览令牌、文件竞争和安全删除。
- `bun test`：78 项通过。外观 / 桌面设置 / Agent Mail / 侧栏 / preload / 预览所有权 / 预览状态回归。
- `bun run check`：生成契约、JavaScript 语法与两个 TypeScript 工程。
- `node scripts/build-renderer.mjs`：正式 renderer 构建。
- `electron tests/settings-storage.electron.mjs`：临时隔离 profile 中验证真实 renderer → preload → IPC。覆盖模式与系统切换、主题色、颜色修改 / 恢复、独立浅深色配置、字号与字体、动画、光标、半透明侧栏、差异标记、Dock 保存、独立预览窗口同步；侧栏归档、恢复、单个归档删除、旧会话批量清理、文件变更跳过、窄窗口及 Escape。
- 截图位于 `output/settings-storage/`，实际用户目录仅做只读元数据扫描；删除测试仅使用临时测试目录。
