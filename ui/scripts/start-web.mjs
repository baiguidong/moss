import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env, MOSS_WEB_MODE: '1',
  MOSS_HOME: process.env.MOSS_HOME || path.join(os.homedir(), '.moss-web'),
};
delete env.ELECTRON_RUN_AS_NODE;
const linuxFlags = process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu'] : [];
const child = spawn(require('electron'), [...linuxFlags, uiRoot, ...process.argv.slice(2)], { cwd: uiRoot, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal || code) console.error(`[moss-web] Host exited (${signal || code}).`);
  process.exitCode = code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
});
