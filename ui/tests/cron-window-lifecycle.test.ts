import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('closing the last macOS window preserves cron runtimes and their workers', async () => {
  const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("app.on('window-all-closed'");
  const end = source.indexOf("app.on('before-quit'", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const sessions = new Map([
    ['chat', { id: 'chat', sessionKind: 'chat' }],
    ['cron', { id: 'cron', sessionKind: 'cron' }],
  ]);
  const subAgentSessions = new Map([
    ['chat-child', { id: 'chat-child', parentSessionId: 'chat' }],
    ['cron-child', { id: 'cron-child', parentSessionId: 'cron' }],
  ]);
  const disposed: string[] = [];
  const shutdown: string[] = [];
  let onClose!: () => void;
  let teamsChecked!: () => void;
  const complete = new Promise<void>(resolve => { teamsChecked = resolve; });
  runInNewContext(source.slice(start, end), {
    app: { on: (_name: string, callback: () => void) => { onClose = callback; }, quit: () => { throw new Error('Unexpected quit'); } },
    process: { platform: 'darwin' }, sessions, subAgentSessions,
    shutdownSessionAgentTeam: async (record: { id: string }) => { shutdown.push(record.id); },
    closeWorkspaceWatcher: () => {},
    disposeRuntime: (record: { id: string }) => disposed.push(record.id),
    agentTeamsService: { checkNow: teamsChecked },
  });
  onClose();
  await complete;
  expect(disposed.sort()).toEqual(['chat', 'chat-child']);
  expect(shutdown).toEqual(['chat']);
});
