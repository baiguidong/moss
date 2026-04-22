# Direct Connect 使用说明

这份文档说明 Moss 当前补齐的远程 Direct Connect 能力怎么用、内部是怎么工作的，以及 Electron/UI 侧应该怎么接。

## 1. 适用场景

适合这类拆分方式：

- 客户端 UI 在用户电脑上运行。
- Agent/Claude Code 执行逻辑放在远端服务器。
- 前端或 Electron 主进程通过 HTTP + WebSocket 连接远端。
- 每次新建会话时，由远端服务拉起一个独立的 `cli-node.js` 子进程处理该会话。

当前实现不是“一个常驻 agent 进程服务所有请求”，而是：

- 1 个 server 监听端口。
- `POST /sessions` 时新建 1 个 session。
- 每个 session 对应 1 个独立 `cli-node.js` 子进程。
- 客户端通过 websocket 和这个 session 通信。

## 2. 架构概览

核心流程如下：

1. 启动 `direct-connect-server.mjs`。
2. 服务监听 HTTP 端口。
3. 客户端请求 `POST /sessions`。
4. 服务端为该 session `spawn` 一个新的 `cli-node.js --print --input-format stream-json --output-format stream-json` 子进程。
5. 服务返回：
   - `session_id`
   - `ws_url`
   - `work_dir`
6. 客户端连接 `ws_url`。
7. 客户端把用户消息按 NDJSON 发到 websocket。
8. 服务端转发给子进程 stdin。
9. 子进程 stdout 的 NDJSON 再转发回 websocket。

对应代码：

- 服务启动封装: [src/server/startStandaloneServer.ts](/Users/bgd/repo/moss/src/server/startStandaloneServer.ts)
- HTTP + WS 服务: [src/server/server.ts](/Users/bgd/repo/moss/src/server/server.ts)
- session 管理: [src/server/sessionManager.ts](/Users/bgd/repo/moss/src/server/sessionManager.ts)
- 子进程 backend: [src/server/backends/dangerousBackend.ts](/Users/bgd/repo/moss/src/server/backends/dangerousBackend.ts)
- 客户端创建 session: [src/server/createDirectConnectSession.ts](/Users/bgd/repo/moss/src/server/createDirectConnectSession.ts)
- 客户端 websocket 管理: [src/server/directConnectManager.ts](/Users/bgd/repo/moss/src/server/directConnectManager.ts)

## 3. 先编译

在仓库根目录执行：

```bash
bun run build:node
```

会生成这些产物：

- `cli-node.js`
- `electron-direct.mjs`
- `direct-connect-server.mjs`
- `direct-connect-open.mjs`

其中：

- `direct-connect-server.mjs` 是独立服务端入口。
- `direct-connect-open.mjs` 是独立 headless 客户端入口。

## 4. 启动服务端

最简单的启动方式：

```bash
node direct-connect-server.mjs --host 0.0.0.0 --port 43127
```

也可以显式指定 token：

```bash
node direct-connect-server.mjs \
  --host 0.0.0.0 \
  --port 43127 \
  --auth-token your-token
```

支持参数：

- `--host <host>`: 监听地址，默认 `0.0.0.0`
- `--port <number>`: 监听端口，默认 `0`
- `--auth-token <token>`: Bearer token；不传则自动生成
- `--workspace <dir>`: 默认工作目录
- `--idle-timeout <ms>`: session 空闲超时，默认 `600000`
- `--max-sessions <n>`: 最大并发 session 数，默认 `32`

启动后会打印：

- HTTP 地址
- `cc://` 连接串

例如：

```text
Claude Code session server started.
HTTP: http://0.0.0.0:43127
Connect: cc://127.0.0.1:43127?token=...
```

说明：

- 当监听地址是 `0.0.0.0` 时，打印出来的 `cc://` 会用 `127.0.0.1` 作为默认展示地址。
- 真正部署到远端服务器时，客户端应该把 `127.0.0.1` 换成真实服务器域名或 IP。

## 5. 服务端内部行为

当前 server 的行为是：

- `GET /health`
  - 只做健康检查
  - 不会创建子进程
- `POST /sessions`
  - 会新建一个 session
  - 会启动一个独立的 `cli-node.js` 子进程
- `GET/WS /sessions/:id/ws`
  - 只是附着到已存在的 session
  - 不会再创建新进程

也就是说，不是“任意请求都起进程”，而是“创建 session 时起进程”。

## 6. HTTP 接口

### 6.1 健康检查

请求：

```http
GET /health
```

返回示例：

```json
{
  "ok": true,
  "sessions": 0
}
```

### 6.2 创建 session

请求：

```http
POST /sessions
Authorization: Bearer your-token
Content-Type: application/json
```

Body：

```json
{
  "cwd": "/path/to/workdir",
  "dangerously_skip_permissions": true
}
```

返回：

```json
{
  "session_id": "uuid",
  "ws_url": "ws://host:port/sessions/uuid/ws",
  "work_dir": "/path/to/workdir"
}
```

说明：

- `cwd` 可选。
- 如果不传 `cwd`，服务端会使用 `--workspace` 或当前进程目录。
- `dangerously_skip_permissions` 为 `true` 时，会给子进程追加 `--dangerously-skip-permissions`。

## 7. WebSocket 协议

websocket 地址格式：

```text
ws://host:port/sessions/<session_id>/ws
```

连接时需要带 Bearer token。

消息格式是 NDJSON，每行一个 JSON。

### 7.1 用户消息

客户端发送：

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "hello"
  },
  "parent_tool_use_id": null,
  "session_id": ""
}
```

### 7.2 权限响应

客户端发送：

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "xxx",
    "response": {
      "behavior": "allow"
    }
  }
}
```

或拒绝：

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "xxx",
    "response": {
      "behavior": "deny",
      "message": "Denied by user"
    }
  }
}
```

### 7.3 中断

客户端发送：

```json
{
  "type": "control_request",
  "request_id": "uuid",
  "request": {
    "subtype": "interrupt"
  }
}
```

### 7.4 服务端返回

服务端会转发子进程输出，例如：

- `system/init`
- `assistant`
- `result`
- `control_request`

其中：

- `control_request` 通常是远端发起的权限请求。
- `assistant` 和 `result` 是主要业务消息。

## 8. 独立命令行使用

### 8.1 启动服务

```bash
node direct-connect-server.mjs --host 0.0.0.0 --port 43127
```

### 8.2 headless 调用远端

```bash
node direct-connect-open.mjs \
  'cc://server-host:43127?token=your-token' \
  -p 'hello'
```

流式 JSON 模式：

```bash
node direct-connect-open.mjs \
  'cc://server-host:43127?token=your-token' \
  -p 'hello' \
  --output-format stream-json
```

## 9. Electron 主进程接入

已经从 `electron-direct.mjs` 导出了 direct-connect 相关能力：

- `startStandaloneDirectConnectServer`
- `createDirectConnectSession`
- `DirectConnectSessionManager`
- `parseConnectUrl`
- `buildConnectUrl`
- `runConnectHeadless`

代码位置：

- [src/electron-direct.ts](/Users/bgd/repo/moss/src/electron-direct.ts)

### 9.1 在远端服务器上启动

如果你的远端是 Node 服务，可以直接：

```ts
import { startStandaloneDirectConnectServer } from './electron-direct.mjs'

const server = await startStandaloneDirectConnectServer({
  host: '0.0.0.0',
  port: 43127,
  authToken: 'your-token',
  workspace: '/srv/workspace',
})

console.log(server.connectUrl)
```

### 9.2 在客户端创建 session

```ts
import { createDirectConnectSession } from './electron-direct.mjs'

const session = await createDirectConnectSession({
  serverUrl: 'http://server-host:43127',
  authToken: 'your-token',
  cwd: '/tmp/project',
})
```

### 9.3 用 websocket 连接远端 session

```ts
import { DirectConnectSessionManager } from './electron-direct.mjs'

const manager = new DirectConnectSessionManager(session.config, {
  onConnected() {
    manager.sendMessage('hello')
  },
  onMessage(msg) {
    console.log(msg)
  },
  onPermissionRequest(request, requestId) {
    manager.respondToPermissionRequest(requestId, {
      behavior: 'deny',
      message: 'Denied by UI',
    })
  },
  onError(error) {
    console.error(error)
  },
})

manager.connect()
```

## 10. UI 设置切换

现在 `ui` 层已经支持在设置页切换：

- `local`
- `remote-direct`

对应设置项位于 `~/.moss/settings.json`，关键字段如下：

```json
{
  "agentMode": "remote-direct",
  "remoteDirectServerUrl": "http://server-host:43127",
  "remoteDirectAuthToken": "your-token",
  "remoteDirectWorkspace": "/srv/moss/workspaces/default"
}
```

字段含义：

- `agentMode`
  - `local`: 使用本机 `electron-direct.mjs`
  - `remote-direct`: 通过 Direct Connect 连接远端
- `remoteDirectServerUrl`
  - 可以填 `http://host:port`
  - 也可以直接填 `cc://host:port?token=...`
- `remoteDirectAuthToken`
  - 当 `remoteDirectServerUrl` 不是 `cc://...token=...` 时，单独填写 token
- `remoteDirectWorkspace`
  - 可选
  - 留空时，由远端 server 自己决定默认工作目录

当前 UI 中 `remote-direct` 模式的限制：

- 远端文件树浏览还没有接通，所以右侧 workspace 面板不会显示远端真实文件。
- 本地附件上传到远端 workspace 还没有接通。
- `model`、`thinkingMode`、`appendSystemPrompt`、本地 `API URL/API Key` 这些设置当前只对 `local` 模式生效。

## 11. 当前实现的重要特征

### 10.1 每个 session 一个独立子进程

这是当前实现最重要的设计点。

优点：

- session 隔离简单
- 崩一个 session 不影响其他 session
- 容易做清理和超时控制

代价：

- 创建 session 会有一次进程启动成本
- 高并发时，进程数会线性增长

### 10.2 服务端只是 broker，不是业务引擎

server 本身不运行 Claude agent 逻辑。

它主要做三件事：

- 监听 HTTP/WS
- 管理 session 生命周期
- 在 session 创建时拉起 `cli-node.js`

真正的 agent 逻辑仍然在 `cli-node.js` 子进程里执行。

### 10.3 适合“远端 agent，本地 UI”

这正好对应你现在的目标：

- 客户端机器只跑 UI / Electron
- 远端机器跑 agent
- 双方通过远程 IPC 风格的 HTTP + WS 通信

## 12. 已验证内容

这次已经完成的烟测：

- `bun run build:node` 成功
- `direct-connect-server.mjs` 成功启动并监听端口
- `POST /sessions` 成功返回 `session_id` 和 `ws_url`
- websocket 成功连接
- 收到了远端 child CLI 返回的 `system/init`

这说明以下链路已经打通：

- server 监听
- session 创建
- 子进程拉起
- websocket 桥接

## 13. 当前限制

- 主 CLI 里的 `claude server` / `claude open` 子命令虽然源码有注册，但当前构建出的主入口行为不稳定，所以这里单独提供了 `direct-connect-server.mjs` 和 `direct-connect-open.mjs` 作为稳定入口。
- 当前不支持 `cc+unix://...` 的 unix socket 直连，只支持 HTTP + WS。
- 如果远端运行环境没有可用的 Claude 认证或模型配置，session 可能能创建成功，但后续推理不会返回完整结果。

## 14. 推荐部署方式

生产里建议这样拆：

1. 远端服务器部署整个 Moss 仓库的 node 构建产物。
2. 开机或容器启动时执行：

```bash
node direct-connect-server.mjs --host 0.0.0.0 --port 43127 --auth-token <固定token>
```

3. 用 Nginx / Caddy / Traefik 反向代理这个端口。
4. 客户端 UI 保存：
   - server base URL
   - auth token
5. 每次用户新开会话时：
   - `POST /sessions`
   - 连接 `ws_url`
   - 通过 websocket 收发 NDJSON

如果你后面要，我下一步可以继续帮你补两块：

- 给 `ui` 直接接上这套 remote direct-connect
- 再补一版“服务端守护进程 + 多用户鉴权 + 反向代理部署”的生产文档
