# Cua Driver 操作 Claude Code Haha 实测

日期：2026-10-08。

结论：官方 Cua Driver 已在本机完成 Claude Code Haha 的截图、界面元素读取、按钮点击、中英文混合输入、清理和设置页往返。后台 AX 文本输入路线被拒绝，后台 Cmd+A 未能全选。单次、单应用测试证明基础路径可用，尚不能证明通用稳定性，也不代表 Moss Core 接入完成。

## 环境与调用路径

| 项目 | 实测环境 |
| --- | --- |
| 系统 | macOS 26.3，Apple Silicon |
| 驱动 | 官方 Cua Driver 0.34.0，`/Applications/CuaDriver.app` |
| 驱动身份 | `com.trycua.driver`；Developer ID Application: Cua AI, Inc. (YCK386LBJ7) |
| 目标应用 | Claude Code Haha 0.6.5，`com.claude-code-haha.desktop` |
| 连接 | 临时 Python MCP stdio 客户端 → 官方 Cua Driver → 目标窗口 |
| 协议 | MCP `2025-06-18` 握手成功 |
| 系统权限 | 用户手动开启 CuaDriver 的辅助功能与屏幕录制权限 |
| 投递方式 | 测试动作均请求 `delivery_mode: background` |

应用制品已核对官方发布资产 SHA-256、Developer ID 签名及装订的公证票据。使用的是独立签名 App；未安装全局 CLI、npm SDK、模型权重或系统 Python 依赖。临时 Python 脚本只负责 MCP 握手、调用及保存响应，没有实现输入或截图引擎。目标应用的操作通过 Cua 工具完成，未调用 Sky 或用 AppleScript 代替 Cua 输入。

制品来源：

- [官方 0.34.0 Release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.34.0)
- 文件：`cua-driver-rs-0.34.0-darwin-arm64.tar.gz`
- SHA-256：`329bcc140c4840a5877e2cfc9f756351eb4a70c2c2d6acf4954751918122c60a`

## 权限结果

用户开启两项权限后，旧测试进程一度仍报告 `permissions_pending`。重启本次 Cua 测试进程后，检查返回 `accessibility: true`、`screen_recording: true`，归属为 `driver-daemon`，Bundle ID 为 `com.trycua.driver`；随后真实窗口截图成功。

这说明本次独立安装的权限已经生效。Moss embedded 模式的宿主权限归属、升级后权限保留和重启流程仍需单独验证。

## 操作结果

| 操作 | 结果 | 验证方式及边界 |
| --- | --- | --- |
| `launch_app` 定位目标应用 | 通过 | 复用已经运行的应用并取得窗口；未测试冷启动 |
| 读取窗口截图与辅助功能树 | 通过 | 获得真实窗口图像、按钮和输入框；大树需要提高元素预算或按标签过滤 |
| 点击“搜索聊天” | 通过 | 使用新快照的元素 token 执行 AXPress，后续截图确认弹窗打开 |
| 使用输入框元素 token 后台输入 | 路线被拒绝 | 返回 `background_unavailable`；Electron 网页内容无法建立安全的后台 AX 文本输入路线，未投递文字 |
| 使用窗口坐标后台输入 `Cua 测试 123` | 通过 | 使用 Cua 内置像素定位路线；截图与 AX 值都确认中英文及数字完整出现 |
| 后台 Cmd+A 全选 | 未通过 | `press_key` 加修饰键及 `hotkey` 均未实现全选；随后退格仅删除一个字符。后一次工具返回 `delivery_failed` 升级提示，未尝试前台模式 |
| 清空测试文字 | 通过 | 根据实际剩余字符使用退格，截图确认搜索框为空 |
| Escape 关闭搜索弹窗 | 通过 | 截图确认返回聊天页面 |
| 打开、关闭设置页 | 通过 | AXPress 点击设置及关闭按钮，截图确认设置页出现和关闭 |
| 返回原聊天、检查草稿 | 通过 | 用新快照定位原聊天，最终截图确认原草稿仍在 |
| 结束控制会话 | 通过 | `end_session` 返回 `active: false`，随后临时 MCP 客户端正常退出 |

测试采用“动作 → 新快照 → 验证”的顺序。部分动作返回 `effect: unverifiable`，通过后续截图才确认结果；不能仅把工具显示的成功提示视为操作成功。新快照会使旧元素 token 失效，后续操作使用对应的新 token。

未独立持续监测系统焦点和物理鼠标位置，因此不能由 `background` 参数推断完全不抢焦点或不影响用户鼠标。未测试滚动、拖拽、多窗口、跨屏、emoji、前台快捷键、长任务和重复成功率。

## 清理与保留

- 搜索框测试文字已清空，搜索弹窗及本次打开的设置页已关闭，已返回原聊天。切换页面后的滚动位置未要求逐像素恢复。
- 未发送聊天消息、执行代码任务、改动目标应用配置或修改原有草稿。
- `moss-haha-test` 控制会话已结束，临时 MCP 客户端已退出；目标应用仍保持运行。
- 保留 `/Applications/CuaDriver.app` 及用户已授予的系统权限；未停止可能由后续调用复用的全局 daemon。Cua 产品遥测已关闭。
- 原始响应与截图保存在系统临时目录 `moss-cua-app-smoke-uy5mpvi4`，未写入仓库，以免夹带私人聊天内容；临时目录不作为长期测试证据存储。

## 对 Moss 接入的影响

1. 可以继续按 [Core 接入规划](cua-computer-use-core-plan.md) 进行 P0；本次没有改动 Moss 运行代码。
2. 保留 Cua 的元素定位与像素定位两条路线。后台 AX 输入拒绝后，应根据目标窗口当前截图选择上游支持的路线，并再次验证输入结果。
3. 后台快捷键必须按目标应用实测；本次 Cmd+A 失败不能算作成功。不能只依赖工具返回值或盲目重复执行。
4. 权限界面需要支持授权后重新检测与重启，并以真实截图自检确认可用。
5. 接下来仍需验证 Moss Electron 40.8.3 下的 SDK 加载、embedded 私有 daemon、权限归属 Moss、停止清理和安装包内容；独立 CuaDriver 测试不能替代这些检查。
