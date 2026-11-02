import { app, BrowserWindow, ipcMain, session } from 'electron';
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
let token = 'alice', pendingLogin, finishLogin;
const server = http.createServer((req, res) => {
  const user = req.headers.authorization?.replace('Bearer ', '');
  if (req.url === '/api/v1/auth/me') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ user: { id: user }, organization: { id: 'org' } })); return; }
  if (req.url === '/api/desktop/login') {
    const send = () => { res.setHeader('Set-Cookie', `cloud=${user}; Path=/; HttpOnly; SameSite=Strict`); res.end('{"ok":true}'); };
    if (pendingLogin) { finishLogin = send; pendingLogin(); } else send();
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><body>${req.headers.cookie || 'logged out'}</body></html>`);
});
async function run() {
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  const local = new BrowserWindow({ show: false });
  await local.loadURL('about:blank');
  const external = [];
  const controller = createCloudComputerWindow({ BrowserWindow, ipcMain: bridge, session,
    shell: { openExternal: url => external.push(url) }, getLocalWindow: () => local,
    resolveConnection: () => ({ serverUrl: origin, authToken: token }),
    certificateVerifyProc: (_request, callback) => callback(-3),
    preload: fileURLToPath(new URL('../src/cloud-computer-preload.cjs', import.meta.url)), appVersion: 'test' });
  const open = () => handlers.get('desktop:open-cloud')({ sender: local.webContents, senderFrame: local.webContents.mainFrame });
  const cloud = () => BrowserWindow.getAllWindows().find(window => window !== local);
  await open();
  assert.match(await cloud().webContents.executeJavaScript('document.body.innerText'), /cloud=alice/);
  assert.deepEqual(await cloud().webContents.executeJavaScript('({local:!!window.agentDesktop,node:typeof require,shell:Object.keys(window.mossDesktopShell),cookie:document.cookie})'),
    { local: false, node: 'undefined', shell: ['returnToLocal'], cookie: '' });
  assert.throws(() => handlers.get('desktop:open-cloud')({ sender: cloud().webContents, senderFrame: cloud().webContents.mainFrame }), /Forbidden/);
  const aliceSession = cloud().webContents.session;
  await cloud().webContents.executeJavaScript('window.mossDesktopShell.returnToLocal()');
  assert.equal(local.isVisible(), true);
  assert.equal(cloud().isVisible(), false);
  await open(); assert.equal(cloud().isVisible(), true);
  const aliceWindow = cloud();
  controller.close();
  token = 'bob';
  await open();
  assert.equal(aliceWindow.isDestroyed(), true);
  assert.notEqual(cloud().webContents.session, aliceSession);
  assert.match(await cloud().webContents.executeJavaScript('document.body.innerText'), /cloud=bob/);
  controller.close();
  const waiting = new Promise(resolve => { pendingLogin = resolve; });
  const stale = open();
  await waiting; controller.close(); finishLogin();
  await assert.rejects(stale, /账号已变更/);
  assert.equal(cloud(), undefined);
  assert.equal(external.length, 0);
  console.log('PASS: cloud cookies, isolated account windows, return to local, no local IPC, and stale-login rejection');
  clearTimeout(timeout); app.exit(0);
} catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
finally { server.close(); await fs.rm(home, { recursive: true, force: true }); }

}
void run();
