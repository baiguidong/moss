# Moss Server 数据库

直接启动时，省略 `database` 配置即可使用 SQLite，文件默认为
`${MOSS_SERVER_HOME}/moss-server.db`。`deploy/server` 的 Compose 部署会自动配置并启动 MySQL 8.4。
两种方式都通过同一套异步 Model / Repository 访问业务数据。

## 配置

调试时可以显式指定 SQLite 文件，也可以保持配置文件中的 `database` 字段为空缺：

```json
{
  "database": {
    "driver": "sqlite",
    "filename": "/tmp/moss-debug/moss-server.db"
  }
}
```

使用 MySQL 时，在 `server.json` 中指定连接信息和凭据环境变量的名称：

```json
{
  "database": {
    "driver": "mysql",
    "host": "mysql",
    "port": 3306,
    "database": "moss",
    "userEnv": "MOSS_DB_USER",
    "passwordEnv": "MOSS_DB_PASSWORD",
    "connectionLimit": 10,
    "connectTimeoutMs": 10000
  }
}
```

Compose 的 `.env` 提供固定的 `MOSS_DB_NAME`、`MOSS_DB_USER`、`MOSS_DB_PASSWORD`
和 `MOSS_DB_ROOT_PASSWORD`；只有 MySQL 容器收到 root 密码。数据库不发布宿主机端口，
只连接内部 `moss-db` 网络。数据目录为 `${MOSS_SERVER_HOME}/var/lib/mysql`。
具体安装与维护命令见 [部署说明](../deploy/server/README.md#database)。

缺少 MySQL 凭据、连接失败或配置无效都会使启动失败，不会自动切换到 SQLite。
修改 `.env` 中的初始化密码不会修改已经创建的 MySQL 账号。

## 数据与代码边界

`server/src/model` 提供连接、事务、初始化和 Repository：

| Repository | 本地保存的数据 |
| --- | --- |
| `auth` | 组织、部门、用户、角色、API Key、OAuth 授权记录和服务配置 |
| `session` | 会话、运行尝试、Server 实例和事件 |
| `agentMail` | 邮件、收件权限、消费租约和删除记录 |
| `openIM` | Moss 用户 / 群与 OpenIM 标识的绑定 |
| `ragflow` | Moss 用户与 RAGFlow 账号的绑定、操作审计 |
| `cloudStorage` | 文件目录、上传会话、分片、配额统计和清理任务 |

OpenIM 和 RAGFlow 仍然独立部署；这里的绑定表只保存 Moss 的集成信息。
云存储文件内容仍在 S3 / Silo，对象内容不会写进 SQL 数据库。
新初始化的数据库统一包含 28 张业务表，以及初始化版本和写锁两张内部表。

Service 负责业务规则，SQL 集中在 Repository。数据库调用必须 `await`；涉及
“检查后更新”的操作使用 `db.transaction()`，嵌套事务通过 savepoint 实现。
事务内只能执行短小的数据库操作；HTTP、S3、文件和容器操作留在事务外。

SQLite 连接队列隔离事务与其他请求。MySQL 使用连接池，并通过公共写锁行串行执行
短写事务，保证 Server、Runner 与维护命令之间的一致性。这是当前单 Server 部署的
简单实现；需要提高写吞吐量时，可按业务改为更细的行锁。

Server 负责创建初始表结构；Runner 复用配置、限制连接池为 1，并只检查结构是否已初始化。
MySQL 和 SQLite 各有显式初始 DDL，使用各自的 upsert 和索引语法。
MySQL 使用区分大小写且保留尾部空格差异的 `utf8mb4_0900_bin`，云文件的有效名称唯一性
由生成列索引实现。

仅支持全新数据库及本版本已初始化的数据库；不迁移旧配置、旧 SQLite 文件或旧数据。
发现无法识别的现有表结构会报错，数据不会被删除。

## 检查与回归

```bash
node bin/moss-server.mjs db check
cd server
bun run typecheck
bun test src
```

`db check` 检查配置和连接；`/healthz` 检查进程存活，`/readyz` 检查数据库可用性。
数据库失败时 `/readyz` 返回 503。Compose 等待 MySQL 就绪后再启动 Server。

同一套测试可在真实 MySQL 上运行：

安装了 Docker 时，可以运行 `cd server && bun run test:mysql`。脚本创建临时 MySQL 8.4
容器和独立卷，以非 root 测试账号验证权限、重启持久化和完整回归，结束后删除自己的容器及卷。
测试端口仅绑定本机回环地址。也可以指定已有的临时实例：

```bash
cd server
MOSS_TEST_MYSQL='mysql://test-user:test-password@127.0.0.1:3306' bun test src
```

测试连接必须指向可丢弃的测试实例，账号需要能创建、访问和删除 `moss_test_*` 数据库。
每个 Node 测试进程创建独立数据库，并在连接关闭后清理。并发测试覆盖事务回滚、嵌套事务、
OAuth 单次消费、邮件幂等与租约、会话序号、云存储配额及目录冲突，以及 Server 启停和就绪检查。

`cloud-storage verify-target` 与 Server 使用同一份数据目录锁，执行前需要停止 Server。
它先在事务外校验对象，再用短事务更新目标信息。
