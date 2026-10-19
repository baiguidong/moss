// Run ONLY on the designated Linux validation machine. Uses a unique controller,
// private volumes and labels; never enumerates/deletes unrelated user resources.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Docker } from '../cloud/docker.mjs';
const image = process.argv[2]; if (!image) throw new Error('Pass the validation image');
const docker = new Docker(), suffix = `snapshot-validation-${Date.now()}`;
const gateway = `${suffix}-gateway`, state = `${suffix}-state`, archives = `${suffix}-archives`;
const origin = `http://127.0.0.1:${process.env.MOSS_SNAPSHOT_TEST_PORT || 43149}`;
const token = randomUUID() + randomUUID(), output = process.env.MOSS_SNAPSHOT_TEST_OUTPUT || '/evidence';
const labels = { 'io.moss.snapshot-validation': suffix };
let cookie, generation = 0, installation, browser;
const results = {};
await fs.mkdir(output, { recursive: true });
const api = async (route, body, method = body === undefined ? 'GET' : 'POST', expected = 200, extra = {}) => {
  const response = await fetch(origin + route, { method, headers: { Cookie: cookie || '', Origin: origin, 'Content-Type': 'application/json', 'X-Moss-Generation': String(generation), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); assert.equal(response.status, expected, `${route}: ${text}`);
  return text ? JSON.parse(text) : null;
};
async function login(management = false) {
  const response = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token, management }) });
  assert.equal(response.status, 200, await response.clone().text()); cookie = response.headers.get('set-cookie').split(';')[0];
}
async function ready() {
  for (let n = 0; n < 180; n++) { try { if ((await fetch(`${origin}/healthz`)).ok) return; } catch {} await delay(1000); } throw new Error('Gateway startup timed out');
}
async function operation(input) {
  const preflight = await api('/api/cloud/snapshots/preflight', input);
  const route = '/api/cloud/snapshots' + (input.snapshotId ? `/${input.snapshotId}${input.action === 'restore' ? '/restore' : ''}` : '');
  const op = await api(route, { ...input, preflightToken: preflight.token, requestId: randomUUID() }, input.action === 'delete' ? 'DELETE' : 'POST', 202);
  for (let n = 0; n < 600; n++) {
    const current = await api(`/api/cloud/operations/${op.id}`);
    if (current.status !== 'running') { assert.equal(current.status, 'completed', JSON.stringify(current)); const env = await api('/api/cloud/environment'); generation = env.generation; return current; }
    await delay(1000);
  }
  throw new Error('Snapshot job timed out');
}
const current = async () => (await api('/api/auth')).environment;
const marker = async (id, system, home) => docker.exec(id, ['node', '-e', 'const fs=require("fs");fs.writeFileSync("/etc/moss-snapshot-test",process.argv[1]);fs.writeFileSync("/home/moss/snapshot-test",process.argv[2],{mode:416});fs.chownSync("/home/moss/snapshot-test",1000,1000);', system, home]);
const read = (id, file) => docker.exec(id, ['cat', file]);
try {
  await docker.createVolume(state, labels); await docker.createVolume(archives, labels);
  await docker.create(gateway, { Image: image, User: '0', Entrypoint: ['node', '/opt/moss/cloud/gateway.mjs'], Cmd: [], Labels: labels,
    Env: [`MOSS_WEB_ORIGIN=${origin}`, `MOSS_WEB_IMAGE=${image}`, `MOSS_WEB_TOKEN=${token}`, `MOSS_CLOUD_GATEWAY_CONTAINER=${gateway}`, 'MOSS_CLOUD_STATE=/state', 'MOSS_CLOUD_SNAPSHOTS=/snapshots', 'MOSS_CLOUD_CPUS=2', 'MOSS_CLOUD_MEMORY_MB=2048'],
    HostConfig: { Binds: [`${state}:/state`, `${archives}:/snapshots`, '/var/run/docker.sock:/var/run/docker.sock'], PortBindings: { '43128/tcp': [{ HostIp: '127.0.0.1', HostPort: new URL(origin).port }] }, CapDrop: ['ALL'], Sysctls: { 'net.ipv4.ip_forward': '0', 'net.ipv6.conf.all.forwarding': '0' } } });
  await docker.start(gateway); await ready(); await login();
  installation = await docker.exec(gateway, ['cat', '/state/installation-id']);
  let row = await current(); const originalId = row.containerId, environmentId = row.id;
  const env = await api('/api/cloud/environment'); assert.equal(env.source, 'default'); assert.equal(env.policy.maxSnapshotsPerEnvironment, 5);
  assert.equal(env.policy.maxBytesPerEnvironment, 20 * 1024 ** 3); results.standaloneLoginAndDefaults = true;
  await marker(row.containerId, 'system-before', 'home-before');
  await docker.exec(row.containerId, ['node', '-e', 'require("fs").symlinkSync("snapshot-test","/home/moss/snapshot-link")']);
  let page;
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), args: ['--no-sandbox'] }); const context = await browser.newContext();
    await context.addCookies([{ name: 'moss_cloud', value: cookie.split('=')[1], url: origin, sameSite: 'Strict' }]);
    page = await context.newPage(); await page.goto(`${origin}/?window=cloud-environment`);
    await page.getByRole('button', { name: '创建快照', exact: true }).click();
    await assert.equal(await page.getByLabel('同时备份数据卷', { exact: true }).isChecked(), false);
    await page.getByLabel('同时备份数据卷', { exact: true }).check(); await page.getByRole('button', { name: '取消', exact: true }).first().click();
    await page.getByRole('button', { name: '创建快照', exact: true }).click(); assert.equal(await page.getByLabel('同时备份数据卷', { exact: true }).isChecked(), false);
    await page.keyboard.press('Escape'); results.checkboxResetsAndCancel = true;
  }
  const system = await operation({ action: 'create', name: '系统快照' });
  const combined = await operation({ action: 'create', name: '包含数据卷', includesDataVolume: true });
  let list = await api('/api/cloud/snapshots'); assert.equal(list.length, 2);
  assert.equal(list.find(s => s.id === system.snapshotId).includesDataVolume, false);
  const manifest = JSON.parse(await docker.exec(gateway, ['cat', `/snapshots/${environmentId}/${system.snapshotId}/manifest.json`]));
  assert.deepEqual(Object.keys(manifest.files), ['image.tar']); results.defaultNeverArchivesData = true;
  await marker(row.containerId, 'system-after', 'home-latest');
  const homeBefore = (await docker.inspect(row.containerId)).Mounts[0].Name;
  await operation({ action: 'restore', snapshotId: system.snapshotId }); row = await current();
  assert.notEqual(row.containerId, originalId); assert.equal(row.id, environmentId);
  assert.equal(await read(row.containerId, '/etc/moss-snapshot-test'), 'system-before');
  assert.equal(await read(row.containerId, '/home/moss/snapshot-test'), 'home-latest');
  assert.equal((await docker.inspect(row.containerId)).Mounts[0].Name, homeBefore);
  await api('/api/upload?name=stale.txt', {}, 'POST', 409, { 'X-Moss-Generation': '0' });
  results.systemRestoreKeepsCurrentHome = true; results.generationRejectsStaleWrites = true;
  await operation({ action: 'restore', snapshotId: combined.snapshotId }); row = await current();
  assert.equal(await read(row.containerId, '/home/moss/snapshot-test'), 'home-before');
  assert.notEqual((await docker.inspect(row.containerId)).Mounts[0].Name, homeBefore);
  assert.equal(await docker.exec(row.containerId, ['stat', '-c', '%a:%u:%g', '/home/moss/snapshot-test']), '640:1000:1000');
  assert.equal(await docker.exec(row.containerId, ['readlink', '/home/moss/snapshot-link']), 'snapshot-test');
  assert.equal((await api('/api/cloud/environment')).automationsPaused, true);
  results.combinedRestoreAndMetadata = true; results.automationsPaused = true;
  list = await api('/api/cloud/snapshots'); assert.equal(list.length, 4); assert.equal(list.filter(s => s.automatic).length, 2);
  await operation({ action: 'create', name: '最后一个名额' });
  await api('/api/cloud/snapshots/preflight', { action: 'restore', snapshotId: combined.snapshotId }, 'POST', 503);
  results.protectionCountedInQuota = true;
  const removed = (await api('/api/cloud/snapshots')).find(s => s.name === '最后一个名额');
  await operation({ action: 'delete', snapshotId: removed.id });
  // A running supervisor with a broken Host must still be recoverable from the
  // independent management page, without claiming consistent automatic backup.
  const brokenId = row.containerId, brokenHome = (await docker.inspect(brokenId)).Mounts[0].Name;
  await docker.exec(brokenId, ['node', '-e', 'require("fs").renameSync("/opt/moss/ui/src/main.mjs","/opt/moss/ui/src/main.mjs.validation-disabled")']);
  await docker.restart(brokenId);
  const loginStarted = Date.now(); await login(true);
  assert.equal((await api('/api/auth?management=1')).authenticated, true);
  assert.ok(Date.now() - loginStarted < 5000, 'Management login waited for the broken Host');
  const degraded = await api('/api/cloud/snapshots/preflight', { action: 'restore', snapshotId: combined.snapshotId });
  assert.equal(degraded.hostUnavailable, true); assert.equal(degraded.protection, false); assert.match(degraded.impact, /可能中断未完成/);
  await operation({ action: 'restore', snapshotId: combined.snapshotId }); row = await current();
  assert.equal((await docker.inspect(brokenId)).State.Running, false); await docker.volume(brokenHome);
  assert.equal((await api('/api/cloud/snapshots')).length, 4); results.brokenHostExplicitRecovery = true;
  // Deliberate loss of ONLY this disposable user's active container. Management
  // authentication/list/restore must still work without creating an empty Host.
  const lost = await docker.inspect(row.containerId);
  await docker.removeOwnedContainer(lost.Id, { 'io.moss.installation': installation, 'io.moss.environment': environmentId });
  await docker.removeOwnedVolume(lost.Mounts[0].Name, { 'io.moss.installation': installation, 'io.moss.environment': environmentId });
  await login(); assert.equal((await current()).containerId, lost.Id); assert.equal((await api('/api/cloud/snapshots')).length, 4);
  await operation({ action: 'restore', snapshotId: combined.snapshotId }); row = await current();
  assert.equal(await read(row.containerId, '/home/moss/snapshot-test'), 'home-before'); results.missingOriginalAndHomeExplicitRecovery = true;
  if (page) { await page.reload(); await page.getByRole('heading', { name: '环境快照', exact: true }).waitFor(); await page.screenshot({ path: path.join(output, 'snapshot-management.png'), fullPage: true }); }
  await docker.restart(gateway); await ready(); await login(); assert.equal((await current()).containerId, row.containerId); results.controllerRestartKeepsRestoredEnvironment = true;
  await fs.writeFile(path.join(output, 'snapshots-result.json'), JSON.stringify({ ok: true, image, ...results }, null, 2));
  console.log(JSON.stringify({ ok: true, ...results }));
} catch (error) {
  await fs.writeFile(path.join(output, 'snapshots-result.json'), JSON.stringify({ ok: false, image, results, error: error.stack }, null, 2)); throw error;
} finally {
  await browser?.close();
  // Only the unique installation and test labels are eligible for cleanup.
  if (installation) {
    const items = await docker.request('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`io.moss.installation=${installation}`] }))}`);
    for (const item of items) await docker.removeOwnedContainer(item.Id, { 'io.moss.installation': installation }).catch(() => {});
  }
  await docker.removeOwnedContainer(gateway, labels).catch(() => {});
  if (installation) {
    const volumes = await docker.request('GET', `/volumes?filters=${encodeURIComponent(JSON.stringify({ label: [`io.moss.installation=${installation}`] }))}`);
    for (const volume of volumes.Volumes || []) await docker.removeOwnedVolume(volume.Name, { 'io.moss.installation': installation }).catch(() => {});
    const images = await docker.request('GET', `/images/json?filters=${encodeURIComponent(JSON.stringify({ label: [`io.moss.installation=${installation}`] }))}`);
    for (const image of images) for (const tag of image.RepoTags || []) if (tag.startsWith(`moss-snapshot/${installation}/`)) await docker.request('DELETE', `/images/${encodeURIComponent(tag)}`).catch(() => {});
    const networks = await docker.request('GET', `/networks?filters=${encodeURIComponent(JSON.stringify({ label: [`io.moss.installation=${installation}`] }))}`);
    for (const network of networks) await docker.request('DELETE', `/networks/${network.Id}`).catch(() => {});
  }
  await docker.removeOwnedVolume(state, labels).catch(() => {}); await docker.removeOwnedVolume(archives, labels).catch(() => {});
}
