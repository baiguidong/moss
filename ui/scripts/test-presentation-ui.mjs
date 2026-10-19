import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-presentation-ui-'));
let server, child;
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 5191, strictPort: false, hmr: false } });
  await server.listen();
  const env = { ...process.env, MOSS_PRESENTATION_UI_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/presentation-review.html`, MOSS_PRESENTATION_UI_TEMP: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), [path.join(root, 'tests/fixtures/presentation-review.cjs')], { cwd: root, env, stdio: 'inherit' });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); }
  finally { clearTimeout(timeout); }
} finally { if (child && child.exitCode === null) child.kill('SIGTERM'); await server?.close(); await fs.rm(temp, { recursive: true, force: true }); }
