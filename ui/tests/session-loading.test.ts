import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const mainSource = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

function handlerSource(name: string, nextName: string) {
  const start = mainSource.indexOf(`ipcMain.handle('${name}'`);
  const end = mainSource.indexOf(`ipcMain.handle('${nextName}'`, start + 1);
  return mainSource.slice(start, end);
}

describe('desktop session loading', () => {
  test('returns cached sessions synchronously without waiting for reconciliation', () => {
    const source = handlerSource('agent:list-sessions', 'agent:search-sessions');
    const summaries = [{ id: 'cached-session' }];
    let handler!: () => unknown;
    runInNewContext(source, {
      ipcMain: { handle: (_name: string, callback: () => unknown) => { handler = callback; } },
      listVisibleSessionSummaries: () => summaries,
    });
    expect(handler()).toBe(summaries);
  });

  test('keeps explicit remote synchronization awaitable', () => {
    const source = handlerSource('agent:sync-remote-sessions', 'agent:create-session');
    expect(source).toContain('await synchronizeRemoteSessionsBestEffort();');
  });
});
