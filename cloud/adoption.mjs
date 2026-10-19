// Explicit administrator command only. An old standalone container is never
// replaced or silently adopted merely because its volume/name happens to match.
export async function adoptStandalone(computers, containerId) {
  if (!/^[a-f0-9]{12,64}$/.test(containerId)) throw new Error('请指定原容器的完整 Docker ID');
  const row = computers.store.ensure({ user: { id: 'local-owner' }, organization: { id: '' } });
  return computers.locked(row.id, async () => {
    let current = computers.store.get(row.id);
    if (current.operation || current.upgrade || current.containerId && current.containerId !== containerId) throw new Error('本地所有者已有环境，不能覆盖');
    const info = await computers.docker.inspect(containerId);
    if (info.Id !== containerId) throw new Error('请使用完整容器 ID');
    if (computers.store.all().some(other => other.id !== row.id && other.containerId === info.Id) || info.Config.Labels?.['io.moss.installation']) throw new Error('不能接管其他已受控环境');
    if (info.Mounts.length !== 1 || info.Mounts[0].Type !== 'volume' || info.Mounts[0].Destination !== '/home/moss') throw new Error('仅支持原标准 standalone HOME 卷部署');
    if (JSON.stringify(info.Config.Entrypoint) !== JSON.stringify(['/usr/bin/tini', '--', '/usr/local/bin/moss-web-entrypoint'])) throw new Error('原容器不是标准 WebUI 启动方式');
    if (!info.State.Running) throw new Error('请先启动原容器，再显式接管');
    await computers.docker.exec(info.Id, ['node', '-e', 'if(!require("fs").existsSync("/opt/moss/shared/snapshot-runtime.mjs"))throw Error("Please upgrade Moss to a snapshot-capable release before adoption")']);
    current = computers.store.update(row.id, { adoptedId: info.Id, adoptedHome: info.Mounts[0].Name, homeVolume: info.Mounts[0].Name, containerId: info.Id, state: 'adopting', adoption: true });
    await computers.attach(current);
    try { await computers.docker.request('POST', `/networks/${computers.name(current)}/connect`, { Container: info.Id }); }
    catch (error) { if (!/already exists|already connected/i.test(error.message)) throw error; }
    const config = computers.containerConfig(current, info.Image, current.homeVolume);
    const environment = Object.fromEntries(config.Env.map(entry => { const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)]; }));
    const supervisor = config.Entrypoint.at(-1);
    await computers.docker.exec(info.Id, ['node', '-e', 'const fs=require("fs");fs.writeFileSync("/etc/moss-cloud.json",process.argv[1],{mode:384});fs.chownSync("/etc/moss-cloud.json",1000,1000);fs.writeFileSync("/usr/local/bin/moss-web-entrypoint",process.argv[2],{mode:493});', JSON.stringify(environment), `#!/usr/local/bin/node\nObject.assign(process.env,JSON.parse(require('fs').readFileSync('/etc/moss-cloud.json','utf8')));\n${supervisor}\n`]);
    await computers.docker.restart(info.Id);
    const status = await computers.ready(current);
    if (status.snapshotProtocol !== 1) throw new Error('原环境未提供快照协议，请检查升级');
    return computers.store.update(row.id, { state: 'ready', version: status.version, adoption: null });
  });
}
