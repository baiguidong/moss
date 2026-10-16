import http from 'node:http';
import { pipeline } from 'node:stream/promises';

export class Docker {
  constructor(socketPath = process.env.MOSS_DOCKER_SOCKET || '/var/run/docker.sock') { this.socketPath = socketPath; }
  async request(method, route, body, { stream = false, input, timeout = 180000 } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request({ socketPath: this.socketPath, path: `/v1.45${route}`, method,
        headers: input ? { 'Content-Type': 'application/x-tar' } : data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
        if (stream && res.statusCode < 300) return resolve(res);
        const chunks = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) res.destroy(new Error('Docker response too large')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => {
          const buffer = Buffer.concat(chunks); let result;
          try { result = JSON.parse(buffer.toString()); } catch { result = buffer; }
          if (res.statusCode >= 300) return reject(Object.assign(new Error(result.message || `Docker ${res.statusCode}`), { status: res.statusCode }));
          resolve(result);
        });
      });
      req.setTimeout(timeout, () => req.destroy(new Error('Docker request timed out')));
      req.on('error', reject);
      if (input) pipeline(input, req).catch(reject); else req.end(data);
    });
  }
  inspect(id) { return this.request('GET', `/containers/${encodeURIComponent(id)}/json`); }
  image(id) { return this.request('GET', `/images/${encodeURIComponent(id)}/json`); }
  create(name, config) { return this.request('POST', `/containers/create?name=${encodeURIComponent(name)}`, config); }
  start(id) { return this.request('POST', `/containers/${id}/start`); }
  stop(id) { return this.request('POST', `/containers/${id}/stop?t=60`); }
  restart(id) { return this.request('POST', `/containers/${id}/restart?t=60`); }
  async exec(id, cmd, user = '0') {
    const { Id } = await this.request('POST', `/containers/${id}/exec`, { Cmd: cmd, User: user, AttachStdout: true, AttachStderr: true });
    const frames = await this.request('POST', `/exec/${Id}/start`, { Detach: false, Tty: false });
    const parts = []; let offset = 0;
    while (offset + 8 <= frames.length) { const size = frames.readUInt32BE(offset + 4); parts.push(frames.subarray(offset + 8, offset + 8 + size)); offset += size + 8; }
    const output = Buffer.concat(parts).toString().trim();
    const state = await this.request('GET', `/exec/${Id}/json`);
    if (state.ExitCode !== 0) throw new Error(`Container command failed: ${output.slice(-1500)}`);
    return output;
  }
  async network(name, labels) {
    try { return await this.request('GET', `/networks/${name}`); }
    catch (error) {
      if (error.status !== 404) throw error;
      try { await this.request('POST', '/networks/create', { Name: name, Driver: 'bridge', CheckDuplicate: true, Labels: labels }); }
      catch (e) { if (e.status !== 409) throw e; }
      return this.request('GET', `/networks/${name}`);
    }
  }
  async connect(network, container) {
    try { await this.request('POST', `/networks/${network}/connect`, { Container: container, EndpointConfig: { Aliases: ['moss-cloud-gateway'] } }); }
    catch (error) { if (!/already exists|already connected/i.test(error.message)) throw error; }
  }
  archive(id, location) { return this.request('GET', `/containers/${id}/archive?path=${encodeURIComponent(location)}`, undefined, { stream: true }); }
  putArchive(id, location, input) { return this.request('PUT', `/containers/${id}/archive?path=${encodeURIComponent(location)}`, undefined, { input }); }
  async removeHelper(id) {
    const info = await this.inspect(id);
    if (info.Config.Labels?.['io.moss.role'] !== 'release-helper') throw new Error('Only disposable release helpers may be removed');
    await this.request('DELETE', `/containers/${id}?force=1&v=1`);
  }
}
