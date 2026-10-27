import { afterEach, expect, test } from 'bun:test';
import { initializeHostClient } from '../src/renderer-react/web-bootstrap';

const saved = new Map(['window', 'location', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function setup(bridge: Record<string, unknown>, url: string) {
  let requests = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: bridge });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(url) });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => {
    requests++;
    throw new Error('web authentication requested');
  } });
  return () => requests;
}

test('desktop terminal starts with its limited bridge without web authentication', async () => {
  const requests = setup({ mossTerminal: {} }, 'file:///ui/index.html?window=terminal');
  await initializeHostClient();
  expect(requests()).toBe(0);
});

test('desktop preview uses the full desktop bridge', async () => {
  const requests = setup({ agentDesktop: {} }, 'file:///ui/index.html?window=preview');
  await initializeHostClient();
  expect(requests()).toBe(0);
});

test('missing desktop bridge reports initialization failure without fetching a local API path', async () => {
  const requests = setup({}, 'file:///ui/index.html?window=preview');
  await expect(initializeHostClient()).rejects.toThrow('桌面连接未初始化');
  expect(requests()).toBe(0);
});

test('a terminal bridge cannot initialize a desktop preview', async () => {
  const requests = setup({ mossTerminal: {} }, 'file:///ui/index.html?window=preview');
  await expect(initializeHostClient()).rejects.toThrow('桌面连接未初始化');
  expect(requests()).toBe(0);
});

test('web terminals still authenticate when no desktop bridge is present', async () => {
  const requests = setup({}, 'https://moss.example/?window=terminal');
  await expect(initializeHostClient()).rejects.toThrow('web authentication requested');
  expect(requests()).toBe(1);
});
