# Moss OpenIM 部署包

用于把 OpenIM 和 Moss 权限回调部署到 Linux 服务器。部署包不包含镜像、运行数据或密钥。

## 环境要求

- 目标机已安装并启动 Docker Engine 和 Docker Compose v2。
- 安装脚本不会安装或检查 Docker，目标机需要联网拉取镜像。
- 使用 root 或 `sudo` 安装；默认目录为 `/data/moss-openim`。
- 默认使用 HTTP/WS，适合可信内网；公网部署应通过反向代理提供 HTTPS/WSS，并在安装时传入外部 URL。

## 打包

```bash
cd deps/im
./package.sh
```

产物位于 `dist/`：

```text
moss-openim-<版本>.tar.gz
moss-openim-<版本>.tar.gz.sha256
```

上传到目标机：

```bash
scp dist/moss-openim-*.tar.gz* root@服务器地址:/tmp/
```

## 安装

目标机上的 Moss Server 管理地址默认是 `http://127.0.0.1:43127`。同机使用容器化 Moss Server 时，安装器会创建共享的 `moss-integrations` Docker 网络，并让 `openim-server` 通过 `http://moss-server:43127` 回调 Moss。安装器还会自动探测 OpenIM 对外 IP、生成密钥、写入 `/data/moss-openim/.env`，并把 OpenIM 配置合并到 Moss Server 的 `settings.json`。

```bash
cd /tmp
sha256sum -c moss-openim-*.tar.gz.sha256
tar -xzf moss-openim-*.tar.gz
cd moss-openim
sudo ./install.sh
```

Moss 设置默认写到 `/data/moss-server/settings.json`。非默认 Moss 数据目录可以显式指定：

```bash
sudo env MOSS_SERVER_HOME=/data/moss-server ./install.sh
```

Moss 位于其他机器时，不能直接写远端文件。可使用具有 `admin:settings` 权限的 Moss token 在线写入配置：

```bash
sudo env \
  PUBLIC_HOST=10.0.1.180 \
  MOSS_SERVER_URL=http://10.0.1.10:43127 \
  WRITE_MOSS_SETTINGS=0 \
  MOSS_ADMIN_TOKEN='<管理员 token>' \
  ./install.sh
```

已通过反向代理提供 TLS 时，同时指定客户端使用的外部地址：

```bash
sudo env \
  PUBLIC_HOST=im.example.com \
  OPENIM_API_URL=https://im.example.com/api \
  OPENIM_WS_URL=wss://im.example.com/msg_gateway \
  OPENIM_CHAT_URL=https://im.example.com/chat \
  MINIO_EXTERNAL_ADDRESS=https://files.example.com \
  ./install.sh
```

所有安装参数都会写入 `/data/moss-openim/.env`。再次执行 `install.sh` 会保留未显式覆盖的端口、地址和密钥。

`MOSS_SERVER_URL` 是宿主机执行安装检查和在线配置时使用的地址；`MOSS_CALLBACK_URL` 是 OpenIM 容器发送 webhook 时使用的地址。默认同机部署无需设置后者。Moss Server 位于其他机器时，两者可以都设为远端可访问地址。

## 安装判定

安装器只有在以下检查全部通过后才报告成功：

- MongoDB、Redis、etcd、Kafka 和对象存储健康。
- `openim-server` 与 `openim-chat` 的本地服务端口均已监听；健康检查不执行运行时编译，也不依赖公网。
- 使用配置的管理密钥成功获取 OpenIM 管理员 token。
- OpenIM 容器能访问 Moss `/healthz`，且 Moss 接受带当前密钥的 webhook 请求。

如 Moss 暂时不在线，可用 `SKIP_MOSS_CHECK=1` 跳过最后两项 Moss 检查；此时权限回调尚未得到验证，不应视为生产可用。

## 启动和停止

```bash
sudo /data/moss-openim/start.sh
sudo /data/moss-openim/stop.sh
```

停止只删除容器和 Compose 网络，不删除 `/data/moss-openim/data`。OpenIM API、WebSocket 和文件端口默认监听所有网卡；Chat API、Admin API、MinIO 控制台及官方前端默认只监听 `127.0.0.1`，可通过 `.env` 中的 `OPENIM_BIND_IP` 和 `OPENIM_ADMIN_BIND_IP` 调整。
