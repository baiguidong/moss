# 创作 App 的会话存储

适用 App：可视化、文档、表格、演示文稿、模板、PDF。只切换新任务，不迁移或删除旧 App 私有目录中的任务。

## 所有权

这些 App 在 `app.moss.json` 声明 `backend.storage: "session"`，要求 Host API 3.23。Core 根据自己的会话记录分配：

```text
<session.workspace>/artifacts/<appId>/<sessionId>/
  .moss-session.json
  jobs/<taskId>/…                    # engine-apps
  workspace.json, files/, tasks/…    # PDF 的 local-tasks
  creation-review/…                  # PDF 检查和对比
```

会话 ID 仍参与目录分隔，因此两个使用同一项目工作目录的会话也不会共用任务记录。标记文件记录 sessionId、appId、instanceId；Core 校验真实路径和归属，不接受模型指定的输出根目录。

任务输入、导入副本、成品、预览、源材料、日志、版本和检查记录都属于上述目录。App 安装目录保存代码、Skill、字体等资源。App 私有目录保留引擎缓存；`engine-apps` 分别向引擎传递任务用的 `dataDir` / `directory` 和缓存用的 `cacheDir`。

模板草稿及技能包属于会话。用户明确保存后，沿用个人技能安装流程，把包含参考文件的完整包安装到个人库；安装后的模板不依赖会话路径。

## 调用、引用与恢复

- Core 在 Action 调度前绑定 `source.sessionId`、`source.workspace`、`source.storage`，SDK 原样传给 handler；这些字段不进入模型的工具参数。
- `createSessionBackend` 在同一后台进程中为各会话建立独立 handler、任务存储和队列。无会话的列表为空；App UI 首次导入或生成时，由宿主建立并绑定一个普通会话。
- 作品 URI 使用 `?session=<sessionId>`。Core 先核对所属会话，再将 URI 交给 App 解析。落盘的修改对比也包含完整会话引用。
- `moss.artifacts/v1 url.get` 支持 sessionId；文件根目录由 Core 查会话记录确定。签名 URL 随会话失效，不能借路径或符号链接访问其他会话的文件。
- `moss.session-storage/v1 scopes.pending` 仅返回当前 App 在有效会话中的待恢复目录。引擎排队任务恢复执行；PDF 沿用现有规则将中断任务标为 interrupted，供重新提交。
- 原生创作工具负责所有任务执行。五个引擎 App 的 CLI 仅提供 help/describe，PDF CLI 仍仅提供参数说明，避免另建不受会话生命周期管理的任务。

## 删除与权限

删除会话时先阻止新调用并等待目录分配结束，再调用内部 `session.close`。后台中止该会话的任务和核验、等待工作进程退出；未能确认停止时由宿主回收整个 App 进程树。之后删除带正确归属标记的会话产物。正常关闭一个会话不停止其他会话的任务。子会话采用相同清理流程。分叉会话会复制已完成的产物，重写任务元数据、修改对比和 transcript 中的会话引用；原会话删除后分叉仍可使用。后台创作任务仍在运行时拒绝分叉，避免复制半成品和重复执行任务。

这六个 App 的安装目录和私有目录不再进入 `Additional working directories`。Skill 安装目录通过独立的 Read 规则按需读取，不因此获得工作目录写权限。Environment 也排除了与主工作目录完全相同的重复项。

## 验证

Core：

```sh
bun test ui/tests/app-session-storage.test.mjs ui/tests/app-artifacts.test.mjs ui/tests/app-resources.test.ts
bun run build:electron-direct
```

App 仓库（`MOSS_CORE_ROOT` 可指向正在开发的 Core；默认使用 vendor/moss-core）：

```sh
MOSS_CORE_ROOT=../moss node --test scripts/session-creation-storage.test.mjs
node --test scripts/engine-app-queue.test.mjs packages/local-tasks/tests/activity.test.mjs packages/creation-apps/tests/document-comparison.test.mjs
node --test apps/{visualize,document-converter,spreadsheets,presentations,templates,pdf-tools}/tests/*.test.mjs
```

共享存储集成测试经过真实 Host、IPC、SDK 和任务工作进程，主用例使用合成引擎测试并发、版本、预览、恢复和删除；另有真实 PDF 引擎的导入和处理用例。它不代替六个 App 的实际入口和桌面验证。

桌面验证前，在 App 仓库分别运行上述六个 App 的 `bun run build`，并在 Core 运行 `bun run build:electron-direct` 和 `cd ui && bun run build:renderer`。随后在 Core 执行：

```sh
node ui/scripts/test-session-creation-cdp.mjs
```

脚本从相邻的 moss-apps（或 `MOSS_APPS_ROOT`）复制当前构建及真实 manifest/schema/资源到临时 profile，校验后安装。它启动实际 Electron main/preload/production renderer，通过本地 HTTP 模型夹具触发原生工具调用，检查发给模型的工具参数与 Environment、六个 App 的新任务与第二版本、会话隔离、预览、分叉与删除。截图、调用记录及检查结果写入 `output/session-creation-cdp`。不连接外部模型，不继承或修改用户 profile，不使用旧内置 ZIP 冒充新源码。

发布时需要同时更新 Core 和这六个 App，并将 App 仓库的 Core 源码依赖固定到包含本变更的提交。
