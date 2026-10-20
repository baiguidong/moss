import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, executeRelease } from './docker-webui.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-webui-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'deploy/webui'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"version":"0.1.0"}');
  for (const name of ['README.md', 'compose.yaml', 'compose.managed.yaml', '.env.example', 'manage.sh']) {
    await fs.copyFile(path.join(repo, 'deploy/webui', name), path.join(root, 'deploy/webui', name));
  }
  await fs.writeFile(path.join(root, 'deploy/webui/.env'), 'SECRET=must-not-be-packaged');
  const calls = [];
  const image = { Id: 'sha256:test', Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.version': 'dev' } } };
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'tar') return execFileSync(command, args, { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    if (args[0] === 'info') return 'linux/x86_64';
    if (args[0] === 'image') return JSON.stringify([image]);
    if (args[0] === 'save') writeFileSync(args[2], 'docker-image-fixture');
    return '';
  };
  return { root, execute, calls, image };
}

test('reject invalid platforms, flag conflicts and path-like versions before building', () => {
  for (const args of [
    ['build', '--platform', 'darwin/arm64'], ['package', '--push'], ['build', '--load', '--push'],
    ['build', '--platform', 'linux/amd64,linux/arm64'], ['package', '--version', '../bad'],
    ['build', '--tag', '--no-cache'], ['build', '--platfrom', 'linux/amd64'],
    ['package', '--skip-build', '--no-cache'], ['package', '--platform', 'linux/amd64,'],
  ]) assert.throws(() => parseOptions(args));
  assert.equal(parseOptions(['build', '--', '--help']).help, true);
});

test('build defaults to Docker architecture and loads; publishing is explicit', async t => {
  const fx = await fixture(t);
  await executeRelease(parseOptions(['build']), fx);
  const build = fx.calls.find(call => call[1] === 'buildx');
  assert.ok(build.includes('linux/amd64'));
  assert.ok(build.includes('--load'));
  assert.ok(!build.includes('--push'));
  fx.calls.length = 0;
  await executeRelease(parseOptions(['build', '--platform', 'linux/amd64,linux/arm64', '--push']), fx);
  assert.ok(fx.calls[0].includes('--push'));
});

test('offline package contains checksums, pinned image and deployment files, excluding secrets', async t => {
  const fx = await fixture(t);
  const options = parseOptions(['package', '--skip-build', '--tag', 'example/webui:test']);
  const result = await executeRelease(options, fx);
  const entries = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' });
  assert.match(entries, /moss-webui\/images\/moss-webui.tar/);
  assert.match(entries, /moss-webui\/SHA256SUMS/);
  assert.doesNotMatch(entries, /moss-webui\/\.env\n|node_modules|\.DS_Store/);
  const config = execFileSync('tar', ['-xOzf', result.archive, 'moss-webui/.env.example'], { encoding: 'utf8' });
  assert.match(config, /MOSS_WEB_IMAGE=example\/webui:test/);
  assert.equal(result.release.builtFromCheckout, false);
  assert.equal(result.release.image.labels['org.opencontainers.image.version'], 'dev');
  assert.match(await fs.readFile(result.checksum, 'utf8'), /^[a-f0-9]{64}  moss-webui-0.1.0-linux-amd64.tar.gz\n$/);
  assert.ok(!fx.calls.some(call => call[1] === 'buildx'));
  await assert.rejects(executeRelease(options, fx), /Output already exists/);
  assert.ok((await fs.stat(result.archive)).size > 0);
});

test('wrong image architecture and interrupted exports never produce a release', async t => {
  const fx = await fixture(t);
  fx.image.Architecture = 'arm64';
  await assert.rejects(executeRelease(parseOptions(['package', '--skip-build', '--platform', 'linux/amd64']), fx), /expected linux\/amd64/);
  assert.ok(!fx.calls.some(call => call[1] === 'save'));
  fx.image.Architecture = 'amd64';
  const execute = (command, args) => { if (args[0] === 'save') throw new Error('disk full'); return fx.execute(command, args); };
  await assert.rejects(executeRelease(parseOptions(['package', '--skip-build']), { ...fx, execute }), /disk full/);
  assert.deepEqual(await fs.readdir(path.join(fx.root, 'deploy/webui/dist')), []);
});

test('Server upgrade archives legacy WebUI before removing obsolete Compose containers', async t => {
  const fx = await fixture(t);
  const target = path.join(fx.root, 'server');
  const bin = path.join(fx.root, 'mock-bin');
  await fs.mkdir(path.join(target, 'scripts'), { recursive: true });
  await fs.mkdir(bin);
  for (const name of ['common.sh', 'cleanup-legacy.sh']) await fs.copyFile(path.join(repo, 'deploy/server/scripts', name), path.join(target, 'scripts', name));
  const envFile = path.join(target, '.env');
  await fs.writeFile(envFile, `COMPOSE_PROJECT_NAME=moss-server\nMOSS_SERVER_HOME=${target}\n`);
  const log = path.join(fx.root, 'commands.jsonl');
  await fs.writeFile(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('fs'); const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'ps' && args.includes('label=com.docker.compose.service=webui')) console.log('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
if (args[0] === 'ps' && args.includes('label=com.docker.compose.service=webui-proxy')) console.log('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
if (args[0] === 'ps' && args.includes('label=com.docker.compose.service=web-cloud-proxy')) console.log('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
if (args[0] === 'inspect') console.log('moss-server_moss-web-home');
if (args[0] === 'commit' && process.env.MOCK_FAIL_COMMIT) process.exit(1);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_LOG: log };
  const result = spawnSync('bash', [path.join(target, 'scripts/cleanup-legacy.sh')], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  const commit = calls.findIndex(args => args[0] === 'commit');
  const remove = calls.findIndex(args => args[0] === 'rm' && args.at(-1).startsWith('a'));
  assert.ok(commit >= 0 && remove > commit);
  assert.equal(calls.filter(args => args[0] === 'rm').length, 3);
  assert.match(await fs.readFile(path.join(target, 'legacy-webui-backups.tsv'), 'utf8'), /moss-legacy-webui:aaaaaaaaaaaa\tmoss-server_moss-web-home/);
  await fs.writeFile(log, '');
  const failed = spawnSync('bash', [path.join(target, 'scripts/cleanup-legacy.sh')], { env: { ...env, MOCK_FAIL_COMMIT: '1' }, encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.ok(!readFileSync(log, 'utf8').includes('"rm"'));
});
