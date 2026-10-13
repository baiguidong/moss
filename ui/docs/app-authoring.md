# App 创建、展示位置与工具范围

App 创建使用独立的 `moss.app-builder`，在普通本地会话完成需求分析、源码修改、构建、预览和安装。现行契约由运行中的 Core `info.get`、`contracts.list/get` 和导出的 SDK 提供。不要引用已删除的旧内置创建助手。

应用构建首页可以直接描述需求，也可以通过 `@` 或“选择资源”选择已安装的技能和助手作为创建来源。仅提供这两类资源：技能多选、助手单选，选择状态与需求草稿共同保存。资源来自新会话使用的同一安装目录，停用资源不进入候选列表；提交时 Core 再核对资源状态并补齐源码位置，用户无需手填路径。已安装 App 的迭代从该 App 内的“迭代”入口进入；构建首页保留“继续项目”，不再列出所有已安装 App。

## 分类与搜索

新建 App 必须在 `app.moss.json` 根级声明一个 `category`，按用户的主要使用目的选择；编辑已有 App 时保留分类，只有用途变化才调整。不要按底层协议或是否有 UI 分类。其他用途、别名和技术名称放入 `keywords`，同一个 App 在列表中只出现一次。

| category | 显示名称 | 当前 App |
| --- | --- | --- |
| `communication` | 沟通协作 | 飞书、即时消息（OpenIM） |
| `knowledge` | 知识与文件 | 知识库、网盘、文件系统 |
| `automation` | 自动化 | 工作流、网页操控、电脑操控 |
| `ai` | AI 增强 | 记忆、分步思考、MCP 管理 |
| `development` | 开发工具 | 应用构建、开发工具、Git 仓库 |
| `diagnostics` | 诊断与审计 | 调用追踪、审计中心 |
| `other` | 其他 | 暂不适合以上用途的 App，以及缺少分类的旧 App |

例如网页操控声明 `"category": "automation", "keywords": ["浏览器", "Chrome", "Playwright"]`。分类使用固定英文标识，中文名称与顺序由 SDK 的 Manifest Schema 统一维护；不得自造“效率”、中文标识或多分类数组。扩展分类时先更新 Core 契约。`keywords` 可省略，最多 20 项，每项 1–40 个字符，不得为空白；不要堆积无关词。

Apps 与应用市场使用紧凑的分类 Tab（含“全部”与数量）展示卡片，不设搜索框；首页“更多”按分类排列入口，也不设搜索框。会话资源选择器和 `@ App` 共用这一分类与排序，支持按名称、描述、分类和关键词搜索。已安装 App 的分类直接来自当前版本 Manifest，不依赖联网查询。旧包缺少分类时显示“其他”；不会按 App ID 猜测分类，也不会改写已安装的签名包。市场返回未来未知分类时暂归“其他”。

`moss-apps` 的 `marketplace.json` 不再单独维护分类和关键词：发布记录与市场索引从 Manifest 生成 `category`、`keywords`，并输出单元素中文 `categories` 兼容旧客户端。仓库校验要求每个 App 显式选类，拒绝非法分类以及与 Manifest 冲突的市场字段。分类信息修改后，已有安装需更新到携带新 Manifest 的版本才会生效。

构建前查询当前 Manifest 契约，确认绑定 SDK 能保留 `category` 和 `keywords`。这两个字段只影响发现与展示，不改变权限、工具范围或 Backend 生命周期，也不额外提高最低 Host API。旧 SDK 可能丢弃未知字段；恢复历史源码后如需新增分类，须先迁移固定 SDK 与锁文件，不能仅向旧 SDK 输入新字段。

## 展示位置选择规则

创建 App 时必须按页面实际用途选择展示位置，不能因为有 UI 就一律放入“更多”，也不能把所有 App 一律塞入设置。先说明用户会在页面完成的任务，再决定入口。

| 页面用途 | 应选择的位置 | 示例 |
| --- | --- | --- |
| 日常查看、编辑、处理业务或检查结果 | 更多 | 工作流、网盘、即时消息、调用追踪 |
| 仅配置账户、连接、权限、目录或查看能力状态 | 设置 → Apps | 飞书、分步思考、电脑操控、网页操控 |
| 只提供后台工具，没有交互页面 | 无导航入口 | 不需要设置页的后台服务 |
| 同时有日常操作与配置功能 | 更多放操作页，设置放独立配置页 | 文件浏览页与账户配置页分别登记 |

App 分类回答“提供什么能力”，展示位置回答“用户在哪里使用或配置”，`toolScope` 决定工具在会话中的范围；三者独立选择。不能根据分类、是否使用 MCP、是否常驻进程来推导展示位置。同一个页面不得为了增加曝光而重复登记到“更多”和设置。

普通编辑保留已有入口和分组；只有页面用途变化或用户明确要求时才迁移。纯后台能力不应为了占一个入口而生成空白 UI。所有已安装 App 仍在 Apps 中可管理。

Host API 3.4 已支持根级 `navigation.location: "more" | "settings" | "none"`，有入口时由 `navigation.viewId` 引用页面；设置页复用 `contributes.settings`，并通过 `group: "integrations" | "tools" | "apps"` 选择分组。显式使用位置或设置分组要求 `hostApi` 至少为 3.4.0 及同版 SDK。新建构建必须声明位置；旧包缺省保留原有入口。完整校验、兼容与 Builder 要求见 [展示位置方案](app-navigation-plan.md)。

新建模板不能统一默认 `more` 或 `settings`，旧包的兼容默认值也不是新建规则。Builder 指引、场景模板、仓库校验与实际安装验证必须同步维护，确保操作型、配置型、纯后台 App 生成不同的正确入口。恢复旧源码时先迁移固定 SDK，避免新字段在构建中丢失。

## 工具范围

Host API 3.1 引入 App 根级 `toolScope`，唯一合法值为 `session` 和 `global`。省略时默认 **session**，旧 App 在新宿主上也采用此默认值。原生 `contributes.tools` 和 App 接入的所有 MCP 服务工具全部继承，不支持逐工具或逐服务覆盖。

| 配置 | 未选择 App | 在会话选择 App 后 |
| --- | --- | --- |
| `session`（默认） | 工具不可见、不可搜索或调用 | 全部可用工具常驻 |
| `global` | 按需搜索和加载 | 全部可用工具常驻 |

创建时根据工具用途显式选择范围：分步思考这类面向任意会话、希望启用后即可使用的通用辅助能力，应声明 `toolScope: "global"`；需要用户为当前会话选择的业务或专用能力使用 `session`。没有明确的跨会话使用需求时仍默认 session。无 UI、放在设置或进程常驻，都不能单独作为全局工具的依据。

分步思考的配置为“设置 → Apps + global”：现有 Manifest 已可通过根级 `toolScope: "global"` 配置工具范围，并要求 `hostApi: "^3.1.0"` 或更高兼容范围。全局表示启用、授权和连接正常后无需会话选择即可按需使用，不表示所有工具定义永久常驻，也不绕过停用或权限检查；导航位置使用 `navigation: {"location":"settings","viewId":"settings"}`，设置页提供连接状态、工具目录和重连操作。

通过输入框 `@` 或“选择资源 → App”添加 App。选择工作流、创建/编辑项目等具体资源时，资源 provider 所属 App 自动加入会话。选择对整个会话有效，重启后恢复；移除后不通过历史资源上下文自动加回。

这里的“常驻”指模型请求携带工具定义。`backend.lifecycle` 单独控制 App 进程生命周期，不用它声明工具范围。启用状态、工具权限、服务配置和 MCP 连接状态仍需满足；连接尚未完成时，MCP 工具在发现后直接常驻。

## App 子服务选择

Host API 3.8 新增根级 `toolSelection: "app" | "services"`，缺省 `app`。面向完整业务能力的 App 使用整体选择；MCP 管理和需要用户分别选择业务服务的 App 声明 `services`，在 @ 与资源选择器展开第二层。显式字段、服务声明和工具的 `serviceId` 均要求最低 Host API 3.8.0，固定 SDK 必须同步升级。

- 原生工具：在 `contributes.services` 声明 `{ id, title, description? }`，每个 `contributes.tools` 条目必须通过 `serviceId` 引用其中一个服务。稳定 id 不随标题修改；不存在的引用在构建时拒绝。
- MCP 工具：Host 自动从 App 注册的服务生成子项，绑定 App、实例和持久化服务 ID。客户后续追加 MCP 无需重建 App；改名保留选择，删除再建不复用旧选择。原生服务和 MCP 服务可以共存。
- `toolSelection` 与 App 级 `toolScope` 独立；上表的“全部工具”只适用于整体选择。services + session 只加载已选服务，services + global 仍全局按需发现，选中服务才常驻。不要创建逐服务范围或授权覆盖。
- 全选保存当前服务集合；之后新增服务不会自动选中。旧会话的父 App 选择在首次打开或恢复运行时转换为当时服务的固定集合。资源自动加入父 App 同样展开成当前服务集合，不保存未来服务的通配选择。
- 搜索直接命中子服务；标签显示所属 App 和服务名。忙碌会话沿用本轮策略，新选择在下次安全启动生效；停用、授权和服务状态继续约束可用性。
- Builder 新建时依据需求决定选择方式；普通编辑保留已有 `toolSelection` 和稳定服务 ID。源码恢复、构建和安装后验证字段保留及同一 App 内服务隔离。普通 App 不因为使用多个 MCP transport 就自动拆分。

完整设计和验证见 [App 子服务](app-subservices.md)。

## 新建示例

下面是只提供后端 AI 工具的 App。`schemas/search.json` 必须是合法的对象输入 Schema，`search` Action 在 Backend 注册。

```json
{
  "schemaVersion": 2,
  "id": "example.catalog",
  "version": "1.0.0",
  "displayName": "目录查询",
  "category": "knowledge",
  "keywords": ["目录", "查询"],
  "hostApi": "^3.4.0",
  "navigation": { "location": "none" },
  "toolScope": "session",
  "permissions": [],
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "on-demand",
    "actions": [{ "name": "search", "inputSchema": "schemas/search.json" }]
  },
  "contributes": {
    "tools": [{
      "id": "search",
      "title": "查询目录",
      "description": "按关键词查询目录条目。",
      "action": "search",
      "inputSchema": "schemas/search.json",
      "effect": "read"
    }]
  }
}
```

如果用途要求启用后各会话均可按需使用，例如分步思考，只把根级 `toolScope` 改成 `global`。App 接入 MCP 时也使用同一根级字段，不向 MCP 注册参数或单工具 `_meta` 添加另一套范围设置。一个 App 下的所有服务共同遵守它。

显式声明 `toolScope` 必须要求 `hostApi` 至少为 3.1.0。旧宿主会忽略未知字段，不能让声明“指定”的新 App 在旧宿主被当成全局工具使用。

## 创建和编辑流程

1. 从 Builder 或目标 App 的编辑入口选择资源，转入普通会话。编辑目标 App 时自动加入的是提供创作能力的 Builder，不会仅因目标引用就加入目标 App 的工具。
2. 使用 Builder 查询当前开发契约，准备绑定的工程和 SDK。新建工程按分类表选择 `category`、填写相关 `keywords`；模板的 `other` 只是通用初始值，应按实际用途替换。按展示位置规则说明页面用途与入口，使用支持该契约的固定 SDK 显式生成位置字段。工具范围也独立按用途显式声明：分步思考这类启用后各会话可用的通用辅助能力写 `global`；没有跨会话需求时写 `session`，不能让模板覆盖已明确的用途。
3. 编辑已有 App 时保留其范围、展示位置和设置分组。缺 `toolScope` 等价于 session，普通功能修改不自动改为 global，也不自动迁移页面位置。Skill 转换遵循同样规则。
4. 使用恢复源码包时保留其固定 SDK 和锁文件；如要采用新字段，先明确迁移到支持该字段的 SDK，并同步最低宿主版本。不能把新字段交给旧 SDK 后让它静默丢失。
5. 按绑定源码、契约和 SDK 摘要构建，读取实际构建报告，验证真实 UI/Backend 行为，再按用户请求安装。
6. 每次安装必须随版本保留完整可重建源码，包括 Manifest、构建脚本、依赖锁文件和固定 SDK。安装后验证工具的范围行为，换会话恢复编辑时仍保留同一声明。

## 验证要求

- 用绑定 SDK 校验实际 Manifest，确认分类和关键词在规范化、构建、安装以及源码恢复后仍保留。检查 Apps、市场中的分类 Tab，以及“更多”的分组、会话选择器中的归类与搜索；无 UI App 同样要分类。旧 App 缺分类的兼容性不能因新规范而被破坏。
- 验证操作型、配置型、纯后台 App 的实际生成与安装入口；设置页应能在等待配置或 Backend 失败时打开，操作页与配置页不能重复登记同一路由。迁移和源码恢复须保留位置字段及其引用。
- Manifest 示例和生成产物使用同版 SDK 校验，拒绝非法范围和不支持字段的最低宿主版本。
- session App 未选择时，原生/MCP 工具均不进入会话；选择后常驻；移除后历史发现记录不能恢复工具。
- global App 未选择时按需，选择后常驻，移除后回到现有按需机制。
- 两个会话独立选择相同 App 时互不影响，包括共享 MCP 工具缓存和动态发现。
- 验证实际生成、打包、安装和恢复的 Manifest，不能只检查 Builder 指引中出现了字段名。

参考：[App Runtime](app-runtime.md)、[MCP App](mcp-app.md)、[SDK](../../packages/app-sdk/README.md)、[工具范围方案](app-tool-scope-plan.md)、[展示位置方案](app-navigation-plan.md)。
