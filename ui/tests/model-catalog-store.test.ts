import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelCatalogStore } from '../src/model-catalog-store.mjs';

test('shares in-flight fetches and restores the last successful catalog for the same credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-catalog-store-'));
  try {
    const storagePath = path.join(root, 'catalogs.json');
    const connection = { url: 'https://models.example.test', apiKey: 'catalog-test-key' };
    const catalog = { models: ['model-a', 'model-b'], contextWindows: {} };
    let requests = 0;
    const store = createModelCatalogStore({ storagePath, fetchCatalog: async () => {
      requests += 1;
      if (requests > 1) throw new Error('Catalog unavailable');
      return catalog;
    } });
    expect(await Promise.all([store.refresh(connection), store.refresh(connection)])).toEqual([catalog, catalog]);
    expect(await store.refresh(connection)).toEqual(catalog);
    expect(requests).toBe(1);
    await expect(store.refresh(connection, { force: true })).rejects.toThrow('Catalog unavailable');
    expect(store.get(connection)).toEqual(catalog);

    const restarted = createModelCatalogStore({ storagePath });
    expect(restarted.get({ ...connection, url: `${connection.url}/v1` })).toEqual(catalog);
    expect(restarted.get({ ...connection, apiKey: 'different-key' })).toBeUndefined();
    expect(await fs.readFile(storagePath, 'utf8')).not.toContain(connection.apiKey);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
