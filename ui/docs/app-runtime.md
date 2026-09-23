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
  "hostApi": "^2.1.0",
  "ui": { "entry": "dist/ui/index.html" },
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "protocols": ["moss.platform/v1"],
    "actions": [{ "name": "message.send" }],
    "configuration": {
      "schema": "schemas/config.schema.json",
      "secrets": "schemas/secrets.schema.json"
    }
  },
  "permissions": []
}
```

`backend.protocols` 是 Backend 使用的 Host 协议字符串数组。Manifest 加载时只保留当前 Schema 定义的字段。

## 进程与数据

同一个 App 最多运行一个 Backend 进程。重复启动会复用现有进程；重启和升级必须先结束旧进程，再启动新进程。

`on-demand` Backend 在第一个 Action 时启动，无待处理 Action 后按空闲超时退出。`persistent` Backend
在 App 启用且配置有效时常驻，退出 Moss 时有界停止。关闭 App 窗口不会停止 Backend。

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
