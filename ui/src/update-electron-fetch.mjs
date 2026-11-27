import { net } from 'electron';
import { Readable, addAbortSignal } from 'node:stream';

// net.fetch rejects Chromium's manual redirects before exposing Location.
// Return one HTTP hop so fetchUpdateResource can validate the next URL.
export function fetchElectronUpdate(url, { signal, headers }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'manual', credentials: 'omit', headers });
    const abort = () => {
      reject(signal.reason);
      request.abort();
    };
    signal?.addEventListener('abort', abort, { once: true });
    request.once('close', () => signal?.removeEventListener('abort', abort));
    request.on('error', reject);
    request.once('redirect', (status, _method, location) => {
      resolve(new Response(null, { status, headers: { location } }));
      request.abort();
    });
    request.once('response', message => {
      const status = message.statusCode;
      const headers = new Headers();
      for (const [key, values] of Object.entries(message.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) headers.append(key, value);
      }
      if ([204, 205, 304].includes(status)) {
        message.resume();
        resolve(new Response(null, { status, headers }));
        return;
      }
      if (signal) addAbortSignal(signal, message);
      message.once('close', () => { if (!message.readableEnded) request.abort(); });
      resolve(new Response(Readable.toWeb(message), { status, headers }));
    });
    request.end();
  });
}
