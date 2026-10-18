import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'moss-presentation-smoke-'));
await writeFile(path.join(root, '.presentation-smoke'), 'isolated');
const env = { ...process.env, MOSS_HOME: root, MOSS_PRESENTATION_SMOKE_ROOT: root, MOSS_OPEN_DEVTOOLS: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(require('electron'), [fileURLToPath(new URL('../tests/helpers/presentation-smoke.mjs', import.meta.url))], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }).finally(() => clearTimeout(timeout));
  if (code !== 0 || !log.includes('PRESENTATION_PASSED:')) throw new Error(log);
  console.log(log.split('\n').find(line => line.startsWith('PRESENTATION_PASSED:')));
} finally { await rm(root, { recursive: true, force: true }); }
