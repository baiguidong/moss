// Native Selection, layout, virtualization and copy commands need Chromium;
// server-rendered markup tests cannot detect lost DOM ranges.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-chat-selection-'));
let server;
let child;
try {
  server = await createServer({
    root: uiRoot,
    configFile: path.join(uiRoot, 'vite.config.ts'),
    cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 5187, strictPort: false, hmr: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), [path.join(uiRoot, 'tests/fixtures/chat-selection-electron.cjs')], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: {
      ...env,
      CHAT_SELECTION_TEMP: temp,
      CHAT_SELECTION_URL: `http://127.0.0.1:${address.port}/tests/fixtures/chat-selection.html`,
    },
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    process.exitCode = code;
  } finally {
    clearTimeout(timeout);
  }
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await server?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
