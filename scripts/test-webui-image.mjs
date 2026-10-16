#!/usr/bin/env node
// Run on a Linux GitHub runner. Every container/volume belongs to this test.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const image = process.argv[2];
if (!image) throw new Error('Pass the built WebUI image tag.');
const name = `moss-webui-ci-${process.pid}-${Date.now()}`;
const volume = `${name}-home`;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-webui-ci-'));
const output = path.resolve('output/webui-validation');
await fs.mkdir(output, { recursive: true });
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const base = 'http://127.0.0.1:43128';
async function ready() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(1000);
  }
  throw new Error('WebUI did not become healthy.');
}
try {
  const [metadata] = JSON.parse(docker('image', 'inspect', image));
  assert.equal(`${metadata.Os}/${metadata.Architecture}`, 'linux/amd64');
  docker('run', '--detach', '--name', name, '--pull', 'never', '--add-host', 'host.docker.internal:host-gateway',
    '--publish', '127.0.0.1:43128:43128', '--env', `MOSS_WEB_ORIGIN=${base}`, '--volume', `${volume}:/home/moss`, image);
  await ready();
  const tokenFile = path.join(temporary, 'access-token');
  await fs.writeFile(tokenFile, docker('exec', name, 'cat', '/home/moss/.moss/web/access-token'), { mode: 0o600 });
  const result = spawnSync(process.execPath, ['ui/scripts/test-web-smoke.mjs'], { stdio: 'inherit', env: {
    ...process.env, MOSS_WEB_TEST_URL: base, MOSS_WEB_TEST_TOKEN_FILE: tokenFile,
    MOSS_WEB_TEST_MODEL_HOST: 'host.docker.internal', MOSS_WEB_TEST_OUTPUT: output,
  }, timeout: 240000 });
  assert.equal(result.status, 0, result.error?.message || 'Browser smoke failed.');
  docker('exec', name, 'bash', '-c', 'printf persistent > /home/moss/restart-check; printf system | sudo tee /etc/moss-restart-check >/dev/null');
  docker('restart', name);
  await ready();
  assert.equal(docker('exec', name, 'cat', '/home/moss/restart-check'), 'persistent');
  assert.equal(docker('exec', name, 'cat', '/etc/moss-restart-check'), 'system');
  const rendererCount = docker('exec', name, 'python3', '-c',
    'import pathlib; print(sum(b"--type=renderer" in p.read_bytes().split(b"\\0") for p in pathlib.Path("/proc").glob("[0-9]*/cmdline") if p.exists()))');
  assert.equal(rendererCount, '0');
  await fs.writeFile(path.join(output, 'image-validation.json'), JSON.stringify({
    image, id: metadata.Id, platform: 'linux/amd64', browserSmoke: true, restart: true,
    electronRendererProcesses: 0, systemRecoveryAfterContainerReplacement: false,
  }, null, 2));
} finally {
  try { await fs.writeFile(path.join(output, 'host.log'), docker('logs', name)); } catch {}
  try { docker('rm', '--force', name); } catch {}
  try { docker('volume', 'rm', volume); } catch {}
  await fs.rm(temporary, { recursive: true, force: true });
}
