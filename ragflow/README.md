# Moss RAGFlow 独立部署包

这个目录用于从 Moss 仓库直接部署 RAGFlow 和定制 Extended MCP，不依赖本地或目标服务器上的 RAGFlow 源码仓库，也不会在安装过程中克隆或下载 RAGFlow GitHub 仓库。

## 架构

```text
Moss / MCP Client
  -> Native MCP :9382（RAGFlow 公开镜像内置）
  -> Extended MCP :9385（本目录 Dockerfile 构建）
  -> Moss RAG MCP :9386（Moss 身份与动态权限）
       -> Moss Server :43127
       -> RAGFlow REST API
          -> Infinity / MySQL / MinIO / Redis
          -> Ollama（可选）
```

主服务和依赖直接使用 `.env` 中配置的公开镜像。默认选择在中国网络可访问的公开镜像代理，不需要登录；也可以通过环境变量切换到 Docker Hub 或企业私有仓库。Extended MCP 和 Moss RAG MCP 使用 `mcp-extended/server.py` 的同一个通用镜像，以两个独立容器和认证模式运行。

## 要求

- 目标机为 Linux x86_64。
- 已安装 Docker Engine 和 Docker Compose v2。
- 部署端可以通过 SSH 登录目标机 root 用户。
- 推荐至少 4 CPU、16 GiB 内存、50 GiB 可用磁盘。

## 一键在线部署

```bash
cd ~/repo/moss
./ragflow/deploy.sh root@服务器地址
```

安装包已经在目标服务器上时，可以进入解压后的目录直接执行，无需额外参数：

```bash
sudo ./install.sh
```

首次部署会明确输出安装目录，默认是 `/opt/moss-ragflow`。安装器根据 `env.example` 生成随机的 MySQL、MinIO、Redis、RAGFlow 管理员密码和 Moss RAG 网关令牌，保存在目标机 `/opt/moss-ragflow/.env`，权限为 `0600`。可通过 `RAGFLOW_INSTALL_DIR` 修改目录；同一个 Compose 项目不能跨两个安装目录运行，安装器检测到冲突会直接退出并提示原目录。

默认服务：

- Web：`http://服务器地址:80`
- 官方 MCP：`http://服务器地址:9382/mcp`
- Extended MCP：`http://服务器地址:9385/mcp`
- Moss RAG MCP：`http://服务器地址:9386/mcp`
- 官方/Extended MCP：`Authorization: Bearer <RAGFlow API key>`
- Moss RAG MCP：复用当前 Moss Server 登录态并自动注入 Bearer 凭据

Moss 中只提供一个 **RAGFlow 企业知识库**连接器。认证时可选择：

- **Moss Server 登录态**：填写 `服务器地址:9386`，运行时复用当前 Moss 登录，不保存第二份 Moss Server API Key；首次请求自动创建并绑定独立的 RAGFlow 用户。
- **RAGFlow API Key**：填写 `服务器地址:9385` 和 RAGFlow API Key，直接使用 Extended MCP。

连接成功后仍可从连接器设置中重新选择认证方式、修改地址或更换 Key，并重新执行连接验证。

Moss Server 地址属于每台目标机的部署配置，不会编译进 Sidecar 镜像。部署时通过环境变量写入目标机的
`/opt/moss-ragflow/.env`：

```bash
MOSS_RAG_MCP_MOSS_SERVER_URL=http://Moss服务器地址:43127 \
  ./ragflow/deploy.sh root@RAG服务器地址
```

Compose 将该值以 `MOSS_SERVER_URL` 注入 Moss RAG MCP 容器。Moss Server 与 RAGFlow
位于同一台机器时，可以保留 `http://host.docker.internal:43127`；位于其他机器时必须改为容器
能够访问的实际地址。修改目标机 `.env` 后重新运行安装器即可应用配置。

### 配置 Moss Server

Moss Server 与 RAGFlow 同机部署时，在 `server.json` 中增加：

```json
{
  "ragflow": {
    "enabled": true,
    "instanceId": "default",
    "baseUrl": "http://127.0.0.1:80",
    "adminUrl": "http://127.0.0.1:9381",
    "adminEmail": "<RAGFLOW_ADMIN_EMAIL 的值>",
    "userDomain": "ragflow.com",
    "passwordLength": 6,
    "requestTimeoutMs": 15000
  }
}
```

并向 `moss-server.service` 注入以下两个环境变量，值取自 `/opt/moss-ragflow/.env` 中的同名管理员密码和网关令牌：

```text
MOSS_RAGFLOW_ADMIN_PASSWORD=<ADMIN_DEFAULT_PASSWORD 的值>
MOSS_RAGFLOW_GATEWAY_TOKEN=<MOSS_RAGFLOW_GATEWAY_TOKEN 的值>
MOSS_RAGFLOW_USER_DOMAIN=ragflow.com
MOSS_RAGFLOW_PASSWORD_LENGTH=6
```

安装器会把 `ADMIN_DEFAULT_PASSWORD` 映射为 RAGFlow 识别的
`DEFAULT_SUPERUSER_PASSWORD`。该值只在首次创建管理员时生效；已有 RAGFlow 数据库必须填写
当前真实管理员密码，修改 `.env` 不会自动重置已有账号密码。

RAGFlow Admin API 默认只发布在 `127.0.0.1:9381`。Moss Server 在其他机器时，需要设置 `RAGFLOW_ADMIN_BIND_IP`、网络访问控制和 TLS。完整权限与数据模型见 [MOSS_RAG_MCP_DESIGN.md](MOSS_RAG_MCP_DESIGN.md)。

### 用户与权限

- 每个 Moss 用户按需创建一个独立 RAGFlow 个人账号，例如 `bgd@ragflow.com`。
- 初始密码为随机 6 位英文字母，账号、密码和 API Key 可由拥有“查看和轮换知识库凭据”权限的管理员在 Moss 用户详情中查看。
- `读取个人知识库`只开放检索工具；`管理个人知识库`开放上传、解析、编辑和删除等工具。
- 用户可以拥有多个角色，有效权限是多个角色权限的并集。角色修改后重新登录生效。
- 当前版本不创建部门或组织共享知识库，也不创建隐藏企业服务账号。

## 常用部署方式

不安装 Ollama，使用客户已有的大模型服务：

```bash
WITH_LOCAL_MODELS=0 ./ragflow/deploy.sh root@服务器地址
```

GPU 模式：

```bash
RAGFLOW_DEVICE=gpu ./ragflow/deploy.sh root@服务器地址
```

只开放只读 MCP：

```bash
EXTENDED_MCP_SCOPES=read ./ragflow/deploy.sh root@服务器地址
```

三个 MCP 默认全部启动，可以独立关闭：

```bash
ENABLE_NATIVE_MCP=0 \
ENABLE_EXTENDED_MCP=1 \
ENABLE_MOSS_RAG_MCP=1 \
./ragflow/deploy.sh root@服务器地址
```

只允许通过服务器本机或 SSH 隧道访问 MCP：

```bash
RAGFLOW_MCP_BIND_IP=127.0.0.1 \
./ragflow/deploy.sh root@服务器地址
```

覆盖公开镜像为企业镜像仓库：

```bash
RAGFLOW_IMAGE=registry.company/ragflow:v0.27.1 \
EXTENDED_MCP_PYTHON_IMAGE=registry.company/python:3.12-slim-bookworm \
./ragflow/deploy.sh root@服务器地址
```

直接使用 Docker Hub 官方命名空间：

```bash
RAGFLOW_IMAGE=infiniflow/ragflow:v0.27.1 \
INFINITY_IMAGE=infiniflow/infinity:v0.7.3-x64-v3 \
MYSQL_IMAGE=mysql:8.0.40 \
REDIS_IMAGE=valkey/valkey:8 \
EXTENDED_MCP_PYTHON_IMAGE=python:3.12-slim-bookworm \
./ragflow/deploy.sh root@服务器地址
```

目标机已经预加载全部镜像时：

```bash
PULL_IMAGES=0 BUILD_EXTENDED_MCP=0 \
./ragflow/deploy.sh root@服务器地址
```

`BUILD_EXTENDED_MCP=0` 要求目标机已经存在 `.env` 中 `EXTENDED_MCP_IMAGE` 指定的镜像。离线使用 Ollama 时还需要单独预装模型数据卷；否则设置 `WITH_LOCAL_MODELS=0`。

## 更新定制 MCP

修改 `ragflow/mcp-extended/server.py`、依赖或 Dockerfile 后，重新运行同一部署命令即可。安装器只重建 Sidecar，不需要构建 RAGFlow 主镜像：

```bash
./ragflow/deploy.sh root@服务器地址
```

也可以在目标机直接重新构建 Sidecar：

```bash
ssh root@服务器地址 ragflowctl mcp-rebuild
```

## 运维

```bash
ssh root@服务器地址 ragflowctl status
ssh root@服务器地址 ragflowctl doctor
ssh root@服务器地址 ragflowctl logs ragflow-mcp-extended
ssh root@服务器地址 ragflowctl logs moss-rag-mcp
ssh root@服务器地址 ragflowctl mcp-scopes read,write,agent
ssh root@服务器地址 ragflowctl lock-registration
ssh root@服务器地址 ragflowctl backup
```

## 验证部署包

```bash
./ragflow/scripts/validate.sh
```

只在目标机生成配置并运行 Compose 校验，不拉镜像、不启动服务：

```bash
CHECK_ONLY=1 RAGFLOW_INSTALL_DIR=/tmp/moss-ragflow-check \
./ragflow/deploy.sh root@服务器地址
```

只读 MCP 验证需要提供 API Key：

```bash
export RAGFLOW_API_KEY=ragflow-REPLACE_ME
./ragflow/scripts/mcp-smoke.sh \
  http://服务器地址:9385/mcp \
  '知识库中包含什么内容？'
```

Moss 身份 MCP 验证：

```bash
export MCP_API_KEY=moss_sk_REPLACE_ME
EXPECTED_MCP_SERVER_NAME=moss-rag-mcp \
./ragflow/scripts/mcp-smoke.sh \
  http://服务器地址:9386/mcp \
  '知识库中包含什么内容？'
```

## 安全边界

- MySQL、MinIO、Redis、Infinity 和 Ollama 不发布宿主机端口，只在 Docker 网络内通信。
- Web 和三个 MCP 的监听地址可在 `.env` 中控制；RAGFlow Admin API 默认只监听宿主机回环地址。
- 官方/Extended MCP 要求 RAGFlow API Key；Moss RAG MCP 在协议层校验 Moss Server 登录凭据，
  Moss 连接器会从当前登录态自动注入该凭据。
- Moss Server 同时校验用户 Key 和网关服务令牌，底层 RAGFlow Key 使用 AES-256-GCM 加密保存且不返回给 Agent。
- 默认 `admin` scope 关闭，删除操作还必须传 `confirm=true`。
- 默认使用明文 HTTP，仅适合可信局域网。跨网络部署必须增加 TLS 反向代理。
