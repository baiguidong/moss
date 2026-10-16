# WebUI 执行计划

更新：2026-10-16。按已确认范围实施：**一个用户一个长期保留的 Docker 容器**，浏览器访问统一入口；Agent 按本地模式操作这个容器。项目、聊天和终端共享该用户环境。Moss Server 复用现有认证 API，保留原有会话能力，本轮不扩展远程会话链路。

## 本轮实现

| 内容 | 实现及验收 |
| --- | --- |
| 共享 UI 和接口 | Desktop 使用 IPC，浏览器使用 HTTP/WS；共享业务处理器与 React UI。完整 Electron Host 无窗口运行，无 renderer/Xvfb |
| 统一登录 | 网关调用 Server login/me；首次原子登记并创建环境，之后启动/复用原容器 |
| 一用户一容器 | SQLite 唯一归属、环境锁和控制器租约；记录原始 container ID，发现丢失或替换时报错，不自动创建空白替代环境 |
| 隔离与限制 | 用户独立桥接网络及 HOME 卷，CPU/内存/PID 限制与用户数上限；用户容器无宿主 Docker socket |
| 程序升级 | 先检查 Agent、确认请求、终端和正在处理的请求；独立发布目录切换，重启同一容器；失败/中断回退旧程序 |
| 部署交付 | `gh` 触发 GitHub Linux AMD64 构建；真实浏览器、两个用户、同容器停启与升级回滚验收；通过后发布 GHCR 和离线包 |
| Server 安装 | `MOSS_WEB_ENABLED=1 MOSS_WEB_DEPLOY_MODE=cloud` 启用统一门户；保留原 `single` 模式和个人容器 |

自动验收入口：`cloud/tests/*.test.mjs`、`ui/tests/web-host.test.mjs`、`scripts/test-cloud-image.mjs`、`deploy/server/scripts/validate.sh`。真实镜像测试安装 apt 包并验证 `/etc`、HOME、container ID 在停启和程序升级后保留。测试中的账号、模型和容器均为隔离夹具，不调用付费模型。

## 持久化承诺

- 浏览器退出/断线、新建聊天：容器继续运行。
- 管理员停止后再次登录：启动**同一个**容器，系统写层、apt 安装和 HOME 保留。
- Moss 程序更新：切换 `/opt/moss` 指向的版本目录并重启原容器，不替换 Linux 系统层。
- 更新基础 OS、Node/Electron 运行要求或不兼容数据 schema：禁止通过普通程序更新强行切换，单独安排迁移。
- 删除容器、磁盘损坏、主机损坏后的完整恢复：后续实现。当前不自动删除个人容器；只有 HOME 卷不能恢复 `/usr`、`/etc`。
- 进程在停启/程序升级时重启，不承诺任意进程从原指令继续执行。自动休眠暂不启用。

**系统盘恢复、Incus/VM 选型不再作为本轮交付前置条件。** 保留原容器即满足本阶段系统软件连续性；备份及灾难恢复作为独立后续任务。

## 目标机验收已完成

2026-10-16 已在 Linux AMD64 主机 `10.0.1.181` 部署，入口为 `https://10.0.1.181:8444/`，使用现有 Moss Server 账号。独立部署目录 `/data/moss-cloud-webui`，复用 Server 认证网络和 TLS 证书。

- 镜像：`ghcr.io/baiguidong/moss-webui:0.0.1-webui.20261016.5`，由 [GitHub Actions](https://github.com/baiguidong/moss/actions/runs/38865670904) 在 Linux AMD64 构建、验收后发布；同次运行提供 WebUI 离线包和 Server 部署包。
- 已用真实浏览器和 Server 账号验证登录、容器内 Linux 命令、文件上传下载、旧会话读取，以及停止后重新登录。
- 已将已有用户环境从 `.3` 原地升级至 `.5`，保留原 container ID；升级前的工作区、HOME、`/etc` 文件和 apt 安装的 `tree` 均在升级、再次停启后保留。
- 门户重建后重新连接原个人网络，网关 IPv4/IPv6 转发关闭；个人容器不接入 Server 认证网络，不挂载 Docker socket。
- 当前试用上限为两个用户，每个容器 1 CPU、1 GB 内存、512 PIDs。双用户隔离及失败版本回滚由 GitHub 上的真实容器验收覆盖；目标机未调用付费模型。
- Docker 存储已迁移至 `/data/docker`，离线校验无差异，原 22 个容器 ID 与运行状态保留；21 个运行、1 个原本停止。根分区释放后约有 37 GB 可用，迁移前副本保存在 `/data/moss-maintenance/docker-migration.GpsJvO/docker-original`。

目标机浏览器、容器及服务验证记录位于 `output/webui-validation/host181/`；GitHub 验收记录位于上述运行的 `webui-validation-38865670904-1` artifact。

## 接下来的优先级

1. 补全 Desktop/Web 能力矩阵，逐项验证 App UI、资源预览、配置与 Linux 原生依赖；云电脑未提供 Linux 图形桌面操控。
2. 增加存储占用统计、磁盘配额/告警、创建队列和环境诊断。当前用户数量、CPU、内存、PID 有限制，磁盘没有硬配额。
3. 增加系统层、HOME、数据库、凭据与网关映射的一致性备份及恢复演练。程序历史目录目前保留，后续再提供受保护的回收策略。
4. 基于实际资源数据考虑休眠、定时唤醒、多节点和更强的 VM 隔离；先识别容器内后台任务，避免休眠中断用户服务。

## 运维约定

门户/代理可随版本部署更新；个人容器位于 Compose 项目之外。`stop.sh` 停止门户和 Server 配套服务，不会删除或自动停止所有个人电脑；`webui.sh stop <environment-id>` 检查空闲后停止指定用户环境。再次登录会启动它，`stop` 不是封禁账号。

`webui.sh upgrade <environment-id> <image>` 下载兼容镜像并更新指定个人电脑。先更新一个空闲环境再逐步推广；没有批量强制更新/删除接口。私有 GHCR 用宿主机 `docker login ghcr.io`，离线环境先 `docker load`；登录用户时不在后台执行不受控的镜像拉取。

网关持久卷保存环境映射和内部控制凭据，应限制访问并备份。重建网关保留状态卷后可重新连接原环境；网关重启要求浏览器重新登录。公开 HTTPS 端口由代理提供，个人容器和控制端点不发布到宿主端口。
