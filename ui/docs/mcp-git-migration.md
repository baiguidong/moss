# Git 配置型 App（Host API 3.11）

Git 0.1.2 固定使用官方 Python 服务 `mcp-server-git==2026.8.18`。移除原 App 的 Node 服务、Backend 和页面。Core 新增两项可选 stdio 配置：

```json
{
  "command": "python3",
  "args": ["-I", "-m", "mcp_server_git"],
  "python": { "requirements": ["mcp-server-git==2026.8.18"] },
  "roots": { "includeWorkspace": true, "delivery": "roots", "directories": [] },
  "pathBindings": [{ "argument": "repo_path", "kind": "git-repository", "executable": "" }]
}
```

`python.requirements` 只接受固定版本。Core 使用内置 Python（或配置的解释器）创建专用 venv，按解释器身份和依赖列表缓存。安装有跨进程锁、超时和失败清理，不写入用户全局 Python。缓存默认在 Moss 数据目录下 `mcp/python`，可用 `MOSS_MCP_PYTHON_HOME` 覆盖。首次使用需要联网下载。

`pathBindings` 在 MCP Client 的请求边界工作，覆盖工具发现、常规调用和直接 SDK 调用；没有引入 MCP 代理进程。目录参数对模型可省略，Core 在发送前补全为当前会话 workspace。不会回退到第一个公共目录。没有会话目录时必须显式给出绝对路径。普通 `directory` 绑定允许配置目录的后代；`git-repository` 要求公共目录为仓库根目录，并同时校验请求真实路径、仓库根目录在范围内。workspace 可以是包含多个仓库的普通目录，默认调用失败时仍可显式选择其中的仓库。

Git 绑定的可选 `executable` 默认使用 PATH 中的 git，支持绝对路径及 `~/`。运行时映射到 `GIT_PYTHON_GIT_EXECUTABLE`。验证和上游进程使用相同 Git 环境：去除继承的 GIT_* 覆盖，禁用 hooks/fsmonitor、签名并启用字面路径。其余 Git 配置及输出、执行限制遵循上游和 Core；GitPython 自行执行提交钩子，不能用 Git 环境参数禁用；Core 检测到提交钩子时拒绝提交，检测到外部 diff/textconv 时拒绝相关差异操作，提示通过常规 Git 客户端完成。此范围校验不是操作系统沙箱。

升级采用现有三方默认值合并，额外将旧 JSON 参数中的 gitExecutable 保存到对应绑定。公共目录、禁用工具、启停和服务 ID 均保留。没有绑定或 Python 声明的既有 MCP 不受影响；Filesystem 的最低 Host 版本仍为 3.10。

验证：

```sh
bun test ui/tests/mcp-path-bindings.test.ts ui/tests/app-mcp-host.test.ts
node --test packages/app-runtime/tests/mcp-app.test.mjs
MOSS_TEST_GIT_MCP=1 bun test src/services/mcp/git.integration.test.ts
```

应用仓库另有 `scripts/verify-git.mjs --previous-archive <0.1.1 ZIP>`，验证真实安装升级、路径保留、错误设置保留旧值、检查、重启和权限撤销。
