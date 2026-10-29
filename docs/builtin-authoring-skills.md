# 内置技能与应用构建

2026-10-29。技能创建、技能安装、图片生成作为 Moss 内置 skill；App 创建复用 moss-apps/apps/app-builder，作为内置 App，全局按需加载。默认在主会话使用，不需要用户进入 App 或输入源码。

| 能力 | 实现与展示 |
| --- | --- |
| 技能创建 skill-creator | 创建/修改 SKILL.md 和必要资源；脚本支持不覆盖的初始化、元数据和引用检查；skillify 继续承担从会话提炼流程 |
| 技能安装 skill-installer | SkillHub 搜索、本地目录/ZIP、公开 GitHub 路径；查看内容与摘要后安装，记录来源；拒绝覆盖、来源变化、越界和符号链接 |
| 图片生成 imagegen | 使用 image_gen，按 Codex 四参数统一生成/编辑；默认 gpt-image-2，复用主会话 URL/Key；多图参考、透明背景、图片回传与主会话展示 |
| 应用构建 moss.app-builder 0.1.7 | 五个原生 builder_* 工具、App 内 app-creator 技能、中文指引与可构建脚手架；保留项目工作台，由通用详情“打开”进入 |

源码 skills/ 是唯一技能内容来源。Desktop 打包到 resources/skills，同时供实际模型加载器和“插件 → 常用 / 技能 → 已安装”目录读取；显示中文名称、Moss 内置来源、版本和完整说明，不允许卸载随包原件。个人同名技能优先。没有 Desktop 资源目录的 CLI/Server 构建内联相同内容，按调用提取必要脚本/参考文件，避免重复注册。

应用构建源码仍在 ~/repo/moss-apps。Core 的 packages/app-sdk/src/builtin-apps.json 仅选择随包 App，打包时生成安装档案与校验和；没有复制一套 App 到 Core。新建工具示例没有 UI，默认 session，实际项目按用途选择范围和展示。应用构建自身是 global/on-demand，可在详情调整。

SDK 的 README、authoring.md、ui-layout.md 和 Builder 指引同步说明主会话、通用详情、可选业务 UI、全局按需/常驻、来源和冲突检查、技能资源、固定 SDK、不可覆盖脚手架与真实验证。新文档随 sdk.export 进入项目。

## 直接测试的会话内容

- “帮我创建一个每周复盘技能，输入本周完成事项和问题，输出进展、原因分析及下周行动，保存为个人技能。”
- “查看 /绝对路径/my-skill 的内容和依赖，适合的话安装到我的 Moss 技能中，保留已有版本。”
- “生成一张横向产品主图：白色陶瓷杯、浅灰背景、柔和自然光，不要文字。保存到当前工作区。”（先配置图片模型）
- “创建一个文本统计 App，统计字数和行数，直接在主会话使用，不需要独立页面。完成后测试并安装。”

## 验证

- python3 -B -m unittest discover -s tests/skills -v：7 项，覆盖创建、检查、安装回执、不覆盖、改变来源、无效链接、ZIP 越界/符号链接/重复路径，以及模拟 Hub/GitHub 来源。
- src/skills/bundled/creation.test.ts：4 项，实际 Moss 加载器、CLI 内容与脚本提取、两种发布模式去重、个人覆盖。
- ImageTool.test.ts：覆盖统一 `image_gen` 的生成、引用图片编辑、会话连接隔离、格式适配、取消、非法结果与文件权限；使用本地模拟服务。完整 CDP 与实际图片模型验证见 [image-generation.md](./image-generation.md)。
- App Builder：10 项源测试，实际安装包构建与 Backend 握手；scaffold 测试验证导出 SDK、真实不可变构建、独立预览、Unicode 文本结果与非法输入拒绝；两个原有预览测试通过。
- Electron browser 验证：资源选择器、@、键盘/输入法、草稿与选择恢复、浅深主题、窄窗，以及真实 UI → preload → Backend → Core 文件服务。
- ui/scripts/test-builtin-skills-cdp.mjs：独立 Profile、真实 Electron renderer/preload/IPC，验证三个内置技能的两个列表入口及说明、在隔离目录实际创建/安装后可见、Builder 内置来源与全局按需/五工具/技能/工作台，以及示例返回主会话。截图和 8 项断言结果在 output/builtin-skills-cdp/。
- UI TypeScript、Core direct/CLI 构建和 renderer 构建通过。未进行真实模型自主编写 App、公开市场发布或多操作系统测试。

联调还修复了两个既有构建链路问题：Node 22 不支持 --allow-net 时不再传入该参数（文件/进程权限仍保留，旧 Node 的握手校验不提供网络隔离）；预览只补充新运行时尚未注册的协议，避免重复注册 app-capabilities/runtime 协议并保留独立身份。
