import { app, BrowserWindow, WebContentsView, ipcMain, session } from 'electron';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createCloudComputerWindow } from '../src/cloud-computer-window.mjs';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-cloud-window-'));
app.setPath('userData', home);
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Cloud window test timed out'); app.exit(1); }, 45000);
const handlers = new Map();
const register = ipcMain.handle.bind(ipcMain);
const bridge = { handle(name, handler) { handlers.set(name, handler); register(name, handler); } };
let token = 'alice', pendingLogin, finishLogin, connectionFailure;
let identityStatus = 200, loginStatus = 200;
const server = http.createServer((req, res) => {
  const user = req.headers.authorization?.replace('Bearer ', '');
  if (req.url === '/api/v1/auth/me') { res.statusCode = identityStatus; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ user: { id: user }, organization: { id: 'org' } })); return; }
  if (req.url === '/api/desktop/login') {
    if (loginStatus !== 200) { res.writeHead(loginStatus, { 'Content-Type': 'application/json' }); res.end('{"error":"云电脑访问受限"}'); return; }
    const send = () => { res.setHeader('Set-Cookie', `cloud=${user}; Path=/; HttpOnly; SameSite=Strict`); res.end('{"ok":true}'); };
    if (pendingLogin) { finishLogin = send; pendingLogin(); } else send();
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><body><h1>${req.headers.cookie || 'logged out'}</h1></body></html>`);
});
async function run() {
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  const local = new BrowserWindow({ show: false, width: 1280, height: 800, titleBarStyle: 'hiddenInset' });
  await local.loadURL('about:blank');
  const external = [];
  let appearance = { themeMode: 'light' };
  const controller = createCloudComputerWindow({ WebContentsView, ipcMain: bridge, session,
    shell: { openExternal: url => external.push(url) }, getLocalWindow: () => local,
    resolveConnection: () => { if (connectionFailure) throw connectionFailure; return { serverUrl: origin, authToken: token }; },
    getAppearance: () => appearance, updateAppearance: value => { appearance = value; },
    certificateVerifyProc: (_request, callback) => callback(-3),
    preload: fileURLToPath(new URL('../src/cloud-computer-preload.cjs', import.meta.url)), appVersion: 'test' });
  const open = () => handlers.get('desktop:open-cloud')({ sender: local.webContents, senderFrame: local.webContents.mainFrame });
  const cloud = () => local.contentView.children.find(view => view.webContents && view.webContents !== local.webContents);
  for (const failure of [Object.assign(new Error('Missing login'), { code: 'MOSS_LOGIN_REQUIRED' }), Object.assign(new Error('Expired login'), { status: 401 })]) {
    connectionFailure = failure;
    assert.deepEqual(await open(), { ok: false, reason: 'authentication-required' });
    assert.equal(cloud(), undefined);
  }
  connectionFailure = null;
  identityStatus = 401;
  assert.deepEqual(await open(), { ok: false, reason: 'authentication-required' });
  identityStatus = 403;
  await assert.rejects(open(), /无权访问/);
  identityStatus = 503;
  await assert.rejects(open(), /无法验证/);
  identityStatus = 200; loginStatus = 401;
  assert.deepEqual(await open(), { ok: false, reason: 'authentication-required' });
  loginStatus = 403;
  await assert.rejects(open(), /访问受限/);
  assert.equal(cloud(), undefined);
  loginStatus = 200;
  await open();
  assert.match(await cloud().webContents.executeJavaScript('document.body.innerText'), /cloud=alice/);
  assert.deepEqual(await cloud().webContents.executeJavaScript('({local:!!window.agentDesktop,node:typeof require,shell:Object.keys(window.mossDesktopShell),cookie:document.cookie})'),
    { local: false, node: 'undefined', shell: ['returnToLocal', 'getPresentation', 'updateAppearance', 'onPresentation'], cookie: '' });
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.deepEqual(cloud().getBounds(), { x: 0, y: 0, width: local.getContentSize()[0], height: local.getContentSize()[1] });
  const preferences = await cloud().webContents.executeJavaScript('window.mossDesktopShell.getPresentation()');
  assert.equal(preferences.appearance.themeMode, 'light');
  await cloud().webContents.executeJavaScript('window.mossDesktopShell.updateAppearance({themeMode:"dark",apiKey:"must-not-cross"})');
  assert.equal(appearance.themeMode, 'dark'); assert.equal(appearance.apiKey, undefined);
  assert.throws(() => handlers.get('desktop:cloud-presentation')({ sender: local.webContents, senderFrame: local.webContents.mainFrame }), /Forbidden/);
  assert.throws(() => handlers.get('desktop:open-cloud')({ sender: cloud().webContents, senderFrame: cloud().webContents.mainFrame }), /Forbidden/);
  const aliceSession = cloud().webContents.session;
  const aliceView = cloud();
  await cloud().webContents.executeJavaScript('window.mossDesktopShell.returnToLocal()');
  assert.equal(cloud(), undefined);
  assert.equal(aliceView.webContents.isDestroyed(), false);
  await open(); assert.equal(cloud(), aliceView);
  const aliceContents = cloud().webContents;
  controller.close();
  token = 'bob';
  await open();
  assert.equal(aliceContents.isDestroyed(), true);
  assert.notEqual(cloud().webContents.session, aliceSession);
  assert.match(await cloud().webContents.executeJavaScript('document.body.innerText'), /cloud=bob/);
  controller.close();
  const waiting = new Promise(resolve => { pendingLogin = resolve; });
  const stale = open();
  await waiting; controller.close(); finishLogin();
  await assert.rejects(stale, /账号已变更/);
  assert.equal(cloud(), undefined);
  assert.equal(external.length, 0);
  console.log('PASS: one native window, shared appearance, bounded preference IPC, isolated cloud views, return to local, and stale-login rejection');
  clearTimeout(timeout); app.exit(0);
} catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
finally { server.close(); await fs.rm(home, { recursive: true, force: true }); }

}
void run();
