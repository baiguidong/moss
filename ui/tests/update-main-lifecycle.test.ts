import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('function shutdownDesktop()'), source.indexOf("app.on('window-all-closed'"));
function fixture(extra: Record<string, any> = {}) {
  const calls: string[] = [];
  const context = {
    Promise, Error, appShutdownComplete: false, desktopShutdownPromise: null,
    stopMossCronScheduler: () => calls.push('cron-stop'),
    localTranscriptSync: { dispose: () => calls.push('transcript-sync-stop') },
    computerUseService: { stop: async () => { calls.push('computer-use-stop'); } },
    sessions: new Map([['chat', { id: 'chat' }]]), subAgentSessions: new Map([['child', { id: 'child' }]]),
    hasActiveAgentTeam: () => false, shutdownSessionAgentTeam: async () => true,
    agentTeamsService: { checkNow: async () => {}, stop: () => calls.push('teams-stop') },
    appExecutionHost: { close: async () => { calls.push('executions-close'); } },
    appTraceHost: { close: async () => { calls.push('trace-close'); } },
    agentMailPoller: { stop: async () => { calls.push('mail-stop'); } },
    appAuditHost: { close: () => calls.push('audit-close') },
    schedulePersistSession: (record: { id: string }, immediate: boolean) => { expect(immediate).toBe(true); calls.push(`persist-${record.id}`); },
    closeWorkspaceWatcher: () => {}, disposeRuntime: (record: { id: string }) => calls.push(`dispose-${record.id}`),
    cloudStorageHost: { close: async () => { calls.push('cloud-close'); } },
    appRuntime: { shutdown: async () => { calls.push('apps-close'); } },
    fsp: { rm: async () => {} }, REMOTE_PREVIEW_CACHE_DIR: '/test-only', ...extra,
  };
  const shutdown = runInNewContext(`${body}\nshutdownDesktop`, context);
  return { shutdown, context, calls };
}

test('desktop shutdown waits for asynchronous services and persists every session before disposal', async () => {
  let entered!: () => void; const cloudEntered = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void; const cloudDone = new Promise<void>(resolve => { finish = resolve; });
  const { shutdown, context, calls } = fixture({ cloudStorageHost: { close: () => { entered(); return cloudDone; } } });
  const pending = shutdown();
  expect(shutdown()).toBe(pending);
  await cloudEntered;
  expect(context.appShutdownComplete).toBe(false);
  expect(calls).toContain('mail-stop'); expect(calls).not.toContain('apps-close');
  finish(); await pending;
  expect(context.appShutdownComplete).toBe(true);
  expect(calls.indexOf('persist-chat')).toBeLessThan(calls.indexOf('dispose-chat'));
  expect(calls.indexOf('persist-child')).toBeLessThan(calls.indexOf('dispose-child'));
  expect(calls).toContain('apps-close');
  expect(calls).toContain('transcript-sync-stop');
  expect(calls.indexOf('computer-use-stop')).toBeLessThan(calls.indexOf('apps-close'));
  expect(calls.indexOf('trace-close')).toBeLessThan(calls.indexOf('apps-close'));
  await shutdown(); expect(calls.filter(call => call === 'apps-close').length).toBe(1);
});
test('a failing component does not skip other cleanup or authorize installation', async () => {
  let failed = true;
  const { shutdown, context, calls } = fixture({ appAuditHost: { close: () => { if (failed) throw new Error('audit close failed'); } } });
  await expect(shutdown()).rejects.toThrow('audit close failed');
  expect(context.appShutdownComplete).toBe(false);
  expect(calls).toContain('apps-close'); expect(calls).toContain('persist-child');
  failed = false; await shutdown(); expect(context.appShutdownComplete).toBe(true);
});
test('Windows installation blockers include queued work, teams, terminals, App requests and runtime setup', () => {
  const getBlockers = runInNewContext(source.slice(source.indexOf('function getInstallBlockers()'), source.indexOf('const updateInstallPreparation')) + '\ngetInstallBlockers', {
    sessions: new Map([['session', { busy: true }]]), subAgentSessions: new Map(),
    sessionPromptQueues: new Map(), sessionSendQueues: new Map(), projectCoordinatorTaskRuns: new Map(),
    isSessionBusyForRenderer: (record: any) => record.busy, hasActiveAgentTeam: () => true,
    terminalManager: { hasOpenTerminals: () => true }, activeAppUpdateOperations: 0,
    computerUseService: { owner: null, inFlight: false },
    appRuntime: { supervisor: { listStatuses: () => [{ pendingActions: 1 }] } }, managedRuntimeInstallPromise: Promise.resolve(),
  });
  expect(getBlockers()).toEqual(['会话或后台任务', 'Agent Team', '终端窗口', 'App 操作', '运行时安装']);
});
