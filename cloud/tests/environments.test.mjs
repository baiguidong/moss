import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EnvironmentStore } from '../store.mjs';
import { Environments } from '../environments.mjs';

const identity = id => ({ user: { id }, organization: { id: 'org' } });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-cloud-'));
  const store = new EnvironmentStore(dir, { maxUsers: 2 }); store.acquire();
  t.after(() => { store.close(); return fs.rm(dir, { recursive: true, force: true }); });
  const containers = new Map(), calls = [];
  const images = Object.fromEntries(['old','new'].map((name,i) => [name, { Id: `sha256:${String(i).repeat(64)}`, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'io.moss.web.runtime': 'test', 'io.moss.web.data-schema': '1', 'org.opencontainers.image.version': name } } }]));
  const docker = {
    async inspect(id) { const info = [...containers.values()].find(c => c.Id === id) || containers.get(id); if (!info) throw Object.assign(new Error('not found'), { status: 404 }); return info; },
    async image(name) { return images[name] || Object.values(images).find(i => i.Id === name); },
    async network(name, labels) { return { Id: name, Labels: labels }; }, async connect() {},
    async request(method, route, body) { assert.equal(route, '/volumes/create'); return body; },
    async create(name, config) { calls.push(['create', name]); const info = { Id: `${containers.size}`, Config: config, Image: images.old.Id, State: { Running: false }, NetworkSettings: { Networks: { [name]: { IPAddress: '127.0.0.1' } } }, program: '/opt/moss-releases/bootstrap', version: 'old' }; containers.set(name, info); return info; },
    async start(id) { (await this.inspect(id)).State.Running = true; },
    async stop(id) { calls.push(['stop',id]); (await this.inspect(id)).State.Running = false; },
    async restart(id) { calls.push(['restart', id]); },
    async exec(id, args) { const c = await this.inspect(id); if (args.some(a => a.includes('realpathSync'))) return c.program; if (args.some(a => a.includes('/opt/moss.next'))) { c.program = args.at(-1); c.version = c.program.endsWith('bootstrap') ? 'old' : 'new'; } return ''; },
    async archive() { return null; }, async putArchive() {}, async removeHelper(id) { calls.push(['helper-remove', id]); },
  };
  const manager = new Environments({ store, docker, installation: 'test', gatewayContainer: 'gateway', image: 'old', origin: 'https://cloud.example' });
  let busy = false, failNew = false;
  manager.control = async (row, command) => { if (command === 'drain' && busy) throw new Error('busy'); return { version: (await docker.inspect(row.containerId)).version }; };
  manager.ready = async (row, version) => { const result = await manager.control(row, 'status'); if (failNew && version === 'new') throw new Error('bad release'); assert.ok(!version || result.version === version); return result; };
  return { dir, store, manager, containers, calls, docker, setBusy: value => busy = value, setFail: value => failNew = value };
}
test('concurrent logins reuse one persistent container; users get distinct networks, volumes and quotas', async t => {
  const fx = await fixture(t);
  const [a, a2] = await Promise.all([fx.manager.ensure(identity('a')), fx.manager.ensure(identity('a'))]);
  assert.equal(a.containerId, a2.containerId); assert.equal(fx.calls.filter(c => c[0] === 'create').length, 1);
  const b = await fx.manager.ensure(identity('b')); assert.notEqual(a.containerId, b.containerId);
  const ca = await fx.docker.inspect(a.containerId), cb = await fx.docker.inspect(b.containerId);
  assert.notEqual(ca.Config.HostConfig.NetworkMode, cb.Config.HostConfig.NetworkMode);
  assert.notEqual(ca.Config.HostConfig.Mounts[0].Source, cb.Config.HostConfig.Mounts[0].Source);
  assert.equal(ca.Config.HostConfig.Mounts.length, 1); assert.equal(ca.Config.HostConfig.Mounts[0].Target, '/home/moss');
  assert.throws(() => fx.manager.ensure(identity('c')), /配额/);
  await fx.manager.stop(a.id); const again = await fx.manager.ensure(identity('a')); assert.equal(again.containerId, a.containerId);
  fx.containers.delete(fx.manager.name(a));
  await assert.rejects(fx.manager.ensure(identity('a')), /原容器已丢失/);
  assert.equal(fx.calls.filter(c => c[0] === 'create').length, 2);
});
test('controller restart retains ownership and excludes another live controller', async t => {
  const fx = await fixture(t), a = await fx.manager.ensure(identity('a'));
  const other = new EnvironmentStore(fx.dir); assert.throws(() => other.acquire(), /controller/);
  fx.store.close(); other.acquire(); assert.equal(other.ensure(identity('a')).containerId, a.containerId);
  other.close(); fx.store.close = () => {};
});
test('busy upgrade rejected; program switch, failed boot rollback and interrupted update retain container', async t => {
  const fx = await fixture(t), a = await fx.manager.ensure(identity('a'));
  fx.setBusy(true); await assert.rejects(fx.manager.upgrade(a.id, 'new'), /busy/);
  assert.ok(!fx.calls.some(c => c[0] === 'restart'));
  fx.setBusy(false); fx.setFail(true); await assert.rejects(fx.manager.upgrade(a.id, 'new'), /bad release/);
  assert.equal(fx.store.get(a.id).version, 'old'); assert.equal(fx.store.get(a.id).upgrade, null);
  fx.setFail(false); const updated = await fx.manager.upgrade(a.id, 'new'); assert.equal(updated.version, 'new'); assert.equal(updated.containerId, a.containerId);
  fx.store.update(a.id, { upgrade: { previous: '/opt/moss-releases/bootstrap', previousVersion: 'old' } });
  fx.setBusy(true); await assert.rejects(fx.manager.ensure(identity('a')), /busy/);
  assert.ok(fx.store.get(a.id).upgrade); fx.setBusy(false);
  const recovered = await fx.manager.ensure(identity('a')); assert.equal(recovered.version, 'old'); assert.equal(recovered.containerId, a.containerId);
  assert.ok(fx.calls.filter(c => c[0] === 'helper-remove').every(c => c[1] !== a.containerId));
});
