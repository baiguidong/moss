import { expect, test } from 'bun:test';
import { fetchModelCatalog, fetchModelList } from './model-list.mjs';

test('model catalog retains context windows without changing the name-only API', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: [
    { id: 'small', context_window: 256_000 },
    { id: 'large', context_window: 1_050_000, max_input_tokens: 922_000 },
    { name: 'input-only', max_input_tokens: 500_000 },
    { id: 'unknown' },
  ] }));
  const options = { url: 'https://example.test/v1', fetchImpl };
  expect(await fetchModelCatalog(options)).toEqual({
    models: ['small', 'large', 'input-only', 'unknown'],
    contextWindows: { small: 256_000, large: 1_050_000, 'input-only': 500_000 },
  });
  expect(await fetchModelList(options)).toEqual(['small', 'large', 'input-only', 'unknown']);
});
