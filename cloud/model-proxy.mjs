import http from 'node:http';
import https from 'node:https';
import { json } from './http.mjs';

const routes = new Map([
  ['/v1/models', 'GET'],
  ['/v1/messages', 'POST'],
  ['/v1/messages/count_tokens', 'POST'],
  ['/v1/responses', 'POST'],
  ['/v1/chat/completions', 'POST'],
  ['/v1/images/generations', 'POST'],
  ['/v1/images/edits', 'POST'],
]);

// This listener is reachable on personal Docker networks. Only the WebUI
// listener is published. Router authenticates and meters each user's key.
export function createModelProxy(upstream) {
  const base = new URL(upstream);
  const transport = base.protocol === 'https:' ? https : http;
  return http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (routes.get(pathname) !== req.method) return json(res, 404, { error: 'Unknown model endpoint' });
    if (!req.headers.authorization && !req.headers['x-api-key']) return json(res, 401, { error: 'Missing model credential' });
    const headers = {};
    for (const key of ['authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'content-type', 'content-length', 'accept']) {
      if (req.headers[key]) headers[key] = req.headers[key];
    }
    const request = transport.request(base, { method: req.method, path: base.pathname.replace(/\/$/, '') + req.url, headers }, response => {
      const headers = { 'cache-control': 'no-store' };
      for (const key of ['content-type', 'content-encoding', 'retry-after', 'request-id', 'x-request-id']) {
        if (response.headers[key]) headers[key] = response.headers[key];
      }
      res.writeHead(response.statusCode, headers);
      res.flushHeaders();
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    res.on('close', () => request.destroy());
    req.on('error', () => request.destroy());
    request.on('error', () => {
      if (!res.headersSent && !res.destroyed) json(res, 502, { error: 'Router connection failed' });
      else res.destroy();
    });
    req.pipe(request);
  });
}
