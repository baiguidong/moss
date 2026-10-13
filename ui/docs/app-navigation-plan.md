# App 展示位置与创建规则方案

状态：已实现展示位置契约、动态导航与创建校验。2026-10-11 确认按用途分配展示位置，避免新 App 全部进入“更多”或设置。工具范围使用已有 `toolScope` 配置，与展示位置独立；分步思考明确配置为 `global`，启用后各会话按需可用。

## 目标与现状

App 作者在 Manifest 中声明主入口，Moss 根据声明展示。“更多”承载日常操作页面，设置承载配置页面，纯后台能力不占导航入口。Apps 仍列出所有已安装 App，负责启停、授权、更新、卸载和恢复配置入口。

实施前 `getSidebarMoreApps` 按 `enabled && hasUi` 收集 App，选第一个已授权 view，没有位置字段。飞书与电脑操控已经通过 `contributes.settings` 声明设置页，此前 `SettingsView` 只有固定分组，未消费这些贡献。网页操控、文件系统、Git、记忆也以配置页为主；不能仅凭 App 名称判断是否需要操作入口。

不能简单将所有有 `contributes.settings` 的 App 移出“更多”：OpenIM 当前也将消息页登记为设置入口。迁移必须检查页面实际用途，不能在 Core 中维护 App ID 白名单。

## Manifest 契约

Host API 3.4 新增根级 `navigation`，声明一个 App 的主入口；复用已有 `contributes.views` 保存路由、标题、图标，复用 `contributes.settings` 登记设置页。不要再增加一套设置页路由配置。

| 字段 | 规则 |
| --- | --- |
| `navigation.location` | `more`、`settings`、`none` 三选一，新建 App 必须显式声明 |
| `navigation.viewId` | `more`、`settings` 时必填，引用本 App 的 view；`none` 时禁止填写 |
| `contributes.settings[].group` | `integrations`、`tools`、`apps`；保留兼容分类元数据，新声明必须选组，设置导航统一归 Apps |

`location` 控制主入口。`more` App 可以通过已有 `contributes.settings` 提供独立配置页；此时操作页出现在“更多”，配置页从应用管理中打开。Moss 设置只展示已启用、明确声明 `settings` 且页面可用的 App，`none` 不生成全局导航入口。

以飞书为例，下面是 Manifest 片段，其他必要字段沿用原文件：

```json
{
  "navigation": { "location": "settings", "viewId": "settings" },
  "contributes": {
    "views": [
      { "id": "settings", "title": "飞书", "route": "#/settings" }
    ],
    "settings": [
      {
        "id": "configuration",
        "title": "飞书",
        "viewId": "settings",
        "group": "integrations"
      }
    ]
  }
}
```

工作流的主入口可声明 `{"location":"more","viewId":"workflow"}`；分步思考声明 `{"location":"settings","viewId":"settings"}`，提供服务状态与重新连接页面。

交叉校验规则：

- 有导航入口必须有 UI，且 `viewId` 存在；引用错误、非法位置和非法分组直接拒绝。
- `settings` 的主 view 必须有且只有一个对应的设置贡献，分组、标题和顺序来自该贡献。
- `more` 的主 view 不得同时登记为设置页；需要两处入口时提供用途明确、路由不同的操作页和配置页。
- 同一 App 的同一个 view 不得重复登记到多个设置分组；不能用多个入口增加曝光。
- `none` 不允许设置贡献。纯后台 App 使用 `none`；只有按需打开的辅助 UI 也可使用 `none`，保留 Apps 管理入口。
- UI 位置、`category`、`toolScope`、Backend 生命周期独立。修改展示位置不改变工具范围、权限、实例配置或后台服务状态。

SDK Schema、规范化函数、公共类型、开发契约目录和 Renderer DTO 同步保留字段。Host API、SDK 与 Runtime 已升至 3.4.0；显式使用新字段要求最低 Host API 3.4.0，防止旧宿主忽略字段后重新将配置页放入“更多”。

## 展示与交互

### “更多”

新 App 仅在 `navigation.location = more` 时生成入口，每个 App 一个，打开指定 view。沿用当前 App 分类和名称排序；不再以“有 UI”作为新 App 的展示依据。未启用、包无效、不兼容或目标 view 未授权时不提供可用入口，也不回退到其他 view 或根路由。

### 设置

设置保留原有“通用”“Agents”“工具”和“高级设置”，新增与“工具”并列的“Apps”组；没有可用 App 设置时隐藏 Apps。所有 App 设置集中在 Apps 内按应用分别展示。Manifest 的 `group` 保留为兼容元数据，不用于将 App 挂到内置工具或其他宿主设置下。

- 飞书、电脑操控、网页操控等均进入“设置 → Apps → 对应 App”。“工具”保持原有工具列表与加载配置，打开 App 只选中 Apps。
- 导航标识使用 App ID 与 contribution ID 的组合，避免不同 App 的 `settings` ID 冲突。
- 分组内保留宿主设置的固定顺序；App 项按 `order`、显示名称、App ID 稳定排序，同一 App 的设置集中展示在独立分组中，沿用 Moss 设置的卡片、图标和分隔线样式。
- 搜索匹配 App 名称、设置标题和 App 关键词；命中后可以直接选中相应页面。
- 右侧复用 `EmbeddedAppView`，保留设置左侧导航，只挂载当前选中的 App 页，不提前启动全部 App 页面；嵌入页始终使用紧凑模式，启用创作功能也不额外显示重复标题及工具栏。
- App 页自己保存 App 配置与密钥；不把这些字段合并进 `DesktopSettings`。打开设置不会把 App 加入当前会话。
- Backend 等待必填配置、连接失败或进程停止时，已启用 App 的设置页仍可打开，用于完成配置和恢复。
- 已停用、包无效、不兼容或未授权的设置页不出现在导航、列表或搜索结果中，不展示“需在应用管理中处理”占位。设置贡献与目标 view 的权限都要满足；启停、授权和修复仍由应用管理处理。
- 更新、卸载、授权变化或页面切换时释放旧嵌入实例；当前条目失效时返回可用设置页，避免空白和过期路由。

Apps 卡片的主操作也消费同一声明：`more` 显示“打开”，`settings` 显示“设置”并进入对应设置页面，纯后台 App 显示“管理”。独立的“打开设置”操作定位设置贡献，非 `settings` App 使用独立嵌入页面，不进入 Moss 设置导航。显式 `none` 的辅助 UI 可由 Apps 管理页打开，但不进入全局导航。

### 现有 App 的迁移建议

以下按页面用途写入各 App Manifest。不是由名称或 category 自动推导的运行时规则。

| 主入口 | App | 依据 |
| --- | --- | --- |
| 设置 → Apps | 飞书、MCP 管理 | 通道凭据、配对、服务连接配置 |
| 设置 → Apps | 电脑操控、网页操控、文件系统、Git 仓库、记忆 | 权限、连接状态、目录范围、工具配置；实际操作在会话中完成 |
| 更多 | 工作流、网盘、知识库、即时消息、应用构建、开发工具、调用追踪、审计中心 | 有工作流编辑、文件浏览、消息处理或结果检查等日常操作页 |
| 设置 → Apps | 分步思考 | 连接状态、工具目录与重连操作；保留 `toolScope: "global"`，无需会话选择即可按需使用 |

OpenIM 保留消息主入口，移除重复指向消息页的设置贡献；对话内的 AI 策略入口仍由消息页提供。若将来增加全局设置页，必须提供独立 view/route。其他 App 将来增加真正的操作页面时可调整主入口，但不能因为一次普通功能修改就自动换位置。

## 新建与编辑规则

创建阶段先说明“用户在这个页面完成什么任务”，再选择入口，不能由通用模板一律生成 `more` 或 `settings`。

1. 有独立日常操作页面，选 `more`；只有账户、连接、授权、目录、模型参数和状态检查页面，选 `settings`；纯后台能力选 `none`。
2. 同时具备操作和配置功能时，主入口选 `more`，配置页通过 `contributes.settings` 单独登记。禁止同页重复占位。
3. 固定模板只能提供场景示例；Builder 在需求分析后生成显式位置。未完成选择的 UI 模板不应通过新建校验。
4. 普通编辑保留位置和分组。页面职责变化或用户明确要求迁移时才调整，并在构建/安装说明中列出入口变化。
5. 恢复旧源码时先检查固定 SDK；采用新字段前迁移 SDK、契约和锁文件。不能只修改 JSON，让旧规范化器丢弃字段。
6. 新建、编辑及 Skill 转换使用同一规则；检查归一化、构建、打包、安装、重启和源码恢复后的实际 Manifest。
7. 独立判断工具范围。面向任意会话、启用即可使用的通用辅助能力（如分步思考）声明 `toolScope: "global"`；需要用户为会话选择的专用能力使用 `session`。没有跨会话需求时仍默认 session，不能根据无 UI 或导航位置自动设为 global。范围配置已受现有契约支持，无需等待导航功能。

规则需要同时落实到 Core 创建文档、独立 Builder 的 `guidance`、随包 README、场景模板、仓库校验器和构建报告。字段合法性可以自动校验；页面用途还需在需求分析和真实 UI 验证中检查。只增加提示词不算完成。

## 兼容与实施顺序

旧签名包缺少 `navigation` 时保留现有“更多”行为，其设置贡献仍可从应用管理打开，不加入 Moss 设置导航。明确声明 `settings` 的可用 App 统一归 Apps；缺少 `group` 时仍采用兼容分类值 `apps`。不自动推断主入口、不改写已安装签名包。旧 App 迁移后的新版本才按显式位置展示。已有 view 全部未授权时，不使用根路由兜底。

运行时保留旧包兼容；新建流程以及完成 SDK 迁移的新发布版本必须显式选择位置。不能将旧包兼容默认值当成新建模板默认值。

| 顺序 | 代码位置 | 交付内容 |
| --- | --- | --- |
| 1 | `packages/app-sdk/src/schemas/`、`src/index.d.mts`、`packages/app-runtime/`、`ui/src/apps/app-developer-catalog.mjs` | 契约、交叉校验、最低版本、规范化和贡献传递 |
| 2 | `ui/src/renderer-react/types.d.ts`、新增共享导航解析模块、`app-sidebar.tsx`、`settings-view.tsx`、`App.tsx`、`apps-panel.tsx` | 统一解析、动态设置导航、指定路由、卡片跳转、嵌入生命周期 |
| 3 | 相邻 `moss-apps/apps/app-builder/src/backend/actions.mjs`、`resources/authoring/`、Builder README、`scripts/lib.mjs` 及构建校验入口 | 创作指引、场景模板、实际生成产物与发布校验 |
| 4 | `moss-apps/apps/*/app.moss.json`、各 App README、固定 SDK 与锁文件 | 按上表迁移；拆分复用同页的操作/配置入口；更新版本并正常构建发布 |
| 5 | Core 与 Builder 的现有测试、安装包桌面验证 | 实际导航、配置恢复、源码恢复和旧包兼容验证 |

展示位置、Core/Builder 创建校验、场景模板和现有 App 声明已在源码中实现，App 版本同步递增。分步思考继续使用 global。已有安装须通过新版本更新；本次实现不发布市场版本，也不替换用户已安装的 App。

## 验收

- Schema 拒绝非法位置、无 UI 导航、缺失 view、设置分组错误、重复入口和过低 Host API；旧包仍能读取。
- 显式配置后，飞书、电脑操控不在“更多”，能从指定设置分组和 Apps 卡片到达正确页面；工作流仍在“更多”。
- 等待配置、Backend 失败和页面重开时仍能填写配置；停用、授权撤销、卸载和不兼容状态不绕过可用性检查。
- 设置搜索、多个 App 使用相同局部 ID、更新后的路由变更、窄屏及主题切换正常；离开页面释放嵌入实例。
- 有操作页与设置页的 App 分别到达不同路由；旧无 view 的 UI App 保留兼容入口，受限 view 不发生根路由兜底。
- Builder 分别创建一个操作型、配置型、纯后台 App，检查实际生成、打包、安装和源码恢复的字段与导航；普通编辑保留位置。
- App 分类、工具的 session/global 行为和关闭设置页后的后台生命周期不因位置迁移而改变。
- 分步思考启用、授权且连接正常后，未选择它的会话也可按需发现和调用 MCP 工具；停用后移除工具，普通编辑和源码恢复保留 global。

参考：[App 创建规则](app-authoring.md)、[App Runtime](app-runtime.md)。

## 实现验证记录（2026-10-12）

- Core 的导航、Manifest、侧栏、Apps 卡片、设置页、分类、MCP 范围与开发契约测试通过；TypeScript 和 SDK 导出一致性检查通过。
- `app-authoring-navigation.test.mjs` 验证三类 App 的实际构建、安装、删除工作区后的源码恢复，以及缺位置时在执行构建命令前拒绝。
- `app-navigation.electron.mjs` 使用隔离测试资料验证分组、关键词搜索、配置保存与重新打开、停用恢复、Apps 卡片、窄屏切换及嵌入实例释放；不操作用户安装的 App。
- `moss-apps` 仓库的 16 个 Manifest 校验和源码构建通过，Builder 场景模板及 SDK 消费端测试通过。
- Moss Renderer 与 `electron-direct.mjs` 构建通过。市场发布、安装包分发及替换用户已安装版本不属于本次代码实现。

## 分步思考设置页补充（2026-10-12）

按用户要求，飞书与分步思考均展示在“设置 → Apps”。飞书沿用已声明的配置页；分步思考 0.1.2 新增设置 UI、settings 主入口和设置贡献，提供真实连接状态、工具目录、刷新及重新连接。全局工具范围和后台自动发现保持独立于页面生命周期。
