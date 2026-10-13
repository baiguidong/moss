# 网页操控按需启动浏览器

2026-10-12，Browser Use 0.1.5。

专用 Chrome 只在实际调用网页自动化工具、需要建立浏览器连接时打开。启动 Moss、启用 App、打开设置、检查工具目录和重新连接都不打开 Chrome。用户关闭浏览器后，也等下一次网页操作再恢复原配置。

## 修复

此前 `createManagedEndpoint()` 在创建 MCP 的 CDP 发现入口时就执行 `ensureManagedBrowser()`，导致 persistent Backend 检查工具目录时提前启动 Chrome。

现改为初始化时仅校验配置、注册本机发现入口。Playwright 执行网页操作并请求 `/json/version` 时才检查和启动浏览器。后台仍可准备浏览器文件，工具目录仍可提前加载；配置隔离、并发启动锁、所有权校验、网站登录数据持久化和连接恢复保持原有行为。

实现位于相邻仓库 `moss-apps/apps/browser-use/src/playwright-cdp/managed.cjs`。App 页面、设置说明、README 和更新记录同步说明按需打开行为。

## 验证

- 26 项单元/后台测试、145 项断言及 TypeScript 检查通过。
- 从归档内源码构建，安装包校验与 Backend 握手通过。
- 真实 MCP 验证：初始化、工具目录查询和空闲重连均不启动浏览器、不创建配置目录；首次并发自动化调用只启动一个实例；关闭浏览器后，刷新工具目录不重开，下次网页操作才恢复；Cookie 和 localStorage 保留，恢复后的点击仅执行一次。
- 隔离 Host 安装真实归档，验证启动、显式检查及停用后重新启用均不启动 Chrome；首次导航后完成输入、点击、读取和截图。安装包页面连接真实 Backend，配置保存、重连和生命周期验证通过。

验证报告：[MCP](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.5/managed-browser.json)、[Host](../../../moss-apps/artifacts/moss.browser-use/verification/0.1.5/host.json)。

本地安装包：[moss.browser-use-0.1.5.zip](../../../moss-apps/artifacts/moss.browser-use/0.1.5/moss.browser-use-0.1.5.zip)。SHA-256：`7e072393c436f985a9df92745c23a7c933544ced9454f66b3da64f89186c0b65`。

本机已核对运行 0.1.5。安装前备份：`~/.moss/backups/browser-use-lazy-start-1791781517672/`。未发布市场，未提交 Git。

## 安装后出现 Host request owner stopped

正常空闲状态为“工具已就绪”，浏览器保持关闭。`Host request owner stopped` 是 Desktop 安装流程重复登记同一版本时，无条件取消了 Backend 正在执行的工具检查；Backend 本身没有重启，因此保留了检查失败状态。Desktop 启动时恢复 App 后再次登记，也可能触发同一问题。

Host 现仅在权限变化或登记失败需要回滚运行时的情况下取消请求与订阅，同版本、同权限的重复登记不再中断检查。修复位于 `packages/app-runtime/src/host/index.mjs`，需要重启使用此源码的 Moss 主程序；无需更换 0.1.5 App 安装包。当前已失败的检查可通过 App 的“重新连接”重试。

验证包括 52 项 Host、生命周期、安装 IPC 和 MCP 测试，以及 `ui/tests/browser-use-install.electron.mjs` 的真实 Desktop 安装验证。后者将首次检查延迟到安装流程的两次重复登记完成后，确认后台和安装包页面均已就绪、发现 25 个工具，且安装与页面重连均未打开浏览器：

```sh
cd ui
MOSS_APP_INSTALL_ARCHIVE=/absolute/path/to/moss.browser-use-0.1.5.zip ./node_modules/.bin/electron tests/browser-use-install.electron.mjs
```
