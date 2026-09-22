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
- user / org / host 隔离的 App Runtime API
- `/admin` 静态 SPA

仓库开发环境的默认启动入口：

- `bun run server:start`（仓库根目录执行）

`server:start` 会先执行 prepare，再从 `MOSS_SERVER_HOME` 启动 server。

Linux 远端部署使用仓库中的 `deploy/server` Docker Compose 配置，由 Nginx 提供
HTTPS；参见 [`deploy/server/README.md`](../deploy/server/README.md)。

默认 server root：

- `~/.moss/server`
- 可通过 `MOSS_SERVER_HOME=/path/to/server-root` 覆盖

prepare 会把随代码变化的运行产物复制到 server root：

- `~/.moss/server/bin/moss-server.mjs`
- `~/.moss/server/bin/moss-session-runner.mjs`
- `~/.moss/server/apps/`
- `~/.moss/server/admin/dist/`

运行期状态也只落在 server root 的子目录：

- `~/.moss/server/server.json`
- `~/.moss/server/moss-server.db`
- `~/.moss/server/var/lib/`
- `~/.moss/server/var/run/`
- `~/.moss/server/var/log/`
- `~/.moss/server/settings.json`

服务端模型配置统一写在 `~/.moss/server/settings.json` 的 `models.text` 和 `models.image` 下。服务端 session 固定使用 Docker，运行时镜像写在 `serverRuntime.dockerImage`。文本模型运行时会注入 `MOSS_MODEL_BASE_URL` / `MOSS_MODEL_AUTH_TOKEN` 给 session runner，配置文件本身不再保存旧的顶级模型字段或模型 env key。

默认 session 目录结构：

- `var/lib/sessions/<sessionId>/workspace/`: session 独立工作目录；不传 `cwd` 且没有服务端默认 workspace 时 Docker backend 在这里执行
- `var/lib/sessions/<sessionId>/transcripts/`: session transcript JSONL
- `var/lib/profiles/users/<userId>/`: 用户共享 profile/Memory 目录；同一登录用户的所有会话共享 Memory，但不共享 workspace
- `var/lib/sessions/<sessionId>/attempts/<attemptId>/`: 单次 runner attempt 的 manifest、stdout/stderr、status，以及 docker backend 的 stdio manifest
- `var/run/sockets/<attemptId>.sock`: server 与 runner attach 的本机 socket

只准备但不启动：

```bash
bun run server:prepare
```

服务端 session 使用独立 runner 进程承接交互：
`MOSS_SERVER_HOME/bin/moss-session-runner.mjs <manifest>`。
runner 进程内嵌和桌面端 `electron-direct.mjs` 同源的 Agent runtime。
runner 固定在容器内运行 `moss-session-runner.mjs --stdio <manifest>`，
不再支持 Host session，也不依赖 `cli-node.js`。

默认配置文件：

- `~/.moss/server/server.json`
- 可通过 `MOSS_SERVER_CONFIG=/path/to/server.json` 覆盖

**首次启动**：如果配置文件不存在，server 会自动创建一个默认配置文件，包含：

- 监听 `0.0.0.0:43127`
- 本地认证模式 (`auth.mode: local`)
- 默认管理员用户名和密码 `admin` / `password`（首次登录后应立即修改）
- 数据存储在 `~/.moss/server/moss-server.db`

也可以在首次启动前通过 `bootstrapAdmin.password` 覆盖默认密码。

### 远程访问配置

如果 server 需要被远程客户端访问（非本地），需要配置 `advertisedHost`：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 43127,
    "advertisedHost": "10.0.1.179",
    "publicUrl": "https://moss.example.com"
  }
}
```

说明：

- `host`: 监听地址，`0.0.0.0` 表示监听所有接口
- `advertisedHost`: 对外广播的地址，用于 WebSocket URL
- `publicUrl`: HTTPS 反向代理后的公开地址；设置后会优先生成对应的 `wss://` 会话地址
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

## RAGFlow Integration

启用配置示例：

```json
{
  "ragflow": {
    "enabled": true,
    "instanceId": "default",
    "baseUrl": "http://127.0.0.1:80",
    "adminUrl": "http://127.0.0.1:9381",
    "adminEmail": "<RAGFLOW_ADMIN_EMAIL>",
    "userDomain": "ragflow.com",
    "passwordLength": 6,
    "requestTimeoutMs": 15000
  }
}
```

敏感值建议通过服务环境变量注入：

```text
MOSS_RAGFLOW_ADMIN_PASSWORD=<RAGFlow 当前管理员密码；新安装等于 ADMIN_DEFAULT_PASSWORD>
MOSS_RAGFLOW_GATEWAY_TOKEN=<Moss RAG MCP 使用的共享随机令牌>
MOSS_RAGFLOW_USER_DOMAIN=ragflow.com
MOSS_RAGFLOW_PASSWORD_LENGTH=6
```

- `POST /api/v1/integrations/ragflow/resolve`：需要 Moss Bearer 凭据和 `X-Moss-Rag-Gateway-Token`；按需创建当前用户的 RAGFlow 个人账号，并按 `ragflow:read` / `ragflow:manage` 返回 MCP 工具范围。
- `GET /api/v1/integrations/ragflow/status`：读取服务接入状态，需要“管理用户与部门”权限。
- `GET /api/v1/users/:userId/ragflow`：读取用户开户状态，需要“管理用户与部门”权限，并受部门可见范围约束。
- `POST /api/v1/users/:userId/ragflow/provision`：初始化用户个人账号，权限要求同上。
- `POST /api/v1/users/:userId/ragflow/credentials`：查看登录账号、密码和 API Key，需要“查看和轮换知识库凭据”权限。
- `POST /api/v1/users/:userId/ragflow/password`：生成新的 6 位字母密码并同步到 RAGFlow，需要凭据权限。
- `POST /api/v1/users/:userId/ragflow/api-key`：轮换 RAGFlow API Key，需要凭据权限。

每个 Moss 用户对应一个 RAGFlow 个人账号，默认用户名为 `<Moss用户名>@ragflow.com`，域名可配置。密码和 RAGFlow API Key 使用 Moss 凭据主密钥加密保存。第三方客户端不应直接调用 `resolve`；它是 Moss RAG MCP 的内部凭据交换接口。

仓库中的 `deploy/rag` 提供 RAGFlow、Native MCP、Extended MCP 和 Moss RAG MCP 的打包、安装及启停脚本。执行 `deploy/rag/install.sh` 会拉取运行镜像、在目标机编译 Extended MCP 并启动服务。

## App Runtime

Server 只托管通用 App 包、实例、Action 和 Host API，不包含任何具体平台的连接、账号供应或消息逻辑。已知 App 包来自 `server.json` 的 `apps.sourceDir`，客户端不能上传任意可执行包。

默认 owner 为当前认证用户。管理员可用 `owner_scope=org|host` 或 JSON 字段 `ownerScope` 管理组织级、主机级实例；普通用户不能越过自己的 user owner。相同 App ID 与实例 ID 在不同 owner 下完全隔离。

主要接口：

- `GET /api/v1/apps`、`GET /api/v1/apps/:appId`：查看当前 owner 的 App。
- `POST /api/v1/apps/availability`：检查已知包源是否包含指定版本。
- `POST /api/v1/apps/install`：按 App ID 和版本安装已知包。
- `PATCH|DELETE /api/v1/apps/:appId`：启停、授权、切换版本或卸载。
- `GET|POST /api/v1/apps/:appId/instances`：列出或创建实例。
- `PATCH|DELETE /api/v1/apps/:appId/instances/:instanceId`：配置、启停或删除实例。
- `POST /api/v1/apps/:appId/instances/:instanceId/actions/:action`：调用 Action。
- `POST /api/v1/apps/:appId/instances/:instanceId/host`：以该实例身份调用已声明的 Host API。
- `POST /api/v1/apps/:appId/instances/:instanceId/restart`：重启实例。
- `GET /api/v1/apps/:appId/instances/:instanceId/status|logs`：查看状态或日志。

权限拆分如下：

- `apps:read`：查看 App、实例和可用版本。
- `apps:manage`：安装、配置、授权、启停和卸载。
- 内置普通用户和部门管理员默认拥有上述 App 权限，但只能操作自己的 user owner；`org` 和 `host` owner 仍只允许管理员。
- `apps:deploy`：重启和部署运行实例。
- `apps:logs`：读取实例日志。

App 通过 `moss.account/v1` 获取当前 owner 的身份和受权限约束的组织目录，通过 `moss.agent/v1` 使用 Session、Turn 和策略能力。平台专属配置、Secret、用户 ID 映射、SDK 和部署脚本均由对应 App 仓库维护。

## Roles and permissions

- `GET /api/v1/roles`：列出当前组织角色及权限。
- `GET /api/v1/permissions`：返回权限目录、中文名称、说明和分组。
- `POST /api/v1/roles`、`PATCH /api/v1/roles/:roleId`、`DELETE /api/v1/roles/:roleId`：系统管理员维护角色。
- `PUT /api/v1/users/:userId/roles`：系统管理员分配多个角色。

用户有效权限为其所有角色权限的并集。权限写入登录令牌，角色变化后用户重新登录生效；已签发令牌不会实时重算。内置系统管理员角色固定拥有全部权限，内置部门管理员和普通用户角色允许系统管理员调整权限但不能重命名或删除。

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
    "backend": "docker",
    "dockerImage": "moss-runtime:latest",
    "containerName": "optional",
    "profileDir": "/abs/path/profiles/users/user-id",
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
  },
  "runtimeOptions": {
    "model": "claude-sonnet-4-6",
    "fastModel": "claude-haiku-4-5",
    "url": "https://model-gateway.example.com",
    "apiKey": "session-model-token",
    "appendSystemPrompt": "Additional session instructions",
    "maxTurns": 100,
    "thinkingConfig": { "type": "adaptive" },
    "webSearch": { "mode": "auto" },
    "mcpServers": {},
    "environment": {},
    "libraryEnabled": false,
    "coordinatorMode": false,
    "agentMailEnabled": false
  }
}
```

`autoMemory` 可选，作为该 session 的运行时配置持久化并传给 Docker backend；
未传时继承运行环境中的 `MOSS_AUTO_MEMORY_SETTINGS`（JSON）。
`sessionMemory` 同样可选，并可由 `MOSS_SESSION_MEMORY_SETTINGS`（JSON）进行全局覆盖。
所有 session 固定使用用户级共享 Memory，因此 `autoMemory.dreamEnabled` 可以直接
跨同一用户的会话进行聚合。

`runtimeOptions` 可选，用来固定 Desktop 创建该远端会话时的模型、思考、系统提示、
Web Search、MCP 和相关运行设置。该字段可能包含凭据，会持久化用于无重放恢复，但不会
出现在 session 查询响应中。

`cwd` 可选。指定时 server 尊重该路径，并把它作为 `runtime.workspaceDir`。
未指定时 server 会先使用服务端默认 workspace；没有默认 workspace 时，始终使用
`~/.moss/server/var/lib/sessions/<sessionId>/workspace`。同一登录用户的会话共享
Memory，但 workspace 始终按 session 隔离。

Docker backend 不挂载整个 `~/.moss/server`，只挂载当前
`~/.moss/server/var/lib/sessions/<sessionId>`，并额外挂载该用户的共享
profile/Memory 目录，但不会挂载该用户的其他 session 目录。显式传入且不在这些
目录下的 `cwd` 会单独挂载。

示例响应：

```json
{
  "session_id": "uuid",
  "ws_url": "ws://127.0.0.1:43127/ws/sessions/uuid",
  "work_dir": "/abs/path/project",
  "runtime": {
    "backend": "docker",
    "dockerImage": "moss-runtime:latest",
    "profileDir": "/abs/path/profiles/users/user-id",
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
列表中的每条 session 还包含 `originChannel`：App Channel 创建的会话使用
`app:<appId>`，其他会话为 `desktop`。Desktop 用这个字段同步和分组 Server App 会话。

### GET `/api/v1/sessions/:sessionId`

返回单个 session；当 `desiredState=active` 时会确保 runtime attempt 可 attach。

### GET `/api/v1/sessions/:sessionId/workspace/list?dir=<path>`

列出 session workspace 内的目录。`dir` 可传相对路径，也可传 workspace 内的绝对路径；未传时列出 workspace root。

### GET `/api/v1/sessions/:sessionId/workspace/read?file=<path>`

读取 session workspace 内的文件预览。`file` 可传相对路径，也可传 workspace 内的绝对路径；超过预览大小或二进制文件会返回不可编辑预览信息。

### GET/PUT `/api/v1/sessions/:sessionId/workspace/content?file=<path>`

GET 流式读取 workspace 文件原始内容；PUT 原子写回一个已有目录中的文件。单次写入上限为 250 MB。

### POST `/api/v1/sessions/:sessionId/workspace/upload?name=<fileName>`

将请求体流式保存到 workspace 的 `inputs/` 目录，并返回文件预览元数据。服务端会清理文件名并生成唯一后缀，单次上传上限为 250 MB。

### GET `/api/v1/sessions/:sessionId/memory`

读取该会话的 session-memory 摘要；尚未生成时返回 `exists: false`。

### GET/PUT `/api/v1/profile/skills`

GET 返回当前用户由 Desktop 同步的技能版本；PUT 接收 ZIP，请求头
`X-Moss-Content-SHA256` 可携带 `sha256:<hex>` 完整性校验。ZIP 中每个文件必须位于
`<skillName>/...` 下，只会清理上一版由 Desktop 管理的文件。

### GET `/api/v1/profile/memory`

列出当前用户的全局 Memory 文件及其 session 摘要元数据。

### GET `/api/v1/profile/memory/read?file=<path>`

读取当前用户的一项 Markdown 全局记忆，单文件展示上限为 512 KB。

### POST `/api/v1/sessions/:sessionId/resume`

确保 session 当前 runtime 可恢复，并返回新的 `ws_url`。

### POST `/api/v1/sessions/:sessionId/terminate`

终止 session。

这是状态变更，不是删除。

### WS `/ws/sessions/:sessionId`

会话 WebSocket attach 路径。

需要 `Authorization: Bearer <token>` header。

`/compact` 与普通用户消息走同一条 WebSocket 通道。Desktop 在模型返回
`Prompt is too long` 时也可先发送一次 `/compact`，收到 `compact_boundary` 后再重试
原消息；恢复或重连不会重放这两个请求。

## Apps API

App 是唯一的可安装扩展类型。用户通过 Desktop App Center 调用这些接口，不需要使用 Moss 命令行。Server 只从 `server.json` 的 `apps.sourceDir` 获取管理员预先放置的已知 App 版本，不接受任意代码上传。

installation、instance、deployment、密钥、数据和日志都按 owner 隔离。默认是当前认证用户的 `user` scope；请求可用 `owner_scope=org|host` 查询参数，带 JSON body 的请求也可用 `ownerScope`。`org` 和 `host` 只允许管理员选择。

权限：

- `apps:read`：查看 App、实例和状态。
- `apps:manage`：安装、启停、配置、创建/删除实例和卸载。
- `apps:invoke`：调用已启用实例的 Action 和 Host API。
- `apps:deploy`：重启和部署实例。
- `apps:logs`：读取实例日志。
- `*`：包含以上全部权限。

### GET `/api/v1/apps`

返回 Server 已安装 App、Manifest、配置 schema、实例、deployment 和观察到的进程状态。需要 `apps:read`。

### POST `/api/v1/apps/install`

```json
{ "appId": "example.app", "version": "1.0.0", "activate": true, "grants": ["example:read"] }
```

Server 从可信包源获取并完整校验指定身份的包。新安装默认 grants 为空；传入的 grant 必须是 Manifest `permissions` 的子集。更新版本只有在 `activate: true` 时切换；启动仍取决于 App 和实例开关。需要 `apps:manage`。

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

请求体为 `{ "input": ..., "timeoutMs": 30000 }`。Action 必须在 Manifest 中声明，输入和输出按声明的 JSON Schema 校验。需要 `apps:invoke`。

### GET `/api/v1/apps/:appId/instances/:instanceId/status`

返回指定实例的 deployment 与进程状态。需要 `apps:read`。

### POST `/api/v1/apps/:appId/instances/:instanceId/host`

请求体为 `{ "protocol": "moss.agent/v1", "method": "binding.get", "input": {} }`。
供受信任的 Desktop App UI 调用该 Server 实例已声明并获授权的 Host API；仍执行 App
Manifest、grant、owner 和实例边界校验。需要 `apps:invoke`。

### GET `/api/v1/apps/:appId/instances/:instanceId/logs?limit=500`

返回轮转、限量并脱敏的实例日志。需要 `apps:logs`。

更完整的安装、包结构和 Desktop/Server 部署说明见 `ui/docs/app-runtime.md`。

## Notes

- `AuthService.verifyAccessToken()` 已经是进程内调用，server 不再反向 fetch 外部 auth-center。
- `admin/dist` 由同一个进程直接挂在 `/admin`。
- 单库模式下，auth / users / api_keys / sessions / runtime events 共用同一个 SQLite 文件。
