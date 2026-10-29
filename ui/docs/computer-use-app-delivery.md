# Computer Use 独立 App 迁移交付

## 0.2.0：Windows 与 Mac 分平台签名包（2026-10-11）

已实现 Windows x64、Mac Apple Silicon、Mac Intel 三种包。市场根据 `process.platform` / `process.arch` 从 `artifacts[platform]` 选择对应下载地址、大小、SHA-256 和签名身份。`platforms` 写入签名覆盖的 App manifest，直接从本地安装错误平台也会被拒绝。旧的单包版本继续兼容；目录保留旧版 Host 可解析的 artifact 元数据，但新 Host 不会使用它作为跨平台回退。

首次安装本版本需要包含 Host API **3.3.0** 的 Moss；App SDK / Runtime 已更新。驱动仍在独立 App 内。后续驱动更新可通过 App 发布完成。

| 平台 | 签名包 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Windows 10/11 x64 | `moss.computer-use-0.2.0-win32-x64.zip` | 31680752 | `5dc4680674a0b16932a97beed21fbae4ac6361292b16dc3a0a8b18f62e7fb65a` |
| Mac Apple Silicon | `moss.computer-use-0.2.0-darwin-arm64.zip` | 49239780 | `d539b68b4435e0e203c0b037ff981c7bf22b5a3470059a31a7aa8f26b8bd2622` |
| Mac Intel | `moss.computer-use-0.2.0-darwin-x64.zip` | 49262722 | `2a3cc833f6f8a863cb9f244ca8022e40001651694c5c5c266a07da71834ef51a` |

交付目录：`/Users/bgd/repo/moss-apps/artifacts/moss.computer-use/0.2.0/`。全部由 `moss/release-1` Ed25519 签名，已使用真实 Host 信任配置逐一验证。源码快照提交：App `34d02cfc071099b9fa3a1d0cf247e76ed1ea636d`，Core `6b391af8c734b2458367c3a7f8df047cf2f30092`。快照仅提交于隔离的临时仓库，未提交用户工作区。

Windows 使用 UI Automation 与 D3D 捕获检查，通过 SDK 验证嵌入驱动身份。应用按真实可执行文件路径生成不透明标识，保留 `bundleId` 字段兼容旧授权协议；独立校验进程创建时间与 HWND 所属 PID。UWP 启动入口与运行进程分别授权，启动后重新列出应用；含参数的快捷方式暂不直接启动。支持 invoke/expand、Ctrl 与 Win 键，设置页显示 Windows 能力和 Moss 外观。普通权限可以控制同等权限的应用；不自动提权，不控制 UAC 安全桌面。本版本没有 Windows ARM64 原生包。

验证结果：

- App 类型检查、工具契约、Mac 授权/快照回归及 Windows 身份/进程复用/UIA 路由测试通过。
- Host 市场选包、错包拒绝、单包兼容、manifest 平台校验、桌面控制生命周期测试与 UI TypeScript 检查通过。
- 三个最终签名 ZIP 均从各自内附源码独立重建，全部运行文件哈希一致；各包只包含对应平台原生 SDK 依赖。
- Mac Apple Silicon 实测真实 Host 信任、驱动启动、截图、AX 中文输入、停用与卸载通过。设置页 Electron 检查通过，包括 Windows 状态、隐藏 Mac 权限按钮、主题切换和窄屏。
- 当前机器为 Mac，**尚未执行 Windows / Intel Mac 原生实机验证**。Windows Electron 原生截图与中文输入测试已接入 CI，失败会阻止统一发布；不能将本地构建或模拟测试视为 Windows 实测通过。

发布流程为三个目标平台分别构建签名包、独立重建，收集全部产物后验证完整平台集合并一次发布。现有线上目录尚未更新；本次只完成本地代码、签名包和可审阅目录，未触发远程发布。证据见交付目录下 `verification/`。


2026-10-11：代码迁移完成。方案见 [迁移方案与实现](computer-use-app-plan.md)。

## 0.1.1：Moss 样式接入与签名包

设置页已接入 `app.getInfo().appearance` 和 Host 的 `appearance` 事件，沿用 Moss 的主题变量、字体、按钮、卡片边框及背景。支持浅色、深色、跟随系统以及默认、网格、圆点、渐变背景。Host 的显式主题优先于系统设置，事件优先于尚未返回的旧读取；失焦恢复和卸载清理也已覆盖。

- [已签名的 0.1.1 安装包](../../../moss-apps/artifacts/moss.computer-use/0.1.1/moss.computer-use-0.1.1.zip)：49,223,901 字节，发布者 `moss`，密钥 `release-1`，算法 Ed25519。导入 Moss 替换旧包；若旧原生版本已加载，需要重启 Moss。
- [浅色截图](../../../moss-apps/artifacts/moss.computer-use/0.1.1/verification/settings-light-grid.png)、[深色截图](../../../moss-apps/artifacts/moss.computer-use/0.1.1/verification/settings-dark-dot.png)、[窄屏截图](../../../moss-apps/artifacts/moss.computer-use/0.1.1/verification/settings-narrow.png)。
- [验证记录](../../../moss-apps/artifacts/moss.computer-use/0.1.1/verification/checks.json)：11 项 Bun 测试和 9 项 Node 测试通过；Electron 页面验证通过；签名 ZIP 经 `--rebuild --require-signature` 校验，包内源码可独立重建，运行文件哈希一致。准备阶段首次重建因磁盘不足中断，清理本次重复解压目录后重试成功。
- [真实 Host 签名及加载验证](../../../moss-apps/artifacts/moss.computer-use/0.1.1/verification/native-load.log)：隔离安装目录使用包的原始签名和 Host 内置公钥，确认 `trusted`，原生适配器启动、Host 权限身份、状态工具、停用和卸载通过。[安装后的设置页](../../../moss-apps/artifacts/moss.computer-use/0.1.1/verification/settings-installed.png)。本轮没有重复操作目标应用；368 个原生运行文件与此前通过截图和中文输入测试的 0.1.0 完全一致。

用户遇到的 `Native adapters require a trusted signature from a Host-approved native publisher` 来自此前交付的未签名包，属于包信任校验，不是 macOS 权限缺失。界面现会显示明确的中文提示，关闭不可用操作并保留重试入口。尚未放宽 Host 的原生发布者校验，也未修改用户信任配置。

用户已明确授权生成签名包。使用现有 Moss 发布密钥完成本地签名，对应仓库及 Host 内置的 `moss/release-1` 公钥；未触发线上发布，也未修改用户信任配置。签名构建使用干净的独立 App/Core 源码快照，提交信息见验证目录中的 `snapshot.json`，原工作分支和暂存区未改动。

CI 发布流程已有 `--require-signature` 的签名和重建验证门槛，缺少密钥或公私钥不匹配会使发布失败。已补齐 Computer Use 的运行平台选择：其源码验证及最终签名构建均使用 macOS arm64 runner（`macos-14`）；其他 App 保持现有矩阵和发布平台。YAML、两类标签的平台分支及签名步骤顺序已在本地验证，未触发远程 CI 或发布。

普通 App 的本地未签名包仍可运行。此处强制可信签名的是加载到 Electron 主进程中的 `nativeAdapter`，不是所有 App 的安装门槛。

```text
0.1.1 已签名 ZIP SHA-256:
58a55845e174819a2b109020b0b87333ac7d19a25a69202d7c238a3ab04ebd94
Source hash:
1716fe2ecb4a19dd0c3ef26337d4990e892518000b0c0849064bf598d055190f
Runtime hash:
89ec9857fef5b569938611c3b84efeea33145578aa25f8f461aee68c446ab591
```

以下为 0.1.0 迁移记录。

## 交付内容

- [App 源码](../../../moss-apps/apps/computer-use/README.md)：`moss.computer-use@0.1.0`，macOS 14+ arm64，Cua 固定 `0.34.0`，Host API `^3.2.0`。
- [本地安装包](../../../moss-apps/artifacts/moss.computer-use/0.1.0/moss.computer-use-0.1.0.zip)：49,213,305 字节，约 47 MiB，包含可重建源码、锁文件、全部运行依赖及第三方许可证。
- [设置页实测截图](../../../moss-apps/artifacts/moss.computer-use/0.1.0/verification/settings.png)；[原生窗口截图](../../../moss-apps/artifacts/moss.computer-use/0.1.0/verification/native-window.png)；[Electron 验证日志](../../../moss-apps/artifacts/moss.computer-use/0.1.0/verification/electron.log)。

工具本地 ID 和模型名称均为 `computer_use`。先在会话中选择 App，再调用 `{"request":{"action":"list_apps"}}`。详细 Schema 与指引随 App 提供。

Cua 驱动、版本与哈希、SDK、策略、快照和操作映射已移出 Core。Core 不再注册静态 `computer_use`，不再打包 `@trycua/*`、`@ubjs/*` 或 Cua 资源。Core 中保留通用受信原生入口、会话/目标授权、停止机制与多模态结果映射。旧设置自动迁移到 `desktopControl`。

设置入口已迁入 App。驱动使用独立原生入口，由 Electron 主进程加载，以维持真实系统权限身份。没有增加普通 Node Backend；截图直接走受信 Host 调用。原生工具保留 write 语义，具体目标和前台控制由 Host 授权，避免重复通用审批。

## 验证

| 验证项 | 结果 |
| --- | --- |
| Core/App 工具、清单、设置、会话选择、运行时生命周期、Host 和包契约 | 129 项通过 |
| 原生包信任、篡改、停用/撤权失败、卸载/重启清理，以及桌面控制策略 | 15 项通过 |
| 主会话/协调器可用、子代理不可见和调用拒绝 | 专项测试通过（19 项工具/模式测试） |
| App Schema、结果去重、窗口/PID/快照、像素尺寸、授权取消 | 6 项 Bun + 9 项 Node 测试通过 |
| 源码描述符与运行文件绑定 | 通过 |
| UI TypeScript、渲染端生产构建、Core direct 构建、SDK 生成契约检查 | 通过 |
| 含源码 ZIP 校验及从 ZIP 源码重新安装依赖、检查、测试、构建 | 通过，重建运行文件哈希一致 |
| 实际 Electron 安装目录中的原生适配器 | 启动、权限归属、AX 树、窗口截图、中文输入、结束控制、停用和卸载通过 |

实际控制使用临时 AppKit 测试应用和隔离数据目录，输入 `Moss 迁移测试 123` 并读取结果核对。测试初期出现 `ax_window_unresolved`；测试窗口经正常应用启动流程稳定后，完整 AX 输入验证通过。该降级状态仍会保留在工具结果中，不会伪装成完整树或自动绕过快照校验。

最终包的运行文件哈希与通过 Electron 实测的包一致。测试应用和驱动已停止，验证图片与日志保留在产物的 `verification/` 目录。

## 哈希

```text
ZIP SHA-256:
ec4fa46a7ba0fff6bbbbaadab5c99f1d3d4d75e1d6ef7285552436f177e71def
Source hash:
ffbab616046ecd0eb826a684dffc01d472c083671f2d2fddac09f905cc90109a
Runtime hash:
c99238863d3c13cf0a25b5d715b1b4199bf85ed02f4160d9bee3655676fcdb94
```

## 发布与边界

0.1.0 初次迁移交付为**未签名、未发布的本地构建**，其 Electron 验证使用临时测试密钥。当前 0.1.1 已完成真实发布者签名及 Host 加载验证，见本文开头。原生入口继续要求可信发布者签名和 Host 原生发布者允许名单，未修改用户信任配置，也未安装到日常用户数据目录。

驱动升级或替换由 App 管理。已加载的原生版本更换需要重启 Moss；通常不需要重新发布 Core。主线程同步挂死或 native crash 不属于可由同线程超时恢复的故障；未来引入新 Host 能力仍需升级 Host API。首次迁移未新增动作、平台或驱动版本。
