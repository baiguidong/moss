# Computer Use 独立 App：迁移方案与实现

状态：代码迁移已实现（2026-10-11）。验收结果和产物见 [迁移交付记录](computer-use-app-delivery.md)。

## 最终架构

| 部分 | 归属 |
| --- | --- |
| Cua 0.34.0 二进制、SDK、平台原生库、策略和依赖许可证 | `moss-apps/apps/computer-use` |
| `computer_use` 的 Schema、完整操作说明、结果语义、目标解析与快照 | App |
| 开关、系统权限指引、已授权应用和停止按钮设置页 | App UI |
| 原生适配器信任校验、会话身份、授权存储、桌面占用、可信授权卡片、紧急停止 | Core |
| App 选择、停用、权限撤销、升级、卸载和退出时的取消 | Core |
| 通用多模态工具结果转换 | Core |

App ID 为 `moss.computer-use`，版本 `0.1.0`，最低 Host API `3.2.0`，平台为 macOS 14+ arm64。模型工具名称和 App 内 ID 均为 `computer_use`。采用 `toolScope: "session"`，在会话中选择后提供工具。

App 源码位于 [独立 Apps 仓库](../../../moss-apps/apps/computer-use/README.md)。输入保留 `{ "request": { "action": "…" } }`，12 种动作由单一 Zod 定义生成 JSON Schema。完整指引通过包内 `instructions` 文件提供，避免工具短描述的 2000 字符限制。

## 原生入口与权限

Manifest 使用 `nativeAdapter: { kind: "desktop-control", apiVersion: 1, entry: "dist/native/entry.mjs" }`，工具声明 `execution: "native"` 和 `permission: "desktop:control"`。入口导出 `createAdapter(context)`，返回 `invokeTool/status/check/requestPermissions/finish/stop`，可选 `invalidate`。

适配器由 Electron 主进程在 `app.whenReady()` 后加载。工厂只创建对象，原生进程在检查/操作时启动。Host 注入已校验的安装目录、宿主 Bundle ID 和控制上下文。Cua 校验 `host` 权限归属、`parent_application`、Bundle ID 与真实主进程 PID。

加载要求包签名可信，且签名发布者出现在 Host 原生发布者允许名单中。当前 Desktop 允许 `moss`；单独声明 Manifest 权限不能进入主进程。每次入口调用先复核安装状态、权限、完整性和签名。原生适配器是可信代码，不是沙箱；不能用同线程超时承诺恢复主线程同步挂死或 native crash。

审查后采用 **UI + 原生入口**，不增加普通 Node Backend。模型调用直接进入 Host 的原生分派，App UI 使用仅限 UI 的 `moss.host/v1/native.settings`。这样真实会话不需要从后端回传，图片也不经过普通 Backend 的 1 MiB IPC 通道。普通 App Backend 保持原有执行边界。

Core 只对经过原生信任校验的工具生成 `hostPermissionManaged` 标记，避免重复的通用 App 工具审批。工具仍声明 `write`；具体目标应用与前台控制继续由可信 Host 卡片批准。App 页面不能替用户批准目标授权。

## 生命周期与迁移行为

- `DesktopControlSession` 持有唯一桌面占用、可信会话上下文、取消信号和 epoch。拒绝远程、定时、子代理与邮件驱动会话。
- 移出会话先更新授权状态，再立即停止控制；不等待忙碌 runtime 的工具列表刷新。调用入口也复查当前 `appIds`。
- 停用和撤权先关闭入口，再停止适配器；停止失败保持禁止状态，不回滚成允许。
- 升级先停旧适配器，再改变活动版本。进程固定已加载的原生版本；新版本在重启 Moss 后加载。
- 卸载先停止，再删除安装记录。已加载的原生包写入退役标记并保留文件，下次 Host 启动后清理，避免删除被加载的 dylib。
- 锁屏、休眠、取消、结束会话、关闭主窗口和退出触发清理。停止后的同一轮不能继续操作；停止失败要求重启。
- 旧 `computerUse` 设置迁移到通用 `desktopControl`，保留用户的开关和应用授权；旧 Core 静态工具入口和 Cua 打包依赖已删除。

Host API 3.2 暂时只在一个主进程加载一个桌面控制提供方。切换到其他提供方同样要求重启。

## 结果与包约束

App 返回 `moss.tool-result/v1` 内容块。Core 保留图片、文本和 `isError`，图片总编码长度限 24 MiB；结构化 AX 信息去重属于 App。保留截图坐标、单动作/60 秒快照、窗口归属、截图尺寸与 frame-valid 检查。

原生运行包采用单文件 128 MiB、总量 512 MiB 的有界上限，解包与验证使用相同限制；源码仍采用原来的 50/250 MiB 上限。App 运行目录包含所有原生依赖，运行时不下载驱动。构建使用固定下载地址和 SHA-256，完整源码和锁文件随 ZIP 交付，并验证可从源码重建。

## 驱动替换

Cua 的版本、包路径、策略、动作映射和安装依赖都在 App 中。后续可在 App 中升级或替换驱动，只需继续满足原生适配器和 Host 控制契约。已经加载的原生模块更新需要重启 Moss；新增 Host 能力时才需要升级 Core。迁移未新增拖拽、剪贴板或完整桌面等动作。
