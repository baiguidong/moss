import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const source = main.slice(main.indexOf("ipcMain.handle('agent:get-model-context'"), main.indexOf("ipcMain.handle('agent:get-session'"));

test('context IPC uses live runtime settings, resolves unopened sessions, and skips remote discovery', async () => {
  let handle: (_event: unknown, payload: { sessionId: string }) => Promise<unknown>;
  let loads = 0;
  const calls: unknown[] = [];
  const settings = { model: 'gpt-5.5', url: 'https://example.test/v1', apiKey: 'test-key' };
  const expected = { model: settings.model, contextWindow: 1_000_000, isDefault: false };
  const sessions: Record<string, unknown> = {
    running: { runtime: { getModelContext: async () => ({ ...expected, model: 'previous-model' }) } },
    reopened: {},
    remote: { agentMode: 'remote-direct' },
  };
  runInNewContext(source, {
    ipcMain: { handle: (_channel: string, fn: typeof handle) => { handle = fn; } },
    getSessionRecord: (id: string) => sessions[id],
    desktopSettings: settings,
    getClaudeRuntimeModule: async () => {
      loads++;
      return { resolveDesktopModelContext: async (options: unknown) => { calls.push(options); return expected; } };
    },
  });
  expect(await handle!(null, { sessionId: 'running' })).toMatchObject({ model: 'previous-model' });
  expect(loads).toBe(0);
  expect(await handle!(null, { sessionId: 'reopened' })).toEqual(expected);
  expect(calls).toEqual([settings]);
  expect(await handle!(null, { sessionId: 'remote' })).toBeNull();
  expect(loads).toBe(1);
});
