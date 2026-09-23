# Moss App SDK

当前 SDK 对应 Host API `2.1.0`，兼容要求 `^2.0.0` 的 App。

App 安装后自动启用。`backend.protocols` 是 Backend 需要的 Host 协议字符串数组，例如：

```json
{
  "protocols": ["moss.platform/v1", "moss.agent/v1"]
}
```

`persistent` Backend 只在 Moss 客户端运行期间常驻；`on-demand` Backend 在首次 Action 调用时启动，
空闲后退出。App 安装后默认启用。单实例 Backend 的默认实例也默认启用；如果缺少必填配置或密钥，
实例保持启用但等待配置完成。
