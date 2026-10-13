# Chrome 配置隔离与双模式连接修复

> 0.1.5 已将专用浏览器改为首次实际网页操作时才打开。启动、工具检查和重新连接不再弹出 Chrome，见[按需启动修复](browser-use-lazy-start.md)。以下为 0.1.4 的历史记录。

2026-10-12，Browser Use 0.1.4。

旧启动器使用系统 `Google Chrome.app`，却传入 `~/.moss/browser-profiles/playwright-cdp-9222`。当该实例是唯一运行的 Chrome 时，点击 Dock 会激活它，用户看到空白配置，误以为书签和设置丢失。原来的用户目录并未被删除，本机仍有 51 个书签。

## 最终行为

App 设置提供两种方式：

- **Moss 专用浏览器（默认）**：首次自动准备固定版本的 Chrome for Testing，无需安装扩展。其应用身份 `com.google.chrome.for.testing` 与系统 Chrome 不同。固定保留网站登录数据，重复、并发连接复用同一个浏览器，关闭后重新打开仍使用同一目录。
- **日常 Chrome**：通过 [Playwright 官方扩展](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)连接已有标签页和配置。首次安装、允许连接；可在高级设置保存扩展令牌以免重复确认。令牌由 Host 凭据存储保管。

高级 CDP 模式只连接已有服务。连接失败、扩展缺失或专用浏览器下载失败，都不会以系统 Chrome 加自动化用户目录的方式回退启动，也不会终止或重启日常 Chrome。

专用浏览器默认使用 `http://127.0.0.1:9222`，配置在 `~/.moss/browser-profiles/playwright-cdp-9222`。启动锁避免并发创建；所有权记录校验调试连接，只复用 Moss 自己启动的浏览器。其他服务占用端口时显示可处理的错误。每个端口对应固定目录；网站自身登录过期仍可能要求重新认证。

旧默认本机配置迁移到专用模式，明确保存的扩展或 CDP 设置保留。旧版本、旧目录文件保留，不复制个人 Chrome 配置。后台先完成浏览器下载再检查 MCP，页面展示准备进度与重试入口。“工具已就绪”代表工具目录可用，日常 Chrome 的实际连接在网页操作时建立。

主要代码在相邻仓库 `moss-apps/apps/browser-use/`；本仓库更新工具指引，明确禁止启动系统 Chrome 的替代用户目录、复制个人配置或通过调试参数重启客户浏览器。

## 0.1.4 审查修复

- 自定义浏览器路径必须提供已有用户目录；启动前检查真实配置文件及 Playwright 扩展记录，固定所选配置。空白目录不会被创建，环境变量中的配置文件也不能绕过启动保护。
- 专用模式增加仅绑定本机的 CDP 发现入口。浏览器退出后，Playwright 下次建立连接时重新校验所有权并打开同一配置；原 MCP 客户端继续使用。不会重放已发送的网页操作。
- 旧默认配置迁移时移除可执行文件和用户配置名，修复 0.1.3 已迁移但保留这些参数的配置。明确选择的日常 Chrome 或已有 CDP 模式仍保留。

## 验证

- TypeScript、25 项配置/迁移/启动保护/Backend 测试，以及安装包校验与 Backend 握手通过。
- 5 项页面测试覆盖模式切换、现有用户配置、重试、主题和窄屏显示。
- 临时 Host 安装真实归档，验证 25 个工具、页面连接、保存配置、停用/重新启用，以及导航、输入、点击、截图。
- 专用模式实测应用身份分离、并发只启动一个实例、MCP 重连复用实例、关闭后重开保留 Cookie 与 localStorage。新增同一 MCP 客户端在浏览器退出后恢复并继续操作的回归，确认点击只执行一次。日常 Chrome 的进程和书签文件保持不变。
- 使用官方扩展及临时 Chrome for Testing 配置完成真实协议连接、输入、点击与第二次连接；保存测试令牌后无需重复确认，原有 Cookie 和标签页保留。
- 扩展缺失或 CDP 不可用时不会启动系统 Chrome，测试通过启动调用保护验证这一点。

扩展验证使用测试程序自己的令牌、浏览器和网页；不读取客户令牌，不修改客户浏览器设置。客户已安装扩展并允许过一次连接，但此前对客户日常 Chrome 的操作验证超时，因此不将其记为通过。后续的自动化扩展回归已经通过。启动器优先采用 IPv4 本机地址，兼容本机代理的回环地址排除配置。

报告与产物：

- [专用浏览器持久化回归](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.4/managed-browser.json)
- [官方扩展连接回归](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.4/extension.json)
- [连接失败保护回归](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.4/browser-startup.json)
- [安装包与 Host 验证](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.4/host.json)
- [本地安装包](../../../moss-apps/artifacts/moss.browser-use/0.1.4/moss.browser-use-0.1.4.zip)

## 本机安装（0.1.4）

已通过正常安装接口从 0.1.3 更新到 0.1.4，保留专用模式设置。安装版本与运行态版本均为 0.1.4，25 个工具就绪；已有专用浏览器 PID 16884 被复用。安装前后日常 Chrome 的进程和书签文件不变，其他 App 安装信息与授权不变。

25 项单元/后端测试（134 项断言）、5 项界面测试、真实专用浏览器恢复、官方扩展、连接失败保护及最终归档的 Host 集成验证均通过。

安装前备份：`~/.moss/backups/browser-use-chrome-fix-1791774641510/`。安装包 SHA-256：`e1b9313cbbc01734d5365706dcd7a38a9668e10625f501863339cf6e5bcc84c6`。未提交 Git，未发布到客户市场。

## 历史安装记录（0.1.3）

已通过正常包安装及单 App 激活接口安装 0.1.3，并保存为专用模式。安装版本、运行态版本、25 项工具目录与受管浏览器所有权记录均已核对。安装前后日常 Chrome 保持 PID 2996，书签文件字节不变（51 个书签）；其他 App 安装信息和授权不变。

安装前备份：`~/.moss/backups/browser-use-chrome-fix-1791773001624/`，其中 `installation-result.json` 记录此次安装结果。安装包 SHA-256：`a98819f39e47943450490b90f624ad012de8043ba3fad5f0d740c4e178362cd4`。

当前运行的 Moss Electron 窗口均为其他工作的临时自测实例，使用独立 MOSS_HOME；没有更新这些实例。常规 `~/.moss` 安装在下次启动时加载新版本。源码尚未提交 Git，也未发布远程市场。
