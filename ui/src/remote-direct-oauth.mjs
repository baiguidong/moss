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

export async function performRemoteDirectOAuth({
  serverUrl,
  openAuthorization,
  fetchImpl = fetch,
  timeoutMs = LOGIN_TIMEOUT_MS,
  signal,
}) {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const state = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const listener = await createCallbackListener(state);
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
  try {
    const startResponse = await Promise.race([
      fetchImpl(`${normalizedServerUrl}/api/v1/auth/oauth/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: listener.redirectUri,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }),
        redirect: 'error',
        signal: abortController.signal,
      }),
      stoppedPromise,
    ]);
    const started = await readJsonResponse(startResponse);
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
    const exchangeResponse = await Promise.race([
      fetchImpl(`${normalizedServerUrl}/api/v1/auth/oauth/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: authorizationCode,
          code_verifier: codeVerifier,
          redirect_uri: listener.redirectUri,
        }),
        redirect: 'error',
        signal: abortController.signal,
      }),
      stoppedPromise,
    ]);
    const exchanged = await readJsonResponse(exchangeResponse);
    if (typeof exchanged.api_key !== 'string' || !exchanged.api_key.startsWith('moss_sk_')) {
      throw new Error('Moss Server response is missing a permanent API Key.');
    }
    completed = true;
    return {
      serverUrl: normalizedServerUrl,
      apiKey: exchanged.api_key,
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
