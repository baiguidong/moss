# Moss 电脑操控：安装与测试

2026-10-08 · 测试版 `0.0.1-cua.3` · macOS 14+ / Apple Silicon

本次将 Cua Driver 接入 Moss Desktop Core，使用上游 `@trycua/cua-driver@0.34.0` 的 `EmbeddedCuaDriverHost`。设置、应用授权、会话控制和停止由 Moss 管理，截图、AX 元素及输入由 Cua 执行。无需安装市场 App、配置 MCP 或另装 CuaDriver。

## 安装和开启

1. 安装 `ui/dist/installers/Moss-0.0.1-cua.3-arm64.dmg`，将 Moss 放入应用程序文件夹并打开。已有会话和模型设置按原有 Moss 用户目录读取。
2. 打开 **设置 → 工具**，开启“允许 Moss 操作电脑上的应用”。系统权限和已允许的应用位于同一张设置卡内。
3. 点击“发起系统授权”，在 **系统设置 → 隐私与安全性** 为 **Moss** 开启“辅助功能”和“屏幕与系统音频录制”。列表没有 Moss 时用“+”添加 `/Applications/Moss.app`。此前对独立 **CuaDriver** 的授权不能代替这一步。
4. 系统要求重新打开时，退出并重新打开 Moss；回到此页点击“重新检查”。
5. 两项权限开启后即可新建本机聊天，使用支持图片的模型，发送下面的任务。首次访问应用会出现授权卡，选择“本次会话允许”或“始终允许”。

> 打开计算器，计算 128 × 64，并截图确认结果。

> 帮我测试 Claude Code Haha 的搜索聊天弹窗：输入“Cua 测试 123”，检查后清空并关闭弹窗，保留原来的聊天草稿。

如果目标应用不支持某个后台动作，Moss 可以请求本次任务的前台操作授权。前台操作期间暂时不要使用键盘鼠标。点击右下角“停止控制”可终止当前控制；设置中可关闭功能或撤销应用访问。

截图与界面文字会进入当前配置的模型服务。驱动在本机运行，模型是否离线取决于你的模型配置。不支持图片的模型应仅使用界面元素模式，不能可靠完成像素定位任务。

## 0.0.1-cua.3 设置界面调整

工具页将应用控制开关、系统权限和已允许的应用合并到一张卡片；移除独立“电脑操控”分区标题、计算器自检入口以及开发模式路径和说明文案。两项权限通过检查后可以直接从对话使用，截图在实际任务中获取并验证。

“Moss 内置工具”列表新增 `computer_use`。默认常驻，可改为按需加载；关闭应用控制总开关时，列表显示关闭，加载方式不能绕过功能开关或系统权限。Cua 仍随正常 macOS 安装包交付，不依赖开发模式。

本次针对改动的验证：Core 工具与加载测试 15/15、UI 设置测试 31/31、电脑操控 Node 测试 11/11；TypeScript、语法检查及生产构建通过。真实 Electron 隔离配置测试确认卡片包含三部分、已移除的文案和自检接口不再出现、工具列表随总开关联动，以及已授权时点击授权按钮会显示明确反馈。包内 229 个 Renderer 文件、主进程、preload、Cua 服务和 Core bundle 与本次构建逐字节一致。截图见 `ui/dist/installers/validation/settings-cua.3.png` 和 `built-in-tools-cua.3.png`。

`0.0.1-cua.3` 的 DMG、ZIP、更新元数据、随包运行时和 Cua 原生 SDK 校验通过，结果保存在 `ui/dist/installers/validation/package-verification-cua.3.json`。安装版实际控制仍需要用户为 Moss 授予两项系统权限。

## 0.0.1-cua.2 授权入口修复（历史记录）

“发起系统授权”不再依赖 macOS 是否弹窗：调用后重新检查真实权限，缺少权限时打开对应系统设置，两项已开启时明确提示运行截图自检。设置页显示实际授权应用及路径，支持在访达中定位。开发模式需授权 `Electron.app`，安装版需授权 `Moss.app`。

已通过 11 项电脑操控 Node 回归测试、TypeScript/语法检查，并在真实 Electron 设置页点击按钮，验证“已开启”反馈和正确应用路径。打包后的 229 个 Renderer 文件、授权主进程及 preload 与当前源码一致。截图见 `ui/dist/installers/validation/permission-feedback.png`。

源码运行的旧进程需重新启动才能加载新的主进程和 preload；操作系统授权仍由用户在系统设置中开启。

## 本次实现

- Core 工具 `computer_use`：查应用、启动应用、列窗口、获取截图和界面树、点击、输入、按键、快捷键、滚动、设置控件值、结束控制。
- 主会话独占控制；后台任务、定时任务、远程会话、App 渠道和子 Agent 不获得本机桌面控制。Boss 主会话也可直接调用，工作 Agent 不可调用。
- 每次操作检查应用授权、进程与窗口归属及新鲜快照；不能从模型参数注入 PID、Cua session 或原始驱动工具。
- 应用会话授权跨同一聊天的多轮保留，持久授权存入设置；前台授权仅对当前控制运行有效。
- 中止、关闭设置开关、关闭最后一个窗口、退出/更新、锁屏/睡眠接入停止流程。驱动异常后需重新观察，不自动重放输入。
- 原生图像直接进入模型图片消息，并在聊天工具卡展示。设置页提供权限检查、授权撤销和不含界面正文的诊断复制。
- 独立私有 daemon + MCP stdio；使用 Cua 上游生命周期管理，不连接机器上的全局 CuaDriver；关闭 Cua 遥测。

## 安装包内容与构建

```text
Moss.app/Contents/Resources/
  app.asar                                 # Moss Core / UI / MCP client
  app.asar.unpacked/node_modules/
    @trycua/cua-driver/                     # 官方 JS SDK
    @trycua/cua-driver-darwin-arm64/         # dylib / node module
    @ubjs/                                 # UniFFI 运行依赖
  computer-use/
    policy.yaml                            # 固定原生工具允许列表
    0.34.0/darwin-arm64/
      cua-driver
      cua-cursor-theme
      LICENSE
      THIRD_PARTY_NOTICES.md
      manifest.json
```

原生 SDK 从真实的 `app.asar.unpacked` 路径加载，避免 `dlopen` 无法读取 ASAR 虚拟路径。打包校验实际使用包内 Electron 导入这一入口，不仅检查文件存在。

固定源制品：`cua-driver-rs-0.34.0-darwin-arm64.tar.gz`。SHA-256：

```text
329bcc140c4840a5877e2cfc9f756351eb4a70c2c2d6acf4954751918122c60a
```

从官方制品中选取的驱动、光标 helper 和许可共 **78,314,808 字节**，另外携带原生 npm SDK。完整独立 `CuaDriver.app`、下载缓存、Python/Rust 开发工具和模型权重不随此功能打包。每个 staged 文件的大小与哈希保存在 `manifest.json`。

```sh
cd ui
bun install --frozen-lockfile
MOSS_PACKAGE_VERSION=0.0.1-cua.3 bun run dist:mac
```

`dist:mac` 会下载并校验锁定制品、构建、生成 DMG/ZIP、验证随包资源和 SDK。用户首次使用无需在线下载驱动。

本次交付沿用仓库现有的**未签名开发包**策略。没有使用本机某个未明确选定的 Developer ID 证书。此包可用于本机测试，不保证跨构建保留 macOS 权限；系统可能要求通过右键“打开”或“隐私与安全性 → 仍要打开”确认启动。无需关闭 SIP 或修改 TCC 数据库。

正式签名入口已提供，需发布者配置自己的 Developer ID 与公证凭据：

```sh
MOSS_MAC_SIGNING_IDENTITY='Developer ID Application: Your Company (TEAMID)' \
MOSS_MAC_NOTARIZE=true bun run release:mac
```

配置身份后启用 hardened runtime、Electron Builder 嵌套签名及公证，并校验签名身份和装订票据。本次没有执行正式签名、公证或升级权限保留测试。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| Core 全套测试 | 540 通过、1 跳过、0 失败；随后补充的工具桥接测试单独运行，5/5 通过 |
| Desktop 全套测试 | 983/983 通过；Node 主进程测试 22/22 通过，其中电脑操控边界测试 8 项 |
| 语法、TypeScript、构建 | `ui/bun run check`、Core bundle、Renderer production build 通过 |
| Electron 40.8.3 真机内嵌 | 官方 SDK 加载、宿主身份检查、真实窗口截图、启用/关闭和设置页面通过 |
| Calculator 真机动作 | 经新 `ComputerUseService` 后台点击 128 × 64；每次使用新快照，最终真实截图确认 **8,192**。macOS 26 的 AX 树未提供结果数值，因此用图像核对 |
| Claude Code Haha 真机输入 | 经新服务使用后台像素输入“Cua 测试 123”，截图与 AX 值确认一致；按实际观察清空、Escape 关闭，原聊天草稿值保持不变。未发送消息、执行任务或修改配置 |
| 实际打包版启动 | 通过 LaunchServices 启动隔离配置的 Moss；SDK 加载和 `com.moss.ai` 宿主归属通过；设置页正确显示 Moss 两项权限待开启 |
| 打包版授权后操作 | 等待用户安装并为 Moss 授权；没有把开发模式 Electron 的授权或独立 CuaDriver 授权冒充 Moss 授权 |
| 随包完整性 | 固定制品哈希、原生依赖、包内 Electron SDK 加载、版本及更新元数据校验通过；DMG 校验及 ZIP 解压校验通过；ASAR 中三份核心实现与当前源码一致 |
| 清理 | 测试配置隔离于原用户目录；退出测试实例后无测试私有 Cua daemon 或调试端口；独立 CuaDriver 保留 |

截图证据位于 `ui/dist/installers/validation/`：`calculator-8192.png`、`packaged-settings.png`，以及仅裁出测试输入框的 `claude-text-input.png` / `claude-text-cleared.png`。完整聊天内容截图留在本机临时测试目录，不放入仓库或交付截图目录。

当前 `0.0.1-cua.3` 安装包 SHA-256：

```text
edcfb32c504fcfff6e223807408ec6ffda4243e17e81d991cc179488d59e8458  Moss-0.0.1-cua.3-arm64.dmg
cf33fd120e07ced5ea712c13cf614be7e6838de9b79905a8724f16ce4cd95759  Moss-0.0.1-cua.3-arm64-mac.zip
```

`0.0.1-cua.2` 安装包 SHA-256（历史记录）：

```text
cc1a1e875e78b37109cdba8924f67f3acdfc4fa67cf21fe31e2db1cb31a2d83c  Moss-0.0.1-cua.2-arm64.dmg
d974fb9edb1044f2f93397ad872976d88dc73945e2f7461621ace40418a279df  Moss-0.0.1-cua.2-arm64-mac.zip
```

初版 `0.0.1-cua.1` 安装包 SHA-256（保留历史记录）：

```text
c27a7d6a249ef5e844f74effe53123949c53d4d2d6390e6522646fea098b12d6  Moss-0.0.1-cua.1-arm64.dmg
bbcf4abe50f9787bc6956a120dca4abb7f85954fba06181e2fdc12414612902b  Moss-0.0.1-cua.1-arm64-mac.zip
```

这些是确定路径的真机测试与自动化测试，不是跨应用通用成功率。真实操作测试调用的是本次 Cua 适配器，没有用 Sky 或 AppleScript 代替控制。随后已核对用户在开发版中的真实聊天任务“打开计算器，计算 123*345”：共 9 次 `computer_use` 调用，7 次进入服务成功返回，2 次因 action 不接受额外参数而被校验拒绝。第一次 `list_apps` 多带 `include_screenshot`，第一次 `end_session` 多带 `app`；纠正后均成功。这两次重试与系统权限无关，未出现权限拒绝。

实际流程是列应用、启动、列窗口、观察、输入、复查、结束。输入返回 `effect: unverifiable` 后，Agent 重新截图，图像确实显示 `123×345` 和 `42,435`，验证闭环成立。`launch_app` 总耗时 33.118 秒，当前日志没有把应用授权等待与驱动启动时间分开，不能据此认定为系统权限问题。自然语言任务已在开发版通过；安装版仍需独立授予 Moss 权限。

## 当前边界

首版提供可用的本机控制路径，尚未开放拖拽、完整桌面坐标、Chrome 扩展或 Excel 加载项。Windows 尚未接入。后台快捷键和输入能力依赖目标应用，不能保证所有原生、Electron、SwiftUI 界面都支持后台操作。

前台运行目前提供明确授权和停止按钮，尚未实现物理键鼠介入的自动暂停检测。未完成原规划中的多显示器、30 分钟长任务、10–20 个任务重复成功率和签名升级矩阵，因此不宣称已达到 95% 通用任务成功率或正式发布稳定性门槛。

实现入口：[Core 工具](../src/tools/ComputerUseTool/ComputerUseTool.ts)、[主进程服务](../ui/src/computer-use/service.mjs)、[官方驱动宿主](../ui/src/computer-use/driver-host.mjs)、[设置与授权 UI](../ui/src/renderer-react/components/computer-use.tsx)、[构建制品脚本](../ui/scripts/download-computer-use.mjs)。原设计见 [Core 规划](cua-computer-use-core-plan.md)。
