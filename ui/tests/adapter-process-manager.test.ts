import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createFeishuAdapterProcessManager,
  resolveFeishuAdapterEntryPath,
} from '../src/adapter-process-manager.mjs';

class FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills: NodeJS.Signals[] = [];
  sent: any[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals) {
    this.kills.push(signal);
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }

  send(message: any) {
    this.sent.push(message);
    return true;
  }
}

describe('Feishu adapter process manager', () => {
  it('resolves development and packaged adapter entries', () => {
    expect(resolveFeishuAdapterEntryPath({
      isPackaged: false,
      resourcesPath: '/resources',
      uiRoot: '/repo/ui',
    })).toBe('/repo/ui/dist/adapters/feishu.mjs');
    expect(resolveFeishuAdapterEntryPath({
      isPackaged: true,
      resourcesPath: '/resources',
      uiRoot: '/repo/ui',
    })).toBe('/resources/adapters/feishu.mjs');
  });

  it('does not start without credentials', async () => {
    let spawnCount = 0;
    const manager = createFeishuAdapterProcessManager({
      entryPath: '/adapter/feishu.mjs',
      configDir: '/config',
      exists: () => true,
      spawn: () => {
        spawnCount += 1;
        return new FakeChild(1) as any;
      },
    });

    expect(await manager.sync({})).toEqual({ status: 'disabled', pid: null });
    expect(spawnCount).toBe(0);
    expect(manager.getStatus()).toEqual({ status: 'disabled', pid: null, bridgeReady: false });
  });

  it('reports entry errors and supervises an unexpected child exit', async () => {
    const missing = createFeishuAdapterProcessManager({
      entryPath: '/missing/feishu.mjs',
      configDir: '/config',
      exists: () => false,
    });
    await missing.sync({ feishu: { appId: 'cli_test', appSecret: 'secret' } });
    expect(missing.getStatus()).toMatchObject({ status: 'error', bridgeReady: false });

    const children: FakeChild[] = [];
    const manager = createFeishuAdapterProcessManager({
      entryPath: '/adapter/feishu.mjs',
      configDir: '/config',
      exists: () => true,
      restartBaseDelayMs: 1,
      spawn: () => {
        const child = new FakeChild(children.length + 1);
        children.push(child);
        return child as any;
      },
    });
    const config = { feishu: { appId: 'cli_test', appSecret: 'secret' } };
    await manager.sync(config);
    children[0]!.exitCode = 1;
    children[0]!.emit('exit', 1, null);
    expect(manager.getStatus()).toMatchObject({ status: 'error', bridgeReady: false });
    for (let index = 0; index < 20 && children.length < 2; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(children).toHaveLength(2);
    expect(manager.getStatus()).toMatchObject({ status: 'running', pid: 2 });
    await manager.stop();
  });

  it('terminates a child that never completes the IPC handshake', async () => {
    let child!: FakeChild;
    const manager = createFeishuAdapterProcessManager({
      entryPath: '/adapter/feishu.mjs',
      configDir: '/config',
      exists: () => true,
      handshakeTimeoutMs: 1,
      restartBaseDelayMs: 1_000,
      spawn: () => {
        child = new FakeChild(7);
        return child as any;
      },
    });
    await manager.sync({ feishu: { appId: 'cli_test', appSecret: 'secret' } });
    for (let index = 0; index < 20 && child.kills.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(child.kills).toEqual(['SIGTERM']);
    manager.dispose();
  });

  it('starts once and restarts only when runtime configuration changes', async () => {
    const children: FakeChild[] = [];
    const manager = createFeishuAdapterProcessManager({
      entryPath: '/adapter/feishu.mjs',
      configDir: '/config',
      runtimePath: '/electron',
      exists: () => true,
      spawn: (_runtime, _args, options) => {
        const child = new FakeChild(children.length + 10);
        children.push(child);
        expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(options.env.MOSS_CONFIG_DIR).toBe('/config');
        return child as any;
      },
    });
    const base = {
      feishu: { appId: 'cli_test', appSecret: 'secret', streamingCard: false },
    };

    expect((await manager.sync(base)).status).toBe('running');
    expect((await manager.sync(base)).status).toBe('running');
    expect(children).toHaveLength(1);

    expect((await manager.sync({
      feishu: { ...base.feishu, streamingCard: true },
    })).status).toBe('running');
    expect(children).toHaveLength(2);
    expect(children[0]!.kills).toEqual(['SIGTERM']);

    await manager.stop();
    expect(children[1]!.kills).toEqual(['SIGTERM']);
    expect(manager.getStatus()).toEqual({ status: 'stopped', pid: null, bridgeReady: false });
  });

  it('negotiates the IPC bridge and dispatches child requests', async () => {
    let child!: FakeChild;
    const requests: string[] = [];
    const manager = createFeishuAdapterProcessManager({
      entryPath: '/adapter/feishu.mjs',
      configDir: '/config',
      exists: () => true,
      spawn: (_runtime, _args, options) => {
        expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe', 'ipc']);
        child = new FakeChild(88);
        return child as any;
      },
      onRequest: async (request) => {
        requests.push(request.type);
        return { accepted: true };
      },
    });

    await manager.sync({ feishu: { appId: 'cli_test', appSecret: 'secret' } });
    child.emit('message', {
      version: 1,
      id: 'hello-1',
      type: 'bridge.hello',
      timestamp: Date.now(),
      payload: { adapter: 'feishu' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.getStatus()).toEqual({ status: 'running', pid: 88, bridgeReady: true });
    expect(child.sent.some((message) => message.replyTo === 'hello-1' && message.ok)).toBe(true);
    expect(manager.send('notification.deliver', { id: 'n1' })).toBe(true);

    child.emit('message', {
      version: 1,
      id: 'request-1',
      type: 'conversation.list',
      timestamp: Date.now(),
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual(['conversation.list']);
    expect(child.sent.some((message) => message.replyTo === 'request-1' && message.result?.accepted)).toBe(true);
  });
});
