import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'moss-project-creation-host-'));
const env = { ...process.env, MOSS_HOME: root, MOSS_PROJECT_CREATION_SMOKE_ROOT: root, MOSS_OPEN_DEVTOOLS: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
await writeFile(path.join(root, '.smoke-marker'), 'project creation isolated');
try {
  await readFile(path.join(uiRoot, 'dist/renderer/index.html'));
  for (const phase of ['prepare', 'restart']) {
    const child = spawn(require('electron'), [fileURLToPath(new URL('../tests/helpers/project-creation-host-smoke.mjs', import.meta.url))], { cwd: uiRoot, env: { ...env, MOSS_PROJECT_CREATION_SMOKE_PHASE: phase }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 55_000);
    let code;
    try { code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }); }
    finally { clearTimeout(timeout); }
    if (code !== 0 || !log.includes(`PROJECT_CREATION_HOST_PASSED: ${phase}`)) throw new Error(`Electron ${phase} failed (${code}):\n${log}`);
    console.log(log.split('\n').find(line => line.startsWith(`PROJECT_CREATION_HOST_PASSED: ${phase}`)));
  }
} finally { await rm(root, { recursive: true, force: true }); }
