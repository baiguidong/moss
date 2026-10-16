# Moss Server Docker Compose deployment

This deployment runs Moss Server and its HTTPS Nginx proxy in containers. Moss
Server uses the host Docker socket to launch isolated session-runtime containers.
The deployment also creates the external `moss-integrations` network so managed
dependencies can use stable container DNS names instead of host IP addresses.

## Requirements

- Linux x86_64 for published releases; source builds also support ARM64 with compatible dependency images
- Docker Engine and Docker Compose v2
- `curl`, `jq`, and `openssl`
- Port 443 available (or set `MOSS_HTTPS_PORT`)

## Linux 部署入口

### 同时启用单用户 WebUI

GitHub CLI 在远端构建 Linux AMD64 WebUI 镜像及部署包，本机无需 Docker：

```bash
gh workflow run build-release.yml --ref codex/webui-amd64-release -f publish=true
gh run list --workflow build-release.yml --limit 5
gh run watch <run-id> --exit-status
gh run download <run-id> --dir artifacts
```

下载、解压 `moss-server-compose-<version>.tar.gz`，在 Linux 主机运行：

```bash
sudo env MOSS_PUBLIC_HOST=10.0.1.181 MOSS_WEB_ENABLED=1 bash install.sh
```

WebUI 默认地址为 `https://10.0.1.181:8444/`，Server 管理入口仍为 `/admin/`。
首次启用通过现有认证 API 将单用户 WebUI 绑定到安装管理员，后续用同一账号密码登录。
也可明确指定 `MOSS_WEB_OWNER_ID`、`MOSS_WEB_OWNER_ORG_ID`；已有管理员密码变更时，
首次绑定需要当前凭据或显式用户 ID。其他有效账号不能访问此个人环境。

`MOSS_WEB_IMAGE`、`MOSS_WEB_HTTPS_PORT` 和 `MOSS_WEB_ORIGIN` 可分别指定镜像、端口与
外部访问 origin。WebUI 默认关闭。启用后单独保存 HOME 卷，无 Docker socket 挂载。
Server 现有会话和 runtime 服务继续保留。

`start.sh`、`stop.sh` 和 Server 升级会保留已有 WebUI 容器及 apt 安装；`stop.sh` 现在停止
容器而不删除它们。WebUI 镜像/配置变更不会静默替换个人容器，用户归属/origin 不匹配时
会要求先处理环境迁移。**删除或重建 WebUI 容器后，仅凭 HOME 卷仍无法恢复系统软件。**
完整系统恢复和独立 Host 升级属于下一阶段，见 [WebUI 计划](../../ui/docs/webui-next-steps.md)。

工作流合入主分支后，`--ref` 可改为 `main`。独立构建包固定 WebUI 版本；
Server 和 runtime 使用包中原有发布配置。完整 `release.yml` 会同时构建和发布 WebUI。
离线 WebUI 单独部署方法见 [WebUI 部署说明](../webui/README.md)。

复制到 Linux 后，按需要选择安装方式：

| 复制的内容 | 执行入口 | Server 镜像来源 |
| --- | --- | --- |
| `deploy/server` 目录或解压后的部署包 | `install.sh` | 拉取 `.env` 配置的镜像，不编译源码 |
| 完整源码仓库 | `deploy/server/local.sh` | 按服务器架构自动编译，再安装和启动 |

### 使用已发布镜像

将 `deploy/server` 目录（包括 `.env.example` 等隐藏文件）复制到 Linux，
或按下文步骤上传并解压部署包，然后执行：

```bash
cd /tmp/moss-server
sudo env MOSS_PUBLIC_HOST=10.0.1.181 bash install.sh
```

将示例 IP 替换为服务器实际 IP 或域名，不带 `https://`。
默认安装目录为 `/data/moss-server`，默认访问地址为 `https://服务器IP/admin/`。
安装脚本启动 Server、MySQL、Nginx 和私有 Silo，自动创建 Silo 的 bucket、
受限服务账号并配置 S3 连接。初始账号为 `admin / password`，首次登录后修改密码。
默认生成自签名证书，客户端需信任证书或换成正式证书。

`install.sh` 默认使用 `.env.example` 中的发布镜像；可用 `MOSS_SERVER_IMAGE`
和 `MOSS_RUNTIME_IMAGE` 指定版本。要部署尚未发布的源码改动，使用下面的源码构建入口。

### 在 Linux 自动编译当前源码

复制完整源码仓库，不携带 Mac 的 `node_modules`；在 Linux 重新安装依赖。
除上述部署依赖外，还需要 Node.js 22、npm、Bun 和 Docker Buildx。
以下命令在已配置这些工具的 root 环境，或具有 Docker、源码及目标目录写权限的用户环境执行：

```bash
cd /path/to/moss
bun install

MOSS_PUBLIC_HOST=10.0.1.181 \
MOSS_HTTPS_PORT=443 \
COMPOSE_PROJECT_NAME=moss-server \
MOSS_INTEGRATION_NETWORK=moss-integrations \
bash deploy/server/local.sh /data/moss-server
```

该入口只自动编译 Server；会话运行时使用 `MOSS_RUNTIME_IMAGE` 配置的镜像，
MySQL、Nginx 和 Silo 使用各自配置的镜像，缺失时自动拉取。
后续更新源码后，在仓库重新执行同一命令即可构建并部署，保留安装目录中的配置、凭证和数据。
需要镜像代理时，设置下文的 `MOSS_SERVER_BASE_IMAGE` 和 `MOSS_DOCKER_CLI_IMAGE`，
后续构建继续使用相同设置。

源码构建默认根据 Docker daemon 的架构选择 AMD64 或 ARM64。
Mac 上构建的 ARM64 镜像用于 ARM64 环境；常见的 Linux x86_64 服务器应构建 AMD64 镜像。
全新安装只需复制源码或部署包，无需复制本机测试部署的 `.env`、TLS 证书和数据库；
迁移已有数据请使用一致性备份恢复流程。

## Package and install

For a local source build on macOS Docker Desktop or Linux, run from a checkout:

```bash
bash deploy/server/local.sh "$HOME/moss-server-local"
```

This builds the Server image for the Docker daemon's architecture (ARM64 or AMD64),
extracts the normal deployment package into the separate directory, and starts
MySQL, Server, Nginx, and private Silo. The first run defaults to
`https://127.0.0.1:8443`, Compose project `moss-local`, and its own integration
network. Set `MOSS_RUNTIME_IMAGE` to reuse an available session-runtime image.
Missing dependency images are pulled; the Server image is always compiled locally.
Rerun the command to rebuild and apply source changes while preserving data and
configuration. `MOSS_LOCAL_ARCH` and `MOSS_LOCAL_SERVER_IMAGE` override the build
architecture and tag. Published release installation below still targets Linux x86_64.

If Docker Hub is unavailable, select reachable base-image mirrors for the build:

```bash
MOSS_SERVER_BASE_IMAGE=docker.m.daocloud.io/library/debian:bookworm-slim \
MOSS_DOCKER_CLI_IMAGE=docker.m.daocloud.io/library/docker:29.2.1-cli \
bash deploy/server/local.sh "$HOME/moss-server-local"
```

Use the same overrides when rebuilding. The image includes a current Docker CLI
compatible with Docker Engine 29; the host still provides the Docker daemon.
Dependency image references and runtime configuration are preserved in the
installation directory.

To verify a disposable local installation through HTTPS, including a 2 GiB
multipart transfer, user isolation, Host pause/resume and checksum verification:

```bash
node server/scripts/test-deployment.mjs "$HOME/moss-server-local" --restart
```

The optional `--restart` also restarts this installation's MySQL, Silo and Server
to check persistence. This test reads bootstrap login settings from `.env`, deletes
its test files, disables its test user and writes `verification/deployment.json`.
Run it only against a test installation whose bootstrap login is still valid.
`--backup` additionally checks a stopped backup by deleting a test file and then
restoring the installation. `--rebuild` reruns `local.sh` with the current build
environment and checks that data, configuration and credentials survive. Both
options restart services. Set `MOSS_DEPLOY_TEST_MODE=host-only` to skip the repeated
2 GiB transfer when running these additional checks. Reports are saved as
`verification/backup.json` and `verification/rebuild.json`, respectively.

Build a deployment package from the repository:

```bash
cd deploy/server
./package.sh
```

Upload and install it on the target host:

```bash
scp dist/moss-server-compose-*.tar.gz* root@server:/tmp/
ssh root@server
cd /tmp
sha256sum -c moss-server-compose-*.tar.gz.sha256
tar -xzf moss-server-compose-*.tar.gz
cd moss-server
MOSS_PUBLIC_HOST=10.0.1.181 ./install.sh
```

The installer copies the deployment into `/data/moss-server`, preserves an
existing `.env`, configuration, TLS keys, and runtime data, then starts the
stack. Running `install.sh` from a newer package updates the deployment files
without deleting persistent files. When migrating a checkout that already has
`.env` or `tls/`, the installer carries them into the target if no target copy
exists.

From a repository checkout, use the same installer directly:

```bash
cd deploy/server
sudo MOSS_PUBLIC_HOST=10.0.1.181 ./install.sh
```

For images in a private registry, pass a read-only package token on every pull
unless Docker is already logged in on the host. The token is not persisted in
`.env`:

```bash
sudo env \
  MOSS_PUBLIC_HOST=10.0.1.181 \
  MOSS_REGISTRY_USERNAME='<github-user>' \
  MOSS_REGISTRY_TOKEN='<read-packages-token>' \
  ./install.sh
```

After the first login, change the default password immediately. Subsequent
starts pull the configured images and run `docker compose up`; configuration
and data remain under `MOSS_SERVER_HOME`.

If migrating from the legacy host process, stop it before the first Compose
start:

```bash
sudo systemctl disable --now moss-server.service
```

The first run creates `.env`, `/data/moss-server/server.json`, and a self-signed
certificate under `tls/`. The initial login is `admin` / `password`; change it
after signing in.

Existing `/data/moss-server/settings.json` values are preserved and merged with
the published session-runtime image setting.

## Image versions and upgrades

For an installed Compose deployment, `/data/moss-server/.env` is the only manually maintained
source for Moss image versions:

```text
MOSS_SERVER_IMAGE=ghcr.io/baiguidong/moss-server:latest
MOSS_RUNTIME_IMAGE=ghcr.io/baiguidong/moss-runtime:latest
```

Both images are published with the same release tag. Use one of these commands
to update both entries in `.env`, pull them, and apply the upgrade:

```bash
sudo /data/moss-server/upgrade.sh latest
sudo /data/moss-server/upgrade.sh 1.2.3
```

Running `upgrade.sh` without an argument keeps the configured references and
pulls them again, which is useful when both already use `latest`.

The start script pulls both images, recreates the Server container when its image
changes, and copies `MOSS_RUNTIME_IMAGE` into
`/data/moss-server/settings.json` for newly created session containers. Do not
edit `serverRuntime.dockerImage` by hand; it is derived from `.env` on every
start. Existing running session containers retain the image with which they were
created.

Clients must trust `/data/moss-server/tls/server.crt` before connecting to the HTTPS
endpoint. To use another port or image, edit `.env` or pass an environment value
to `configure.sh` before starting.

## Storage and Agent runtime

`/data/moss-server` is bind-mounted into the Server container at the same
absolute path. It contains `server.json`, `settings.json`, the MySQL data directory,
logs, session workspaces, user profiles, transcripts, and the image-owned
`container-app` payload. The Docker socket is mounted separately at
`/var/run/docker.sock`.

The runtime image is not mounted as a volume. For each new Agent session, Server
reads `serverRuntime.dockerImage`, invokes `docker run` through the host socket,
and bind-mounts only that session's workspace, profile, transcript, manifest,
and the read-only session runner from `container-app`. Existing sessions keep
their originally recorded runtime image.

Docker image layers and Docker-managed named volumes are stored under the Docker
daemon's data root, not under `/data/moss-server`. The bundled
`deploy/docker/install.sh` uses `/data/docker` by default; Docker installed by
other means commonly uses `/var/lib/docker`. Changing the Moss application
directory alone does not move Docker-managed data.

## Operations

```bash
sudo /data/moss-server/start.sh
sudo /data/moss-server/stop.sh
sudo /data/moss-server/upgrade.sh
cd /data/moss-server && docker compose --env-file .env -f compose.yaml logs -f
```

## Public cloud storage

New Compose installations also start a private Silo service, initialize its bucket
and restricted service account, and verify S3 access. Silo publishes no host ports.
The pinned `MINIO_IMAGE` and `SILO_MC_IMAGE` use
`docker.1ms.run/pgsty/silo:RELEASE.2026-08-06T00-00-00Z`; its included `mc` is used
only by the initialization container. These image versions do not track Moss upgrades.

Connection settings live in `server.json.cloudStorage`; service credentials use the
server's encrypted credential store. An existing cloud configuration, including an
explicit `enabled: false` or external S3 endpoint, is preserved. Runtime data lives
under `silo-data/`. Run `scripts/cloud-storage-init.sh` to retry initialization.
Storage initialization failures leave other Moss Server features available.

For a consistent backup, stop server writers/cleanup first, then Silo, and back up
the entire server home including MySQL data, Silo data, configuration and
`credentials/.master.key`. Restore the objects, metadata and credentials together.
For external S3 configuration, API contracts, transfer recovery and detailed backup
instructions, see `docs/cloud-storage.md` in the source repository.

## Database

New Compose installations use the bundled MySQL 8.4 service. `configure.sh`
sets `server.json` to `database.driver=mysql`; `.env` supplies `MYSQL_IMAGE`,
`MOSS_DB_NAME`, `MOSS_DB_USER`, `MOSS_DB_PASSWORD`, and `MOSS_DB_ROOT_PASSWORD`.
MySQL has no published port and joins only the internal `moss-db` network.
Server receives the application credentials; root credentials belong to MySQL.
Its data persists at `${MOSS_SERVER_HOME}/var/lib/mysql`. `stop.sh` preserves it.
Changing initialization passwords in `.env` does not change existing MySQL users;
update the database account before changing its connection environment.
Moss upgrades leave the independently pinned MySQL image version unchanged.

Check the configured connection inside the Server container:

```bash
docker compose exec server /opt/moss/node/bin/node /opt/moss/app/bin/moss-server.mjs db check
```

Direct program startup defaults to SQLite at `${MOSS_SERVER_HOME}/moss-server.db`
(`~/.moss/server/moss-server.db` when the environment variable is absent).
An explicit SQLite configuration is `{"database":{"driver":"sqlite","filename":"/path/to/moss-server.db"}}`.
Database configuration errors fail startup; MySQL failures never switch to SQLite.
This release initializes fresh databases. Legacy `storage.dbPath` configuration
and legacy database schemas are not migrated.

`cloud-storage verify-target` is an offline maintenance command. Stop Server
before executing it with the same configuration and environment. It shares an
exclusive owner lock with Server, verifies objects outside a database transaction,
and accepts the target in a short transaction after verification.
