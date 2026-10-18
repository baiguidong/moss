import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { EnvironmentStore } from '../store.mjs';
import { Environments } from '../environments.mjs';
import { Snapshots } from '../snapshots.mjs';
import { normalizeSnapshotPolicy, validateSnapshotPolicyPatch } from '../../shared/webui-snapshot-policy.mjs';
import { createIdentityProvider } from '../identity.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-snapshots-'));
  const store = new EnvironmentStore(root); store.acquire();
  const containers = new Map(), volumes = new Map(), images = new Map(), calls = [];
  const base = { Id: 'base', Size: 1024, Architecture: 'amd64', Os: 'linux', Config: { Env: [] }, program: 'same', system: 'before' };
  images.set('base', base);
  let counter = 0, failCandidate = false, failStop = false;
  const docker = {
    async inspect(id) { const value = containers.get(id) || [...containers.values()].find(c => c.Name === id); if (!value) throw Object.assign(new Error('missing container'), { status: 404 }); return value; },
    async inspectSize(id) { return { ...await this.inspect(id), SizeRootFs: 1024, SizeRw: 0 }; },
    async image(id) { const value = images.get(id); if (!value) throw Object.assign(new Error('missing image'), { status: 404 }); return value; },
    async volume(name) { const value = volumes.get(name); if (!value) throw Object.assign(new Error('missing volume'), { status: 404 }); return value; },
    async createVolume(name, Labels) { if (!volumes.has(name)) volumes.set(name, { Name: name, Labels, contents: '' }); return volumes.get(name); },
    async create(name, config) { const image = await this.image(config.Image); const info = { Id: `container-${++counter}`, Name: name, Config: config, Image: config.Image, State: { Running: false, ExitCode: 0 }, system: image.system,
      Mounts: (config.HostConfig?.Mounts || []).map(m => ({ Type: 'volume', Name: m.Source, Destination: m.Target })), NetworkSettings: { Networks: {} } }; containers.set(info.Id, info); calls.push(['create', name]); return info; },
    async start(id) { const c = await this.inspect(id); if (failCandidate && c.Name.startsWith('moss-restore-')) throw new Error('candidate boot failure'); c.State.Running = true; },
    async stop(id) { const c = await this.inspect(id); c.State.Running = false; if (failStop) c.State.ExitCode = 137; calls.push(['stop', id]); },
    async commit(id, reference) { const c = await this.inspect(id); assert.equal(c.State.Running, false); const i = { ...base, Id: `image-${++counter}`, system: c.system, program: (await this.image(c.Image)).program }; images.set(i.Id, i); images.set(reference, i); return i; },
    async saveImage(id) { return Readable.from([JSON.stringify(await this.image(id))]); },
    async loadImage(input) { let value = ''; for await (const chunk of input) value += chunk; const image = JSON.parse(value); images.set(image.Id, image); calls.push(['load']); },
    async archive(id) { const c = await this.inspect(id); calls.push(['archive', c.Mounts[0].Name]); return Readable.from([(await this.volume(c.Mounts[0].Name)).contents]); },
    async putArchive(id, _path, input) { const c = await this.inspect(id); let contents = ''; for await (const chunk of input) contents += chunk; (await this.volume(c.Mounts[0].Name)).contents = contents; calls.push(['extract', c.Mounts[0].Name]); },
    async exec(id, args) { const c = await this.inspect(id); if (args[0] === 'du') return '100 /volume'; if (args[0] === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted\ntest 999999999 1 999999998 1% /volume'; const i = await this.image(c.Image); return JSON.stringify({ protocol: 1, version: '1', programDigest: i.program }); },
    async removeOwnedContainer(id, labels) { let c; try { c = await this.inspect(id); } catch { return; } for (const [key, value] of Object.entries(labels)) assert.equal(c.Config.Labels[key], value); containers.delete(c.Id); calls.push(['remove', c.Id]); },
    async removeOwnedVolume(name, labels) { const v = volumes.get(name); if (!v) return; for (const [key, value] of Object.entries(labels)) assert.equal(v.Labels[key], value); assert.ok(![...containers.values()].some(c => c.Mounts.some(m => m.Name === name))); volumes.delete(name); },
    async request(method, route) { calls.push([method, route]); return {}; },
  };
  const computers = new Environments({ store, docker, installation: 'a'.repeat(32), image: 'base', origin: 'http://localhost' });
  let row = store.ensure({ user: { id: 'alice' } });
  await docker.createVolume('home', computers.labels(row)); volumes.get('home').contents = 'home-before';
  const original = await docker.create('original', computers.containerConfig(row, 'base', 'home')); await docker.start(original.Id);
  row = store.update(row.id, { containerId: original.Id, homeVolume: 'home', state: 'ready', version: '1' });
  computers.control = async (row, endpoint) => { calls.push(['control', endpoint]); return { version: '1', snapshotProtocol: 1, blockers: [], automationsPaused: true }; };
  computers.ready = async () => ({ version: '1', snapshotProtocol: 1, automationsPaused: true });
  let policy = normalizeSnapshotPolicy();
  const snapshots = new Snapshots({ computers, root: path.join(root, 'snapshots'), getPolicy: async () => ({ policy, source: 'default' }) });
  const wait = async op => { for (let i = 0; i < 500; i++) { const value = snapshots.store.operation(row.id, op.id); if (value.status !== 'running') return value; await new Promise(r => setTimeout(r, 5)); } throw new Error('operation timeout'); };
  const submit = async input => { const preflight = await snapshots.preflight(row.id, input); return snapshots.submit(row.id, { ...input, requestId: randomUUID(), preflightToken: preflight.token }); };
  const perform = async input => wait(await submit(input));
  t.after(async () => { await Promise.allSettled([...computers.locks.values()]); store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { row, store, root, snapshots, computers, docker, containers, volumes, images, calls, submit, perform, wait,
    setPolicy: value => policy = value, failCandidate: () => failCandidate = true, failStop: () => failStop = true };
}
test('policy fills each missing/invalid field; admin writes reject invalid values', () => {
  assert.deepEqual(normalizeSnapshotPolicy(), { maxSnapshotsPerEnvironment: 5, maxBytesPerEnvironment: 20 * 1024 ** 3 });
  assert.deepEqual(normalizeSnapshotPolicy({ maxSnapshotsPerEnvironment: 2, maxBytesPerEnvironment: -1 }), { maxSnapshotsPerEnvironment: 2, maxBytesPerEnvironment: 20 * 1024 ** 3 });
  assert.throws(() => validateSnapshotPolicyPatch({ maxSnapshotsPerEnvironment: '5' }));
  assert.throws(() => validateSnapshotPolicyPatch({ maxSnapshotsPerEnvironment: 1.5 }));
});
test('standalone identity survives key rotation; losing Server config never downgrades identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-identity-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const provider = await createIdentityProvider({ stateRoot: root, token: 'a'.repeat(32) });
  const login = await provider.request('/api/v1/auth/login', { token: 'a'.repeat(32) });
  assert.equal((await provider.request('/api/v1/auth/me', null, login.access_token)).user.id, 'local-owner');
  const rotated = await createIdentityProvider({ stateRoot: root, token: 'b'.repeat(32) });
  const next = await rotated.request('/api/v1/auth/login', { token: 'b'.repeat(32) });
  assert.equal((await rotated.request('/api/v1/auth/me', null, next.access_token)).user.id, 'local-owner');
  await assert.rejects(createIdentityProvider({ stateRoot: root, authBase: 'https://server' }), /认证模式/);
});
test('default captures system only; restore keeps latest HOME and protects only system', async t => {
  const f = await fixture(t); const created = await f.perform({ action: 'create' }); assert.equal(created.status, 'completed', created.error);
  const snapshot = f.snapshots.store.get(f.row.id, created.snapshotId);
  assert.equal(snapshot.includesDataVolume, false); assert.deepEqual(Object.keys(snapshot.files), ['image.tar']);
  (await f.docker.inspect(f.row.containerId)).system = 'after'; f.volumes.get('home').contents = 'home-latest';
  f.images.delete(snapshot.imageId);
  const restored = await f.perform({ action: 'restore', snapshotId: snapshot.id }); assert.equal(restored.status, 'completed', restored.error);
  const row = f.store.get(f.row.id), active = await f.docker.inspect(row.containerId);
  assert.equal(active.system, 'before'); assert.equal(row.homeVolume, 'home'); assert.equal(f.volumes.get('home').contents, 'home-latest');
  assert.equal(row.generation, 1); assert.equal(row.id, f.row.id); assert.notEqual(row.controlToken, f.row.controlToken);
  assert.equal(f.calls.filter(c => c[0] === 'archive' || c[0] === 'extract').length, 0);
  assert.equal(f.snapshots.store.get(row.id, restored.protectionId).includesDataVolume, false);
  assert.equal((await f.docker.inspect(f.row.containerId)).State.Running, false);
});
test('selected volume is restored into a new volume; original remains intact', async t => {
  const f = await fixture(t); const created = await f.perform({ action: 'create', includesDataVolume: true }); assert.equal(created.status, 'completed', created.error);
  f.volumes.get('home').contents = 'new data';
  const op = await f.perform({ action: 'restore', snapshotId: created.snapshotId }); assert.equal(op.status, 'completed', op.error);
  const row = f.store.get(f.row.id); assert.notEqual(row.homeVolume, 'home'); assert.equal(f.volumes.get(row.homeVolume).contents, 'home-before');
  assert.equal(f.volumes.get('home').contents, 'new data'); assert.equal(f.snapshots.store.get(row.id, op.protectionId).includesDataVolume, true);
});
test('candidate failure rolls back before opening traffic and preserves active volume', async t => {
  const f = await fixture(t); const created = await f.perform({ action: 'create' }); f.failCandidate();
  const restored = await f.perform({ action: 'restore', snapshotId: created.snapshotId }); assert.equal(restored.status, 'failed');
  const row = f.store.get(f.row.id); assert.equal(row.containerId, f.row.containerId); assert.equal(row.homeVolume, 'home'); assert.equal(row.generation, 2);
  assert.equal((await f.docker.inspect(row.containerId)).State.Running, true); assert.ok(f.volumes.has('home')); assert.ok(!row.operation);
});
test('scope binding, stale inventory, idempotence, total protection quota and ownership enforced', async t => {
  const f = await fixture(t), input = { action: 'create' };
  const p = await f.snapshots.preflight(f.row.id, input);
  await assert.rejects(f.snapshots.submit(f.row.id, { ...input, includesDataVolume: true, requestId: randomUUID(), preflightToken: p.token }), /预检/);
  const requestId = randomUUID(), op = await f.snapshots.submit(f.row.id, { ...input, requestId, preflightToken: p.token }); await f.wait(op);
  assert.equal((await f.snapshots.submit(f.row.id, { ...input, requestId, preflightToken: p.token })).id, op.id);
  assert.throws(() => f.snapshots.store.get('someone-else', op.snapshotId), /不存在/);
  f.setPolicy({ ...normalizeSnapshotPolicy(), maxSnapshotsPerEnvironment: 1 });
  await assert.rejects(f.snapshots.preflight(f.row.id, { action: 'restore', snapshotId: op.snapshotId }), /名额/);
  const deleted = await f.perform({ action: 'delete', snapshotId: op.snapshotId }); assert.equal(deleted.status, 'completed'); assert.equal(f.snapshots.list(f.row.id).length, 0);
});
test('corrupt archives and missing current volume are rejected before stopping', async t => {
  const f = await fixture(t), op = await f.perform({ action: 'create' });
  const snapshot = f.snapshots.store.get(f.row.id, op.snapshotId);
  await fs.appendFile(path.join(f.snapshots.directory(f.row.id, snapshot.id), 'image.tar'), 'corrupt');
  await assert.rejects(f.snapshots.preflight(f.row.id, { action: 'restore', snapshotId: snapshot.id }), /损坏/);
  f.volumes.delete('home'); await assert.rejects(f.snapshots.preflight(f.row.id, { action: 'create' }), /missing volume/);
  assert.equal((await f.docker.inspect(f.row.containerId)).State.Running, true);
});
test('unclean stop never publishes a snapshot; restart recovers pre-promotion interruption', async t => {
  const f = await fixture(t); f.failStop(); const op = await f.perform({ action: 'create' }); assert.equal(op.status, 'failed'); assert.equal(f.snapshots.list(f.row.id).length, 0);
  const row = f.store.get(f.row.id), pending = f.snapshots.store.begin(row, randomUUID(), { action: 'create' }, {});
  f.snapshots.store.update(pending, { original: row, stopAttempted: true, preflight: { originalRunning: true }, helperName: 'missing-helper', candidateName: 'missing-candidate' });
  await f.docker.stop(row.containerId); await f.snapshots.recover();
  assert.equal((await f.docker.inspect(row.containerId)).State.Running, true); assert.equal(f.store.get(row.id).operation, null);
});
test('preflight inventory cannot be reused after another snapshot consumes quota', async t => {
  const f = await fixture(t), p = await f.snapshots.preflight(f.row.id, { action: 'create' });
  await f.perform({ action: 'create' });
  await assert.rejects(f.snapshots.submit(f.row.id, { action: 'create', requestId: randomUUID(), preflightToken: p.token }), /用量已变化/);
});
test('combined recovery handles missing original and HOME without creating an empty replacement', async t => {
  const f = await fixture(t), captured = await f.perform({ action: 'create', includesDataVolume: true });
  f.containers.delete(f.row.containerId); f.volumes.delete('home');
  const p = await f.snapshots.preflight(f.row.id, { action: 'restore', snapshotId: captured.snapshotId });
  assert.equal(p.protection, false); assert.equal(f.volumes.has('home'), false);
  const op = await f.wait(await f.snapshots.submit(f.row.id, { action: 'restore', snapshotId: captured.snapshotId, requestId: randomUUID(), preflightToken: p.token }));
  assert.equal(op.status, 'completed', op.error); assert.equal(f.volumes.has('home'), false);
  assert.equal(f.volumes.get(f.store.get(f.row.id).homeVolume).contents, 'home-before');
});
test('recovery completes an atomic promotion and stops a restarted old container', async t => {
  const f = await fixture(t), row = f.store.get(f.row.id);
  const op = f.snapshots.store.begin(row, randomUUID(), { action: 'restore' }, {}, { preflight: { originalRunning: true } });
  assert.equal(f.snapshots.store.operation(row.id, op.id).original.containerId, row.containerId);
  const config = f.computers.containerConfig(row, 'base', 'home', { restored: true });
  const candidate = await f.docker.create(op.candidateName, config);
  f.snapshots.store.update(op, { candidateId: candidate.Id });
  f.snapshots.store.promote(op, { containerId: candidate.Id, homeVolume: 'home' });
  await f.snapshots.recover();
  assert.equal((await f.docker.inspect(candidate.Id)).State.Running, true);
  assert.equal((await f.docker.inspect(row.containerId)).State.Running, false);
  assert.equal(f.store.get(row.id).operation, null);
  assert.equal(f.snapshots.store.operation(row.id, op.id).status, 'completed');
});
