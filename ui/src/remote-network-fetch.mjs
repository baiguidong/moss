function requestUrl(input) {
  try { return new URL(typeof input === 'string' ? input : input?.url || String(input)); }
  catch { return null; }
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isConnectionError(error) {
  return /net::ERR_(?:CONNECTION_|INTERNET_DISCONNECTED|NETWORK_|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|TIMED_OUT|SSL_)/.test(error?.message || '')
    || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(error?.code || error?.cause?.code)
    || (error instanceof TypeError && /fetch failed|failed to fetch|network error/i.test(error.message));
}

// All desktop server consumers share this transport: session sync, Agent Mail,
// cloud files and the embedded runtime. Throttling only one poller still lets
// the others repeatedly open failing TLS connections (and emit native logs).
export function createOfflineAwareFetch({
  fetchImpl,
  isOnline = () => true,
  now = Date.now,
  initialDelayMs = 30_000,
  maxDelayMs = 5 * 60_000,
}) {
  const failures = new Map();
  let wasOffline = false;

  const fetchWithBackoff = async (input, init) => {
    const signal = init?.signal ?? input?.signal;
    signal?.throwIfAborted();
    const url = requestUrl(input);
    if (!url || !['http:', 'https:'].includes(url.protocol)) return fetchImpl(input, init);
    const online = isOnline();
    if (!online) {
      wasOffline = true;
      // Local Moss Servers remain usable without an Internet connection.
      if (!isLoopback(url.hostname)) {
        throw Object.assign(new Error('当前网络离线，恢复连接后自动重试。'), { code: 'MOSS_NETWORK_OFFLINE' });
      }
    } else if (wasOffline) {
      wasOffline = false;
      failures.clear();
    }

    const previous = failures.get(url.origin);
    if (previous && (previous.retryAt > now() || previous.probing)) throw previous.error;
    if (previous) previous.probing = true;
    try {
      const response = await fetchImpl(input, init);
      // HTTP responses (including auth failures) prove the server is reachable.
      failures.delete(url.origin);
      return response;
    } catch (error) {
      if (!signal?.aborted && error?.name !== 'AbortError' && isConnectionError(error)) {
        const delayMs = Math.min(maxDelayMs, previous ? previous.delayMs * 2 : initialDelayMs);
        if (failures.size >= 64 && !failures.has(url.origin)) failures.delete(failures.keys().next().value);
        failures.set(url.origin, { error, delayMs, retryAt: now() + delayMs, probing: false });
      }
      throw error;
    } finally {
      if (previous) previous.probing = false;
    }
  };

  // Explicit reconnect/settings changes should not wait for a background retry.
  fetchWithBackoff.reset = (input) => {
    const url = input ? requestUrl(input) : null;
    if (url) failures.delete(url.origin);
    else failures.clear();
  };
  return fetchWithBackoff;
}
