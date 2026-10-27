import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const refreshSource = source.slice(source.indexOf('  const refreshRestoredAppServices ='), source.indexOf('  const installAppPackage ='));
const desktopStart = source.indexOf("    ipcMain.handle('host:renderer-ready'");
const desktopSource = source.slice(desktopStart, source.indexOf('\n  }\n  if (isWebHost', desktopStart));
const webStart = source.indexOf('    setTimeout(() => {', source.indexOf('const webRestoreSignal ='));
const webSource = source.slice(webStart, source.indexOf('\n  } else {', webStart));

for (const mode of ['desktop', 'web']) {
  for (const phase of ['register', 'restore', 'recover', 'mcp', 'connector', 'none']) {
    test(`${mode} startup cancellation at ${phase} preserves the service lifecycle`, async () => {
      let entered, release;
      const paused = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const calls = [];
      const step = async name => {
        calls.push(name);
        if (name === phase) { entered(); await gate; }
      };
      const controller = new AbortController();
      const apps = [{ id: 'test.app', currentVersion: '1', connectorApp: {}, manifest: { host: { protocols: ['agent'] } } }];
      const context = {
        restoreSignal: controller.signal, webRestoreSignal: controller.signal,
        mainWindow: { webContents: {} }, backgroundStarted: false,
        appRuntimeRestorePromise: null, appRuntimeRestorePending: true,
        listAllStoredApps: () => apps,
        registerStoredApps: () => step('register'),
        appRuntime: {
          restoreBackground: () => step('restore'),
          installations: { list: () => [{ appId: 'test.app', activeVersion: '1', enabled: true }] },
          instances: { list: () => [{ id: 'default', enabled: true }] }, packageCache: new Map(),
        },
        appExecutionHost: { recoverPending: () => step('recover') },
        appMcpHost: { refresh: () => step('mcp') },
        connectorAppHost: { refresh: () => step('connector') },
        agentChannelController: { onReady: () => calls.push('channel') },
        MOSS_AGENT_PROTOCOL: 'agent', webAutomationsPaused: false,
        initializeAgentMail: () => calls.push('mail-start'), startMossCronScheduler: () => calls.push('cron-start'),
        agentTeamsService: { start: () => calls.push('teams-start') },
        recoverInterruptedProjectCoordinatorTasks: () => calls.push('coordinator-start'),
        emitAppsChanged: () => calls.push('catalog'), mossLog: (...args) => { if (args[0] === 'error') assert.fail(args.join(' ')); },
        ipcMain: { handle: (_channel, fn) => { context.ready = fn; } },
        setTimeout: fn => fn(),
      };
      runInNewContext(refreshSource + (mode === 'desktop' ? desktopSource : webSource), context);
      if (mode === 'desktop') context.ready({ sender: context.mainWindow.webContents });
      const pending = context.appRuntimeRestorePromise;
      if (phase === 'none') {
        await pending;
        assert.deepEqual(calls, ['register', 'restore', 'recover', 'mcp', 'channel', 'connector', 'mail-start', 'cron-start', 'teams-start', 'coordinator-start', ...(mode === 'desktop' ? ['catalog'] : [])]);
        return;
      }
      await paused;
      controller.abort();
      const beforeCancel = [...calls];
      release();
      await pending;
      assert.deepEqual(calls, beforeCancel, 'Canceled restoration must not schedule another stage');
    });
  }
}
