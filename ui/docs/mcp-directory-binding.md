# 配置型 MCP 的目录绑定（Host API 3.10）

Filesystem 0.1.2 使用配置和 Core 公共页面，固定启动上游 `@modelcontextprotocol/server-filesystem@2026.8.31`，没有独立 Backend 或启动包装。首次 npx 连接可能需要下载依赖。

服务可声明以下可选配置；未声明时，既有 MCP 的行为保持不变：

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31"],
  "roots": {
    "includeWorkspace": true,
    "delivery": "arguments",
    "directories": []
  }
}
```

公共页面在服务含 `roots` 时显示“公共目录（可选）”。列表最多 32 项，支持绝对路径、`~/` 和空格。Core 在保存时校验公共目录，在连接前校验有效目录；不存在的目录报告错误，不覆盖已有设置。

`includeWorkspace` 控制当前会话工作目录是否排在公共目录之前。会话目录只在连接时注入，不保存到 App 配置。设置页检查使用空会话目录，公共目录也为空时，Filesystem 可列出工具，但没有文件访问范围。

`delivery: "arguments"` 将完整目录列表附加到 stdio 参数，随后所有 Roots 请求返回空列表。这使 Filesystem 在首次工具调用前已获得完整范围，保留 `/tmp` 等路径别名，且不会被异步 Roots 更新覆盖。`delivery: "roots"` 仅通过标准 MCP Roots 传递目录，不修改参数；路径使用 file URL 编码。Roots 是协议上下文，具体目录访问约束由服务实现。当前只允许本地 stdio 服务声明此配置。

每个会话仍拥有自己的连接。不同会话不能通过此配置自动访问对方工作区；显式添加的公共目录供使用该 App 的会话共享。目录变更沿用 Core 的配置变更和连接重建机制。

升级时保存包的原始默认配置，按原默认值、用户值、新默认值合并。未改动的默认参数随包更新；用户修改、禁用工具、服务启停、凭据和服务 ID 保留。旧目录型 Backend 在第二个参数中保存 JSON 设置，首次配置化时提取其中 `directories`，替换已过期的包内启动路径。不存在或不合法的旧目录不会被静默扩大为其他范围。

若新默认配置切换传输类型（如 stdio 改为 HTTP），已定制的连接保留完整旧配置，需用户主动切换，避免把本地目录等字段混入远程服务。

验证入口：

```sh
bun test ./ui/tests/mcp-directories.test.ts ./ui/tests/app-mcp-host.test.ts
MOSS_TEST_FILESYSTEM_MCP=1 bun test ./src/services/mcp/filesystem.integration.test.ts
```

真实服务测试默认读取相邻 `moss-apps/artifacts/moss.filesystem/0.1.2/package/mcp.json`，可通过 `MOSS_FILESYSTEM_CONFIG` 指定。应用仓库另提供 `node scripts/verify-filesystem.mjs --previous-archive <旧版 ZIP>` 验证真实安装、升级与设置保留。
