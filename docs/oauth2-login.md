# OAuth2 登录

> moss 的 OAuth2 登录把所有 IdP 交互都放在 sudowork 桌面端完成，moss-server 通过一个可执行的“凭证脚本”解析回调结果。本文只介绍管理员侧的开关，IdP 协议细节请参考各厂商文档。

## 流程

```
sudowork (登录页)
   ├── GET /api/v1/auth/oauth2/config         ← 拿到 authorize URL 模板和策略
   ├── 在浏览器中打开 authorize URL (带 state)
   │     ↓
   │   IdP 完成认证后 302 到 sudowork://oauth2-callback?...&state=...
   │     ↓
   ├── 校验 state (可关，详见下文)
   └── POST /api/v1/auth/token (grant_type=oauth2, params=回调中的非 state 字段)
                    ↓
         moss-server 调用凭证脚本 → 解析出用户身份 → 颁发 token
```

`state` 的整个生命周期都在 sudowork 内：sudowork 生成、发送到 IdP、回调时校验。**moss-server 本身从不读取 state**——它只把回调里的 `code` / `access_token` / `refresh_token` 等业务参数（不含 state）转交给凭证脚本。

## 系统设置

在 **管理后台 → 系统设置 → OAuth2 登录** 配置：

| 字段                                | 说明                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **启用 OAuth2 登录**                | 总开关。关闭后客户端登录页不出现 OAuth2 选项。                                                                                                                                                                                                                                                                       |
| **强制校验 state 参数 (CSRF 保护)** | 默认 **开启**。客户端在 OAuth2 回调时会校验返回的 `state` 与发起授权时本地生成的值是否一致，防御跨站请求伪造。当 sudowork、IdP、moss-server 都部署在完全可信的内网，且能确保浏览器到 sudowork 的回调链路不经过外部网络时，可以关闭本开关。**关闭后客户端仍会在 authorize URL 中携带 `state`** —— 一些 IdP 强制要求该参数；只有回调时的本地校验会被跳过。 |
| **Authorize URL 模板**              | 完整的 IdP 授权地址。moss-server 只替换 `{redirect_uri}`，客户端填充 `{state}`，其它参数（`client_id` / `scope` / `response_type` ...）请直接写在 URL 中。                                                                                                                                                                  |
| **凭证脚本路径**                    | 服务器上可执行脚本的绝对路径，moss-server 以 `resolve` / `refresh` 两个子命令调用它。脚本输出 stdout JSON，包含用户身份。                                                                                                                                                                                                                |
| **Redirect URI**                    | 只读：`sudowork://oauth2-callback`。请在 IdP 中将该 URI 注册为允许的回调地址。                                                                                                                                                                                                                                           |

## 何时关闭 state 校验

默认开启即可——CSRF 是真实威胁，state 校验成本几乎为零。**仅在以下条件同时成立时**才考虑关闭：

1. 部署完全在受信任的企业内网（没有公网入站路径）。
2. IdP 在回调中会改写或丢弃 `state` 参数（比如某些把回调挂在企业网关后面的二次跳转方案，网关吞掉了 query string）。
3. 接受跳过 CSRF 校验带来的残余风险。

关闭只是跳过 sudowork 客户端的本地 state 等值比较；authorize URL 上仍会带 `state`，moss-server 也仍不参与校验。

## 设置的作用域

该开关存储在 moss-server 的 `~/.moss/settings.json`（`oauth2.requireState`），通过 `GET /api/v1/auth/oauth2/config` 下发给客户端。**它是 moss-server 级的策略**——连接到同一台 moss-server 的所有 sudowork 桌面端都会得到一致的行为。客户端不会缓存该值，每次进入 OAuth2 登录页时都会重新拉取。

## 校验

1. 默认状态：开关打开 → 篡改回调里的 `state` 应导致 sudowork 报“授权回调验证失败”。
2. 关闭后：客户端重新进入登录页（重新拉取 config）→ 同样的篡改应被忽略，登录正常完成。
3. 关闭后：仍可在浏览器跳转的 URL 中看到 `state=` 参数（authorize 阶段保留）。
