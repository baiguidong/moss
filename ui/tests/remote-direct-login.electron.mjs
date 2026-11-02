import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRemoteDirectTrustStore, ensureRemoteDirectTrustWithConfirmation } from '../src/remote-direct-tls.mjs';
import { createRemoteDirectTransport } from '../src/remote-direct-transport.mjs';
import { performRemoteDirectOAuth } from '../src/remote-direct-oauth.mjs';
import { openRemoteDirectAuthorizationWindow } from '../src/remote-direct-auth-window.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'moss-login-tls-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Login TLS test timed out'); app.exit(1); }, 60000);
let server, start, opened = 0;
async function certificate(name) {
  const key = path.join(temp, `${name}.key`), cert = path.join(temp, `${name}.pem`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  return { key: await readFile(key), cert: await readFile(cert) };
}
async function run() {
try {
  const first = await certificate('first'), second = await certificate('second');
  server = https.createServer(first, async (req, res) => {
    if (req.url === '/health') { res.end('ok'); return; }
    if (req.url === '/api/v1/auth/oauth/authorize') {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>账号或密码错误</title></head><body><form><input name="password"></form></body></html>'); return;
    }
    if (req.url.startsWith('/api/v1/auth/oauth/authorize/')) {
      res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<html><head><title>登录 Moss Server</title></head><body><h1>登录 Moss Server</h1><input name="username"></body></html>'); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/start')) {
      start = JSON.parse(body); res.end(JSON.stringify({ authorization_url: `/api/v1/auth/oauth/authorize/${'t'.repeat(43)}` }));
    } else if (req.url.endsWith('/exchange')) res.end(JSON.stringify({ api_key: 'moss_sk_test.secret', user: { id: 'test-user' } }));
    else res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  const trustDir = path.join(temp, 'trust');
  let store = createRemoteDirectTrustStore({ trustDir, initialExtraCaPath: '' });
  const transport = createRemoteDirectTransport({ session,
    ensureTrustLoaded: () => store.load(), certificateVerifyProc: (request, callback) => store.verifyCertificate(request, callback),
  });
  // Reproduce a cached TLS rejection before the first login.
  await assert.rejects(transport.fetch(`${origin}/health`));
  const firstTrust = await store.ensureTrusted(origin);
  assert.equal(firstTrust.trustUpdated, true);
  transport.reset();
  async function login() {
    const result = await performRemoteDirectOAuth({ serverUrl: origin, fetchImpl: transport.fetch,
      openAuthorization: async (authorizationUrl, context) => {
        let window;
        const close = await openRemoteDirectAuthorizationWindow({
          createWindow: options => { window = new BrowserWindow(options); return window; },
          authorizationUrl, ...context,
          certificateVerifyProc: (request, callback) => store.verifyCertificate(request, callback),
        });
        assert.equal(window.isVisible(), true);
        assert.equal(window.webContents.getURL(), authorizationUrl);
        assert.equal(window.webContents.getTitle(), '登录 Moss Server');
        await window.loadURL(`${origin}/api/v1/auth/oauth/authorize`);
        assert.equal(window.isDestroyed(), false);
        assert.equal(window.webContents.getTitle(), '账号或密码错误');
        opened++;
        await fetch(`${start.redirect_uri}?state=${start.state}&code=${'a'.repeat(43)}`);
        return close;
      },
    });
    assert.equal(result.user.id, 'test-user');
  }
  await login();
  // A newly created store simulates the next app launch, without a manual load.
  store = createRemoteDirectTrustStore({ trustDir, initialExtraCaPath: '' });
  assert.equal((await store.ensureTrusted(origin)).trustUpdated, undefined);
  transport.reset(); await login();
  server.setSecureContext(second); server.closeAllConnections(); transport.reset();
  await assert.rejects(transport.fetch(`${origin}/health`));
  await assert.rejects(ensureRemoteDirectTrustWithConfirmation({ trustStore: store, serverUrl: origin, confirmCertificateChange: async () => false }), /认证已取消/);
  let confirmations = 0;
  await ensureRemoteDirectTrustWithConfirmation({ trustStore: store, serverUrl: origin, confirmCertificateChange: async details => {
    assert.notEqual(details.oldFingerprint, details.newFingerprint); confirmations++; return true;
  } });
  transport.reset(); await login();
  assert.equal(confirmations, 1); assert.equal(opened, 3);
  console.log('PASS: real Electron login after first trust, restart and certificate rotation; changed certificate still requires confirmation');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server?.closeAllConnections(); server?.close();
  await rm(temp, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
}

}
void run();
