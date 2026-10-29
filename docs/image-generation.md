# 内置图片工具

`image_gen` 是 Moss 原生 TypeScript 工具，统一替代 `image_generate` / `image_edit`。主会话连接可用时默认常驻；不需要选择 App 或打开工作台。内置 `imagegen` skill 负责使用指导。

## 来源与适配

依据本机 Codex 提交 `9ef9cb1d9f` 的 `codex-rs/ext/image-generation/src/tool.rs`、`artifact.rs`、`backend.rs` 和 `codex-api/src/endpoint/images.rs` 移植：

- 严格四参数：`prompt`、`transparent_background=false`、`referenced_image_paths`、`num_last_images_to_include`。
- 无参考图生成，有参考图编辑；最多 5 张，两种引用方式互斥。最近 N 张从实际用户/工具图片块中逆序收集、按原顺序提交；上下文不足明确报错。
- `size=auto`、`quality=auto`、背景为 `transparent` 或 `opaque`。图片模型名称可以配置，默认 `gpt-image-2`。
- 生成与编辑默认均提交 JSON。仅编辑接口明确拒绝 JSON 格式时，适配一次公共 Images multipart 格式；超时、429、5xx 等不会自动重试，避免重复计费。
- 图片结果作为真正的图片块回传模型。Moss 原有 OpenAI Messages 网关适配负责将嵌套工具图片移至原生图片输入位置。

Moss 的宿主适配：

- URL/Key 使用当前主会话的 `SessionApiOverrides` / `modelConnection`。桌面设置与服务端管理页的“文本模型”中，默认模型、快速模型之后是唯一的“图片模型”字段，保存为 `models.image.model`。独立图片设置区和旧 OpenAI/MiniMax 厂商分支已移除；加载旧配置只保留自定义模型名称，保存时删除独立图片地址和 Key。
- 使用 Moss 的文件读取/写入权限。参考路径为绝对路径，可经授权读取工作区外图片。
- 自动保存到当前工作区 `generated_images/<session>/<call>.png`，方便本地与远程工作区共用预览；不覆盖旧图。完整写入临时文件后原子发布，取消不留下半张图片。
- 使用现有工具执行状态，主会话专用图片卡直接展示生成中、成品和失败状态；成品在折叠/合并工具模式下仍可见。点击图片可放大，也可在现有右侧预览器打开。没有整体“继续修改”按钮。
- 远端生成耗时主导整体时间；本地使用异步 HTTP/文件 I/O 和已有 Sharp 图片处理，无需增加 Rust 构建链。

## 代码位置

- `src/tools/ImageTool/ImageTool.ts`：参数、权限、保存及模型结果。
- `src/tools/ImageTool/imageReferences.ts`：会话图片选择。
- `src/services/imageGeneration.ts`：会话连接与 Images HTTP。
- `ui/src/renderer-react/components/chat/image-generation-card.tsx`：主会话图片展示。
- `skills/imagegen/SKILL.md`：内置技能。

## 验证

核心测试覆盖新建、恢复历史后编辑、五图参考、非法参数、会话凭据隔离、格式适配、URL 下载、服务错误、取消、权限和文件保留。UI 测试在 `ui/` 下执行，使用其 JSX 配置：

```sh
bun test src/tools/ImageTool/ImageTool.test.ts src/utils/toolAvailability.test.ts src/services/api/__tests__/toolImageCompatibility.test.ts
cd ui
bun test tests/image-generation.test.tsx tests/tool-display-settings.test.ts tests/desktop-settings.test.ts
node scripts/test-image-gen-cdp.mjs
```

CDP 测试启动隔离的真实 Electron，使用本地 Messages/Images 服务贯穿主会话调用、图片回传、右侧预览、连续编辑、刷新恢复和设置保存。报告和截图位于 `output/image-gen-cdp/`。

另已使用现有主会话连接实测 `gpt-image-2`：生成约 29 秒，编辑约 39 秒；编辑结果实际具有 alpha 通道，透明值范围 0～255。原图、编辑图及去除凭据的报告位于 `output/image-gen-live/`。这些时间仅为本次两次调用的观测值。

桌面运行时/渲染器构建及 UI、管理端类型检查已通过。全仓根目录 `tsc` 仍会报告缺失的 `src/types/message.js` 等声明及其他类型错误，不将其计为通过。
