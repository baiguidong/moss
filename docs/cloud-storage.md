Moss 公共云端空间（Host API 2.2，协议 `moss.cloud-storage/v1`）。

云端空间是一套独立的存储能力。App 的 KV、Backend dataDir、本地资料库、会话工作区和 OpenIM 存储继续使用原有接口。Agent 在本地还是远程执行，不改变文件保存的位置。

调用链：App → Moss Host → moss-server HTTPS 网关 → 内网 S3。客户端没有 S3 凭证，不接收 S3 预签名地址。moss-server 从登录身份确定组织和用户，文件名与对象 key 分离；组织管理员也不能读取其他用户的个人文件。

**部署与配置**

`deploy/server/start.sh` 首次配置默认开启云端空间，启动私有 Silo，创建 bucket 和受限服务账号，然后运行写、读、删和 Multipart 探测。Silo 和初始化工具均使用实际验证过的镜像：

```
docker.1ms.run/pgsty/silo:RELEASE.2026-08-06T00-00-00Z
```

该镜像自带同版本 `mc/mcli`。初始化容器运行 `mc`，常驻服务端仅使用 AWS SDK v3 的 S3 数据接口。Silo 没有主机端口映射，只有 moss-server 加入其内部网络。管理密码保存在部署 `.env` 中；服务凭证保存到 `ServerCredentialStore` 加密文件中。初始化使用的临时凭证文件在退出时删除。不要启用 shell 的 `set -x`。

服务端非敏感配置只有 `server.json.cloudStorage` 一个来源：

```json
{
  "cloudStorage": {
    "enabled": true,
    "endpoint": "http://silo:9000",
    "bucket": "moss-cloud-storage",
    "region": "us-east-1",
    "forcePathStyle": true,
    "quotaBytes": 107374182400,
    "uploadTtlMs": 604800000
  }
}
```

`quotaBytes` 是每个用户的容量上限（默认 100 GiB），包含已发布文件和未清理完的删除对象；未完成上传另外预留容量。目录、元数据和 S3 本身的副本开销不计入该数值。上传会话默认 7 天过期。

独立运行 moss-server 的默认配置为关闭；Compose 首次配置默认开启。已有 `cloudStorage` 配置整体保留，包括显式 `enabled:false`、外部 endpoint 和自定义 bucket。重启/重装不重置账号，升级 Moss 不改变单独固定的 Silo 版本。

外部 S3：填写 endpoint、bucket、region、path-style，预先创建私有 bucket 和受限服务凭证。通过 stdin 导入凭证，然后探测：

```sh
# 在部署目录执行。s3-credentials.json 为权限 0600 的临时文件，包含 accessKeyId、secretAccessKey。
docker compose exec -T server /opt/moss/node/bin/node /opt/moss/app/bin/moss-server.mjs cloud-storage set-credentials < s3-credentials.json
docker compose exec -T server /opt/moss/node/bin/node /opt/moss/app/bin/moss-server.mjs cloud-storage probe
# 凭证变更后重启 server，使现有 S3 客户端重新加载。
docker compose restart server
```

探测通过前不向客户端报告就绪。外部 S3 不执行任何 IAM 或 bucket 创建操作。需要的权限见部署脚本 `scripts/silo-init.sh`；对象权限限制到配置 bucket 的 `data/*`，并需 bucket 列举、位置及 Multipart 列举权限。

失败时其他 moss-server 功能继续可用；修复配置或存储后运行 `scripts/cloud-storage-init.sh` 重试。服务端配置变化需要重启。不要把 bucket 改成公开读。

**App 接入**

Manifest 声明 `hostApi: "^2.2.0"`，在 `backend.protocols` 中加入 `moss.cloud-storage/v1`，并声明所需权限：

| 权限 | 操作 |
| --- | --- |
| `cloud-storage:read` | 状态、配额、列表、详情、下载和任务查询/控制 |
| `cloud-storage:write` | 文件选择、上传、建目录、移动和改名 |
| `cloud-storage:delete` | 删除文件或空目录 |

任务控制还会检查任务自身的读/写权限。必须同时有 App 声明、安装授权和远程用户权限。普通用户/部门管理员初次升级获得这三个个人云端权限；已有显式 API Key 的 scopes 不会自动扩权，需要重新授权或使用登录凭证。

```js
import { createCloudStorageClient } from '@moss/app-sdk/cloud-storage'
const cloud = createCloudStorageClient(backend.host)
const stop = cloud.on('transfers.progress', task => console.log(task.transferredBytes, task.totalBytes))
const { files } = await cloud.request('local-files.pick')
const { transferId } = await cloud.request('uploads.start', { handle: files[0].handle })
const task = await cloud.request('transfers.get', { transferId })
const page = await cloud.request('files.list', { parentId: null, limit: 100 })
```

完整可构建示例在 `examples/cloud-storage-app/`，包含最小页面、Backend 和事件转发。

| 方法 | 输入/返回 |
| --- | --- |
| `status.get` | `{state, version?}` |
| `quota.get` | `{usedBytes, reservedBytes, limitBytes}` |
| `files.list` | `{parentId?, cursor?, limit?}` → `{files, nextCursor}`，最多 200 项 |
| `files.get` | `{fileId}` → 文件 |
| `folders.create` | `{name, parentId?}` → 文件夹 |
| `files.update` | `{fileId, name?, parentId?}` → 文件 |
| `files.delete` | `{fileId}` → `{ok:true}` |
| `local-files.pick` | 宿主文件选择器 → `{files:[{handle,name,size}]}` |
| `uploads.start` | `{handle, parentId?, name?}` → `{transferId}` |
| `downloads.start` | `{fileId}`，宿主保存位置选择器 → `{transferId}` |
| `transfers.list/get` | `{cursor?,limit?}` / `{transferId}` → `{transfers,nextCursor}` / 任务 |
| `transfers.pause/resume/cancel` | `{transferId}` → 任务 |

文件模型：`{id,parentId,name,kind,size,revision,createdAt,updatedAt}`；任务模型及各方法完整类型见 SDK 的 `CloudStorageInputMap/CloudStorageOutputMap`。所有时间戳为毫秒。根目录使用 `null`，列表游标为不透明 ID。

同目录同名返回 `NAME_CONFLICT`，不覆盖原文件。下载目标存在时返回 `EEXIST`，请另选名称。文件夹不能移入自身或子目录，非空文件夹不能删除；进行中的上传也占据其目录位置。

传输事件：`transfers.progress`（约 200ms 节流）、`transfers.changed`、`storage.status-changed`。再次打开 App 后通过任务查询恢复显示，事件本身不保证离线投递。

任务列表按任务 ID 排序，默认每页 100 条，最多 200 条；将 `nextCursor` 传入下一次查询，直到其为 `null`。历史任务保留在本地，分页保证 Host 消息不会随历史任务数量增长而超限。

本地文件句柄仅当前 App 实例和远程账号可使用，24 小时失效；传输状态独立保存在 Moss 的 `cloud-transfers/transfers.json`，不占用 App KV。该文件包含宿主需要的路径，App 只看到文件名和任务 ID。重启后未完成任务变为暂停，用户显式恢复。关闭 App 页面可继续任务；禁用/卸载 App、撤销权限、切换账号、退出 Moss 或关闭远程会停止任务。跨账号无法恢复原任务；切回原连接后可再恢复。

同一账号修改密码或轮换 API Key 后，重新认证确认服务器、组织和用户一致即可查询和恢复旧任务；正在执行的请求仍保持原连接绑定并先中止，不会中途改用新凭证。

取消先返回 `paused` / `CANCEL_PENDING`，等待实际操作停止并确认服务端结果，再推送 `cancelled` 或 `completed`。若完成已提交，则保留文件并显示已完成；删除文件仍需单独调用删除接口。断网或无法确认取消时保留暂停状态及错误，不报告取消成功；再次取消或恢复会继续确认取消意图。初始化响应丢失时通过原 `requestKey` 查询会话，不创建新上传。

**HTTP 与传输行为**

HTTP 前缀 `/api/v1/cloud-storage`，使用现有 Moss Bearer 登录令牌/API Key。每次操作重新检查用户、组织、API Key 当前有效性及权限；活动流每 2 秒重检，授权撤销后中止。

| HTTP | 用途 |
| --- | --- |
| `GET /status`、`GET /quota` | 状态与容量 |
| `GET /files?parentId=&cursor=&limit=`、`GET /files/:id` | 列表、详情 |
| `POST /folders`、`PATCH /files/:id`、`DELETE /files/:id` | 目录及文件元数据操作 |
| `POST /uploads` | `{requestKey,name,parentId?,size}`，requestKey 必填且同用户内幂等 |
| `GET /uploads/:id` | 会话状态、fileId、partSize、expiresAt、已确认分片 |
| `GET /uploads?requestKey=…` | 按当前用户的幂等键查询会话；未找到返回 `UPLOAD_NOT_FOUND` |
| `PUT /uploads/:id/parts/:number` | 原始分片字节；允许 chunked 请求；提供 Content-Length 时须匹配 |
| `POST /uploads/:id/complete` | 核验 S3 实际分片并发布；可重复调用 |
| `DELETE /uploads/:id` | 取消未完成上传；活动分片/完成操作冲突时稍后重试 |
| `GET /files/:id/content`、`HEAD /files/:id/content` | 网关流式内容访问 |

默认分片 16 MiB，按 10,000 分片上限向上调整；最大文件 5 TiB。每个 Host 最多 3 条数据流，服务端每用户 3 条、全局 24 条，超限 429。分片直接流式进入 S3，服务端核验实际字节数；已消费的上传流不由 SDK 重放。Host 每次重试重新打开并核对源文件（设备、inode、大小及修改时间），最多额外重试 3 次。

下载支持单 Range、206/416、Content-Length、Content-Range、HEAD 及逻辑内容版本 ETag。`If-Match`/`If-Range` 与当前版本不符返回 412，避免拼接不同版本。Multipart ETag 仅校验分片身份，不用作整文件 MD5。支持硬链接时，临时下载文件成功后原子发布到目标路径。不支持硬链接（如 exFAT/FAT）时，排他创建目标文件并流式复制，确认写入成功后才完成任务；复制过程中目标路径可能可见，且暂时需要两份文件的磁盘空间。两种方式均不覆盖已有文件，复制中断后只继续写入本任务创建并记录身份的目标文件，取消时清理未完成副本。

Nginx 关闭上传请求缓冲和下载响应缓冲；连接超时 10 秒，上传空闲超时 120 秒；单次分片/下载请求最长 15 分钟。较慢下载可在临时文件基础上继续。Host 取消会向网关和 S3 传递中止信号。

元数据通过统一的异步 model 层访问数据库，Compose 默认使用 MySQL，调试和测试可使用 SQLite。准备、上传、完成中、取消清理状态持久化；每分钟进行恢复/清理，重启后立即运行一次；对终止会话在请求超时窗口后再检查一次残留 Multipart，避免迟到响应留下孤立上传。S3 已完成但数据库尚未提交时通过对象大小及 revision 恢复发布。删除先隐藏文件，S3 清理成功后释放容量。离线取消上传可能等服务端过期清理后才释放预留空间。

状态：`remote_disabled`、`unauthenticated`、`unconfigured`、`disabled`、`unsupported`、`unavailable`、`forbidden`、`target_mismatch`、`ready`。远程关闭时不发云端网络请求；云端失败不回退写入本地资料库。常见错误：`FILE_NOT_FOUND`、`NAME_CONFLICT`、`FOLDER_NOT_EMPTY`、`FOLDER_CYCLE`、`QUOTA_EXCEEDED`、`UPLOAD_BUSY`、`UPLOAD_EXPIRED`、`PARTS_INCOMPLETE`、`REVISION_CHANGED`、`SOURCE_CHANGED`、`STORAGE_FULL`。

**更换 S3 存储**

只配置一套实际存储，不自动迁移。先暂停客户端传输并停止 moss-server，处理完所有未完成上传；完整复制对象及其 S3 metadata（尤其 `revision`），保留原 object key。保存旧配置和凭证，再修改 endpoint/bucket/region、导入新凭证并运行 probe。数据库记录原目标，直接改配置会返回 `target_mismatch`。对所有未删除文件验证大小和 revision 后，使用 `cloud-storage verify-target` 接受已迁移目标，再启动服务。该命令必须在 moss-server 停止时离线运行；未完成上传会阻止切换。验证失败恢复旧配置和凭证。

**一致性备份和恢复**

单机默认部署采用停写备份，需要同时备份数据库与 Silo：

1. 暂停客户端传输，停止网关/服务端，随后停止 Silo 和内置 MySQL。先停止 moss-server 可保证清理器也已停止；保留整个部署目录，不运行删除数据的命令。
2. 备份 `server.json`、`.env`、TLS、数据库、`silo-data/`、`credentials/server-secrets.json` 和 `credentials/.master.key`。Compose 使用 `${MOSS_SERVER_HOME}/var/lib/mysql`，必须在 MySQL 完全停止后备份；调试用 SQLite 则备份 `database.filename`（默认 `${MOSS_SERVER_HOME}/moss-server.db`）及可能存在的 `-wal/-shm`。推荐对整个 `MOSS_SERVER_HOME` 做同一份权限受控的归档；配置在目录外的数据库文件另行纳入。主密钥丢失时不能解密服务凭证。可另存运行环境下 `~/.moss-credential-key-backup/` 的密钥备份。
3. 校验归档，再启动 MySQL、Silo 和 moss-server。外部 S3 使用相同停写窗口制作对象快照，保留上述元数据和凭证；恢复完成前不要允许客户端写入。
4. 恢复到原绝对路径、使用相同镜像和配置，先恢复对象，再恢复元数据和密钥，运行初始化/探测。新路径或 endpoint 按“更换 S3 存储”验证目标。
5. 用原用户登录，验证目录、容量和抽样文件的 SHA-256。未完成任务可在服务恢复后继续；未确认分片会被重传。

例如在部署目录使用 `docker compose --profile cloud stop nginx server`，待其退出后 `docker compose --profile cloud stop silo mysql`，再制作文件系统备份。备份含密钥，应按服务器私密数据保存。数据库配置见 [Moss Server 数据库](server-database.md)。

**验证入口**

```sh
bun test server/src/__tests__/cloudStorage.test.ts
# Docker 真实 Silo，包括初始化重试、2 GiB 传输和 SHA-256 校验
MOSS_CLOUD_SILO_TEST=1 bun test server/src/__tests__/cloudStorage.test.ts
# 有桌面运行环境时使用 Electron net.fetch 跑同一套链路
MOSS_CLOUD_SILO_TEST=1 MOSS_CLOUD_ELECTRON_TEST=1 bun test server/src/__tests__/cloudStorage.test.ts
bash deploy/server/scripts/validate.sh
# 数据库重构后的完整服务端回归
cd server && bun test src && bun run test:mysql
```

本机源码部署与真实 HTTPS 验证（在仓库根目录执行）：

```sh
bash deploy/server/local.sh "$HOME/moss-server-local"
node server/scripts/test-deployment.mjs "$HOME/moss-server-local" --restart

# 停写备份、删除测试文件、恢复 MySQL/Silo/凭证后校验
MOSS_DEPLOY_TEST_MODE=host-only node server/scripts/test-deployment.mjs "$HOME/moss-server-local" --backup
# 重新编译并部署，验证数据、配置和凭证保留
MOSS_DEPLOY_TEST_MODE=host-only node server/scripts/test-deployment.mjs "$HOME/moss-server-local" --rebuild

# Electron 的真实 HTTPS 网络栈；仅信任此测试证书及 127.0.0.1
MOSS_DEPLOY_TEST_HOME="$HOME/moss-server-local" \
MOSS_DEPLOY_TEST_MODE=host-only \
MOSS_CLOUD_TEST_CA="$HOME/moss-server-local/tls/server.crt" \
ui/node_modules/.bin/electron ui/tests/helpers/cloud-electron.cjs "$PWD/server/scripts/test-deployment.mjs"
```

部署测试只用于可重启、可恢复的测试安装，使用 `.env` 中的初始登录信息。测试文件会删除，测试用户会禁用；结果写入部署目录的 `verification/`。基础镜像代理及本机构建参数见 [部署说明](../deploy/server/README.md)。

Host API 次版本提升到 2.2.0，兼容原有 `^2.0.0` / `^2.1.0` App。分享仍是后续独立阶段；本期已保留稳定文件 ID、内容版本、所有者和统一授权入口。

2026-09-23 数据库重构后验证：SQLite 与真实 MySQL 服务端回归各 55 项、桌面回归 670 项、review 新增回归 12 项，以及 Server/Admin/桌面类型检查均通过。独立 Compose 部署使用本机源码编译的 ARM64 Server 镜像、MySQL 8.4.8 和指定 Silo，实际 HTTPS 网关的 2 GiB + 101 字节上传下载及重启后 SHA-256 校验通过。Node Host 与 Electron 40.8.3 各验证 35 MiB + 101 字节的进度、暂停、重建 Host 后续传及下载校验。

停写备份后删除测试文件，再恢复数据库、对象、加密凭证和主密钥，内容校验通过；重复源码构建、部署和 Silo 初始化后的配置、凭证和文件保留也通过。验证报告位于部署目录 `verification/`。本轮为 macOS ARM64 / Docker Desktop 实测，未把 Linux AMD64 发布环境或完整网盘 GUI 标记为已测试。
