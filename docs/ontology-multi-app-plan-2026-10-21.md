# 多 App 组成本体工作台：Host 工具桥方案

2026-10-21。目标是新建一个独立的组合 App，复用现有 App 的功能，逐步实现 Sudowork 本体工作台的核心闭环。数据库查询 App 和本地数据工作台保持现有职责、Manifest 和安装包，不为组合需求增加接口。

## 架构决定

数据库查询 App 已把 DBHub 的 search_objects、execute_sql 注册为 MCP 工具，Agent 会话选中它后本来就能调用。本地数据工作台现有包已有 run、task、catalog、list、cancel、read-result 等静态工具，也已有 moss.dataset/v1 只读能力。新组合 App 的 Backend 要程序化取得这些工具的结果时，通过 Host API 3.19 的 tools.list 和 tool.invoke 调用现有工具。

    组合 App（页面、领域模型、映射、发布）
        → Host（发现、授权、实例与服务路由、取消、审计）
            → 数据库查询 App 已有的 DBHub MCP 工具
            → 本地数据工作台已有的静态工具或只读能力
            → 后续其他 App 已有的工具

组合 App 拥有统一页面、本体对象与关系、字段映射、检查规则、草稿和发布版本。来源 App 继续管理各自的数据、数据库连接和凭据。Host 只转发经过授权的工具请求与结果，不把目标 App 的私有目录或连接凭据交给组合 App。现有 moss.dataset/v1 可以按其原契约继续使用，但新工具桥不要求目标 App 声明 provides。

## 新组合 App 如何接入

新 App 的 Manifest 需要 Host API 3.19、moss.app-capabilities/v1、apps:invoke，并精确声明目标 App ID 与工具名。例如：

    {
      "hostApi": "^3.19.0",
      "host": { "protocols": ["moss.app-capabilities/v1"] },
      "permissions": ["apps:invoke"],
      "appCapabilities": {
        "usesTools": [
          { "appId": "moss.database", "tools": ["search_objects", "execute_sql"] },
          { "appId": "moss.data-workbench", "tools": ["catalog", "run", "task", "read-result"] }
        ]
      }
    }

组合 App 先用 tools.list 取得工具、输入 Schema、目标实例、serviceName、serviceId 和短期 toolRef，再按实时 Schema 调用 tool.invoke。数据库 App 有多个连接时，同名 execute_sql 会按服务分别列出；组合 App 必须让用户选择来源，并保存 App ID、实例 ID、serviceId 和工具名，调用前重新发现 toolRef。toolRef 有效期为 15 分钟，不作为长期模型引用。来源标题和业务含义由组合 App 保存；Host 当前只能提供 MCP 配置名称，无法从目标 App 的私有元数据猜出友好标题。

授权粒度是目标 App ID 加工具名，覆盖该 App 当前及以后启用的实例与 MCP 服务；安装和更新时必须显示这个范围。Host 在调用前复核调用方声明与授权、目标安装和实例、服务状态、工具 Schema。目标 App 停用、服务关闭、撤权或配置变更后，旧引用不能继续调用。DBHub 的 execute_sql 可能写入，取决于目标连接的 readonly 设置；需要只读产品流程时，组合 App 应限制查询并引导用户选只读连接。

## 先做什么

| 阶段 | 交付 | 完成标准 |
| --- | --- | --- |
| 0. Host 工具桥 | Host API 3.19、SDK、Manifest 声明、安装披露、静态工具与 MCP 实时发现/调用 | 临时组合 App 使用未修改的数据库查询和本地数据工作台现有包，查询 SQLite 并调用工作台 catalog；跨 owner、撤权、取消、重启有测试 |
| 1. 组合 App 骨架 | 独立 App 页面与 Backend、来源选择、serviceId 映射、错误与重试界面 | 用户可选数据库连接和工作台任务来源，重启后重新发现工具并恢复映射；目标 App 不变 |
| 2. 本体最小闭环 | 对象、属性、直接关系、手动字段映射、样本预览、确定性检查、草稿 revision、发布版本 | 两份相关 CSV 与一个 SQLite 样例可建模、检查、发布和按发布版本查询；来源结构变化使映射待复核 |
| 3. 扩展组合 | PostgreSQL/MySQL、资料检索、AI 建议、规则、版本比较和 RDF/OWL 交换 | 每项独立验收；真实数据库与真实模型联调后再宣布可用 |

阶段 0 的本地代码与验证已完成。阶段 1 开始前，先固定两份相关 CSV、一个 SQLite 样例，以及预期对象、关联键和查询结果。Sudowork 的纯领域模型与检查规则可作为参考移植；它的服务层和 UI 依赖不能直接作为 Moss App 运行时依赖。阶段 2 的保存、检查和发布应由组合 App 的确定性代码完成，AI 负责提出可复核的建议。

## 可行性、收益和代价

方案可行。已用临时组合 App 经 Host 调用未修改的数据库查询 App 的 DBHub execute_sql，读取临时 SQLite 两行；同一组合 App 还调用了未修改的数据工作台 catalog 工具。两个目标 Manifest 前后字节一致。Host 与安装流程的聚焦测试、UI 类型检查也已通过。

收益是复用已安装 App 的连接、凭据、文件引擎和工具，不用为每个组合场景改目标 App。组合 App 可以独立迭代统一界面和本体领域逻辑；第二个组合场景也能复用 Host 桥。代价是组合 App 要处理多个工具的 Schema、异步任务、部分失败、来源选择和版本变化。本体存储、关系图、映射检查和发布语义仍需在新 App 中实现，不能只靠工具调用自动得到 Sudowork 工作台。

当前桥对 MCP 每次使用隔离短连接，不共享 Agent 会话中有状态的 MCP 进程，DBHub 启动耗时会计入调用。授权尚未细分到单个数据库连接。需要独立桌面会话授权的 native 工具尚不在跨 App 桥内。Node Backend 还没有独立的操作系统文件沙箱；面向不受信任的第三方 App 发布前需补进程与文件访问隔离。

本地 moss-apps/vendor/moss-core 的 SDK 已同步 Host API 3.19，供新组合 App 开发。正式签名发布还需提交 Core 变更并固定 moss-apps 的 Core 子模块版本；数据库查询与本地数据工作台的现有包无需为工具桥重建。

实现与调用示例见 ../ui/docs/app-capabilities.md。双目标验证脚本为 ../ui/scripts/verify-app-tool-bridge-database.mjs。
