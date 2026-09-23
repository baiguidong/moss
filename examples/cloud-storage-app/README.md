在仓库根目录执行：

```sh
bun build examples/cloud-storage-app/src/backend.mjs --target=node --outfile=examples/cloud-storage-app/dist/backend.mjs
```

通过 Moss 的本地 App 安装入口安装此目录（使用现有 App 打包/签名流程）。安装时授权三个 `cloud-storage:*` 权限。在设置中开启远程、登录已启用云端存储的 moss-server，即可在示例页面选择文件、上传、列出文件并下载。

页面仅展示接口结果和任务事件。关闭页面后宿主可继续传输；退出 Moss 后，重新打开示例并查询任务，再显式恢复。既有 App 本地存储接口继续独立使用。
