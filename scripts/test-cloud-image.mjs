#!/usr/bin/env node
// GitHub Linux only. Two users, real browser/WS, persistent system and program updates.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const run = promisify(execFile);
const docker = async (...args) => (await run('docker', args, { maxBuffer: 16 * 1024 * 1024, timeout: 600000 })).stdout.trim();
const image = process.argv[2]; if (!image) throw new Error('Pass a WebUI image');
const suffix = `moss-cloud-ci-${process.pid}-${Date.now()}`, gateway = `${suffix}-gateway`, state = `${suffix}-state`, network = `${suffix}-net`;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-cloud-ci-'));
const output = path.resolve('output/webui-validation/cloud'); await fs.mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:43129';
const auth = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let user;
  if (req.url === '/api/v1/auth/login') {
    let text = ''; for await (const chunk of req) text += chunk;
    const input = JSON.parse(text); user = input.username;
    if (!['alice', 'bob'].includes(user) || input.password !== 'ci-fixture-only') { res.writeHead(401); res.end('{}'); return; }
    res.end(JSON.stringify({ access_token: `ci-${user}`, expires_in: 3600 })); return;
  }
  user = req.headers.authorization?.replace('Bearer ci-', '');
  if (!['alice', 'bob'].includes(user)) { res.writeHead(401); res.end('{}'); return; }
  res.end(JSON.stringify({ user: { id: user }, organization: { id: 'ci' } }));
});
await new Promise(resolve => auth.listen(0, '0.0.0.0', resolve));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, owned = [], installation;
async function ready() {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}/healthz`)).ok) return; } catch {} await delay(1000); }
  throw new Error('Gateway not healthy');
}
const admin = async (...args) => JSON.parse(await docker('exec', gateway, 'node', '/opt/moss/cloud/cli.mjs', ...args));
async function apiLogin(user) {
  const res = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: 'ci-fixture-only' }) });
  assert.equal(res.status, 200, await res.clone().text()); return res.headers.get('set-cookie').split(';')[0];
}
const inspect = async id => JSON.parse(await docker('inspect', id))[0];
async function pageReady(page) { await page.waitForFunction(() => window.agentDesktop && document.querySelector('[contenteditable=true], textarea'), null, { timeout: 120000 }); }
try {
  await docker('network', 'create', network);
  await docker('run', '-d', '--name', gateway, '--network', network, '--add-host', 'host.docker.internal:host-gateway',
    '-p', '127.0.0.1:43129:43128', '-v', `${state}:/state`, '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '--user', '0', '--entrypoint', 'node', '-e', `MOSS_WEB_ORIGIN=${origin}`, '-e', `MOSS_WEB_IMAGE=${image}`,
    '-e', `MOSS_WEB_AUTH_SERVER=http://host.docker.internal:${auth.address().port}`, image, '/opt/moss/cloud/gateway.mjs');
  await ready(); installation = await docker('exec', gateway, 'cat', '/state/installation-id');
  assert.equal((await fetch(`${origin}/internal/status`)).status, 403);
  assert.equal((await fetch(`${origin}/_cloud/environments`)).status, 403);
  assert.equal((await fetch(`${origin}/api/files?path=/etc/passwd`)).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext(), contextB = await browser.newContext();
  const a = await contextA.newPage(), b = await contextB.newPage();
  await a.goto(origin); await a.locator('[name=username]').fill('alice'); await a.locator('[name=password]').fill('ci-fixture-only');
  const concurrent = apiLogin('alice');
  await a.getByRole('button', { name: '登录', exact: true }).click(); await pageReady(a); await concurrent;
  let rows = await admin('list'); assert.equal(rows.length, 1); const alice = rows[0]; owned.push(alice.containerId);
  await b.goto(origin); await b.locator('[name=username]').fill('bob'); await b.locator('[name=password]').fill('ci-fixture-only');
  await b.getByRole('button', { name: '登录', exact: true }).click(); await pageReady(b);
  rows = await admin('list'); assert.equal(rows.length, 2); const bob = rows.find(r => r.userId === 'bob'); owned.push(bob.containerId);
  assert.notEqual(alice.containerId, bob.containerId);
  const ai = await inspect(alice.containerId), bi = await inspect(bob.containerId);
  assert.notEqual(ai.HostConfig.NetworkMode, bi.HostConfig.NetworkMode);
  assert.notEqual(ai.Mounts[0].Name, bi.Mounts[0].Name);
  assert.ok(!ai.Mounts.some(m => m.Destination.includes('docker.sock')));
  const sessions = await a.evaluate(async () => {
    const first = await window.agentDesktop.createSession({ title: 'Alice one', agentMode: 'local' });
    const second = await window.agentDesktop.createSession({ title: 'Alice two', agentMode: 'local' });
    await window.agentDesktop.send({ sessionId: first.summary.id, prompt: '!printf cloud-alice > private.txt' });
    return { ids: [first.summary.id, second.summary.id], file: first.detail.workspace + '/private.txt' };
  });
  assert.equal(await a.evaluate(async file => (await fetch('/api/files?path=' + encodeURIComponent(file))).text(), sessions.file), 'cloud-alice');
  assert.equal(await b.evaluate(async file => (await fetch('/api/files?path=' + encodeURIComponent(file))).status, sessions.file), 404);
  await docker('exec', alice.containerId, 'bash', '-c', 'sudo apt-get update -qq && sudo apt-get install -y -qq tree && printf system | sudo tee /etc/moss-cloud-check >/dev/null && printf home > /home/moss/cloud-check');
  const verifyPersistent = async () => {
    assert.equal((await admin('list')).find(r => r.userId === 'alice').containerId, alice.containerId);
    assert.equal(await docker('exec', alice.containerId, 'cat', '/etc/moss-cloud-check'), 'system');
    assert.equal(await docker('exec', alice.containerId, 'cat', '/home/moss/cloud-check'), 'home');
    assert.match(await docker('exec', alice.containerId, 'tree', '--version'), /tree/);
  };
  await a.screenshot({ path: path.join(output, 'alice.png') }); await b.screenshot({ path: path.join(output, 'bob.png') });
  await docker('restart', gateway); await ready(); await apiLogin('alice'); await verifyPersistent();
  await admin('stop', alice.id); assert.equal((await inspect(alice.containerId)).State.Running, false);
  await apiLogin('alice'); await verifyPersistent();
  await fs.writeFile(path.join(temporary, 'Dockerfile'), `ARG BASE\nFROM \${BASE}\nUSER root\nARG TEST_VERSION\nARG BREAK_BOOT=0\nRUN TEST_VERSION="$TEST_VERSION" BREAK_BOOT="$BREAK_BOOT" node -e 'const fs=require("fs"),p="/opt/moss/package.json",j=JSON.parse(fs.readFileSync(p));j.version=process.env.TEST_VERSION;fs.writeFileSync(p,JSON.stringify(j));if(process.env.BREAK_BOOT==="1")fs.writeFileSync("/opt/moss/ui/src/main.mjs","process.exit(42);")'\nLABEL org.opencontainers.image.version="$TEST_VERSION"\nUSER moss\n`);
  for (const broken of [false, true]) {
    const version = `0.0.0-cloud-ci.${broken ? 'bad' : 'good'}`, tag = `${suffix}:${broken ? 'bad' : 'good'}`;
    await docker('build', '--build-arg', `BASE=${image}`, '--build-arg', `TEST_VERSION=${version}`, '--build-arg', `BREAK_BOOT=${broken ? 1 : 0}`, '-t', tag, temporary);
    if (broken) await assert.rejects(admin('upgrade', alice.id, tag));
    else assert.equal((await admin('upgrade', alice.id, tag)).version, version);
    assert.equal((await admin('list')).find(r => r.id === alice.id).version, '0.0.0-cloud-ci.good');
    await verifyPersistent();
  }
  const newCookie = await apiLogin('alice');
  const logout = await fetch(`${origin}/api/logout`, { method: 'POST', headers: { Origin: origin, Cookie: newCookie } }); assert.equal(logout.status, 200);
  assert.equal((await fetch(`${origin}/api/files?path=/etc/passwd`, { headers: { Cookie: newCookie } })).status, 401);
  assert.equal((await inspect(alice.containerId)).State.Running, true);
  await docker('rm', '-f', bob.containerId); // Explicitly destroy ONLY a disposable CI user's container to test refusal to recreate.
  const missing = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ username: 'bob', password: 'ci-fixture-only' }) });
  assert.equal(missing.status, 503); assert.match(await missing.text(), /原容器已丢失/);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, concurrentLogin: true, twoUserIsolation: true, multipleChatsOneContainer: true, controllerRestart: true, sameContainerStopStart: true, programUpgrade: true, badReleaseRollback: true, aptAndEtcPreserved: true, missingContainerNotRecreated: true, image }, null, 2));
  console.log('Cloud browser, isolation, persistence, upgrade and rollback validation passed.');
} finally {
  await browser?.close();
  for (const id of [gateway, ...owned]) { try { await fs.writeFile(path.join(output, `${id}.log`), await docker('logs', id)); } catch {} }
  // Only resources labeled by this isolated CI installation are eligible for cleanup.
  if (installation) {
    const list = async kind => (await docker(kind, 'ls', '-q', '--filter', `label=io.moss.installation=${installation}`)).split(/\s+/).filter(Boolean);
    for (const id of await list('container')) await docker('rm', '-f', id).catch(() => {});
    await docker('rm', '-f', gateway).catch(() => {});
    for (const id of await list('network')) await docker('network', 'rm', id).catch(() => {});
    for (const id of await list('volume')) await docker('volume', 'rm', id).catch(() => {});
  } else await docker('rm', '-f', gateway).catch(() => {});
  await docker('volume', 'rm', state).catch(() => {}); await docker('network', 'rm', network).catch(() => {});
  auth.close(); await fs.rm(temporary, { recursive: true, force: true });
}
