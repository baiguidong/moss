import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export class Environments {
  constructor({ store, docker, installation, gatewayContainer, image, origin, cpu = 1, memoryMb = 1024, pids = 512 }) {
    Object.assign(this, { store, docker, installation, gatewayContainer, image, origin, cpu, memoryMb, pids });
    this.locks = new Map();
    // Fence every Docker call, including calls resumed after an awaited copy.
    this.docker = new Proxy(docker, { get: (target, key) => typeof target[key] === 'function'
      ? (...args) => { store.assertLease(); return target[key](...args); } : target[key] });
  }
  locked(id, operation) {
    const previous = this.locks.get(id) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    this.locks.set(id, result);
    result.finally(() => { if (this.locks.get(id) === result) this.locks.delete(id); }).catch(() => {});
    return result;
  }
  labels(row) { return { 'io.moss.installation': this.installation, 'io.moss.environment': row.id, 'io.moss.user': row.userId, 'io.moss.org': row.orgId }; }
  name(row) { return `moss-${this.installation.slice(0, 12)}-${row.id}`; }
  checkOwner(row, info) {
    for (const [key, value] of Object.entries(this.labels(row))) if (info.Config.Labels?.[key] !== value) throw new Error('Container ownership does not match environment registry');
    if (row.containerId && row.containerId !== info.Id) throw new Error('Original personal container was replaced; automatic recreation is disabled');
  }
  async inspect(row) {
    try { const info = await this.docker.inspect(row.containerId || this.name(row)); this.checkOwner(row, info); return info; }
    catch (error) {
      if (error.status !== 404) throw error;
      if (row.containerId) { this.store.update(row.id, { state: 'missing', error: '原容器已丢失，未创建空白替代环境。' }); throw new Error('原容器已丢失，需要管理员处理；不会自动创建空白容器。'); }
      return null;
    }
  }
  async attach(row) {
    const network = await this.docker.network(this.name(row), this.labels(row));
    for (const [key, value] of Object.entries(this.labels(row))) if (network.Labels?.[key] !== value) throw new Error('Network ownership mismatch');
    await this.docker.connect(network.Id, this.gatewayContainer);
    return network;
  }
  async target(row) {
    const info = await this.inspect(row);
    if (!info?.State.Running) throw new Error('云电脑尚未启动。');
    const ip = info.NetworkSettings.Networks[this.name(row)]?.IPAddress;
    if (!ip) throw new Error('Cloud computer has no private network address');
    return `http://${ip}:43128`;
  }
  async control(row, endpoint, body, timeout = 15000) {
    const response = await fetch(`${await this.target(row)}/internal/${endpoint}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Moss-Control': row.controlToken }, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(timeout) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Cloud computer control request failed'), { status: response.status });
    return result;
  }
  async ready(row, version) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        const status = await this.control(row, 'status', undefined, 2000);
        if (!version || status.version === version) return status;
      } catch {}
      await delay(1000);
    }
    throw new Error('云电脑启动未完成，请查看环境日志后重试。');
  }
  ensure(identity) {
    const record = this.store.ensure(identity);
    return this.locked(record.id, async () => {
      let row = this.store.get(record.id);
      this.store.update(row.id, { desiredState: 'running' });
      await this.attach(row);
      let info = await this.inspect(row);
      if (!info) {
        const image = await this.docker.image(this.image);
        if (image.Os !== 'linux') throw new Error('A Linux WebUI image is required');
        const volume = await this.docker.request('POST', '/volumes/create', { Name: `${this.name(row)}-home`, Labels: this.labels(row) });
        for (const [key, value] of Object.entries(this.labels(row))) if (volume.Labels?.[key] !== value) throw new Error('User volume ownership mismatch');
        try {
          await this.docker.create(this.name(row), { Image: image.Id, Labels: { ...this.labels(row), 'io.moss.role': 'personal-computer' },
            Env: [`MOSS_WEB_ORIGIN=${this.origin}`, `MOSS_WEB_OWNER_ID=${row.userId}`, `MOSS_WEB_OWNER_ORG_ID=${row.orgId}`,
              `MOSS_ENVIRONMENT_ID=${row.id}`, `MOSS_WEB_CONTROL_TOKEN=${row.controlToken}`, 'MOSS_WEB_AUTH_SERVER=http://moss-cloud-gateway:43128/_moss-auth'],
            HostConfig: { NetworkMode: this.name(row), Mounts: [{ Type: 'volume', Source: volume.Name, Target: '/home/moss' }],
              Memory: this.memoryMb * 1024 * 1024, NanoCpus: Math.round(this.cpu * 1e9), PidsLimit: this.pids,
              RestartPolicy: { Name: 'unless-stopped' }, LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '3' } } },
          });
        } catch (error) { if (error.status !== 409) throw error; }
        info = await this.inspect(row);
      }
      row = this.store.update(row.id, { containerId: info.Id, state: 'starting', error: null });
      if (!info.State.Running) await this.docker.start(info.Id);
      if (row.upgrade) row = await this.recoverUpgrade(row);
      const status = await this.ready(row);
      if (status.maintenance) await this.control(row, 'resume', {});
      return this.store.update(row.id, { state: 'ready', version: status.version, lastActiveAt: Date.now() });
    });
  }
  async reconnectNetworks() {
    for (const row of this.store.all()) {
      if (row.containerId) {
        try {
          await this.inspect(row); await this.attach(row);
          if (row.upgrade) await this.locked(row.id, () => this.recoverUpgrade(row));
        } catch (error) { this.store.update(row.id, { state: 'error', error: error.message }); }
      }
    }
  }
  async recoverUpgrade(row) {
    const journal = row.upgrade;
    if (!journal) return row;
    const info = await this.inspect(row);
    if (!info.State.Running) await this.docker.start(info.Id);
    // A controller may have been down longer than the maintenance lease. Recheck
    // a responsive Host before restarting so resumed tasks are not interrupted.
    let responsive = false;
    try { await this.control(row, 'status', undefined, 2000); responsive = true; } catch {}
    if (responsive) await this.control(row, 'drain', {});
    if (journal.previous) {
      await this.switchProgram(info.Id, journal.previous);
      await this.docker.restart(info.Id);
    } else { await this.control(row, 'resume', {}); }
    const status = await this.ready(row, journal.previousVersion);
    if (journal.helper) await this.docker.removeHelper(journal.helper).catch(() => {});
    return this.store.update(row.id, { state: 'ready', version: status.version, programImage: journal.previousProgramImage || row.programImage, upgrade: null, error: 'Interrupted update rolled back; original container retained.' });
  }
  stop(id) {
    return this.locked(id, async () => {
      const row = this.store.get(id); if (!row) throw new Error('Unknown environment');
      const info = await this.inspect(row);
      if (row.upgrade) throw new Error('Resolve interrupted upgrade before stopping');
      if (info.State.Running) {
        await this.control(row, 'drain', {});
        try { await this.docker.stop(info.Id); }
        catch (error) { await this.control(row, 'resume', {}).catch(() => {}); throw error; }
      }
      return this.store.update(id, { state: 'stopped', desiredState: 'stopped' });
    });
  }
  upgrade(id, imageReference) {
    return this.locked(id, async () => {
      let row = this.store.get(id); if (!row) throw new Error('Unknown environment');
      if (row.upgrade) row = await this.recoverUpgrade(row);
      const info = await this.inspect(row); if (!info.State.Running) throw new Error('Start the cloud computer before upgrading');
      const base = await this.docker.image(row.programImage || info.Image), image = await this.docker.image(imageReference);
      for (const key of ['io.moss.web.runtime', 'io.moss.web.data-schema']) {
        if (!base.Config.Labels?.[key] || base.Config.Labels[key] !== image.Config.Labels?.[key]) throw new Error('Runtime/schema compatibility differs; an in-place program update is not supported');
      }
      if (base.Architecture !== image.Architecture || image.Os !== 'linux') throw new Error('Release architecture mismatch');
      const version = image.Config.Labels['org.opencontainers.image.version'];
      if (!version) throw new Error('Image has no release version');
      const before = await this.control(row, 'status');
      if (before.version === version) return { ...row, unchanged: true };
      const directory = `/opt/moss-releases/${image.Id.replace('sha256:', '')}`;
      let helper; let previous; let switched = false;
      try {
        await this.control(row, 'drain', {});
        previous = await this.docker.exec(info.Id, ['node', '-e', 'const fs=require("fs");if(!fs.lstatSync("/opt/moss").isSymbolicLink())throw Error("Runtime does not support program switching");console.log(fs.realpathSync("/opt/moss"));']);
        this.store.update(id, { state: 'upgrading', upgrade: { image: image.Id, version, previous, previousVersion: before.version, previousProgramImage: row.programImage || info.Image, startedAt: Date.now() } });
        await this.docker.exec(info.Id, ['node', '-e', 'require("fs").mkdirSync(process.argv[1],{recursive:true})', directory]);
        helper = (await this.docker.create(`moss-release-${randomUUID()}`, { Image: image.Id, Labels: { 'io.moss.role': 'release-helper' }, Entrypoint: ['/bin/true'] })).Id;
        this.store.update(id, { upgrade: { ...this.store.get(id).upgrade, helper } });
        // Copy the real directory, not the image's /opt/moss symlink.
        await this.docker.putArchive(info.Id, directory, await this.docker.archive(helper, '/opt/moss-releases/bootstrap/.'));
        await this.docker.exec(info.Id, ['env', 'ELECTRON_RUN_AS_NODE=1', `${directory}/ui/node_modules/electron/dist/electron`, '--version']);
        switched = true; await this.switchProgram(info.Id, directory);
        await this.docker.restart(info.Id);
        await this.ready(row, version);
        return this.store.update(id, { state: 'ready', version, programImage: image.Id, upgrade: null, error: null });
      } catch (error) {
        if (switched && previous) {
          try { await this.switchProgram(info.Id, previous); await this.docker.restart(info.Id); await this.ready(row, before.version); }
          catch (rollbackError) { this.store.update(id, { state: 'error', error: `${error.message}; rollback: ${rollbackError.message}` }); throw rollbackError; }
        } else { await this.control(row, 'resume', {}).catch(() => {}); }
        this.store.update(id, { state: 'ready', error: error.message, upgrade: null });
        throw error;
      } finally { if (helper) await this.docker.removeHelper(helper).catch(() => {}); }
    });
  }
  switchProgram(id, directory) {
    if (!/^\/opt\/moss-releases\/(bootstrap|[a-f0-9]{64})$/.test(directory)) throw new Error('Invalid program directory');
    return this.docker.exec(id, ['node', '-e', 'const fs=require("fs");fs.rmSync("/opt/moss.next",{force:true});fs.symlinkSync(process.argv[1],"/opt/moss.next");fs.renameSync("/opt/moss.next","/opt/moss");', directory]);
  }
}
