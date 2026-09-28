import { expect, test } from 'bun:test';
import { registerUpdateHandlers } from '../src/update-ipc-handlers.mjs';

test('all update operations reject foreign windows, subframes and destroyed windows', async () => {
  const handlers = new Map<string, Function>();
  let calls = 0; let destroyed = false;
  const webContents = { mainFrame: {} };
  const window = { isDestroyed: () => destroyed, webContents };
  const coordinator = new Proxy({}, { get: () => () => { calls++; return {}; } });
  registerUpdateHandlers({ ipcMain: { handle: (channel: string, fn: Function) => handlers.set(channel, fn) }, coordinator, getWindow: () => window, openExternal: async () => {} });
  for (const handler of handlers.values()) {
    for (const event of [{ sender: {}, senderFrame: webContents.mainFrame }, { sender: webContents, senderFrame: {} }]) {
      expect((await handler(event, {})).success).toBe(false);
    }
    destroyed = true;
    expect((await handler({ sender: webContents, senderFrame: webContents.mainFrame }, {})).success).toBe(false);
    destroyed = false;
  }
  expect(calls).toBe(0);
});
test('IPC accepts IDs only; supplied paths and URLs cannot select downloads or opened files', async () => {
  const handlers = new Map<string, Function>(); const frame = {}; const sender = { mainFrame: frame }; const event = { sender, senderFrame: frame };
  const received: unknown[] = [];
  registerUpdateHandlers({ ipcMain: { handle: (channel: string, fn: Function) => handlers.set(channel, fn) }, getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    coordinator: { download: (id: any) => { received.push(id); return {}; }, open: (id: any) => { received.push(id); return {}; } }, openExternal: async () => {} });
  await handlers.get('update:download')!(event, { url: 'https://evil.org', fileName: 'evil.exe' });
  await handlers.get('update:open-downloaded')!(event, { filePath: '/arbitrary/path' });
  expect(received).toEqual([undefined, undefined]);
});
