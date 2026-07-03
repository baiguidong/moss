import http from 'node:http';
import https from 'node:https';

export const MAX_DOWNLOAD_REDIRECTS = 8;

export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024; // 200MB 上限, 防止不可信响应撑爆内存

export async function downloadFileBuffer(url, options = {}) {
  const {
    userAgent = 'Moss/1.0',
    timeoutMs = 60000,
    maxRedirects = MAX_DOWNLOAD_REDIRECTS,
    maxBytes = MAX_DOWNLOAD_BYTES,
  } = options;

  let currentUrl = url;
  const visitedUrls = new Set();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const normalizedUrl = new URL(currentUrl).toString();
    if (visitedUrls.has(normalizedUrl)) {
      throw new Error(`Redirect loop detected while downloading: ${normalizedUrl}`);
    }
    visitedUrls.add(normalizedUrl);

    const result = await new Promise((resolve, reject) => {
      const parsedUrl = new URL(normalizedUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const request = client.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { 'User-Agent': userAgent },
      }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          const redirectLocation = response.headers.location;
          response.resume();
          if (!redirectLocation) {
            reject(new Error(`Redirect (${response.statusCode}) missing location header`));
            return;
          }
          resolve({
            redirectUrl: new URL(redirectLocation, normalizedUrl).toString(),
          });
          return;
        }

        if (response.statusCode && response.statusCode >= 400) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const declaredLength = Number(response.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.destroy();
          reject(new Error(`Download exceeds size limit (${declaredLength} > ${maxBytes} bytes)`));
          return;
        }

        const chunks = [];
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy();
            reject(new Error(`Download exceeds size limit (> ${maxBytes} bytes)`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        response.on('error', reject);
      });

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error('Download timeout'));
      });
      request.on('error', reject);
      request.end();
    });

    if (result.redirectUrl) {
      currentUrl = result.redirectUrl;
      continue;
    }

    return result.buffer;
  }

  throw new Error(`Too many redirects while downloading: ${url}`);
}
