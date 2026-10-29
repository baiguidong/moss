import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createWebTerminals } from '../src/web/terminal.mjs';
import { createWebOAuth } from '../src/web/oauth.mjs';
import { performRemoteDirectOAuth } from '../src/remote-direct-oauth.mjs';
import { createWebResources } from '../src/web/resources.mjs';
import { createWebApps } from '../src/web/apps.mjs';
import { createRequestRegistry } from '../src/host/request-registry.mjs';
import { createWebPortPreviews } from '../src/web/ports.mjs';
import { createWebInteractions } from '../src/web/interactions.mjs';
import { createWebPreviews } from '../src/web/previews.mjs';
import { createAppPlatformHandlers } from '../src/apps/app-platform-host.mjs';
const owner = { transport: 'web', principal: { userId: 'owner' }, connectionId: 'one', viewId: 'one' };
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };

test('terminal serializes concurrent attach/restart, retains exit state, and rejects stale writes', async () => {
  const ptys = [], events = [];
  const terminals = createWebTerminals({ registry: { publish: (...args) => events.push(args) }, resolveLaunch: async () => ({ title: 'test', shell: '/bin/sh', args: [], env: {}, cwd: '/tmp' }), loadPty: async () => {
    await new Promise(resolve => setTimeout(resolve, 2)); return { spawn() { const pty = { onData(fn) { this.data = fn; }, onExit(fn) { this.exit = fn; }, write() {}, resize() {}, kill() { this.exit({ exitCode: 0 }); } }; ptys.push(pty); return pty; } };
  } });
  const call = (method, payload) => terminals.handlers.get('terminal:' + method)(owner, payload);
  const { terminalId } = await call('open', {});
  const [first, second] = await Promise.all([call('start', { terminalId }), call('start', { terminalId })]);
  assert.equal(ptys.length, 1); assert.equal(first.generation, second.generation);
  ptys[0].data('hello'); ptys[0].exit({ exitCode: 7 });
  assert.equal((await call('start', { terminalId })).status, 'exited');
  await Promise.all([call('start', { terminalId, restart: true, generation: 1 }), call('start', { terminalId, restart: true, generation: 1 })]);
  assert.equal(ptys.length, 2);
  assert.throws(() => call('write', { terminalId, generation: 1, data: 'bad' }), /状态已变化/);
  await call('stop', { terminalId, generation: 2 }); assert.equal((await call('start', { terminalId })).status, 'exited');
  await assert.rejects(terminals.handlers.get('terminal:start')({ principal: { userId: 'other' } }, { terminalId }), /过期/);
  terminals.close();
});

test('Web terminal stops after its browser connection closes and survives a prompt reconnect', async () => {
  const ptys = [];
  const terminals = createWebTerminals({ registry: { publish() {} }, disconnectGraceMs: 15,
    resolveLaunch: async () => ({ title: 'test', shell: '/bin/sh', args: [], env: {}, cwd: '/tmp' }),
    loadPty: async () => ({ spawn() {
      const pty = { onData() {}, onExit(fn) { this.exit = fn; }, kill() { this.killed = true; this.exit({ exitCode: 0 }); } };
      ptys.push(pty); return pty;
    } }),
  });
  const { terminalId } = await terminals.handlers.get('terminal:open')(owner, {});
  await terminals.handlers.get('terminal:start')(owner, { terminalId });
  terminals.disconnect('one');
  const reconnected = { ...owner, connectionId: 'two' };
  await terminals.handlers.get('terminal:start')(reconnected, { terminalId });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(ptys[0].killed, undefined);
  terminals.disconnect('two');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(ptys[0].killed, true);
  assert.equal(terminals.activeCount(), 0);
  terminals.close();
});

test('Web OAuth exchanges with exact HTTPS callback/PKCE; invalid, duplicate and canceled states cannot exchange', async () => {
  const hub = createWebOAuth({ env: { MOSS_WEB_ORIGIN: 'https://portal.example' } });
  let state, exchanges = 0, verifier;
  const result = await performRemoteDirectOAuth({ serverUrl: 'https://server.example', callbackListener: async expected => {
    state = expected; const listener = await hub.listen(state); return { ...listener, callback: listener.callback.then(url => new URL(url).searchParams.get('code')) };
  }, openAuthorization: (url, context) => {
    hub.show(url, context);
    assert.throws(() => hub.accept(new URL('https://portal.example/api/oauth/callback?state=wrong&code=bad')), /失效/);
    const callback = new URL(`https://portal.example/api/oauth/callback?state=${state}&code=${'c'.repeat(43)}`);
    hub.accept(callback); assert.throws(() => hub.accept(callback), /已处理/); return () => {};
  }, fetchImpl: async (url, options) => {
    const input = JSON.parse(options.body);
    assert.equal(input.redirect_uri, 'https://portal.example/api/oauth/callback');
    if (url.endsWith('/start')) { verifier = input.code_challenge; return Response.json({ authorization_url: '/api/v1/auth/oauth/authorize/' + 'a'.repeat(43) }); }
    exchanges++; assert.ok(input.code_verifier); return Response.json({ api_key: 'moss_sk_test', user: { id: 'user' } });
  } });
  assert.equal(result.apiKey, 'moss_sk_test'); assert.equal(exchanges, 1); assert.equal(verifier.length, 43); assert.deepEqual(hub.list(), []);
  const pending = await hub.listen('s'.repeat(43)); hub.cancel(hub.list()[0].id);
  await assert.rejects(pending.callback, /取消/); assert.throws(() => hub.accept(new URL('https://portal.example/api/oauth/callback?state=' + 's'.repeat(43) + '&code=ok')), /已处理/);
  await pending.close(); hub.close();
});

test('isolated resource trees load relative assets and reject traversal, symlinks and revoked handles', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-resource-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets')); await fs.writeFile(path.join(root, 'index.html'), '<img src="assets/a.svg">'); await fs.writeFile(path.join(root, 'assets/a.svg'), '<svg/>');
  await fs.symlink('/etc/passwd', path.join(root, 'outside'));
  const resources = createWebResources(); const handle = await resources.create({ root, entryPath: path.join(root, 'index.html'), ownerId: 'owner' });
  const server = http.createServer((req, res) => resources.serve(req, res, new URL(req.url, 'http://local')).catch(() => { res.writeHead(403); res.end(); }));
  const base = await listen(server); t.after(() => new Promise(resolve => server.close(resolve)));
  const document = await fetch(base + handle.url); assert.match(document.headers.get('content-security-policy'), /sandbox allow-scripts/); assert.doesNotMatch(document.headers.get('content-security-policy'), /allow-same-origin/);
  assert.equal(await (await fetch(base + handle.base + 'assets/a.svg')).text(), '<svg/>');
  for (const suffix of ['outside', '%2e%2e%2fetc/passwd', 'assets%5c..%5csecret']) assert.equal((await fetch(base + handle.base + suffix)).status, 403);
  handle.revoke(); assert.equal((await fetch(base + handle.url)).status, 403);
});

test('App bridge binds identity, cancels work on disconnect, rejects root APIs and invalidates versions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-app-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>App</h1>');
  let installation = { enabled: true, activeVersion: '1' }, aborted = false;
  const runtime = { installations: { get: () => installation }, invoke: async (id, instance, name, input, options) => {
    assert.equal(id, 'test.app'); assert.equal(instance, 'test.app--default');
    if (name === 'wait') return new Promise(resolve => options.signal.addEventListener('abort', () => { aborted = true; resolve('canceled'); }, { once: true }));
    return input;
  } };
  const apps = createWebApps({ registry: createRequestRegistry(), resources: createWebResources(), resolveApp: async () => ({ id: 'test.app', runtime, manifest: { ui: { entry: 'index.html' } }, entryPath: path.join(root, 'index.html') }) });
  t.after(() => apps.close());
  const opened = await apps.handlers.get('app:embedded-open')(owner, { name: 'test.app' });
  const request = (method, input, context = owner) => apps.handlers.get('web:app-request')(context, { embedId: opened.embedId, method, input });
  await assert.rejects(request('host:confirmations-respond', { allowed: true }), /无权/);
  await assert.rejects(request('app-ui:get-info', {}, { ...owner, connectionId: 'other' }), /失效/);
  const result = await request('app-ui:actions:invoke', { requestId: 'a', name: 'echo', input: { ok: 1 }, appId: 'evil' }); assert.deepEqual(result, { ok: true, result: { ok: 1 } });
  const waiting = request('app-ui:actions:invoke', { requestId: 'b', name: 'wait' });
  await new Promise(resolve => setTimeout(resolve, 0)); apps.disconnect(owner.connectionId); assert.equal((await waiting).ok, false); assert.equal(aborted, true);
  assert.deepEqual(apps.handlers.get('app:embedded-close')(owner, { embedId: opened.embedId }), { ok: true });
  const reopened = await apps.handlers.get('app:embedded-open')(owner, { name: 'test.app' }); installation = { ...installation, activeVersion: '2' };
  await assert.rejects(Promise.resolve().then(() => apps.handlers.get('app:embedded-close')({ ...owner, connectionId: 'other' }, { embedId: reopened.embedId })), /失效/);
  await assert.rejects(apps.handlers.get('web:app-request')(owner, { embedId: reopened.embedId, method: 'app-ui:get-info' }), /版本已变化/);
  const offer = apps.offer({ id: 'test.app', runtime, manifest: { ui: { entry: 'index.html' } }, entryPath: path.join(root, 'index.html') }, owner.principal.userId);
  let closed = 0; offer.on('closed', () => closed++);
  const previewRef = apps.handlers.get('web:app-preview-list')(owner)[0].id;
  await apps.handlers.get('app:embedded-open')(owner, { previewRef }); apps.disconnect(owner.connectionId);
  assert.equal(closed, 0);
  const refreshed = await apps.handlers.get('app:embedded-open')({ ...owner, connectionId: 'refreshed' }, { previewRef });
  assert.ok(refreshed.embedId);
  apps.handlers.get('web:app-preview-close')(owner, { id: previewRef }); assert.equal(closed, 1);
  await assert.rejects(apps.handlers.get('web:app-request')({ ...owner, connectionId: 'refreshed' }, { embedId: refreshed.embedId, method: 'app-ui:get-info' }), /失效/);
});

test('port previews preserve paths, redirects and WebSockets on isolated origins; root-origin access is rejected', async t => {
  const upstream = http.createServer((req, res) => { if (req.url === '/redirect') { res.writeHead(302, { Location: `http://localhost:${upstream.address().port}/asset` }); res.end(); } else if (req.url === '/cookies') { res.setHeader('Set-Cookie', ['dev_session=ok; Domain=localhost; Path=/; HttpOnly', 'moss_web=evil']); res.end(req.headers.cookie); } else res.end(req.url); });
  const wsServer = new WebSocketServer({ server: upstream }); wsServer.on('connection', ws => ws.on('message', message => ws.send(message)));
  await listen(upstream); t.after(() => { wsServer.close(); return new Promise(resolve => upstream.close(resolve)); });
  const ports = createWebPortPreviews({ env: { MOSS_WEB_ORIGIN: 'https://portal.example', MOSS_WEB_PREVIEW_DOMAIN: 'preview.example' } });
  t.after(() => ports.close());
  const opened = await ports.handlers.get('web:port-open')(owner, { url: `http://localhost:${upstream.address().port}/test?q=1` });
  const target = new URL(opened.url), token = target.hostname.split('.')[0];
  const server = http.createServer((req, res) => { try { ports.serve(req, res, new URL(ports.route(req), 'http://local')); } catch { res.writeHead(403); res.end(); } });
  server.on('upgrade', (req, socket, head) => { try { ports.upgrade(req, socket, head, new URL(req.url, 'http://local')); } catch { socket.destroy(); } });
  const base = await listen(server); t.after(() => new Promise(resolve => server.close(resolve)));
  const prefix = `/_moss/port/${token}`;
  assert.equal((await fetch(base + prefix + '/secret')).status, 403);
  const get = (url, extra = {}) => new Promise((resolve, reject) => { const request = http.get(url, { headers: { Host: target.host, ...extra } }, response => { let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ body, headers: response.headers, status: response.statusCode })); }); request.on('error', reject); });
  assert.equal((await get(base + prefix + '/test?q=1')).body, '/test?q=1');
  assert.equal((await get(base + '/test?q=1')).body, '/test?q=1');
  const cookies = await get(base + '/cookies', { Cookie: 'moss_web=secret; dev_session=ok; moss_cloud=secret' });
  assert.equal(cookies.body.trim(), 'dev_session=ok');
  assert.deepEqual(cookies.headers['set-cookie'], ['dev_session=ok; Path=/; HttpOnly; Secure']);
  assert.equal((await get(base + prefix + '/redirect')).headers.location, target.origin + '/asset');
  const ws = new WebSocket(base.replace('http:', 'ws:') + prefix + '/socket', { headers: { Host: target.host, Origin: target.origin } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send('hmr'); assert.equal(await new Promise(resolve => ws.once('message', data => resolve(String(data)))), 'hmr'); const closed = new Promise(resolve => ws.once('close', resolve)); ports.revokeOwner('owner'); await closed;
  assert.equal((await get(base + '/test')).status, 403);
});

test('file prompts are invalidated by cancellation and validate selected paths at response time', async t => {
  const service = createWebInteractions({ registry: createRequestRegistry() }); t.after(() => service.close());
  const controller = new AbortController();
  const result = service.request('pick', { kind: 'file' }, { signal: controller.signal });
  const item = service.handlers.get('web:interactions-list')()[0]; controller.abort(); assert.equal(await result, null);
  await assert.rejects(service.handlers.get('web:interactions-respond')(owner, { id: item.id, result: ['/etc/passwd'] }), /过期/);
});

test('Web screenshots use the browser selection, copy into App storage and honor cancellation before prompting', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-screen-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const screenshot = path.join(root, 'screen.png'); await fs.writeFile(screenshot, 'png-fixture'); let prompts = 0;
  const handlers = createAppPlatformHandlers({ web: true, webCapture: async () => { prompts++; return screenshot; }, resolveMediaUrl: async file => '/_moss/resource/test/' + path.basename(file), desktopCapturer: { getSources() { throw Error('Native capture must not run'); } } });
  const context = { appId: 'test.app', dataDir: path.join(root, 'app') };
  const result = await handlers['screen.capture']({}, context); assert.equal(prompts, 1); assert.ok(result.path.startsWith(context.dataDir)); assert.equal(await fs.readFile(result.path, 'utf8'), 'png-fixture'); assert.match(result.mediaUrl, /^\/_moss\/resource\//);
  const canceled = new AbortController(); canceled.abort(); await assert.rejects(handlers['screen.capture']({}, { ...context, signal: canceled.signal })); assert.equal(prompts, 1);
});

test('repeated HTML decoration reuses resources and independent preview closure preserves the main preview', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-decoration-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entryPath = path.join(root, 'index.html'); await fs.writeFile(entryPath, 'hello');
  const resources = createWebResources(), registry = createRequestRegistry();
  const previews = createWebPreviews({ resources, registry }); t.after(() => previews.close());
  const file = { path: entryPath, content: 'hello', contentType: 'html' };
  const first = await previews.decorate(owner, file);
  for (let i = 0; i < 260; i++) assert.equal((await previews.decorate(owner, file)).metadata.previewResourceToken, first.metadata.previewResourceToken);
  const page = await previews.handlers.get('preview.open')(owner, { file }); const id = new URL(page.url, 'http://local').searchParams.get('previewId');
  const independent = previews.handlers.get('web:preview-get')(owner, { id }); assert.notEqual(independent.file.metadata.previewResourceToken, first.metadata.previewResourceToken);
  previews.handlers.get('web:preview-close')(owner, { id }); assert.equal((await previews.decorate(owner, file)).metadata.previewResourceToken, first.metadata.previewResourceToken);
  resources.revokeOwner(owner.principal.userId); assert.notEqual((await previews.decorate(owner, file)).metadata.previewResourceToken, first.metadata.previewResourceToken);
});

test('App contexts opened during a disconnect cannot survive the disconnected page', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-open-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entryPath = path.join(root, 'index.html'); await fs.writeFile(entryPath, 'hello'); let finish;
  const apps = createWebApps({ registry: createRequestRegistry(), resources: createWebResources(), resolveApp: () => new Promise(resolve => { finish = () => resolve({ id: 'test.app', entryPath, manifest: { ui: {} }, runtime: { installations: { get: () => ({ enabled: true, activeVersion: '1' }) } } }); }) }); t.after(() => apps.close());
  const opening = apps.open(owner, {}); apps.disconnect(owner.connectionId); finish(); await assert.rejects(opening, /已关闭/);
});

test('ZIP installation rejects changed reviewed content or grants and accepts only authenticated absolute ZIP paths', async t => {
  const { registerAppRuntimeIpc } = await import('../src/apps/app-runtime-ipc.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-install-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'app.zip'); await fs.writeFile(archive, 'fixture');
  for (const change of ['package', 'grants', 'none']) {
    const handlers = new Map(); let installs = 0, nativePick = 0, checksum = 'before', grants = [], sawPrompt = false;
    registerAppRuntimeIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showOpenDialog: () => { nativePick++; throw Error('native picker'); } },
      getRuntime: () => ({ installations: { list: () => [{ appId: 'test.app', grants, activeVersion: '1' }] }, registerInstalled: async () => {} }),
      installArchive: async (_runtime, _path, options) => options.installPackage(root),
      validatePackage: async () => ({ manifest: { id: 'test.app', version: '2', permissions: ['platform:files'] }, checksums: { 'app.moss.json': checksum } }),
      confirmInstallation: async (_manifest, _permissions, detail) => { sawPrompt = true; assert.match(detail, /摘要/); if (change === 'package') checksum = 'after'; if (change === 'grants') grants = ['platform:files']; return true; },
      installArchivePackage: async () => { installs++; return { id: 'test.app', currentVersion: '2' }; },
    });
    const install = handlers.get('app:install-archive');
    await assert.rejects(install(owner, { filePath: 'relative.zip' }), /请选择/);
    const result = install(owner, { filePath: archive });
    if (change === 'none') { assert.equal((await result).ok, true); assert.equal(installs, 1); }
    else { await assert.rejects(result, /变化/); assert.equal(installs, 0); }
    assert.equal(sawPrompt, true); assert.equal(nativePick, 0);
  }
});

test('declared settings bind the route and view state to one owner; revoked grants dispose the page', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-settings-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Settings</h1>');
  let installation = { enabled: true, activeVersion: '1.0.0', grants: ['app:settings'] };
  const manifest = { version: '1.0.0', ui: { entry: 'index.html' }, contributes: {
    views: [{ id: 'connection', route: '#/connection', permission: 'app:settings' }],
    settings: [{ id: 'manage', viewId: 'connection' }],
  } };
  const registry = createRequestRegistry(), events = [];
  registry.subscribe((name, payload) => events.push({ name, payload }));
  const apps = createWebApps({ registry, resources: createWebResources(), resolveApp: async () => ({ id: 'test.app',
    runtime: { installations: { get: () => installation } }, manifest, entryPath: path.join(root, 'index.html') }) });
  t.after(() => apps.close());
  const opened = await apps.handlers.get('app:embedded-open')(owner, { name: 'test.app', settingId: 'manage', version: '1.0.0', route: '#/injected' });
  assert.equal(opened.url.split('#')[1], '/connection');
  await apps.handlers.get('web:app-request')(owner, { embedId: opened.embedId, method: 'app-ui:view-state', input: { dirty: true, busy: false, embedId: 'forged' } });
  assert.deepEqual(events.find(event => event.name === 'app:embedded-state').payload, { embedId: opened.embedId, dirty: true, busy: false });
  await assert.rejects(apps.handlers.get('web:app-request')({ ...owner, connectionId: 'other' }, { embedId: opened.embedId, method: 'app-ui:view-state', input: { dirty: false, busy: false } }), /失效/);
  installation = { ...installation, grants: [] };
  registry.publish('app:changed', {});
  assert(events.some(event => event.name === 'web:app-closed' && event.payload.embedId === opened.embedId));
  await assert.rejects(apps.handlers.get('web:app-request')(owner, { embedId: opened.embedId, method: 'app-ui:get-info' }), /失效/);
  await assert.rejects(apps.handlers.get('app:embedded-open')(owner, { name: 'test.app', settingId: 'manage', version: '1.0.0' }), /授权/);
});
