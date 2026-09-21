import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

function handlerSource(name: string, nextName: string) {
  const start = mainSource.indexOf(`ipcMain.handle('${name}'`);
  const end = mainSource.indexOf(`ipcMain.handle('${nextName}'`, start + 1);
  return mainSource.slice(start, end);
}

describe('desktop session loading', () => {
  test('returns cached sessions before local reconciliation or remote synchronization finishes', () => {
    const source = handlerSource('agent:list-sessions', 'agent:search-sessions');

    expect(source).toContain('const summaries = listVisibleSessionSummaries();');
    expect(source).toContain('setImmediate(() => {');
    expect(source).toContain('void reconcileLocalSessionSourcesBestEffort();');
    expect(source).toContain('void synchronizeRemoteSessionsBestEffort();');
    expect(source).toContain('return summaries;');
    expect(source).not.toContain('await ');
  });

  test('keeps explicit remote synchronization awaitable', () => {
    const source = handlerSource('agent:sync-remote-sessions', 'agent:create-session');
    expect(source).toContain('await synchronizeRemoteSessionsBestEffort();');
  });
});
