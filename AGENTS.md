# Repository Guidelines

## Project structure

- `src/` contains the agent runtime and CLI. Remote client code lives in `src/remote/`, and its wire protocol lives in `packages/direct-connect-protocol/`.
- `ui/src/main.mjs` is the Electron entry point. `ui/src/renderer-react/` contains the React interface, and `ui/build/` holds desktop icons.
- `server/src/` implements the control plane, `admin/` contains its management console, and `cloud/` manages cloud computers. Put code used by multiple runtimes in `shared/` or the relevant package under `packages/`.

## Build and run locally

Use Bun 1.3.10 and Node.js 22.22.2 to match the CI quality job. Install ripgrep (`rg`) for source tests. Run these commands from the repository root to install dependencies and build the CLI, desktop runtime, and server.

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd admin
bun install --frozen-lockfile --cwd ui
bun run build:node
```

Run `node bin/cli.js` to start the CLI or `bun run --cwd ui dev` to launch Electron with the Vite development server.

## Moss Server 与 WebUI 部署更新

部署主机为 `root@10.0.1.181`，部署目录为 `/data/moss-server`。日常更新先在本地构建改动，用 `scp` 上传产物，再通过 SSH 将文件复制到运行中的目标容器并重启该容器。

例如，更新服务端入口时，在本地仓库根目录执行：

```sh
bun run build:server &&
  scp bin/moss-server.mjs root@10.0.1.181:/data/moss-server/ &&
  ssh root@10.0.1.181 'cd /data/moss-server && docker compose cp moss-server.mjs server:/opt/moss/app/bin/moss-server.mjs && docker compose restart server && docker compose ps server'
```

更新 WebUI 页面时，先用 `ssh root@10.0.1.181 'docker ps'` 确认承载目标用户页面的 WebUI 容器。用 `scp` 上传 WebUI 构建产物后，在主机上用 `docker cp` 复制到该容器对应的运行路径，再用 `docker restart` 重启并打开页面验证。直接写入容器的文件会保留到容器重建为止。

## Coding style and naming

Use two-space indentation and ES modules. Use camelCase for functions and PascalCase for React components and types. Match filenames to nearby modules, such as `createDirectConnectSession.ts` in the remote client and `remote-direct-oauth.mjs` in Electron. Follow the surrounding quote and semicolon style. Run `bun run --cwd ui check` for UI type and contract checks. The `admin` and `server` packages also provide `check` scripts.

## UI 风格

- **标题与文案**　界面保持简洁、干净。导航或标签页已经说明当前位置时，省去正文里的同名标题。仅在需要区分内容分组时添加小标题，保留操作标签和必要的状态提示。
- **布局与空间**　让列表、表格和预览区随窗口伸展。宽度足够时，将搜索、筛选和常用操作放在同一行；窄窗口允许换行。用对齐和适量留白区分分组，减少嵌套卡片和空白页头。
- **配色**　沿用 Moss 桌面的主题变量。用 `--background` 和 `--foreground` 搭配底色与正文，`--border` 区分区域，`--primary` 突出主操作或选中项，让配色随浅色和深色主题切换。参见 [桌面主题样式](ui/src/renderer-react/globals.css)。

## Testing

- Run `bun run test` for core, build-script, and protocol tests. To iterate on one module, run `bun test ./src/remote/createDirectConnectSession.test.ts`.
- Run `bun run --cwd server test` for server tests under `server/src/`. Place `*.test.ts` files beside the module or in its existing `__tests__/` directory.
- Run `bun run --cwd ui test` for UI tests. The runner discovers `*.test.ts`, `*.test.tsx`, and `*.test.mjs` under `ui/tests/` and `ui/src/` and selects Bun or Node’s test runner. CI checks suite results without a coverage threshold.

## Commits and pull requests

Use a lowercase prefix followed by an imperative summary, as in `fix: support OIDC redirects in the desktop login window`. History also uses `feat:`, `test:`, and `docs:`. In a pull request, describe the behavior change and list the checks you ran. Link a related issue when available and include a screenshot for visible UI changes.
