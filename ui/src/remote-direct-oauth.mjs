import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const CANCEL_TIMEOUT_MS = 1000;

function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function valuesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left), 'ascii');
  const rightBuffer = Buffer.from(String(right), 'ascii');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeServerUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim().replace(/\/+$/, ''));
  } catch {
    throw new Error('Moss Server 地址无效，请检查协议、主机和端口。');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) {
    throw new Error('远端认证要求 HTTPS；仅本机 Server 可以使用 HTTP。');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Moss Server 地址必须是 origin，不能包含路径、查询参数或 fragment。');
  }
  return url.origin;
}

async function readJsonResponse(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Moss Server response is too large.');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('Moss Server response is too large.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Moss Server returned invalid JSON (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Moss Server returned ${response.status}.`);
  }
  return data;
}

function callbackPage(ok) {
  const title = ok ? 'Moss 认证已完成' : 'Moss 认证失败';
  const message = ok ? '可以关闭此窗口并返回 Moss。' : '请返回 Moss 后重新认证。';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

async function createCallbackListener(expectedState) {
  let settle;
  const callback = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  let settled = false;
  const settleOnce = (method, value) => {
    if (settled) return;
    settled = true;
    settle[method](value);
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    const state = url.searchParams.get('state') || '';
    const error = url.searchParams.get('error') || '';
    const code = url.searchParams.get('code') || '';
    if (!valuesMatch(state, expectedState)) {
      response.writeHead(400, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(callbackPage(false));
      return;
    }
    if (error) {
      response.writeHead(400, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(callbackPage(false));
      settleOnce('reject', new Error(error === 'access_denied' ? '认证已取消。' : `OAuth authorization failed: ${error}`));
      return;
    }
    if (!code) {
      response.writeHead(400, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(callbackPage(false));
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
      response.writeHead(400, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(callbackPage(false));
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'content-type': 'text/html; charset=utf-8',
    });
    response.end(callbackPage(true));
    settleOnce('resolve', code);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', (error) => settleOnce('reject', error));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to start OAuth callback listener.');
  }
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    callback,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function cancelServerAuthorization({ serverUrl, redirectUri, state, code, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('OAuth cancellation timed out.')),
    CANCEL_TIMEOUT_MS,
  );
  try {
    await fetchImpl(`${serverUrl}/api/v1/auth/oauth/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: redirectUri,
        state,
        ...(code ? { code } : {}),
      }),
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    // Cancellation is best-effort; the Server will prune any remaining request.
  } finally {
    clearTimeout(timeout);
  }
}

async function performLegacyRemoteDirectOAuth({
  serverUrl,
  openAuthorization,
  fetchImpl = fetch,
  timeoutMs = LOGIN_TIMEOUT_MS,
  requestTimeoutMs = 20_000,
  signal,
  callbackListener = createCallbackListener,
}) {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const state = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const listener = await callbackListener(state);
  const abortController = new AbortController();
  let timeout;
  let rejectStopped;
  let stopped = false;
  const stoppedPromise = new Promise((_, reject) => {
    rejectStopped = reject;
  });
  const stop = (error) => {
    if (stopped) return;
    stopped = true;
    rejectStopped(error);
    abortController.abort(error);
  };
  const handleExternalAbort = () => {
    stop(signal?.reason instanceof Error ? signal.reason : new Error('认证已取消。'));
  };
  if (signal?.aborted) handleExternalAbort();
  else signal?.addEventListener('abort', handleExternalAbort, { once: true });
  timeout = setTimeout(() => stop(new Error('Moss Server 认证超时。')), timeoutMs);
  timeout.unref?.();
  let completed = false;
  let authorizationCode = '';
  let closeAuthorization = () => {};
  const requestJson = async (url, body) => {
    const requestSignal = AbortSignal.any([abortController.signal, AbortSignal.timeout(requestTimeoutMs)]);
    return Promise.race([
      (async () => readJsonResponse(await fetchImpl(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: requestSignal,
      })))(),
      stoppedPromise,
    ]);
  };
  try {
    const started = await requestJson(`${normalizedServerUrl}/api/v1/auth/oauth/start`, {
      redirect_uri: listener.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    const authorizationUrl = new URL(started.authorization_url, normalizedServerUrl);
    const authorizePath = '/api/v1/auth/oauth/authorize';
    const pathTransactionId = authorizationUrl.pathname.startsWith(`${authorizePath}/`)
      ? authorizationUrl.pathname.slice(authorizePath.length + 1)
      : '';
    if (
      authorizationUrl.origin !== normalizedServerUrl ||
      !/^[A-Za-z0-9_-]{43}$/.test(pathTransactionId) ||
      authorizationUrl.search ||
      authorizationUrl.username ||
      authorizationUrl.password ||
      authorizationUrl.hash
    ) {
      throw new Error('Moss Server returned an invalid authorization URL.');
    }
    const closeOpenedAuthorization = await Promise.race([
      Promise.resolve(openAuthorization(authorizationUrl.toString(), {
        redirectUri: listener.redirectUri,
        state,
        signal: abortController.signal,
      })),
      stoppedPromise,
    ]);
    if (typeof closeOpenedAuthorization === 'function') {
      closeAuthorization = closeOpenedAuthorization;
    }

    authorizationCode = await Promise.race([
      listener.callback,
      stoppedPromise,
    ]);
    const exchanged = await requestJson(`${normalizedServerUrl}/api/v1/auth/oauth/exchange`, {
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: listener.redirectUri,
    });
    if (typeof exchanged.access_token !== 'string' || !exchanged.access_token) {
      throw new Error('Moss Server response is missing an access token.');
    }
    completed = true;
    return {
      serverUrl: normalizedServerUrl,
      authToken: exchanged.access_token,
      user: exchanged.user ?? null,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', handleExternalAbort);
    closeAuthorization();
    await Promise.all([
      listener.close(),
      completed
        ? Promise.resolve()
        : cancelServerAuthorization({
          serverUrl: normalizedServerUrl,
          redirectUri: listener.redirectUri,
          state,
          code: authorizationCode,
          fetchImpl,
        }),
    ]);
  }
}

async function performOidcRemoteOAuth({
  serverUrl, discovery, openAuthorization, fetchImpl = fetch, timeoutMs = LOGIN_TIMEOUT_MS,
  requestTimeoutMs = 20_000, signal, callbackListener = createCallbackListener,
}) {
  const state = randomBase64Url();
  const clientId = discovery.desktop_client_id || 'moss-desktop';
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const listener = await callbackListener(state);
  const abortController = new AbortController();
  let timeout;
  let rejectStopped;
  let stopped = false;
  const stoppedPromise = new Promise((_, reject) => { rejectStopped = reject; });
  const stop = error => { if (stopped) return; stopped = true; rejectStopped(error); abortController.abort(error); };
  const handleExternalAbort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error('认证已取消。'));
  if (signal?.aborted) handleExternalAbort(); else signal?.addEventListener('abort', handleExternalAbort, { once: true });
  timeout = setTimeout(() => stop(new Error('Moss Server 认证超时。')), timeoutMs); timeout.unref?.();
  let closeAuthorization = () => {};
  const request = async (url, init) => Promise.race([
    (async () => readJsonResponse(await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(requestTimeoutMs)]) })))(),
    stoppedPromise,
  ]);
  try {
    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId, redirect_uri: listener.redirectUri, response_type: 'code',
      scope: 'openid profile email', state, code_challenge: codeChallenge, code_challenge_method: 'S256',
    }).toString();
    const opened = await Promise.race([
      Promise.resolve(openAuthorization(authorizationUrl.toString(), { redirectUri: listener.redirectUri, state, signal: abortController.signal })),
      stoppedPromise,
    ]);
    if (typeof opened === 'function') closeAuthorization = opened;
    const code = await Promise.race([listener.callback, stoppedPromise]);
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: listener.redirectUri, code_verifier: codeVerifier });
    const exchanged = await request(discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (typeof exchanged.access_token !== 'string' || !exchanged.access_token) throw new Error('Moss Server response is missing an access token.');
    let user = null;
    if (discovery.userinfo_endpoint) {
      try { user = await request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${exchanged.access_token}` } }); } catch {}
    }
    return { serverUrl, authToken: exchanged.access_token, user };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', handleExternalAbort); closeAuthorization();
    await listener.close();
  }
}

export async function performRemoteDirectOAuth(options) {
  const normalizedServerUrl = normalizeServerUrl(options.serverUrl);
  try {
    const fetchDiscovery = options.fetchImpl || fetch;
    const discoveryTimeout = Math.min(options.requestTimeoutMs || 20_000, options.timeoutMs || LOGIN_TIMEOUT_MS);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason || new Error('Discovery timed out.'));
    const timer = setTimeout(abort, discoveryTimeout);
    options.signal?.addEventListener('abort', abort, { once: true });
    const response = await Promise.race([
      fetchDiscovery(`${normalizedServerUrl}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' }, redirect: 'error', signal: controller.signal,
      }),
      new Promise((_, reject) => {
        const done = () => reject(new Error('OIDC discovery timed out.'));
        timer.unref?.();
        controller.signal.addEventListener('abort', done, { once: true });
      }),
    ]);
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    if (response.ok) {
      const discovery = await response.json();
      if (typeof discovery.authorization_endpoint === 'string' && typeof discovery.token_endpoint === 'string') {
        return await performOidcRemoteOAuth({ ...options, serverUrl: normalizedServerUrl, discovery });
      }
    }
  } catch {}
  return await performLegacyRemoteDirectOAuth({ ...options, serverUrl: normalizedServerUrl });
}
