# Docker 离线安装包

面向 Ubuntu amd64/x86_64 服务器安装固定版本的 Docker Engine 和 Docker Compose。安装过程不访问网络，默认把镜像、容器和 named volume 数据统一存放到 `/data/docker`。

## 安装

把整个 `deploy/docker` 目录复制到目标服务器后执行：

```bash
cd deploy/docker
sudo ./install.sh
```

安装完成后可确认实际目录：

```bash
sudo docker info --format '{{.DockerRootDir}}'
```

输出应为 `/data/docker`。如需其他目录，只通过安装环境变量指定：

```bash
sudo env DOCKER_DATA_ROOT=/data/custom-docker ./install.sh
```

## 已有 Docker 数据

如果当前 Docker 使用另一个非空目录，安装器默认停止并提示，不会直接切换。确认磁盘空间足够后，可显式迁移：

```bash
sudo env MIGRATE_DOCKER_DATA=1 ./install.sh
```

安装器会停止 Docker，把现有数据完整复制到 `/data/docker`，再启动并校验新目录；旧目录不会自动删除。确认原有镜像、容器和 volume 均正常后再手工清理旧目录。

若要保留 Docker 原来的默认位置：

```bash
sudo env DOCKER_DATA_ROOT=/var/lib/docker ./install.sh
```

如果 `/etc/docker/daemon.json` 已包含 `data-root`，它必须先调整为目标目录；安装器不会改写文件中的其他 Docker 配置。

## 制作分发包

```bash
./package.sh
```

产物为 `dist/docker.tar.gz`，解压后进入 `docker-offline` 目录执行同一个 `install.sh`。
