# Moss RAG MCP 设计

## 组件边界

```text
Moss Agent
  -> Moss RAG MCP Sidecar
       -> Moss Server /api/v1/integrations/ragflow/resolve
       -> RAGFlow REST API
```

Moss RAG MCP 是独立 Sidecar，不修改 RAGFlow 官方镜像。Moss Agent 连接器自动携带当前 Moss 登录凭据；Sidecar 再附加仅服务间共享的网关令牌向 Moss Server 换取当前用户的 RAGFlow API Key 和工具范围。

## 身份模型

- 一个 Moss 用户对应一个 RAGFlow 个人用户和租户。
- 默认账号格式为 `<Moss用户名>@ragflow.com`，域名由 `userDomain` 或 `MOSS_RAGFLOW_USER_DOMAIN` 配置。
- 用户名发生跨组织冲突时，在本地部分追加稳定的短哈希。
- 首次调用 MCP 或管理员点击初始化时开户，并生成随机 6 位英文字母密码和 RAGFlow API Key。
- 密码和 API Key 通过 Moss Server 凭据存储加密保存，不写入普通业务表或审计日志。

当前版本只管理个人知识库。部门共享库、组织服务账号、团队成员关系和知识库归属迁移留待后续企业知识库阶段。

## 授权模型

用户可以绑定多个角色，有效权限为所有角色权限的并集。角色权限写入登录令牌，修改角色或权限后需要重新登录；服务不会为已签发令牌实时查询数据库。

知识库权限：

- `ragflow:read`：MCP 只返回查询、检索和读取类工具。
- `ragflow:manage`：在读取能力上增加知识库、文档、解析、Chunk 和 Agent 管理工具。
- `ragflow:credentials`：允许 Moss 管理端查看或轮换指定可见用户的 RAGFlow 登录凭据。

Moss RAG MCP 不接受客户端声明的权限，而是完全使用 Moss Server `resolve` 返回的范围。显式 Moss API Key 继续使用 Key 中已签发的 scopes；调整角色后应重新登录并按需重新签发 Key。

## 管理边界

- 系统管理员可以创建、编辑、删除自定义角色并为用户分配多个角色。
- 系统管理员角色固定拥有全部权限，不能编辑或删除。
- 内置部门管理员和普通用户角色可调整权限，但不能重命名或删除。
- 部门管理员只能查看和管理本部门及子部门用户，不能分配角色。
- 查看 RAGFlow 密码/API Key 与普通用户管理权限分离。

## 部署配置

RAGFlow、官方 MCP、Extended MCP 和 Moss RAG MCP 由 `deps/rag/docker-compose.yml` 部署。三个 MCP 分别由 `ENABLE_NATIVE_MCP`、`ENABLE_EXTENDED_MCP`、`ENABLE_MOSS_RAG_MCP` 控制，默认全部开启。

目标服务器差异全部放在 `/data/moss-ragflow/.env`。同机部署时，Moss Server、RAGFlow 和 Moss RAG MCP 通过 `moss-integrations` 网络及稳定的容器 DNS 名互访；安装器把 RAGFlow 配置合并到 `/data/moss-server/server.json`。跨主机时通过 `MOSS_RAG_MCP_MOSS_SERVER_URL` 注入 Sidecar，并关闭本地 Server 配置写入。任何机器 IP 都不编译进镜像或连接器源码。

## 安全要求

- `resolve` 同时校验 Moss Bearer 凭据和 Sidecar 网关令牌。
- 凭据查看和轮换响应使用 `Cache-Control: no-store`。
- Admin API 默认仅绑定回环地址；跨主机访问时必须限制来源并在非可信网络使用 TLS。
- 审计记录开户、查看凭据和轮换动作，但不记录密码或 API Key 明文。
