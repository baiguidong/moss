# 文件卡片的数据来源与扩展

自动文件卡片只展示通过明确工具契约取得、且经本机文件系统校验的文件。
准确性指工具归属和文件定位；卡片打开当前文件，不保存执行时的历史版本，也不保证文件内容或格式有效。

## 当前支持范围

- 本地会话、主会话中的内置 `Write` / `Edit`。
- 通过 `toolUseId` 关联成功调用和结果，校验各自结构化结果中的 `filePath` 等字段。
- `Write` 显示已创建或已更新，`Edit` 显示已更新。
- 暂不支持 Read、Bash、外部工具、资料库、子代理和远程文件产物。
- 不从助手正文、链接、工具文本、工具输入、checkpoint 或通用附件猜测产物。

## 数据流

1. `agent-transcript.ts` 将已有 `tool_use_result` / `toolUseResult` 单独保留为展示层的 `structuredResult`。
   一个事件包含多个结果且无法明确归属时，不分配此字段。
2. `assistant-output-files.ts` 的精确工具适配表生成候选记录。没有完成结果、结果错误、结构不符或关联冲突时跳过。
3. `use-assistant-output-files.ts` 调用 `preview.resolveFiles`。候选内容相同的回复文本变化不会重复触发校验。
4. 主进程 `preview:resolve-files` 确认本地会话，接受本机绝对路径，经 realpath、只读打开和文件状态检查返回实际路径。
5. 校验通过后按会话内的轮次、实际路径去重，挂在工具结果之后的最后一条非流式助手回复下。
6. 切换会话立即隐藏旧结果，并丢弃旧异步请求。点击打开时再次检查文件，不查找同名替代文件。

所有新增状态都留在界面和本机 IPC 中。不修改工具定义、模型工具回复、提示词、会话原始消息或压缩摘要，不增加模型调用和模型输入 token。
历史会话使用相同规则重建；缺失结构化记录就不显示，不从正文回填，也不需要数据库迁移。

## 增加工具支持

在 `assistant-output-files.ts` 的适配表中添加精确工具身份和结果解析器：

- 确认结果表示已完成的文件操作，而非候选路径、原始导入位置或搜索命中。
- 校验该工具自己的结果结构，返回明确的路径与操作；未知版本或缺失字段返回 null。
- 本地路径继续经过统一文件校验，不能直接构造可点击卡片。
- 不使用工具名包含匹配，也不按任意工具结果中存在 `filePath` 自动启用。
- 新工具须覆盖成功、失败、结构缺失、调用关联、历史重放和定位错误的测试。

资料库应新增资源 URI 类型并接入已有资源解析器，不能使用 `metadata.origin` 代替资源身份。
远程文件需接入对应环境的校验和打开能力，不能交给本机路径接口。
普通 Bash 命令与 stdout 无可靠产物契约，继续不自动提取文件。

## 验证

在 `ui` 目录执行：

```sh
bun test tests/assistant-output-files.test.tsx tests/file-system-preview.test.ts tests/agent-transcript.test.ts tests/agent-transcript-streaming.test.ts
node scripts/test-output-files.mjs
bun run check
```

单元测试覆盖结构化来源、文件校验、路径去重、错误打开、实时/历史一致性，以及展示链路不改写原始消息和压缩记录。
Electron 测试覆盖校验前隐藏、会话切换、过期请求、正文变化、远程隔离与 IPC 失败。
