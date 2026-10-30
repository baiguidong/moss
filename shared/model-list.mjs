/**
 * Fetch model ids from an OpenAI-compatible model endpoint.
 * Settings accept either a provider root URL or a URL ending in /v1.
 */
export function getModelListUrl(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('请先填写 API URL。');

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('API URL 无效。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API URL 必须使用 http 或 https。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!/\/v1$/i.test(url.pathname)) url.pathname = `${url.pathname}/v1`;
  url.pathname += '/models';
  return url.toString();
}

export async function fetchModelList({ url, apiKey = '', timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = getModelListUrl(url);
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(typeof apiKey === 'string' && apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* handled by the status/message below */ }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || raw || response.statusText;
      throw new Error(`获取模型列表失败（HTTP ${response.status}）：${String(message).slice(0, 500)}`);
    }
    const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const models = [...new Set(entries
      .map((entry) => typeof entry === 'string' ? entry : entry?.id || entry?.name)
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim()))];
    if (!models.length) throw new Error('接口未返回可用模型。');
    return models;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('获取模型列表超时，请检查 API URL。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
