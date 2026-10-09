# App Runtime

Moss 只有一种可安装扩展：App。App 可以只有 UI、只有 Backend，或同时包含两者。

## 安装与启用

1. 用户在 Apps 页面选择 `.zip` 包或从应用市场安装。
2. Moss 在执行任何代码前校验 Manifest V2、路径、文件数量、大小和校验和。
3. App 安装后默认启用。有 UI 的 App 自动进入“更多”，每个 App 只有一个导航入口；停用后入口隐藏，纯后台 App 只在 Apps 中管理。
4. 每个 App 只有一个由 Host 管理的 Backend；`persistent` Backend 会在配置就绪后启动。
5. 如果缺少必填配置或密钥，App 仍保持启用，Backend 等待用户补齐配置后自动运行。有设置页的 App 在自己的页面维护配置；其他 App 使用管理页的配置表单。
6. 管理页只保留 App 总开关、运行管理和日志。Host 沿用原有默认 Backend 标识与数据目录，已安装 App 的配置和密钥继续可用。

Skill 从市场或本地包安装后同样默认启用。

App 的 `backend.actions` 供页面调用；只有显式声明在 `contributes.tools` 中的能力才会加入 Moss
AI 助手的工具列表。安装或更新包含 AI 工具的 App 时，安装确认会列出工具名称、用途及操作类型，
即使 App 没有申请额外权限也会展示。Apps 管理页持续展示该列表，以及工具已注册、未授权或 App
已停用的状态。开发工具与 HTTP 调试 App 仅提供页面功能，不注册 AI 工具。

设置 → 工具也按 App 分组展示声明的 AI 工具，包括已停用或尚未授权的工具。此处仅展示，
不提供逐工具的常驻、按需或关闭选项；App 工具统一按需加载，启停和授权仍由 App 管理控制。
工具的按需加载与 Backend 的常驻或按需启动生命周期相互独立。

导航位置统一由 Moss 决定，App 不声明 `contributes.views[].location`，也不提供手动加入侧栏功能。进入 App 时优先使用已授权 view 中 `order` 最小的页面路由；未声明 view 时打开 `ui.entry`。多个页面由 App 内部导航，旧包的位置字段会被忽略。

## App 包

```text
example-app/
├── app.moss.json
├── checksums.json
├── app-signature.json        # 可选 Ed25519 签名
├── assets/
├── schemas/
└── dist/
    ├── ui/index.html
    └── backend/main.mjs
```

`checksums.json` 必须覆盖包内除自身和 `app-signature.json` 以外的每个文件。安装包不能包含软链接、
绝对路径、路径穿越或运行期安装脚本。Backend 的运行依赖必须在构建阶段放入包内。

最小 Manifest V2：

```json
{
  "schemaVersion": 2,
  "id": "example.app",
  "version": "1.0.0",
  "displayName": "Example",
  "hostApi": "^3.0.0",
  "ui": {
    "entry": "dist/ui/index.html"
  },
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "actions": [
      {
        "name": "message.send"
      }
    ],
    "configuration": {
      "schema": "schemas/config.schema.json",
      "secrets": "schemas/secrets.schema.json"
    }
  },
  "permissions": [],
  "host": {
    "protocols": [
      "moss.platform/v1"
    ]
  }
}
```

`host.protocols` 是 App 的 UI 与 Backend 共用的 Host 协议字符串数组。Manifest 加载时只保留当前 Schema 定义的字段。

## 进程与数据

同一个 App 最多运行一个 Backend 进程。重复启动会复用现有进程；重启和升级必须先结束旧进程，再启动新进程。

`on-demand` Backend 在第一个 Action 时启动，无待处理 Action 后按空闲超时退出。`persistent` Backend
在 App 启用且配置有效时常驻，退出 Moss 时有界停止。关闭 App 窗口不会停止 Backend。

Backend 完成本地初始化后发送 `service.ready`，不等待互联网或远端服务连接。断网、服务端不可达和
连接重试属于业务连接状态，通过 `service.status` 上报，并在原进程内重连；不得因此退出 Backend。
`service.ping` / `service.pong` 只检查 Host 与本地 Backend 的 IPC 响应，不依赖远端请求成功。
Host 采样在休眠或长时间阻塞后恢复时，启动握手和心跳检查会给予新的响应窗口，再判断进程是否卡死。

Host 在 `apps-runtime/processes/` 持久化每个 App 的进程所有权：宿主 PID 与启动时间、子进程身份、
本次启动的唯一标识。启动器先等待 Host 保存子进程记录，再加载 App 代码。不同 Host 不能同时持有
同一 App 的所有权；仍有活跃宿主时拒绝重复启动。IPC 断开后允许 App 完成清理，并提供 5 秒退出兜底；
事件循环阻塞时由下次 Host 启动回收。

Host 启动时先恢复这些记录，包括已停用 App 的记录。确认旧宿主已退出后，按启动时间和唯一标识
识别遗留子进程，先发 `SIGTERM`，超时后发 `SIGKILL`，确认结束后才允许新进程访问 App 数据。
这一路径不依赖子进程处理 IPC，因此子进程阻塞时也能在下次 Host 启动时回收。损坏或无法验证的
记录会报告恢复错误并阻止相应 App 重复启动，不会仅凭旧 PID 杀进程。

强杀 Host 后的卡死进程由下一次 Host 启动负责恢复；这不是脱离 Host 常驻的看门狗。所有权记录只
覆盖采用此启动器创建的进程，升级前已遗留且未记录的旧进程仍需单独识别和清理。

```text
~/.moss/apps/<app-id>/versions/<version>/
~/.moss/apps/<app-id>/current.json
~/.moss/apps-data/<app-id>/instances/<instance-id>/
~/.moss/apps-runtime/<app-id>/<instance-id>/
~/.moss/credentials/app-secrets.json
```

已安装版本不可变。配置状态与包分离，密钥只进入加密 Credential Vault。版本升级后只读取新 Schema 声明的配置字段，其他字段不会进入 Backend；已声明字段仍按新 Schema 校验。

## 安全边界

- Electron Main 不直接导入 Backend 模块，而是通过版本化 IPC 协议管理子进程。
- Backend 只收到当前 App 的配置、密钥、数据目录和 runtime 目录。
- App UI 使用 context isolation，不能任意访问文件系统，也不能指定其他 App ID。
- Action 输入、输出、消息大小、超时和并发均受限；日志轮转并对密钥字段和值脱敏。
- Backend 进程不是操作系统级沙箱，只应运行第一方或用户明确信任的包。
