import { createHash } from 'node:crypto';
import { fetchModelCatalog, getModelListUrl } from '../../shared/model-list.mjs';
import { readJsonFile, writeJsonFileAtomicAsync } from './shared/json-files.mjs';

const REFRESH_INTERVAL_MS = 30_000;
const MAX_CATALOGS = 8;

function catalogKey({ url, apiKey }) {
  try {
    const endpoint = getModelListUrl(url);
    return createHash('sha256').update(JSON.stringify([endpoint, apiKey?.trim() || ''])).digest('hex');
  } catch {
    return '';
  }
}

export function createModelCatalogStore({ storagePath, fetchCatalog = fetchModelCatalog, log = () => {} }) {
  const saved = readJsonFile(storagePath, {}) || {};
  const catalogs = new Map(Object.entries(saved).filter(([key, record]) => (
    /^[0-9a-f]{64}$/.test(key) && Number.isFinite(record?.fetchedAt) &&
    Array.isArray(record.catalog?.models) && record.catalog.models.every(model => typeof model === 'string')
  )).slice(-MAX_CATALOGS));
  const pending = new Map();
  let writes = Promise.resolve();

  return {
    get(connection) {
      return catalogs.get(catalogKey(connection))?.catalog;
    },
    async refresh(connection, { force = false } = {}) {
      const key = catalogKey(connection);
      if (!key) return fetchCatalog(connection);
      const existing = catalogs.get(key);
      if (pending.has(key)) return pending.get(key);
      if (!force && existing && Date.now() - existing.fetchedAt < REFRESH_INTERVAL_MS) return existing.catalog;

      const promise = (async () => {
        const catalog = await fetchCatalog(connection);
        catalogs.delete(key);
        catalogs.set(key, { fetchedAt: Date.now(), catalog });
        if (catalogs.size > MAX_CATALOGS) catalogs.delete(catalogs.keys().next().value);
        const snapshot = Object.fromEntries(catalogs);
        writes = writes.then(() => writeJsonFileAtomicAsync(storagePath, snapshot)).catch(error => {
          log('warn', 'model-catalog', 'Unable to save model catalog', { error: error.message });
        });
        await writes;
        return catalog;
      })().finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
  };
}
