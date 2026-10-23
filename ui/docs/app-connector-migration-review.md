# 连接器 App 接入与复查

最终范围以用户修正为准：保留既有普通 App 和市场卡片，在 moss-apps 增加 115 个服务 App。迁移的是源码，绝不自动迁移个人旧连接器安装或数据。

- 源码在相邻仓库 `moss-apps/apps/<服务名>`，App ID 使用 `moss.<服务名>`、包名使用 `@moss/<服务名>`，使用标准 App 构建、源码随包、签名发布流程。新增飞书 CLI 使用 `feishu-cli`，保留已有 `moss.feishu`。
- 服务身份通过 Manifest 的 `connectorApp.id` 关联载荷，不从 App ID 拼接或解析。安装、账号配置、会话选择和卸载均使用实际 App ID；权限和载荷身份校验保持不变。
- Moss 只读取 `https://baiguidong.github.io/moss-apps/v1/index.json`，不再混入内置连接器目录。
- 桌面安装包不再携带旧连接器目录、认证配置与 overrides。旧目录已从 `ui/resources` 清除，兼容性测试 fixture 单独放在 `ui/tests/fixtures/connector-catalog`；打包检查会拒绝意外携带该目录。
- 已删除 `migrateInstalled`、旧会话 Connector→App 转换、迁移回滚分支和 Main 启动中的旧连接器目录初始化；不是以开关禁用。
- 既有普通 App 不需要迁移。本次误移出的 28 个普通 App 已原样恢复，安装清单逐项相同；数据与凭据没有删除。
- 市场与已安装页提供分类/全部展示；搜索框与分区同排。已删除隐藏/恢复市场卡片的功能。
- 安装采用市场签名、摘要及权限复查。真实 ZIP 安装测试修复了激活失败后只回滚包指针、未恢复运行版本的问题。
- Connector App Manifest 支持规范化后再次校验；声明式 MCP/CLI/技能源文件被识别为真实可重建源码，无需伪造 UI 源文件。

验证记录位于 `output/app-connector-migration-20261019/correction/`：115 个标准发布 ZIP、本地市场预览、源码重建、Main 启动/重启、实际个人配置中 28 个普通 App 的恢复核对，以及界面与安装生命周期测试。

Host 相关测试 334 项、moss-apps 测试 28 项通过；类型检查、渲染器生产构建与 Electron 界面验证通过。Apps 和应用市场共用单行搜索布局，窄窗口下分类标签可横向滚动。

本地测试包未签名，尚未发布线上；正式上线沿用 moss-apps 的签名发布流程，并要求先固定支持 Host API 3.15.0 的 Core 提交。不得把本地源码迁入或构建完成当作线上市场发布完成。
