import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { cleanIpcErrorMessage, getErrorMessage } from '../src/renderer-react/lib/app-notifications';

test('loads runtime file URLs in Node and retries after a failed Windows runtime import', () => {
  const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const start = main.indexOf('async function getClaudeRuntimeModule()');
  const end = main.indexOf('async function reloadRemoteDirectRuntimeTlsTrust()', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const result = spawnSync('node', ['--input-type=module', '-e', String.raw`
    import assert from 'node:assert/strict';
    import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { pathToFileURL as nativePathToFileURL } from 'node:url';

    let windowsPaths = true;
    // Use Windows URL conversion on every test host, then exercise its real Node loader.
    const pathToFileURL = value => windowsPaths
      ? nativePathToFileURL(value, { windows: true })
      : nativePathToFileURL(value);
    let sdkPath = 'C:/moss-missing-runtime-' + process.pid + '/Moss #1/runtime.mjs';
    let claudeRuntimeModulePromise = null;
    const installRuntimeMacros = () => {};
    const remoteDirectNetFetch = () => {};
    const logs = [];
    const mossLog = (...args) => logs.push(args);
    ${main.slice(start, end)}

    await assert.rejects(getClaudeRuntimeModule(), { code: 'ERR_MODULE_NOT_FOUND' });
    assert.equal(claudeRuntimeModulePromise, null);
    assert.equal(logs[0]?.[3]?.code, 'ERR_MODULE_NOT_FOUND');

    const root = mkdtempSync(join(tmpdir(), 'moss runtime 中文 #%-'));
    try {
      windowsPaths = false;
      sdkPath = join(root, 'electron-direct.mjs');
      writeFileSync(sdkPath, [
        'export let configEnableCount = 0;',
        'export let fetchImplementation;',
        'export function enableConfigs() { configEnableCount++; }',
        'export function setDirectConnectFetchImplementation(value) { fetchImplementation = value; }',
        'export class ClaudeSession {}',
      ].join('\n'));
      const [first, second] = await Promise.all([getClaudeRuntimeModule(), getClaudeRuntimeModule()]);
      assert.equal(first, second);
      assert.equal(typeof first.ClaudeSession, 'function');
      assert.equal(first.configEnableCount, 1);
      assert.equal(first.fetchImplementation, remoteDirectNetFetch);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  `], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});

test('shows and retains a notification when the first message fails before the runtime starts', async () => {
  const renderer = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
  const start = renderer.indexOf('const handleSend = React.useCallback');
  const end = renderer.indexOf('const handleCreateWorkflowInChat', start);
  const source = new Bun.Transpiler({ loader: 'tsx' }).transformSync(renderer.slice(start, end));
  const notices: unknown[][] = [];
  const notifications: any[] = [];
  const error = new Error("Error invoking remote method 'agent:send': Error: Runtime could not start");
  const files = [{ name: 'notes.txt', path: 'C:/work/notes.txt' }];
  const submitted: unknown[][] = [];
  let fail = true;
  const send = runInNewContext(`${source}; handleSend;`, {
    React: { useCallback: (callback: unknown) => callback },
    composerIntent: 'chat',
    submitPrompt: async (...args: unknown[]) => {
      submitted.push(args);
      if (fail) throw error;
    },
    cleanIpcErrorMessage,
    getErrorMessage,
    showPermissionNotice: (...args: unknown[]) => notices.push(args),
    pushAppNotification: (notification: unknown) => notifications.push(notification),
  });

  await send(files, 'C:/work');
  expect(notices[0]).toEqual(['消息发送失败：Runtime could not start', 'error', 6000]);
  expect(notifications[0]).toMatchObject({ severity: 'error', title: '消息发送失败' });
  expect(notifications[0].details).toContain(error.message);

  fail = false;
  await send(files, 'C:/work');
  expect(submitted[1]).toEqual(['chat', files, 'C:/work', undefined, undefined]);
  expect(notifications).toHaveLength(1);
});
