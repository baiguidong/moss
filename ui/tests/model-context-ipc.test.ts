import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getDeclaredModelContextWindows } from '../src/desktop-settings.mjs';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const source = main.slice(main.indexOf("ipcMain.handle('agent:get-model-context'"), main.indexOf('registerSessionEffortIpc({'));

test('context IPC uses live runtime settings, resolves unopened sessions, and skips remote discovery', async () => {
  let handle: (_event: unknown, payload: { sessionId: string }) => Promise<unknown>;
  let loads = 0;
  const calls: unknown[] = [];
  const settings = {
    model: 'gpt-5.5', url: 'https://example.test/v1', apiKey: 'test-key',
    declaredContextByModel: { 'previous-model': 1_000_000 },
  };
  const expected = { model: 'previous-model', contextWindow: 1_000_000, isDefault: false };
  const sessions: Record<string, unknown> = {
    running: { runtime: { getModelContext: async () => expected } },
    reopened: { modelOverride: 'previous-model' },
    remote: { agentMode: 'remote-direct' },
  };
  runInNewContext(source, {
    ipcMain: { handle: (_channel: string, fn: typeof handle) => { handle = fn; } },
    getSessionRecord: (id: string) => sessions[id],
    getRuntimeModelSettings: () => settings,
    resolveSessionModel: (sessionRecord: any, modelSettings: typeof settings) =>
      typeof sessionRecord?.modelOverride === 'string' && sessionRecord.modelOverride.trim()
        ? sessionRecord.modelOverride.trim()
        : String(modelSettings.model || '').trim(),
    getDeclaredModelContextWindows,
    getClaudeRuntimeModule: async () => {
      loads++;
      return { resolveDesktopModelContext: async (options: unknown) => { calls.push(options); return expected; } };
    },
  });
  expect(await handle!(null, { sessionId: 'running' })).toMatchObject({ model: 'previous-model' });
  expect(loads).toBe(0);
  expect(await handle!(null, { sessionId: 'reopened' })).toEqual(expected);
  expect(calls).toEqual([{
    model: 'previous-model', url: settings.url, apiKey: settings.apiKey,
    declaredContextWindows: { 'previous-model': 1_000_000 },
  }]);
  expect(await handle!(null, { sessionId: 'remote' })).toBeNull();
  expect(loads).toBe(1);
});
