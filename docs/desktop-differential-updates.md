# Moss 桌面增量更新方案

Moss 0.1.43 的实现与验收记录。范围为 macOS arm64 和 Windows x64 安装版。目标是减少实际下载量，让用户继续使用 Moss 直到自己选择重启，并保留安装失败时的手动入口。

## 更新方式

沿用 GitHub Release 已发布的 ZIP、Setup EXE 和对应的 `.blockmap`。用户点“下载更新”后，用当前版本的安装包重建目标包。macOS 在后台提前完成解压和签名验证，Windows 继续通过 NSIS 静默安装。在“待处理”显示“已准备好，重启更新”。桌面主程序会短暂退出，用户可以选择切换时间。

这种做法需要缓存当前版本的**原始发行包**。Mac 对应 ZIP，Windows 对应 Setup EXE。把已安装的 Moss.app 重新压缩可能改变压缩流、文件顺序和元数据，不能保证得到同一份 ZIP。若产品目标变成“从 DMG 首装后第一次升级也必须省流量，且不愿常驻一份 ZIP”，优先评估 Sparkle 的应用目录补丁。

## 四个开源实现与 WorkBuddy

| 实现 | 如何复用旧数据 | 首装与跨版 | 对 Moss 的意义 |
| --- | --- | --- | --- |
| electron-builder / electron-updater | 索引旧包的块校验值和偏移，生成本地复制及远程下载操作。Windows 使用缓存的安装器，Mac 的标准更新器使用缓存的 ZIP。 | 有匹配的旧包和分块表即可直接计算旧版到目标版的差异。Mac 默认缺少旧 ZIP 时走全量。 | 与当前 CI 产物和 Windows 安装方式匹配。Moss 锁定 6.8.3，应针对该版本验证取消、进度、GitHub 重定向及整包回退。上游新代码的行为可能不同。[下载计划](https://github.com/electron-userland/electron-builder/blob/072f05ff4b67f422e8d8d274a199e0072e9e7fe3/packages/electron-updater/src/differentialDownloader/downloadPlanBuilder.ts) |
| Signal Desktop | 用旧安装包和分块表计算差异，先估算下载量，再用 HTTP Range 获取缺块。下载器处理相邻范围及分组请求，整包完成后验证签名。 | 有差分计划时可以只下载增量，整包路径独立。下载阶段和最终安装分别处理。 | 借鉴进度口径与全量回退。Signal 服务端支持的多区间请求需要在 GitHub 单独验证。[下载器](https://github.com/signalapp/Signal-Desktop/blob/01e59719454fec204b3f7902fb663d68419848c9/ts/updater/differential.main.ts) · [更新流程](https://github.com/signalapp/Signal-Desktop/blob/01e59719454fec204b3f7902fb663d68419848c9/ts/updater/common.main.ts) |
| Sparkle 2 | CI 针对指定旧版本生成并签署 delta。客户端校验已安装应用的源目录，复制到临时目录、应用补丁，再核对目标目录哈希。 | 本机可以直接使用已安装的 .app。CI 必须拥有对应的旧构建，且 appcast 中有匹配源版本的补丁，才能获得差分收益。 | 可节省常驻 ZIP 的空间，尤其适合 DMG 首装。代价是增加 Mac 专属签名密钥、appcast、补丁产物以及与现有 ad-hoc 发行方式的集成验证。[补丁应用](https://github.com/sparkle-project/Sparkle/blob/666fabe80eb3168616bea929be69280e7ac822c8/Autoupdate/SUBinaryDeltaApply.m) · [补丁生成与签名](https://github.com/sparkle-project/Sparkle/blob/666fabe80eb3168616bea929be69280e7ac822c8/generate_appcast/Appcast.swift) |
| Velopack | 保留本地完整 .nupkg，CI 生成 delta 包。客户端可以下载多个中间差分，重建目标完整包。 | 没有本地完整包时先全量。差分链过长或总大小超过整包时直接全量。 | 可借鉴缓存轮换及按成本选择下载方式。采用其完整方案需改变现有发布格式和安装链路。[更新策略](https://github.com/velopack/velopack/blob/07db4a1020e8e4a9aed4b73aa3d2adcb5de200d0/src/lib-csharp/UpdateManager.cs) · [差分生成](https://github.com/velopack/velopack/blob/07db4a1020e8e4a9aed4b73aa3d2adcb5de200d0/src/vpk/Velopack.Packaging/Compression/DeltaPackageBuilder.cs) |

本机 WorkBuddy 5.11.3 提供了安装体验的参照。Mac 更新模块会下载并校验更新，在缓存中准备应用。2026-11-13 的安装日志记录了等待旧进程退出、备份、交换应用和重新打开新版。这份日志能验证桌面进程发生过重启，未提供足够信息判断此次网络传输是否使用了块级增量。

## 实际发布包能省多少

对两个 Release 的块表按块校验值与长度匹配，再累加目标包中需要从网络读取的字节。表中使用十进制 MB，应另计分块表和 HTTP 开销。第一组只有版本号差异，第二组包含真实的客户端功能改动。Electron 升级、压缩参数变化和大资源改动都可能提高下载量。

| 升级路径与平台 | 目标完整包 | 理论缺块 | 占整包 |
| --- | ---: | ---: | ---: |
| 0.1.40 → 0.1.41 · macOS ZIP | 558.8 MB | 25.8 MB | 4.62% |
| 0.1.40 → 0.1.41 · Windows Setup | 396.1 MB | 11.2 MB | 2.84% |
| 0.1.41 → 0.1.42 · macOS ZIP | 558.8 MB | 26.9 MB | 4.81% |
| 0.1.41 → 0.1.42 · Windows Setup | 396.1 MB | 14.5 MB | 3.67% |

使用 0.1.43 下载器实测 0.1.41 → 0.1.42，Mac 向 GitHub 发出 116 次成功的单区间请求，安装包响应体共 26,864,706 字节。Windows 安装版发出 28 次，收到 14,541,524 字节。两端重建的完整包均通过发布清单 SHA-512 校验。Mac 从隔离位置替换并打开新版主窗口。Windows 从 NSIS 缓存恢复安装包、静默安装并重新启动目标版本。[Windows 安装验收](https://github.com/baiguidong/moss/actions/runs/45980491417) · [0.1.40 资产](https://github.com/baiguidong/moss/releases/tag/v0.1.40) · [0.1.41 资产](https://github.com/baiguidong/moss/releases/tag/v0.1.41) · [0.1.42 资产](https://github.com/baiguidong/moss/releases/tag/v0.1.42)

## 客户端流程

1. **发现新版。** 启动、定时和手动检查只获取发布信息与必要清单。“待处理”列出可更新版本和中间各版的 changelog，支持稍后处理及跳过本版。
2. **用户点下载。** 根据平台、架构、安装形态和当前版本寻找旧包。匹配时获取对应的旧、新块表，在本地计算可复制范围、远端缺块和预计流量。跨版直接比较本机版和目标版。例如 42 升 45，只需 42 和 45 的包信息。
3. **传输与验证。** 先使用单区间 HTTP Range，复用已校验的重定向目标，按需要合并相邻请求。校验 206、Content-Range、长度与目标边界，限制块表解压大小，完成后核对目标完整包的 SHA-512 和大小。进度条显示网络已收字节与预计网络总量，本地复制、解压和校验单独显示阶段。
4. **处理回退。** 没有旧包时直接准备目标全量包，用户无须先补下载一个旧包。旧包损坏、块表不存在、服务器忽略 Range 或最终摘要不符时，丢弃无效的临时文件。若已显示较小的增量大小，建议在待处理中提示全量大小，供用户选择继续或稍后。用户取消后终止网络传输和回退。
5. **准备切换。** macOS 在旧应用运行期间，将完整 ZIP 解压到原安装目录所在卷的私有临时目录，校验应用标识、目标版本、架构及签名。Windows 在后台重建、校验 Setup EXE，使用 electron-updater 的缓存和安装接口。两端都应把“准备好”记录在磁盘，重开应用后可以继续。
6. **重启生效。** 用户点击“重启更新”时重新检查活动会话、终端和后台任务，保存状态。Mac 用现有助手交换 .app 并重新打开，启动异常沿用恢复流程。Windows 以静默参数运行安装器并重新打开。下载变小不会自动缩短 NSIS 解包和运行时准备耗时，这两项应分别测量。普通关闭和主动重启更新应保留各自的行为。

## 两个平台的落点

**macOS。** 在下载服务增加“缓存旧 ZIP + 当前发布块表”的重建路径，优先复用 electron-updater 的计划计算，通过 Moss 现有的 HTTPS 重定向检查和取消机制执行请求。完整 ZIP 继续作为手动兜底。将当前点击安装时才执行的暂存、解压和校验提前，安装助手在切换前再次确认暂存目标身份和原安装位置。保留现有 ad-hoc 签名方案。若使用 electron-updater 的内部模块，锁定依赖，并以已发布包及回归测试约束升级。[下载服务](../ui/src/update-download-service.mjs) · [Mac 安装服务](../ui/src/mac-update-service.mjs) · [安装助手](../ui/build/mac/update-helper.m)

**Windows 安装版。** 优先启用现有 electron-updater 的 NSIS differential download，核对首次安装后它管理的安装包缓存、从固定 GitHub tag 获取旧块表的 URL，以及实际 Range 字节数。沿用现有静默安装和失败后的 EXE 定位入口。若仍出现可见界面，按 NSIS 向导、系统提权和 Moss 自己的启动或准备窗口分别定位。用实际窗口和日志确认原因后再改动。便携版继续使用已有的下载与手动替换流程。[Windows 适配器](../ui/src/auto-updater-service.mjs) · [NSIS 准备步骤](../ui/build/installer.nsh)

## 缓存、升级起点和磁盘

- **长期保留一份基准包。** 缓存按平台、架构、版本、资产名称和 SHA-512 绑定。Mac 把基准放在专用更新缓存内，Windows 复用安装器缓存。以新版实际启动并确认版本作为晋升时点，再回收上一份基准。启动失败时保留上一版和已验证的目标包，供重试或手动安装。
- **首次从 DMG 安装。** 用户通常只有已解压的 .app。首次应用内升级可以下载一次目标全量 ZIP，成功后自然建立下次的基准。已有用户通过 0.1.42 升入支持差分的版本时，新版启动应检查旧流程留下的安装记录，验证并接管对应 ZIP。0.1.43 启动时校验旧版留下的 ZIP，随后把它移到当前架构的基准缓存。[启动时的更新缓存处理](../ui/src/update-ipc.mjs)
- **临时空间大于下载量。** Mac 升级时会同时占用旧基准 ZIP、重建中的目标 ZIP、运行中的 .app 和解压后的新版 .app。按各文件所在卷检查空间。回滚使用交换后保留的旧 bundle。Windows 应同时考虑旧 EXE、目标 EXE 和 NSIS 的解包空间。重试复用已验证的目标包，只回收由 Moss 管理且确定已失效的临时文件。
- **CI 沿用现有资产。** 每次发布核对 Mac ZIP 和 Windows Setup 的块表、资产名称、大小与最新版本清单，并保留老 Release 的块表供跨版读取。增量重建失败始终可以使用官方完整包。

## 实施与验收

先接入下载与缓存，再将 Mac 准备阶段移到后台，最后用两个隔离、可启动的正式构建验收。每个平台记录本机基准版本、目标版本、完整包大小、预计缺块、实际 HTTP 响应体字节数、校验结果、退出到新版可用的时间和安装时出现的窗口。

| 场景 | 应达到的结果 |
| --- | --- |
| 用户尚未点下载、选择跳过或正常关闭 | 没有安装包字节传输，普通退出不会触发安装。 |
| 当前版本基准完整，连续升级及跨版升级 | 确认真实 206 响应，重建结果与 GitHub 完整包摘要一致。以实际传输统计报告节省量。 |
| DMG 首装、Windows 新装、缓存被清理 | 分别确认真实缓存状态。缺基准时下载目标整包，下一次升级能复用新基准。 |
| 代理返回 200、范围不符、旧包损坏或网络中断 | 不把损坏的包标为可安装。取消后停止请求，全量回退显示真实大小。 |
| 下载后正常退出、磁盘不足、进程崩溃、重复点更新 | 能恢复已完成的准备结果，旧版仍能打开，活跃任务不被强制退出。 |
| 最终安装 | 两端自动打开目标版本，已保存会话可读。失败时可以定位已校验的完整安装包。单独记录 Windows 是否出现向导或系统提权。 |
