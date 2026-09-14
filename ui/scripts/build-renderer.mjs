import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js');

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--max-old-space-size=6144', viteBin, 'build'], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: process.env,
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`Renderer build failed (${signal || code || 'unknown'}).`));
  });
});

await import('./copy-build-resources.mjs');
