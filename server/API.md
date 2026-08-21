# Moss Server API

本文档描述统一后的 `moss-server` HTTP / WebSocket 接口。

## Overview

统一后的 server 对外只有一个主进程、一个端口、一个 base URL、一个 SQLite 数据库连接。
每个 active session 会有独立 runner 进程承接 Agent runtime。

它同时提供：

- session runtime API
- auth API
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
- `~/.moss/server/admin/dist/`

运行期状态也只落在 server root 的子目录：

- `~/.moss/server/server.json`
- `~/.moss/server/moss-server.db`
- `~/.moss/server/var/lib/`
- `~/.moss/server/var/run/`
- `~/.moss/server/var/log/`
- `~/.moss/server/settings.json`
- `~/.moss/server/skills/`
- `~/.moss/server/assistants/`

服务端模型配置统一写在 `~/.moss/server/settings.json` 的 `models.text` 和 `models.image` 下。服务端执行后端写在 `serverRuntime.backend`，客户端只能指定 `profileMode`。文本模型运行时会注入 `MOSS_MODEL_BASE_URL` / `MOSS_MODEL_AUTH_TOKEN` 给 session runner，配置文件本身不再保存旧的顶级模型字段或模型 env key。

默认 session 目录结构：

- `var/lib/sessions/<sessionId>/workspace/`: `profileMode=session` 的 session 工作目录；不传 `cwd` 且没有服务端默认 workspace 时 host/docker backend 都在这里执行
- `var/lib/workspaces/users/<userId>/`: `profileMode=user` 的用户共享工作目录；同一登录用户的 remote 会话复用该目录
- `var/lib/sessions/<sessionId>/transcripts/`: session transcript JSONL
- `var/lib/profiles/sessions/<sessionId>/`: `profileMode=session` 的独立配置目录
- `var/lib/profiles/users/<userId>/`: `profileMode=user` 的用户共享配置目录
- `var/run/attempts/<sessionId>/<attemptId>/`: 单次 runner attempt 的 manifest、stdout/stderr、status
- `var/run/sockets/<attemptId>.sock`: server 与 runner attach 的本机 socket
- `var/run/docker/manifests/<attemptId>.json`: docker backend 的 stdio manifest

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
  "auth_mode": "local"
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
  "profileMode": "session"
}
```

`cwd` 可选。指定时 server 尊重该路径，并把它作为 `runtime.workspaceDir`。
未指定时 server 会先使用服务端默认 workspace；没有默认 workspace 时，再按
`profileMode` 选择目录：`session` 使用
`~/.moss/server/var/lib/sessions/<sessionId>/workspace`，`user` 使用
`~/.moss/server/var/lib/workspaces/users/<userId>`。

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

## Notes

- `AuthService.verifyAccessToken()` 已经是进程内调用，server 不再反向 fetch 外部 auth-center。
- `admin/dist` 由同一个进程直接挂在 `/admin`。
- 单库模式下，auth / users / api_keys / sessions / runtime events 共用同一个 SQLite 文件。
