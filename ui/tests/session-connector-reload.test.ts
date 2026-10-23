import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeStringList } from '../src/shared/string-list.mjs';
import { connectorIdFromApp } from '../../packages/app-sdk/src/discovery.mjs';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const selection = main.slice(main.indexOf('function getRuntimeSessionAppSelection('), main.indexOf('async function buildClaudeSessionConfig('));
const startup = main.slice(main.indexOf('async function runSessionPromptObserved('), main.indexOf('  const bindVisibleUser =')) + '\nreturn runtime;\n}';

function fixture() {
  const record: any = { id: 'esp32', agentMode: 'local', projectId: 'project', underlyingSessionId: 'saved',
    appIds: ['moss.database'], appServiceIds: [], connectorIds: ['baidu-netdisk'], runtime: null };
  let restores = 0, disposals = 0;
  const controller = new AbortController();
  const context: any = {
    normalizeStringList, connectorIdFromApp,
    getRuntimeSessionConnectorIds: (value: any) => value.connectorIds,
    listAllStoredApps: () => [{ id: 'moss.baidu-netdisk', connectorApp: { id: 'baidu-netdisk' } }],
    appRuntime: { getInstallation: () => ({ enabled: true }) },
    assertWorkspaceVersionIdle: () => {}, localTranscriptSync: { refresh: async () => {} },
    hasActiveAgentTeam: () => false, getProjectWorkerTasks: () => [], isActiveProjectWorker: () => false,
    disposeRuntime: () => { disposals++; record.runtime = null; },
    resumeSessionRecord: async () => {
      if (++restores > 3) throw new Error('Repeated runtime reload');
      const selected = context.getSelection(record);
      record.runtimeAppIds = selected.selectedAppIds;
      record.runtimeAppServiceIds = selected.selectedAppServiceIds;
      record.runtime = {};
      return {};
    },
    ensureRuntime: async () => record.runtime,
  };
  vm.runInNewContext(selection + startup + '\nglobalThis.getSelection = getRuntimeSessionAppSelection; globalThis.run = runSessionPromptObserved;', context);
  return { record, context, controller, counts: () => ({ restores, disposals }) };
}

test('a session with an authorized connector resumes once and proceeds to its prompt', async () => {
  const { context, record, controller, counts } = fixture();
  const runtime = await context.run({ sessionRecord: record, controllerSignal: controller.signal });
  expect(runtime).toBe(record.runtime);
  expect(record.runtimeAppIds).toEqual(['moss.database', 'moss.baidu-netdisk']);
  expect(record.appIds).toEqual(['moss.database']);
  expect(counts()).toEqual({ restores: 1, disposals: 0 });
});

test('adding project Apps or services does not make prompt startup rebuild an existing runtime', async () => {
  const { context, record, counts } = fixture();
  record.runtime = {}; record.runtimeAppIds = ['moss.database']; record.runtimeAppServiceIds = [];
  record.appServiceIds = ['moss.database/service'];
  await context.run({ sessionRecord: record });
  expect(counts()).toEqual({ restores: 0, disposals: 0 });
  expect(record.appServiceIds).toEqual(['moss.database/service']);
});

test('Stop during runtime startup exits before a prompt is sent', async () => {
  const { context, record, controller, counts } = fixture();
  record.runtime = {}; record.runtimeAppIds = [];
  let ensures = 0;
  context.ensureRuntime = async () => { ensures++; controller.abort(); return record.runtime; };
  await expect(context.run({ sessionRecord: record, controllerSignal: controller.signal })).rejects.toThrow();
  expect(counts()).toEqual({ restores: 0, disposals: 0 });
  expect(ensures).toBe(1);
});
