# Moss RAGFlow 部署包

用于在 Linux x86_64 服务器上部署 RAGFlow、Native MCP、Extended MCP 和 Moss RAG MCP。安装过程不需要 RAGFlow 源码仓库。

## 环境要求

- 打包机只需要 Bash、Python 3 和 tar，不需要 Docker。
- 目标机为 Linux x86_64，并已通过独立脚本准备好 Docker Engine、Buildx 和 Docker Compose v2。
- 目标机推荐至少 4 CPU、16 GiB 内存和 50 GiB 可用磁盘。
- 目标机需要联网拉取运行镜像、Python 基础镜像和 Extended MCP 依赖。

`install.sh` 不检查也不安装 Docker，只负责拉取 RAGFlow 运行镜像、编译 Extended MCP 并启动服务。

## 安装

在 Moss 仓库中直接安装：

```bash
cd deploy/rag && sudo ./install.sh
```

## 打包迁移

在本目录执行：

```bash
./package.sh
```

生成文件位于 `dist/`：

```text
moss-ragflow-<版本>.tar.gz
moss-ragflow-<版本>.tar.gz.sha256
```

压缩包只包含部署文件和 Extended MCP 源码，不包含 Docker 镜像。

上传到目标机：

```bash
scp dist/moss-ragflow-*.tar.gz* root@服务器地址:/tmp/
```

在目标机安装：

```bash
cd /tmp && sha256sum -c moss-ragflow-*.tar.gz.sha256 && tar -xzf moss-ragflow-*.tar.gz && cd moss-ragflow && sudo ./install.sh
```

如果当前已经是 root 用户，去掉 `sudo` 即可。只测试基础服务、不下载 Ollama 模型：

```bash
sudo env WITH_LOCAL_MODELS=0 ./install.sh
```

默认安装目录为 `/data/moss-ragflow`，配置和密码保存在 `/data/moss-ragflow/.env`。安装成功后会把 `ragflow` 配置合并到 `/data/moss-server/server.json`，保留 Server 的其他配置，并在 Moss Server 正在运行时重启容器使其生效。

Moss Server 和 RAGFlow 会加入共享 Docker 网络 `moss-integrations`。写入 Server 的 RAGFlow 地址默认是容器可直接访问的 `http://moss-ragflow:9380` 和 `http://moss-ragflow:9381`，不依赖宿主机 IP 和端口绑定。

应先启动一次 Moss Server，使 `server.json` 已生成。若 Moss Server 使用其他数据目录，可设置 `MOSS_SERVER_HOME` 或 `MOSS_SERVER_CONFIG`。不需要修改本机 Moss Server 配置时，设置 `WRITE_MOSS_CONFIG=0`。

## 验证安装

```bash
sudo ragflowctl status
```

```bash
sudo ragflowctl doctor
```

查看管理员账号和初始密码：

```bash
sudo grep -E '^(RAGFLOW_ADMIN_EMAIL|ADMIN_DEFAULT_PASSWORD)=' /data/moss-ragflow/.env
```

浏览器访问：

```text
http://服务器地址
```

## 服务地址

| 服务 | 地址 | 认证方式 |
| --- | --- | --- |
| RAGFlow Web | `http://服务器地址:80` | 管理员账号 |
| Native MCP | `http://服务器地址:9382/mcp` | RAGFlow API Key |
| Extended MCP | `http://服务器地址:9385/mcp` | RAGFlow API Key |
| Moss RAG MCP | `http://服务器地址:9386/mcp` | Moss 登录凭据 |

Moss 中添加“RAGFlow 企业知识库”连接器时：

- 使用 Moss 登录态：填写 `服务器地址:9386`。
- 使用 RAGFlow API Key：填写 `服务器地址:9385` 和 API Key。

Moss Server 与 RAGFlow 不在同一台机器时，不能使用本机 Docker DNS，也不能直接修改远端配置文件。安装命令应关闭本地配置写入，并指定 RAG MCP 可访问的 Moss Server 地址：

```bash
sudo env \
  WRITE_MOSS_CONFIG=0 \
  MOSS_RAG_MCP_MOSS_SERVER_URL=https://Moss服务器地址 \
  ./install.sh
```

远端 Moss Server 需要另行配置 RAGFlow 的可访问地址，以及 `/data/moss-ragflow/.env` 中的 `ADMIN_DEFAULT_PASSWORD` 和 `MOSS_RAGFLOW_GATEWAY_TOKEN`。身份和权限设计见 [MOSS_RAG_MCP_DESIGN.md](MOSS_RAG_MCP_DESIGN.md)。

## 启停

```bash
sudo ./start.sh
sudo ./stop.sh
```

## 更新

重新执行 `sudo ./install.sh` 即可更新。安装器会保留 `.env` 和 Docker 数据卷。

## 注意事项

- 默认使用 HTTP，只适合可信内网；跨公网使用时应配置 TLS 反向代理。
- `80/9382/9385/9386` 是默认对外端口，`9381` 默认只监听本机。
- 安装包不包含 Docker 镜像，不支持离线安装。
- 修改 `.env` 后重新执行 `/data/moss-ragflow/install.sh` 使配置生效。
