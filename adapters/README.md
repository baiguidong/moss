# Moss 飞书 Adapter

当前目录只放 IM Adapter 运行时代码。

配置以 Desktop Webapp 流程为准。

## 当前方案摘要

当前真实链路是：

```text
Desktop Webapp Settings
  -> ~/.moss/settings.json (adapters)
  -> Electron Main 启动 Feishu Adapter 子进程
  -> 版本化进程 IPC
  -> Moss Desktop session / notification / decision
```

注意：

- IM 配置和配对都在 Desktop Webapp 的 `Settings -> IM 接入`
- Desktop 客户端启动时会在飞书凭据完整的情况下自动启动飞书 Adapter；保存新配置后也会立即启动或按需重启
- 飞书 Adapter 必须由 Moss Desktop 启动，不再连接 `/api/sessions` 或 `/ws/:sessionId`

## 快速启动

```bash
cd adapters
bun install
bun run feishu
```

## 开发

### 运行测试

```bash
cd adapters
bun test
bun test common/
bun test feishu/
```

### 目录结构

```text
adapters/
├── common/
│   └── attachment/        # 附件工具(types / limits / store / image-watcher)
├── feishu/
│   ├── media.ts           # FeishuMediaService(@larksuiteoapi/node-sdk 封装)
│   └── extract-payload.ts # 入站 im.message.receive_v1 事件解析
├── package.json
├── tsconfig.json
└── README.md
```

## 附件收发

飞书 Desktop IPC 当前只接收入站文本；入站附件会返回明确提示。

**出站(Claude → 用户):**

Agent 文本里的 markdown 图片引用 `![alt](path|url|data:)` 会被 `ImageBlockWatcher` 识别、上传到 IM 平台,作为独立图片消息发出:

- 飞书: `im.message.create(msg_type='image')` 单发(card 内嵌是后续优化)

非图片类出站(Agent 产的 pdf/zip 等)暂不支持。

设计细节: `docs/superpowers/specs/2026-04-11-im-attachment-support-design.md`。
