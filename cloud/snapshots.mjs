import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SnapshotStore } from './snapshot-store.mjs';
import { RESTORE_GUARD } from './restore-guard.mjs';
import { normalizeSnapshotPolicy } from '../shared/webui-snapshot-policy.mjs';

const GiB = 1024 ** 3;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => structuredClone(value);
const publicSnapshot = ({ imageId, files, ...snapshot }) => snapshot;
export function snapshotInput(input = {}) {
  const action = input.action || 'create';
  if (!['create', 'restore', 'delete'].includes(action)) throw new Error('无效的快照操作');
  if (input.includesDataVolume !== undefined && typeof input.includesDataVolume !== 'boolean') throw new Error('数据卷选项必须为布尔值');
  const value = { action, snapshotId: action === 'create' ? null : String(input.snapshotId || ''), includesDataVolume: input.includesDataVolume === true,
    name: String(input.name || '').trim().slice(0, 100), notes: String(input.notes || '').trim().slice(0, 1000) };
  if (action !== 'create' && !/^[a-f0-9-]{36}$/.test(value.snapshotId)) throw new Error('无效的快照 ID');
  return value;
}

export class Snapshots {
  constructor({ computers, root, getPolicy = async () => ({ policy: normalizeSnapshotPolicy(), source: 'default' }), onFence = () => {} }) {
    Object.assign(this, { computers, root: path.resolve(root), getPolicy, onFence });
    this.environments = computers.store; this.docker = computers.docker;
    this.store = new SnapshotStore(computers.store); this.preflights = new Map(); this.running = new Set();
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  directory(env, id) {
    if (!/^env-[a-f0-9]{24}$/.test(env) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid snapshot path');
    return path.join(this.root, env, id);
  }
  labels(row, op) { return { ...this.computers.labels(row), 'io.moss.snapshot-operation': op.id }; }
  list(id) { return this.store.list(id).map(publicSnapshot); }
  async environment(id, accessToken) {
    const row = this.environments.get(id), policy = await this.getPolicy(accessToken);
    const list = this.store.list(id);
    return { id, state: row.state, generation: row.generation || 0, version: row.version, error: row.error,
      automationsPaused: !!row.automationsPaused, capabilities: { snapshots: true }, ...policy,
      usage: { count: list.length, bytes: list.reduce((n, s) => n + s.bytes, 0) },
      operation: row.operation ? this.store.operation(id, row.operation) : this.store.operations(id)[0] || null };
  }
  async home(row, info) {
    const mounts = info?.Mounts || [];
    if (info && (mounts.length !== 1 || mounts[0].Type !== 'volume' || mounts[0].Destination !== '/home/moss')) throw new Error('只支持单独的 HOME 数据卷；请先处理额外挂载');
    const name = info ? mounts[0].Name : row.homeVolume;
    if (!name) throw new Error('当前数据卷记录缺失，不能创建空白卷代替');
    const volume = await this.docker.volume(name);
    if (volume.Driver && volume.Driver !== 'local' || Object.keys(volume.Options || {}).length) throw new Error('仅支持 Docker 本地私有数据卷，不支持外部卷驱动或额外绑定');
    if (name !== row.adoptedHome) for (const [key, value] of Object.entries(this.computers.labels(row))) if (volume.Labels?.[key] !== value) throw new Error('数据卷归属不匹配');
    return name;
  }
  async original(row, allowMissing = false) {
    try { const info = await this.docker.inspect(row.containerId); this.computers.checkOwner(row, info); return info; }
    catch (error) { if (allowMissing && error.status === 404) return null; throw error; }
  }
  async hostStatus(row, allowUnavailable = false) {
    try { return await this.computers.control(row, 'status'); }
    catch (error) {
      // Ownership/authentication failures are never an offline recovery signal.
      if (allowUnavailable && (error.status >= 500 || ['TypeError', 'TimeoutError', 'SyntaxError'].includes(error.name))) return null;
      throw error;
    }
  }
  async preflight(id, raw, accessToken) {
    return this.computers.locked(id, async () => {
      const input = snapshotInput(raw), row = this.environments.get(id);
      if (row.operation || row.upgrade) throw new Error('环境已有维护任务');
      const snapshot = input.snapshotId ? this.store.get(id, input.snapshotId) : null;
      if (snapshot) input.includesDataVolume = snapshot.includesDataVolume;
      const policyResult = await this.getPolicy(accessToken), policy = normalizeSnapshotPolicy(policyResult.policy);
      const info = input.action === 'delete' ? null : await this.original(row, input.action === 'restore');
      let homeVolume = row.homeVolume, hostUnavailable = false;
      if (input.action !== 'delete') {
        if (input.action === 'create' || !input.includesDataVolume) homeVolume = await this.home(row, info);
        else { try { homeVolume = !info && !row.homeVolume ? null : await this.home(row, info); } catch (error) { if (error.status !== 404) throw error; homeVolume = null; } }
        if (info?.State.Running) {
          const status = await this.hostStatus(row, input.action === 'restore' && input.includesDataVolume);
          hostUnavailable = !status;
          if (status && status.snapshotProtocol !== 1) throw new Error('请先升级云电脑 Moss，当前版本不支持安全快照');
          if (status?.blockers?.length) throw new Error(`请先完成正在运行的工作：${status.blockers.join('、')}`);
        }
      }
      const protection = input.action === 'restore' && !!info && !hostUnavailable && (!input.includesDataVolume || !!homeVolume);
      const existing = this.store.list(id), bytes = existing.reduce((n, s) => n + s.bytes, 0);
      const needsSlot = input.action === 'create' || protection;
      if (needsSlot && existing.length >= policy.maxSnapshotsPerEnvironment) throw new Error('快照数量已达上限，请先删除快照（恢复前保护也占用一个名额）');
      const storage = input.action === 'delete' ? null : await this.storageInfo(row, homeVolume, input.includesDataVolume && !!homeVolume);
      let estimate = 0;
      if (needsSlot) {
        const sized = await this.docker.inspectSize(info.Id);
        const image = await this.docker.image(info.Image);
        estimate = Math.max(image.Size || 0, sized.SizeRootFs || 0) + (sized.SizeRw || 0) + 32 * 1024 ** 2;
        // The trusted helper does not execute the user's image or entrypoint.
        if (input.includesDataVolume) estimate += storage.volumeBytes;
        if (bytes + estimate > policy.maxBytesPerEnvironment) throw new Error('快照空间不足，请先清理快照或调整 Server 额度');
      }
      const dockerPeak = estimate * 2 + (input.action === 'restore' ? (snapshot.files['image.tar']?.bytes || 0) + (snapshot.files['home.tar']?.bytes || 0) : 0);
      if (storage && storage.freeBytes < dockerPeak + 128 * 1024 ** 2) throw new Error('Docker 磁盘剩余空间不足以完成捕获和恢复');
      const disk = await fsp.statfs(this.root);
      if (disk.bavail * disk.bsize < estimate + 64 * 1024 ** 2) throw new Error('快照存储磁盘剩余空间不足');
      if (input.action === 'restore') await this.verify(snapshot);
      const token = randomBytes(32).toString('base64url');
      const result = { token, input, generation: row.generation || 0, protection, hostUnavailable, homeVolume, originalId: info?.Id || null,
        originalRunning: !!info?.State.Running, estimatedBytes: estimate, availableBytes: policy.maxBytesPerEnvironment - bytes,
        policy, inventory: digest(existing.map(s => [s.id, s.bytes])), source: policyResult.source, expiresAt: Date.now() + 5 * 60_000,
        impact: input.action === 'delete' ? '永久删除这个快照归档，当前环境不变。' : input.action === 'create'
          ? `会短暂停止当前环境。${input.includesDataVolume ? '同时保存 HOME 数据卷。' : '只保存 Docker 环境，不备份数据卷。'}`
          : `${input.includesDataVolume ? '系统和数据卷恢复到快照时间。' : '系统恢复到快照时间，保留当前数据卷。'}${hostUnavailable ? '当前 Moss 服务无响应，无法确认是否有工作进行；确认后将停止原容器，可能中断未完成的工作。无法创建一致的恢复前保护快照，原容器和原卷保留供管理员处理，不会自动清理。' : protection ? '会创建相同范围的恢复前保护快照。' : '原容器或数据卷缺失，无法创建完整的恢复前保护。'}恢复后自动任务暂停，需手动启用。` };
      for (const [key, value] of this.preflights) if (value.expiresAt < Date.now()) this.preflights.delete(key);
      if (this.preflights.size >= 500) this.preflights.delete(this.preflights.keys().next().value);
      this.preflights.set(token, { ...result, environmentId: id });
      return result;
    });
  }
  async storageInfo(row, volume, measure) {
    const id = randomUUID(), op = { id }, name = `moss-snapshot-check-${id}`;
    // Deterministic labels permit startup cleanup even if the create response is lost.
    try {
      await this.helper(row, op, name, this.computers.image, volume, true);
      const bytes = measure ? Number((await this.docker.exec(name, ['du', '-sb', '/volume'])).split(/\s/)[0]) : 0;
      const df = await this.docker.exec(name, ['df', '-Pk', volume ? '/volume' : '/']);
      const freeBytes = Number(df.trim().split('\n').at(-1).trim().split(/\s+/)[3]) * 1024;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isFinite(freeBytes)) throw new Error('无法估算数据卷或 Docker 空间');
      return { volumeBytes: bytes + (measure ? 16 * 1024 ** 2 : 0), freeBytes };
    } finally { await this.docker.removeOwnedContainer(name, this.labels(row, op)); }
  }
  async helper(row, op, name, image, volume, readOnly = true) {
    const labels = this.labels(row, op);
    const mountedVolume = volume ? await this.docker.volume(volume) : null;
    try { await this.docker.create(name, { Image: image, User: '0', Labels: { ...labels, 'io.moss.role': 'snapshot-helper' },
      Entrypoint: ['/usr/local/bin/node', '-e', 'setInterval(()=>{},100000)'], Cmd: [], Env: ['NODE_OPTIONS=', 'LD_PRELOAD=', 'LD_LIBRARY_PATH='], Healthcheck: { Test: ['NONE'] },
      HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: ['DAC_READ_SEARCH'], SecurityOpt: ['no-new-privileges'], PidsLimit: 64, Memory: 512 * 1024 ** 2, RestartPolicy: { Name: 'no' },
        Mounts: volume ? [{ Type: 'volume', Source: volume, Target: '/volume', ReadOnly: readOnly, VolumeOptions: { NoCopy: true } }] : [] } }); }
    catch (error) { if (error.status !== 409) throw error; }
    const info = await this.docker.inspect(name);
    for (const [key, value] of Object.entries(labels)) if (info.Config.Labels?.[key] !== value) throw new Error('快照辅助容器归属不匹配');
    if (volume) {
      const current = await this.docker.volume(volume);
      if (digest([current.CreatedAt, current.Labels]) !== digest([mountedVolume.CreatedAt, mountedVolume.Labels])) throw new Error('数据卷在挂载期间被替换');
    }
    if (!info.State.Running) await this.docker.start(info.Id);
    return info;
  }
  async submit(id, raw, accessToken) {
    const input = snapshotInput(raw), key = raw.requestId;
    if (typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw new Error('缺少有效幂等请求 ID');
    return this.computers.locked(id, async () => {
      const old = this.store.byKey(id, key);
      if (input.snapshotId) input.includesDataVolume = old?.input.includesDataVolume ?? this.store.get(id, input.snapshotId).includesDataVolume;
      if (old) { if (digest(old.input) !== digest(input)) throw new Error('重复请求的内容不同'); return old; }
      const preflight = this.preflights.get(raw.preflightToken), row = this.environments.get(id);
      if (!preflight || preflight.environmentId !== id || preflight.expiresAt < Date.now() || digest(preflight.input) !== digest(input) || preflight.generation !== (row.generation || 0)) throw new Error('预检已失效，请重新确认范围');
      const policy = normalizeSnapshotPolicy((await this.getPolicy(accessToken)).policy);
      if (digest(this.store.list(id).map(s => [s.id, s.bytes])) !== preflight.inventory) throw new Error('快照用量已变化，请重新预检');
      if (digest(policy) !== digest(preflight.policy)) throw new Error('额度已变化，请重新预检');
      if (row.containerId !== preflight.originalId && input.action !== 'delete' && preflight.originalId !== null) throw new Error('当前环境已变化');
      const op = this.store.begin(row, key, input, { bytes: preflight.availableBytes, policy, estimate: preflight.estimatedBytes }, { preflight: copy(preflight) });
      this.preflights.delete(raw.preflightToken);
      // Start after releasing this lock; accepted jobs survive the request/browser.
      setImmediate(() => { const promise = this.computers.locked(id, () => this.run(op)); this.running.add(promise); promise.finally(() => this.running.delete(promise)).catch(() => {}); });
      return copy(op);
    });
  }
  stage(op, phase, patch = {}) { this.store.update(op, { phase, ...patch }); }
  async writeFile(op, file, input, allowance) {
    let bytes = 0, last = 0; const hash = createHash('sha256');
    await pipeline(input, new Transform({ transform: (chunk, _encoding, done) => {
      bytes += chunk.length;
      if (bytes > allowance) return done(new Error('归档超过可用快照额度，原环境保留'));
      hash.update(chunk); if (Date.now() - last > 1000) {
        const disk = fs.statfsSync(this.root);
        if (disk.bavail * disk.bsize < 64 * 1024 ** 2) return done(new Error('磁盘剩余空间不足，已停止归档并保留原环境'));
        this.store.update(op, { transferredBytes: bytes }); last = Date.now();
      }
      done(null, chunk);
    } }), fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    const handle = await fsp.open(file, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    return { bytes, sha256: hash.digest('hex') };
  }
  async verify(snapshot) {
    if (snapshot.format !== 1 || snapshot.state !== 'ready' || typeof snapshot.includesDataVolume !== 'boolean') throw new Error('快照格式无效');
    const required = snapshot.includesDataVolume ? ['image.tar', 'home.tar'] : ['image.tar'];
    if (digest(Object.keys(snapshot.files).sort()) !== digest(required.sort())) throw new Error('快照产物与范围声明不匹配');
    const dir = this.directory(snapshot.environmentId, snapshot.id);
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    if (digest(manifest) !== digest(snapshot)) throw new Error('快照 manifest 与控制器记录不符');
    for (const name of required) {
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of fs.createReadStream(path.join(dir, name))) { hash.update(chunk); bytes += chunk.length; }
      if (hash.digest('hex') !== snapshot.files[name].sha256 || bytes !== snapshot.files[name].bytes) throw new Error('快照归档已损坏或不完整');
    }
  }
  async capture(op, row, id, automatic) {
    const info = await this.original(row), dir = this.directory(row.id, id);
    const volume = await this.home(row, info);
    this.stage(op, 'saving-system', { captureId: id });
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const reference = `moss-snapshot/${this.computers.installation}/${id}`;
    this.store.update(op, { imageReference: reference });
    const committed = await this.docker.commit(info.Id, reference);
    this.store.update(op, { capturedImageId: committed.Id });
    await this.helper(row, op, op.helperName, committed.Id, volume);
    const program = JSON.parse(await this.docker.exec(op.helperName, ['/usr/local/bin/node', '--no-warnings', '-e', RESTORE_GUARD]));
    const image = await this.docker.image(committed.Id);
    this.environments.update(row.id, { homeVolume: volume, programDigest: program.programDigest, version: program.version });
    const files = {}; let bytes = 0;
    if (op.input.includesDataVolume) {
      this.stage(op, 'saving-data');
      files['home.tar'] = await this.writeFile(op, path.join(dir, 'home.tar'), await this.docker.archive(op.helperName, '/volume/.'), op.reservation.bytes);
      bytes += files['home.tar'].bytes;
    }
    await this.docker.removeOwnedContainer(op.helperName, this.labels(row, op));
    // For creation, resume the original as soon as both selected parts are fixed.
    if (!automatic) await this.resumeOriginal(op);
    this.stage(op, 'packaging');
    files['image.tar'] = await this.writeFile(op, path.join(dir, 'image.tar'), await this.docker.saveImage(committed.Id), op.reservation.bytes - bytes);
    bytes += files['image.tar'].bytes;
    const snapshot = { id, environmentId: row.id, format: 1, state: 'ready', includesDataVolume: op.input.includesDataVolume,
      volumes: op.input.includesDataVolume ? [{ target: '/home/moss', archive: 'home.tar' }] : [],
      name: automatic ? '恢复前自动保护' : op.input.name || `环境快照 ${new Date().toLocaleString('zh-CN')}`, notes: automatic ? '' : op.input.notes,
      automatic, createdAt: Date.now(), dataSchema: program.dataSchema || null, version: program.version, programDigest: program.programDigest, architecture: image.Architecture,
      imageId: committed.Id, imageReference: reference, bytes, files };
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    const manifestHandle = await fsp.open(path.join(dir, 'manifest.json'), 'r'); await manifestHandle.sync(); await manifestHandle.close();
    const directoryHandle = await fsp.open(dir, 'r'); await directoryHandle.sync(); await directoryHandle.close();
    this.store.save(snapshot);
    this.store.update(op, { capturePublished: true });
    return snapshot;
  }
  async stopOriginal(op) {
    const row = op.original, info = await this.original(row, true);
    if (!info) return;
    this.stage(op, 'stopping', { stopAttempted: true });
    if (info.State.Running) {
      if (op.preflight?.hostUnavailable) {
        const status = await this.hostStatus(row, true);
        if (status) {
          if (status.snapshotProtocol !== 1 || status.blockers?.length) throw new Error('原环境状态已变化，请重新预检并完成正在运行的工作');
          await this.computers.control(row, 'drain', { operationId: op.id });
        }
      } else await this.computers.control(row, 'drain', { operationId: op.id });
      this.onFence(row.id); await this.docker.stop(info.Id);
      const stopped = await this.docker.inspect(info.Id);
      if (stopped.State.Running || !op.preflight?.hostUnavailable && (stopped.State.OOMKilled || stopped.State.ExitCode === 137)) throw new Error('环境未正常停止，未创建一致性快照');
    }
    this.store.update(op, { originalStopped: true });
  }
  async resumeOriginal(op) {
    if (!op.preflight?.originalRunning || !op.stopAttempted || op.originalResumed || op.promoted) return;
    this.stage(op, 'starting-original');
    try {
      await this.docker.start(op.original.containerId);
      await this.computers.ready(op.original);
      await this.computers.control(op.original, 'resume', { operationId: op.id });
      this.environments.update(op.environmentId, { state: 'ready' });
      this.store.update(op, { originalResumed: true, resumeError: null });
    } catch (error) { this.store.update(op, { resumeError: error.message }); this.environments.update(op.environmentId, { state: 'error', error: `原环境启动失败：${error.message}` }); }
  }
  async restore(op) {
    const row = this.environments.get(op.environmentId), target = this.store.get(row.id, op.snapshotId);
    await this.verify(target);
    this.stage(op, 'loading-image');
    try { await this.docker.image(target.imageId); }
    catch (error) { if (error.status !== 404) throw error; await this.docker.loadImage(fs.createReadStream(path.join(this.directory(row.id, target.id), 'image.tar'))); }
    const image = await this.docker.image(target.imageId), currentImage = await this.docker.image(this.computers.image);
    if (image.Os !== 'linux' || image.Architecture !== currentImage.Architecture || image.Architecture !== target.architecture) throw new Error('快照架构不兼容');
    await this.stopOriginal(op);
    let protection;
    if (op.protectionId) protection = await this.capture(op, row, op.protectionId, true);
    if (!target.includesDataVolume && target.programDigest !== (protection?.programDigest || row.programDigest)) throw new Error('快照程序与当前数据的兼容性无法确认；仅环境恢复要求相同 Moss 程序，请使用包含数据卷的快照');
    const volume = target.includesDataVolume ? op.newVolume : await this.home(row, await this.original(row, true));
    if (target.includesDataVolume) {
      this.stage(op, 'restoring-data');
      const created = await this.docker.createVolume(volume, this.labels(row, op));
      for (const [key, value] of Object.entries(this.labels(row, op))) if (created.Labels?.[key] !== value) throw new Error('目标卷归属不匹配');
      await this.helper(row, op, op.helperName, this.computers.image, volume, false);
      // Docker extracts inside a read-only helper root; only this NEW volume is
      // writable. Archive links cannot write to the controller or another volume.
      await this.docker.putArchive(op.helperName, '/volume', fs.createReadStream(path.join(this.directory(row.id, target.id), 'home.tar')));
      await this.docker.removeOwnedContainer(op.helperName, this.labels(row, op));
    }
    this.stage(op, 'checking');
    await this.helper(row, op, op.helperName, image.Id, volume, true);
    const program = JSON.parse(await this.docker.exec(op.helperName, ['/usr/local/bin/node', '--no-warnings', '-e', RESTORE_GUARD]));
    if ((program.dataSchema || null) !== target.dataSchema) throw new Error('快照程序和当前数据结构不兼容，请使用包含数据卷的快照');
    if (program.programDigest !== target.programDigest || program.version !== target.version) throw new Error('快照内实际程序与 manifest 不匹配');
    const free = await this.docker.exec(op.helperName, ['df', '-Pk', '/volume']);
    const available = Number(free.trim().split('\n').at(-1).trim().split(/\s+/)[3]) * 1024;
    if (!Number.isFinite(available) || available < 128 * 1024 ** 2) throw new Error('Docker 数据磁盘剩余空间不足');
    await this.docker.removeOwnedContainer(op.helperName, this.labels(row, op));
    const controlToken = randomBytes(32).toString('base64url');
    this.store.update(op, { candidateToken: controlToken, candidateVolume: volume });
    const candidate = { ...row, containerId: null, controlToken, generation: (row.generation || 0) + 1 };
    const config = this.computers.containerConfig(candidate, image.Id, volume, { restored: true, imageEnv: image.Config.Env || [] });
    config.Labels = { ...config.Labels, ...this.labels(row, op) };
    config.HostConfig.RestartPolicy = { Name: 'no' };
    const result = await this.docker.create(op.candidateName, config);
    this.store.update(op, { candidateId: result.Id });
    // Candidate was validated without running business code. Traffic stays closed
    // while the journal atomically changes its mapping and credentials.
    const promoted = this.store.promote(op, { containerId: result.Id, homeVolume: volume, controlToken, state: 'restoring', automationsPaused: true,
      programDigest: target.programDigest, version: target.version, programImage: target.imageId,
      retired: [...(row.retired || []), { containerId: row.containerId, homeVolume: row.homeVolume || op.preflight.homeVolume, adopted: row.adoptedId === row.containerId, retain: !!op.preflight.hostUnavailable, expiresAt: Date.now() + 24 * 3600_000 }] });
    this.onFence(row.id);
    await this.activate(op, promoted);
  }
  async activate(op, row) {
    const original = await this.original(op.original, true);
    if (original?.State.Running && original.Id !== row.containerId) {
      await this.stopOriginal(op);
    }
    await this.docker.start(row.containerId);
    const status = await this.computers.ready(row, row.version);
    if (status.snapshotProtocol !== 1 || !status.automationsPaused) throw new Error('恢复后的 Host 没有进入安全启动模式');
    await this.docker.request('POST', `/containers/${row.containerId}/update`, { RestartPolicy: { Name: 'unless-stopped' } });
    this.environments.update(row.id, { state: 'ready', desiredState: 'running', error: null });
  }
  async rollback(op) {
    this.stage(op, 'rolling-back', { rollbackRequested: true });
    const current = this.environments.get(op.environmentId);
    const candidate = await this.docker.inspect(op.candidateId);
    for (const [key, value] of Object.entries(this.labels(current, op))) if (candidate.Config.Labels?.[key] !== value) throw new Error('回退候选容器归属不匹配');
    if (candidate.State.Running) await this.docker.stop(candidate.Id);
    // Fence again even when rolling back: browsers from either incarnation must
    // reload, and retired credentials must never route to the restored Host.
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const original = { ...op.original, generation: (current.generation || 0) + 1, operation: op.id,
        state: op.preflight.originalRunning ? 'starting' : 'stopped', error: op.error };
      this.store.db.prepare('UPDATE environments SET data=? WHERE id=?').run(JSON.stringify(original), original.id);
      this.store.update(op, { promoted: false, rolledBack: true });
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.onFence(current.id);
    await this.resumeOriginal(op);
  }
  async cleanup(op) {
    const row = this.environments.get(op.environmentId), labels = this.labels(row, op);
    await this.docker.removeOwnedContainer(op.helperName, labels);
    if (!op.promoted) {
      await this.docker.removeOwnedContainer(op.candidateName, labels);
      if (op.newVolume && op.newVolume !== row.homeVolume) await this.docker.removeOwnedVolume(op.newVolume, labels);
    }
    if (op.captureId && !this.store.list(row.id).some(s => s.id === op.captureId)) {
      await fsp.rm(this.directory(row.id, op.captureId), { recursive: true, force: true });
      if (op.imageReference) await this.docker.request('DELETE', `/images/${encodeURIComponent(op.imageReference)}`).catch(error => { if (error.status !== 404 && error.status !== 409) throw error; });
    }
  }
  async run(op, recovering = false) {
    let outcome = 'completed';
    try {
      if (recovering) {
        if (op.promoted && op.rollbackRequested) { await this.rollback(op); throw new Error(op.error || '恢复失败，已回退原环境'); }
        else if (op.promoted) await this.activate(op, this.environments.get(op.environmentId));
        else if (op.input.action === 'create' && this.store.list(op.environmentId).some(snapshot => snapshot.id === op.snapshotId)) await this.resumeOriginal(op);
        else if (op.input.action === 'delete') await this.deleteSnapshot(op);
        else throw new Error('控制器中断了快照任务，已保留原环境；请重新提交');
      } else if (op.input.action === 'delete') await this.deleteSnapshot(op);
      else if (op.input.action === 'create') { await this.stopOriginal(op); await this.capture(op, op.original, op.snapshotId, false); }
      else await this.restore(op);
      this.stage(op, 'finalizing');
    } catch (error) {
      if (op.promoted) {
        this.store.update(op, { error: error.message, rollbackRequested: true });
        try { await this.rollback(op); }
        catch (rollbackError) {
          this.environments.update(op.environmentId, { state: 'restore-error', error: `${error.message}；回退未完成：${rollbackError.message}` });
          this.stage(op, 'activation-failed', { status: 'attention', error: `${error.message}；回退未完成：${rollbackError.message}` });
          return;
        }
      }
      await this.resumeOriginal(op);
      outcome = 'failed'; this.store.update(op, { error: error.message });
    }
    try { await this.cleanup(op); }
    catch (error) { this.stage(op, 'cleanup-failed', { status: 'attention', cleanupError: error.message }); return; }
    this.store.finish(op, outcome);
  }
  async deleteSnapshot(op) {
    const snapshot = this.store.list(op.environmentId).find(s => s.id === op.snapshotId);
    if (!snapshot) return;
    this.stage(op, 'deleting');
    await fsp.rm(this.directory(op.environmentId, snapshot.id), { recursive: true, force: true });
    // Delete the owned tag only; other containers and user image references stay.
    if (snapshot.imageReference) await this.docker.request('DELETE', `/images/${encodeURIComponent(snapshot.imageReference)}`).catch(error => { if (![404, 409].includes(error.status)) throw error; });
    this.store.remove(op.environmentId, snapshot.id);
  }
  async reapHelpers() {
    const items = await this.docker.request('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`io.moss.installation=${this.computers.installation}`, 'io.moss.role=snapshot-helper'] }))}`);
    for (const info of items) {
      const row = this.environments.get(info.Labels?.['io.moss.environment']);
      if (!row || row.operation) continue;
      await this.docker.removeOwnedContainer(info.Id, { ...this.computers.labels(row), 'io.moss.role': 'snapshot-helper' });
    }
  }
  async recover() {
    for (const row of this.environments.all()) if (row.operation) await this.computers.locked(row.id, () => this.run(this.store.operation(row.id, row.operation), true));
  }
  async collectRetired() {
    for (const record of this.environments.all()) await this.computers.locked(record.id, async () => {
      const row = this.environments.get(record.id); if (row.operation || row.upgrade) return;
      const kept = [];
      for (const resource of row.retired || []) {
        if (!resource.containerId || resource.adopted || resource.retain || resource.expiresAt > Date.now() || resource.containerId === row.containerId) { kept.push(resource); continue; }
        try {
          await this.docker.removeOwnedContainer(resource.containerId, this.computers.labels(row));
          // Never remove a shared active HOME or a volume still referenced by a
          // retained container. The Engine independently rejects volumes in use.
          if (resource.homeVolume && resource.homeVolume !== row.homeVolume && !(row.retired || []).some(other => other !== resource && other.homeVolume === resource.homeVolume && (other.retain || other.adopted || other.expiresAt > Date.now()))) {
            await this.docker.removeOwnedVolume(resource.homeVolume, this.computers.labels(row));
          }
        } catch { kept.push(resource); }
      }
      if (kept.length !== (row.retired || []).length) this.environments.update(row.id, { retired: kept });
    });
  }
  async retry(id) {
    return this.computers.locked(id, async () => {
      const row = this.environments.get(id); if (!row.operation) throw new Error('没有待恢复的任务');
      const op = this.store.operation(id, row.operation); if (op.status !== 'attention') throw new Error('任务仍在进行');
      await this.run(op, true); return copy(op);
    });
  }
}
