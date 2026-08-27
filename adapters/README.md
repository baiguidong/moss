# Claude Code IM Adapters

当前目录只放 IM Adapter 运行时代码。

用户文档已经迁移到 `docs/`，并且以 Desktop Webapp 配置流程为准：

- `docs/im/index.md`
- `docs/im/telegram.md`
- `docs/im/feishu.md`

## 当前方案摘要

当前真实链路是：

```text
Desktop Webapp Settings
  -> ~/.moss/settings.json (adapters)
  -> Electron Main 启动 Feishu Adapter 子进程
  -> 版本化进程 IPC
  -> Moss Desktop session / notification / decision
```

注意两点：

- IM 配置和配对都在 Desktop Webapp 的 `Settings -> IM 接入`
- Desktop 客户端启动时会在飞书凭据完整的情况下自动启动飞书 Adapter；保存新配置后也会立即启动或按需重启
- 飞书 Adapter 必须由 Moss Desktop 启动，不再连接 `/api/sessions` 或 `/ws/:sessionId`
- Telegram 仍可独立运行并使用原服务端链路

## 快速启动

```bash
cd adapters
bun install
bun run telegram
```

## 开发

### 运行测试

```bash
cd adapters
bun test
bun test common/
bun test telegram/
bun test feishu/
```

### 目录结构

```text
adapters/
├── common/
│   └── attachment/        # 跨平台附件工具(types / limits / store / image-watcher)
├── telegram/
│   └── media.ts           # TelegramMediaService(grammy Bot API 封装)
├── feishu/
│   ├── media.ts           # FeishuMediaService(@larksuiteoapi/node-sdk 封装)
│   └── extract-payload.ts # 入站 im.message.receive_v1 事件解析
├── package.json
├── tsconfig.json
└── README.md
```

## 附件收发

Telegram 保留双向图片/文件支持。飞书 Desktop IPC 的 MVP 当前只接收入站文本；入站附件会返回明确提示。

**入站(用户 → Claude):**

- Telegram: photo、document、video、audio、voice

下载落地到 `~/.moss/im-downloads/{platform}/{sessionId}/`,24 小时后自动 GC(`.part` 孤文件 10 分钟超时)。大小限制:单张图 ≤10 MB、单个文件 ≤30 MB,超限直接拒收并在 IM 里提示。

**出站(Claude → 用户):**

Agent 文本里的 markdown 图片引用 `![alt](path|url|data:)` 会被 `ImageBlockWatcher` 识别、上传到 IM 平台,作为独立图片消息发出:

- 飞书: `im.message.create(msg_type='image')` 单发(card 内嵌是后续优化)
- Telegram: `bot.api.sendPhoto(InputFile)` 单发

非图片类出站(Agent 产的 pdf/zip 等)暂不支持。

设计细节: `docs/superpowers/specs/2026-04-11-im-attachment-support-design.md`。
