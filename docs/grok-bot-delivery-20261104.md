# Grok Bot 借鉴功能：实施、验收与发布记录

用户授权（2026-11-03）：各功能独立提交，方便 revert；全部完成后执行 CDP 测试和 review，通过后自动 commit、push、CI 打包新版本，并更新 10.0.1.181 的 WebUI。正常修复、构建和部署无需再次询问。

## 本轮范围与状态

- 待处理工作台：来源仍是 Host 问题、决策、会话状态和操作草稿，普通通知留在消息中心；计划确认去重；操作草稿可跳转查看。
- 业务操作草稿：Host 持久化生命周期、版本检查、账号/目标展示、正文修改、确认执行、未知结果查询；新增 `moss.operations/v1`，App 可真正提交草稿并读取自身回执。
- 统一自动化：在现有定时任务中展开详情，展示项目、执行电脑、触发时间和最近十次运行；运行回执持久化，支持打开承接会话。
- 此次渠道验收使用隔离的邮件/CRM fixture。没有向真实收件人发消息或修改真实 CRM；已安装的第三方渠道仍需按下述协议接入并配置自己的真实账号。UI/协议通过不等于真实第三方渠道已开通。
- 事件触发、演示教学、岗位方案、团队知识审核属于原方案后续批次，本轮没有将它们标成已完成。

## Review 修复

1. **未知结果禁止重复执行**：执行请求抛异常、超时、缺失或畸形回执，均保留 `unknown`；不能通过修改、取消再打开草稿绕过。只有查询明确回执后才解除。
2. **重启恢复**：上次 `executing` 恢复为 `unknown`，不自动重发；过期只影响尚可编辑的草稿。
3. **当前版本确认**：修改/取消/确认必须携带当前 revision。修改正文、账号或目标会更新幂等键并清空旧回执；重复确认成功草稿返回已有回执。
4. **动作归属和权限**：动作必须属于草稿绑定 App；实际调用仍走 App Runtime 授权。记录 App 版本和调用者身份，版本或账号发生变化要求重新生成。App 接口不提供 confirm。
5. **真实目标展示**：不再把“修改目标显示文字”伪装成改收件人；显示稳定目标字段与账号 ID。目标/账号需从来源 App 重新选择生成。
6. **存储保留**：容量达到上限时只清理已完成/取消/过期项；未处理或结果未知的草稿不能因新建而丢失。
7. **自动化回执**：普通 Cron 会话没有项目任务终态，不能用项目字段推测结果。由调度器记录开始、成功、失败和触发方式，重启时将未完成运行记为未知。
8. **CDP 基线**：创作 App 测试从打包 manifest 取得 App 总数，替代写死的 7；仍验证全部打包 App 已完成恢复且没有延迟项。

## App 渠道接入契约

manifest 声明 `operations:propose` 权限和 `moss.operations/v1` Host protocol，Backend 使用 `host.request(protocol, method, input)`。

| 方法 | 用途 | 边界 |
| --- | --- | --- |
| `draft.create` | 提交已解析的草稿 | App/instance/owner 由 Runtime 注入，不接受 App 冒充 |
| `draft.list` | 查看自己的草稿和回执 | 按 App、实例、owner 隔离 |
| `draft.get` | 查看指定草稿 | 非当前调用者草稿返回 null |

创建字段：`title`, `channel`, `accountId`, `target`, `content`, `actionRefs` 必填；可带账号显示名、摘要、附件、`baseVersion`、过期时间和业务 metadata。目标必须来自渠道只读查询，包含稳定 ID、类型与租户。内容当前是文本；结构化 CRM 变更由 App 编码并校验。Core 不猜联系人，不从文本标签推断业务字段。

`actionRefs` 引用同一 App 的三个 commands：

- `validateDraft({ draft })`：每次确认时重新检查实际账号、租户、权限、目标、附件和业务 `baseVersion`；仅明确返回 `{ valid: true }` 或 `{ ok: true }` 才允许执行，冲突返回 `{ valid: false, error }`。
- `execute({ draft, idempotencyKey })`：渠道在外部副作用边界实现幂等；必须返回 `{ status: 'succeeded' | 'failed' | 'unknown', result }`。`failed` 只用于确认没有产生副作用或已经回滚的失败；失去响应返回 unknown。
- `queryResult({ draft, idempotencyKey })`：通过稳定请求键查回执；未能确定结果继续返回 unknown，不在此方法里重发。

执行前的校验不是事务锁；CRM 的 execute 还必须通过上游条件更新/版本条件处理“校验后变化”。Core 单次调度和幂等键不能替代上游幂等支持。新渠道需补目标歧义、账号切换、版本冲突、重复点击、网络中断与回执查询的适配测试。

受控参考实现：`ui/tests/fixtures/apps/operation-review`，覆盖邮件草稿、CRM 版本冲突和未知结果，不连接外部业务服务。

## 验收入口

- `bun test ui/tests/operation-drafts.test.mjs ui/tests/app-operation-drafts.test.mjs ui/tests/pending-work-items.test.ts ui/tests/pending-work-panel.test.tsx ui/tests/app-sidebar.test.tsx`
- `bun test ui/tests/moss-cron-scheduler.test.ts ui/tests/cron-window-lifecycle.test.ts`
- `cd ui && bun run check && bun run build:renderer`
- `cd ui && node scripts/test-work-review-cdp.mjs`：真实 App Backend/Host/preload/生产 renderer，局域网本机模型 fixture；证据 `output/work-review-cdp`。
- `cd ui && bun run test:creation-desktop`：打包 App、真实 PDF 预览等回归；证据 `output/creation-desktop-cdp`。
- 项目创建和六种创作 App 会话 CDP 已在前一次提交通过；对应证据 `output/session-creation-cdp`。

全仓 `bun test` 前次记录有 2439 pass、2 skip、49 fail、10 errors，涉及环境 Node SQLite、既有 TSX、浏览器/WebSocket 和依赖问题；不能宣称全仓测试通过。此次重点复测上述改动相关路径，CI 还需通过 Linux 镜像浏览器、容器重启、多用户隔离和程序升级/回滚检查。

## 发布与回滚

首次发布 0.1.21：CI https://github.com/baiguidong/moss/actions/runs/41626124125 成功。此后 review 补充修复需进入修订版，不能把 0.1.21 当作最终验收版本。

181 真实地址为 `root@10.0.1.181`（本机 `ssh 181` 解析为错误的 `0.0.0.181`）。安装目录 `/data/moss-server`，个人环境 `env-20a7006bd8bd828e8437aa50`，容器 `2976b1f996bde485b303dc6e4d6698773766d77024617886e6eb4562ed432b18`。

个人环境使用 `webui.sh upgrade <env-id> <image>` 原容器内切换程序，保留 HOME、容器 ID、系统安装；gateway 使用 `.env` 的 `MOSS_WEB_IMAGE` 与 Compose 更新。不要用删除/重建个人容器或删除卷代替升级。升级脚本校验兼容性、检查空闲并支持失败自动退回；应用回滚也用同一入口指定上一镜像。原 `.env` 备份为 `.env.before-webui-0.1.21`。

## 最终发布与 181 验收（2026-11-04）

最终修订版 **0.1.22** 已发布并更新到 [181 WebUI](https://10.0.1.181/)。本轮功能按独立提交保留；代码构建点为 `fb8c617fc8a77d6f6aa8d21c00e2b3d1e00b8a18`，本节是部署后的文档记录，不改变镜像代码。

- [CI 41676825909](https://github.com/baiguidong/moss/actions/runs/41676825909) 成功；启用 `runtime_tests=true` 和镜像发布，未构建 Server。
- 镜像：`ghcr.io/baiguidong/moss-webui:0.1.22`，Linux AMD64。
- 发布摘要：`sha256:6ec8c39cd612b8411ccb86d5e9fa7d0fa8fb77cf87d8bea953158602e5780733`，已与 CI 推送日志和 181 实际镜像核对。
- 个人环境通过 `webui.sh upgrade` 原地切换到 0.1.22，状态 `ready`、无错误；原容器 ID 和 `/home/moss` 数据卷均保持不变。实际程序位于 `/opt/moss-releases/6ec8c39cd612b8411ccb86d5e9fa7d0fa8fb77cf87d8bea953158602e5780733`。
- `.env` 备份为 `/data/moss-server/.env.before-webui-0.1.22`；仅将 `MOSS_WEB_IMAGE` 更新到 0.1.22，并重建 `web-gateway`。个人环境、gateway、原 Server 均为 `running / healthy`。
- Server 仍为 `moss-server:181-control-plane-phase2-20261102`，容器 ID 核对未变。

### 验证结果

本轮 56 项定向测试通过；UI 类型/静态检查与 renderer 构建通过。隔离桌面 CDP 已验证 App 生成草稿、待处理跳转、编辑确认与回执、刷新恢复、未知结果查询、CRM 版本冲突，以及 Cron 执行历史和会话跳转。六种创作 App 与真实 PDF 预览回归通过。全仓既有失败记录见上文，未将这些定向结果表述为全仓通过。

CI 验收报告确认：真实浏览器、容器重启、双用户隔离、同一容器多会话、控制器重启、原容器停止/启动、原地升级、坏版本回滚、apt 与 `/etc` 保留均通过；缺失个人容器时不会擅自创建空环境。容器替换后的系统恢复不属于本轮已验证能力。

181 登录后的 Chrome CDP 验收于北京时间 2026-11-04 09:14 完成：

1. 登录网关后，Host API 和环境 API 返回已认证、`ready`、版本 0.1.22。
2. 待处理页面正常展示，按项目/按状态可切换。
3. 业务操作草稿列表、定时任务列表及刷新正常，无错误提示。
4. 浏览器刷新后重新连接同一环境，版本和列表数量一致。
5. 页面异常与请求失败均为 0；截图已检查，页面无布局溢出或遮挡。

真实环境当时待处理项、业务草稿、定时任务均为 0，因此这里只验证空状态、API 与导航；不会把空状态冒烟测试等同于真实渠道执行成功。完整操作路径的证据来自上述隔离 App fixture。

本地证据目录（忽略提交）：`output/webui-181-20261104/`，包含 `validation.json`、`deployment.json`、`image.json`、`ci-result.json`、页面截图及下载的 CI 验收报告。功能闭环证据保留在 `output/work-review-cdp/` 和 `output/creation-desktop-cdp/`。

如需回滚个人程序，在 `/data/moss-server` 执行 `./webui.sh upgrade env-20a7006bd8bd828e8437aa50 ghcr.io/baiguidong/moss-webui:0.1.21`；网关将 `MOSS_WEB_IMAGE` 改回 0.1.21 后执行 `docker compose --env-file .env -f compose.yaml up -d --no-deps web-gateway`。仍使用原个人容器和数据卷。
