import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describeAppInstallation } from '../src/apps/app-tool-disclosure.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-installation-ui-'));
const manifest = process.env.MOSS_INSTALLATION_MANIFEST
  ? JSON.parse(await fs.readFile(process.env.MOSS_INSTALLATION_MANIFEST, 'utf8'))
  : { id: 'test.video', displayName: '动画工坊', version: '1.0.0', publisher: { name: 'Moss' }, permissions: ['local-files:pick'], contributes: {
    tools: Array.from({ length: 11 }, (_, i) => ({ id: `video-${i}`, title: `视频工具 ${i}`, description: `创建、查看和导出本地视频项目，工具序号 ${i}。`, effect: i % 2 ? 'write' : 'read' })),
    skills: [{ id: 'video', title: '视频创作', description: '在主会话创建分镜、场景并导出视频。' }],
  } };
await fs.writeFile(path.join(temp, 'disclosure.json'), JSON.stringify(describeAppInstallation(manifest, manifest.permissions)));
let server, child;
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 5192, strictPort: false, hmr: false } });
  await server.listen();
  const env = { ...process.env, MOSS_INSTALLATION_UI_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-installation-review.html`, MOSS_INSTALLATION_UI_TEMP: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), [path.join(root, 'tests/fixtures/app-installation-review.cjs')], { cwd: root, env, stdio: 'inherit' });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); }
  finally { clearTimeout(timeout); }
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await server?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
