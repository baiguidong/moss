# Moss App SDK

当前 SDK 对应 Host API `2.1.0`，兼容要求 `^2.0.0` 的 App。

App 安装后自动启用。`backend.protocols` 是 Backend 需要的 Host 协议字符串数组，例如：

```json
{
  "protocols": ["moss.platform/v1", "moss.agent/v1"]
}
```

`persistent` Backend 只在 Moss 客户端运行期间常驻；`on-demand` Backend 在首次 Action 调用时启动，
空闲后退出。每个 App 最多运行一个由 Host 管理的 Backend 进程，使用 App 总开关控制。
如果缺少必填配置或密钥，App 保持启用，Backend 等待配置完成后运行。
