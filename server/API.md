# Moss Server API

本文档描述统一后的 `moss-server` HTTP / WebSocket 接口。

## Overview

统一后的 server 对外只有一个主进程、一个端口、一个 base URL、一个 SQLite 数据库连接。
每个 active session 会有独立 runner 进程承接 Agent runtime。

它同时提供：

- session runtime API
- auth API
- 内置窗口登录授权与永久 API Key 交换
- users / api keys 管理 API
- `/admin` 静态 SPA

默认启动入口：

- `bun run server:start`（仓库根目录执行）

`server:start` 会先执行 prepare，再从 `MOSS_SERVER_HOME` 启动 server。

默认 server root：

- `~/.moss/server`
- 可通过 `MOSS_SERVER_HOME=/path/to/server-root` 覆盖

prepare 会把随代码变化的运行产物复制到 server root：

- `~/.moss/server/bin/moss-server.mjs`
- `~/.moss/server/bin/moss-session-runner.mjs`
- `~/.moss/server/adapters/feishu.mjs`
- `~/.moss/server/admin/dist/`

运行期状态也只落在 server root 的子目录：

- `~/.moss/server/server.json`
- `~/.moss/server/moss-server.db`
- `~/.moss/server/var/lib/`
- `~/.moss/server/var/run/`
- `~/.moss/server/var/log/`
- `~/.moss/server/settings.json`

服务端模型配置统一写在 `~/.moss/server/settings.json` 的 `models.text` 和 `models.image` 下。服务端执行后端写在 `serverRuntime.backend`，客户端只能指定 `profileMode`。文本模型运行时会注入 `MOSS_MODEL_BASE_URL` / `MOSS_MODEL_AUTH_TOKEN` 给 session runner，配置文件本身不再保存旧的顶级模型字段或模型 env key。

默认 session 目录结构：

- `var/lib/sessions/<sessionId>/workspace/`: session 独立工作目录；不传 `cwd` 且没有服务端默认 workspace 时 host/docker backend 都在这里执行，与 `profileMode` 无关
- `var/lib/sessions/<sessionId>/profile/`: `profileMode=session` 的独立 profile/Memory 目录
- `var/lib/sessions/<sessionId>/transcripts/`: session transcript JSONL
- `var/lib/profiles/users/<userId>/`: `profileMode=user` 的用户共享 profile/Memory 目录；同一登录用户的会话共享 Memory，但不共享 workspace
- `var/lib/sessions/<sessionId>/attempts/<attemptId>/`: 单次 runner attempt 的 manifest、stdout/stderr、status，以及 docker backend 的 stdio manifest
- `var/run/sockets/<attemptId>.sock`: server 与 runner attach 的本机 socket

只准备但不启动：

```bash
bun run server:prepare
```

服务端 session 使用独立 runner 进程承接交互：
`MOSS_SERVER_HOME/bin/moss-session-runner.mjs <manifest>`。
runner 进程内嵌和桌面端 `electron-direct.mjs` 同源的 Agent runtime。
host 模式直接在本机 runner 内运行 Agent；docker 模式在容器内运行
`moss-session-runner.mjs --stdio <manifest>`，不再依赖 `cli-node.js`。

默认配置文件：

- `~/.moss/server/server.json`
- 可通过 `MOSS_SERVER_CONFIG=/path/to/server.json` 覆盖

**首次启动**：如果配置文件不存在，server 会自动创建一个默认配置文件，包含：

- 监听 `0.0.0.0:43127`
- 本地认证模式 (`auth.mode: local`)
- 默认管理员用户名 `admin`（密码需手动设置）
- 数据存储在 `~/.moss/server/moss-server.db`

启动后会提示编辑配置文件设置 `bootstrapAdmin.password`。

### 远程访问配置

如果 server 需要被远程客户端访问（非本地），需要配置 `advertisedHost`：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 43127,
    "advertisedHost": "10.0.1.179"
  }
}
```

说明：

- `host`: 监听地址，`0.0.0.0` 表示监听所有接口
- `advertisedHost`: 对外广播的地址，用于 WebSocket URL
- 如果不设置 `advertisedHost`，当 `host` 为 `0.0.0.0` 或 `::` 时，WebSocket URL 会使用 `127.0.0.1`，导致远程客户端无法连接

首次初始化 admin 可直接从配置文件读取：

```json
{
  "bootstrapAdmin": {
    "username": "admin",
    "password": "ChangeMe123!",
    "email": "admin@example.com"
  }
}
```

说明：

- `username` 用于 `/admin` 登录
- `password` 仅在数据库首次初始化时生效
- `email` 可选；不填时会自动生成一个本地占位邮箱

### 内置窗口认证（零配置）

Moss Server 自身提供浏览器登录授权，不连接外部 OAuth/OIDC 提供方，因此无需配置 authorization URL、client ID、client secret 或固定 Server callback。

桌面客户端在“设置 → 远端”填写 Server 地址并点击“认证”后，会启动临时本地 callback listener，生成 `state` 和 PKCE verifier/challenge，再通过隔离的 Moss 认证窗口打开 Server 登录页。用户使用已有 Moss Server 账号登录，Server 将一次性 authorization code 重定向到客户端回环地址，客户端换取永久 API Key 并加密保存。

授权请求和一次性 authorization code 保存在 AuthCenter SQLite 中，分别有效 10 分钟和 2 分钟，可跨 Server 进程重启和多实例请求切换。桌面客户端认证期间，原“认证”按钮会变为“取消”，点击后立即关闭本地 callback 并解除认证状态。

Server 只接受 `http://127.0.0.1:<动态端口>/callback` 或 IPv6 回环地址，拒绝外部 callback。远端 Server 登录页应通过 HTTPS 提供；只有本机 Server 可以使用 HTTP。

## Base URL

示例：

```text
http://127.0.0.1:43127
```

`cc://` 连接串也收敛成单地址模式：

```text
cc://127.0.0.1:43127
```

## Auth

除以下路径外，其他接口都要求：

```text
Authorization: Bearer <access_token>
```

无需鉴权的路径：

- `GET /healthz`
- `GET /readyz`
- `GET /admin`
- `GET /admin/*`
- `POST /api/v1/auth/token`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/introspect`
- `POST /api/v1/auth/oauth/start`
- `POST /api/v1/auth/oauth/cancel`
- `GET /api/v1/auth/oauth/authorize/:transactionId`
- `POST /api/v1/auth/oauth/authorize`
- `POST /api/v1/auth/oauth/exchange`

失败格式统一为：

```json
{ "error": "..." }
```

## Health

## Client Config

### GET `/api/v1/bootstrap`

返回客户端启动配置。当前为兼容空实现：

```json
{
  "client_data": null,
  "additional_model_options": []
}
```

### GET `/api/v1/settings/remote-managed`

返回远程托管 settings。当前为兼容空实现：

```json
{
  "uuid": "org-id:default",
  "checksum": "sha256:...",
  "settings": {}
}
```

### GET `/api/v1/policy-limits`

返回组织策略限制。当前为兼容空实现：

```json
{
  "restrictions": {}
}
```

### GET `/healthz`

存活检查。

示例响应：

```json
{
  "ok": true,
  "ready": true,
  "sessions": 2,
  "auth_mode": "local",
  "oauth_enabled": true
}
```

### GET `/readyz`

就绪检查。

示例响应：

```json
{
  "ok": true,
  "ready": true
}
```

飞书凭据不在 Admin UI 或 Server 配置文件中编辑。Desktop 是唯一配置入口，
并通过以下托管接口选择让 Adapter 运行在本机或长期在线的 Moss Server。

## Feishu Runtime

所有接口只操作当前认证用户的飞书实例。Server 不提供读取或修改飞书密钥的配置接口。

- `GET /api/v1/adapters/feishu/status`：查询 Server 托管实例状态；需要 `sessions:create` scope。
- `POST /api/v1/adapters/feishu/start`：由 Desktop 推送完整配置快照并启动；需要 `sessions:create`、`sessions:list`、`sessions:attach` scope。
- `POST /api/v1/adapters/feishu/stop`：停止 Server 托管实例；需要 `sessions:create` scope。

Server 会记住由 Desktop 启用的托管实例并在自身重启后恢复。Desktop 切换运行位置时会先停止另一端，确保本机和 Server 不会同时连接同一个飞书应用。

## Admin UI

### GET `/admin`

返回 `admin/dist/index.html`。

### GET `/admin/*`

静态资源直接返回；非文件路径会做 SPA fallback，统一回到 `index.html`。

## Auth API

### POST `/api/v1/auth/token`

密码或 API key 登录，返回 access token。

密码登录：

```json
{
  "grant_type": "password",
  "username": "admin",
  "password": "secret"
}
```

兼容旧客户端，`email` 登录仍然可用。

API key 登录：

```json
{
  "grant_type": "api_key",
  "api_key": "moss_sk_xxx.yyy"
}
```

示例响应：

```json
{
  "access_token": "jwt",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user": {
    "id": "user-id",
    "orgId": "org-id",
    "email": "admin@example.com",
    "name": "Admin",
    "role": "admin",
    "status": "active",
    "createdAt": 0,
    "passwordUpdatedAt": 0,
    "lastLoginAt": 0
  },
  "organization": {
    "id": "org-id",
    "name": "Default Organization",
    "createdAt": 0
  },
  "scopes": ["*"]
}
```

### POST `/api/v1/auth/login`

`/api/v1/auth/token` 的等价别名。

### POST `/api/v1/auth/oauth/start`

客户端创建回环 callback，生成随机 `state` 和 PKCE S256 challenge 后发起登录：

```json
{
  "redirect_uri": "http://127.0.0.1:54321/callback",
  "state": "43-character-client-state",
  "code_challenge": "base64url-sha256-challenge",
  "code_challenge_method": "S256"
}
```

Server 返回站内授权页地址：

```json
{
  "authorization_url": "/api/v1/auth/oauth/authorize/<transaction_id>",
  "expires_in": 600
}
```

客户端必须使用配置的 Server origin 解析相对地址，并通过独立的 Moss 认证窗口打开。认证窗口使用临时隔离会话，不开放 Node.js、弹窗、下载或网站权限，只允许当前 Server 授权页和本机一次性 callback 之间的顶层导航。授权页 CSP 也只额外允许当前事务绑定的精确 callback，事务 ID 只位于 URL path 中。

### POST `/api/v1/auth/oauth/cancel`

客户端取消、超时或无法打开认证窗口时，使用原始 `state`、`redirect_uri`，以及已经收到时的一次性 `code`，回收尚未完成的授权请求或授权码。即使 callback 没有把 code 送达客户端，Server 也能通过 `state + redirect_uri` 回收已经签发的 code。接口幂等返回 `{ "canceled": true|false }`，不会触发额外跳转。

### GET/POST `/api/v1/auth/oauth/authorize`

`GET` 返回 Moss Server 登录授权页。用户提交现有用户名或邮箱及密码后，`POST` 校验账号并返回 HTTP `303`，认证窗口跳转到客户端的回环 callback：

```text
http://127.0.0.1:54321/callback?code=<one-time-code>&state=<client-state>
```

用户取消时 callback 包含 `error=access_denied`。authorization code 两分钟内有效，只能使用一次；登录请求最多允许五次密码尝试。

### POST `/api/v1/auth/oauth/exchange`

客户端校验 callback 中的 `state` 后，提交 code、原始 PKCE verifier 和相同 callback：

```json
{
  "code": "one-time-code",
  "code_verifier": "client-pkce-verifier",
  "redirect_uri": "http://127.0.0.1:54321/callback"
}
```

验证完成后返回 HTTP `200`，永久 API Key 只在这一次响应中返回：

```json
{
  "api_key": "moss_sk_xxx.yyy",
  "key": {
    "id": "key-id",
    "name": "oauth:browser-login",
    "scopes": ["sessions:create", "sessions:attach", "sessions:list"],
    "status": "active"
  },
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "role": "user"
  },
  "organization": {
    "id": "org-id",
    "name": "Default Organization"
  },
  "scopes": ["sessions:create", "sessions:attach", "sessions:list"]
}
```

API Key 无自动过期时间，服务端只存哈希，可通过现有 `DELETE /api/v1/api-keys/:keyId` 撤销。同一用户再次通过浏览器认证会轮换 Key，并立即撤销上一次浏览器登录签发的 Key。客户端随后可使用新 Key 调用 `POST /api/v1/auth/token` 获取短期 access token，或直接作为 Bearer 凭据访问 Server。

### GET `/api/v1/auth/me`

返回当前 token 对应用户信息。

### POST `/api/v1/auth/introspect`

可选外部接口，内部不再通过 HTTP 调它。

请求：

```json
{ "token": "jwt" }
```

示例响应：

```json
{
  "active": true,
  "sub": "user-id",
  "org_id": "org-id",
  "role": "admin",
  "scopes": ["*"],
  "key_id": "password-login"
}
```

## Users API

### GET `/api/v1/roles`

需要 scope：`admin:users`

返回固定角色定义：`admin / dept_admin / user`。

## Departments API

### GET `/api/v1/departments`

需要 scope：`admin:users`

返回当前组织下的部门列表，前端可据此构建层级树。

### POST `/api/v1/departments`

需要 scope：`admin:users`

请求：

```json
{
  "name": "研发中心",
  "parent_id": null
}
```

### PATCH `/api/v1/departments/:departmentId`

需要 scope：`admin:users`

支持字段：

```json
{
  "name": "平台研发部",
  "parent_id": "parent-department-id"
}
```

### DELETE `/api/v1/departments/:departmentId`

需要 scope：`admin:users`

仅允许删除没有子部门且没有用户归属的部门。

### GET `/api/v1/users`

需要 scope：`admin:users`

### POST `/api/v1/users`

需要 scope：`admin:users`

请求：

```json
{
  "name": "Member",
  "department_id": "department-id",
  "role": "user",
  "password": "Passw0rd!"
}
```

`email` 现在是可选字段。

### PATCH `/api/v1/users/:userId`

需要 scope：`admin:users`

支持字段：

```json
{
  "name": "Updated Name",
  "department_id": "department-id",
  "role": "dept_admin",
  "status": "active"
}
```

### POST `/api/v1/users/:userId/password`

需要 scope：`admin:users`

请求：

```json
{
  "password": "NewPassw0rd!"
}
```

### GET `/api/v1/users/:userId/sessions`

需要 scope：`admin:users`

返回该用户在当前 org 下的 session 列表。

## API Keys API

### GET `/api/v1/api-keys`

需要 scope：`admin:api_keys`

### POST `/api/v1/api-keys`

需要 scope：`admin:api_keys`

请求：

```json
{
  "user_id": "user-id",
  "name": "service-key",
  "scopes": ["sessions:create", "sessions:list"]
}
```

示例响应：

```json
{
  "api_key": {
    "id": "key-id",
    "orgId": "org-id",
    "userId": "user-id",
    "name": "service-key",
    "prefix": "moss_sk_xxx",
    "scopes": ["sessions:create", "sessions:list"],
    "status": "active",
    "createdAt": 0,
    "lastUsedAt": null
  },
  "plain_text_key": "moss_sk_xxx.yyy"
}
```

### DELETE `/api/v1/api-keys/:keyId`

需要 scope：`admin:api_keys`

逻辑上是 revoke，不会物理删除行。

## Sessions API

### Session shape

```json
{
  "sessionId": "uuid",
  "transcriptSessionId": "uuid",
  "workDir": "/abs/path/project",
  "userId": "user-id",
  "orgId": "org-id",
  "role": "user",
  "scopes": ["sessions:create", "sessions:attach", "sessions:list"],
  "runtime": {
    "backend": "host",
    "profileMode": "session",
    "dockerImage": "optional",
    "containerName": "optional",
    "profileDir": "/abs/path/profile",
    "transcriptDir": "/abs/path/session/transcripts",
    "workspaceDir": "/abs/path/workspace"
  },
  "status": "creating|active|detached|ended|terminated|failed|lost",
  "desiredState": "active|ended|terminated",
  "title": "飞书会话",
  "summary": null,
  "createdAt": 0,
  "lastActiveAt": 0,
  "endedAt": null
}
```

### POST `/api/v1/sessions`

需要 scope：`sessions:create`

请求：

```json
{
  "cwd": "/abs/path/project",
  "dangerously_skip_permissions": true,
  "profileMode": "session",
  "autoMemory": {
    "enabled": true,
    "extractionEnabled": true,
    "extractionIntervalTurns": 1,
    "pastContextSearchEnabled": true,
    "dreamEnabled": true,
    "dreamMinHours": 24,
    "dreamMinSessions": 5
  },
  "sessionMemory": {
    "enabled": true,
    "compactEnabled": true,
    "minimumMessageTokensToInit": 10000,
    "minimumTokensBetweenUpdate": 5000,
    "toolCallsBetweenUpdates": 3,
    "compactMinTokens": 10000,
    "compactMinTextBlockMessages": 5,
    "compactMaxTokens": 40000
  }
}
```

`autoMemory` 可选，作为该 session 的运行时配置持久化并传给 host/docker backend；
未传时继承运行环境中的 `MOSS_AUTO_MEMORY_SETTINGS`（JSON）。
`sessionMemory` 同样可选，并可由 `MOSS_SESSION_MEMORY_SETTINGS`（JSON）进行全局覆盖。
启用 `autoMemory.dreamEnabled` 时必须使用 `profileMode=user`，确保多会话共享同一份
Memory；服务端会拒绝无法达到跨会话门槛的 `profileMode=session` 组合。

`cwd` 可选。指定时 server 尊重该路径，并把它作为 `runtime.workspaceDir`。
未指定时 server 会先使用服务端默认 workspace；没有默认 workspace 时，始终使用
`~/.moss/server/var/lib/sessions/<sessionId>/workspace`。`profileMode` 不参与
workspace 选择，只控制 profile/Memory 范围：`session` 完全独立，`user` 在同一登录
用户的会话间共享 Memory。

Docker backend 不挂载整个 `~/.moss/server`，只挂载当前
`~/.moss/server/var/lib/sessions/<sessionId>`。`profileMode=user` 时额外挂载该用户的
共享 profile/Memory 目录，但不会挂载该用户的其他 session 目录。显式传入且不在这些
目录下的 `cwd` 会单独挂载。

示例响应：

```json
{
  "session_id": "uuid",
  "ws_url": "ws://127.0.0.1:43127/ws/sessions/uuid",
  "work_dir": "/abs/path/project",
  "runtime": {
    "backend": "host",
    "profileMode": "session",
    "profileDir": "/abs/path/profile",
    "transcriptDir": "/abs/path/session/transcripts",
    "workspaceDir": "/abs/path/workspace"
  }
}
```

### GET `/api/v1/sessions`

需要 scope：

- `sessions:list`
- 或 `sessions:list:any`

查询参数：

- `active_only=true`

有 `sessions:list:any` 时可看当前 org 的全部 session；否则只看自己的。
列表中的每条 session 还包含 `originChannel`：由 Server 飞书 Adapter 创建的会话为
`feishu`，其他会话为 `desktop`。Desktop 用这个字段同步和分组 Server 飞书会话。

### GET `/api/v1/sessions/:sessionId`

返回单个 session；当 `desiredState=active` 时会确保 runtime attempt 可 attach。

### GET `/api/v1/sessions/:sessionId/workspace/list?dir=<path>`

列出 session workspace 内的目录。`dir` 可传相对路径，也可传 workspace 内的绝对路径；未传时列出 workspace root。

### GET `/api/v1/sessions/:sessionId/workspace/read?file=<path>`

读取 session workspace 内的文件预览。`file` 可传相对路径，也可传 workspace 内的绝对路径；超过预览大小或二进制文件会返回不可编辑预览信息。

### POST `/api/v1/sessions/:sessionId/resume`

确保 session 当前 runtime 可恢复，并返回新的 `ws_url`。

### POST `/api/v1/sessions/:sessionId/terminate`

终止 session。

这是状态变更，不是删除。

### WS `/ws/sessions/:sessionId`

会话 WebSocket attach 路径。

需要 `Authorization: Bearer <token>` header。

## Apps API

App 是唯一的可安装扩展类型。用户通过 Desktop App Center 调用这些接口，不需要使用 Moss 命令行。Server 只从 `server.json` 的 `apps.sourceDir` 获取管理员预先放置的已知 App 版本，不接受任意代码上传。

权限：

- `apps:read`：查看 App、实例和状态。
- `apps:manage`：安装、启停、配置、创建/删除实例和卸载。
- `apps:deploy`：调用 Action 和重启实例。
- `apps:logs`：读取实例日志。
- `*`：包含以上全部权限。

### GET `/api/v1/apps`

返回 Server 已安装 App、Manifest、配置 schema、实例、deployment 和观察到的进程状态。需要 `apps:read`。

### POST `/api/v1/apps/install`

```json
{ "appId": "example.app", "version": "1.0.0", "activate": true }
```

Server 从可信包源获取并完整校验指定身份的包。更新版本只有在 `activate: true` 时切换；启动仍取决于 App 和实例开关。需要 `apps:manage`。

### POST `/api/v1/apps/availability`

```json
{ "packages": [{ "appId": "example.app", "version": "1.0.0" }] }
```

批量检查可信包源中指定版本是否存在、完整有效并声明支持 Server；结果按输入顺序返回，并包含 `available` 及失败时的 `reason`。单次最多检查 200 个版本。需要 `apps:read`。

### GET `/api/v1/apps/:appId`

返回一个 App 的完整运行状态。需要 `apps:read`。

### PATCH `/api/v1/apps/:appId`

可提交 `enabled` 或 `activeVersion`。版本激活失败会自动回滚。需要 `apps:manage`。

### DELETE `/api/v1/apps/:appId`

查询参数 `delete_data=true` 和 `delete_credentials=true` 分别控制数据与密钥删除；默认都保留。需要 `apps:manage`。

### GET/POST `/api/v1/apps/:appId/instances`

列出或创建实例。创建体可包含 `id`、`displayName`、`config`、`secrets` 和 `enabled`。读取需要 `apps:read`，创建需要 `apps:manage`。

### PATCH/DELETE `/api/v1/apps/:appId/instances/:instanceId`

更新实例名称、配置、密钥或开关，或删除多实例 App 的实例。停用实例后可提交 `clearCredentials: true` 清除单实例来源密钥。删除同样使用 `delete_data` 和 `delete_credentials` 查询参数，默认保留。需要 `apps:manage`。

### POST `/api/v1/apps/:appId/instances/:instanceId/restart`

清除当前 crash-loop 计数并重启本节点拥有的实例。需要 `apps:deploy`。

### POST `/api/v1/apps/:appId/instances/:instanceId/actions/:action`

请求体为 `{ "input": ..., "timeoutMs": 30000 }`。Action 必须在 Manifest 中声明，输入和输出按声明的 JSON Schema 校验。需要 `apps:deploy`。

### GET `/api/v1/apps/:appId/instances/:instanceId/logs?limit=500`

返回轮转、限量并脱敏的实例日志。需要 `apps:logs`。

更完整的安装、包结构和 Desktop/Server 部署说明见 `ui/docs/app-runtime.md`。

## Notes

- `AuthService.verifyAccessToken()` 已经是进程内调用，server 不再反向 fetch 外部 auth-center。
- `admin/dist` 由同一个进程直接挂在 `/admin`。
- 单库模式下，auth / users / api_keys / sessions / runtime events 共用同一个 SQLite 文件。
