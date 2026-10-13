import { describe, expect, test } from 'bun:test';
import { access } from 'node:fs/promises';
import { createMemoryDreamService, registerMemoryDreamIpc } from '../src/memory-dream-service.mjs';

const settings = { model: 'gpt-5.5', autoMemory: { enabled: true, dreamEnabled: false } };
function fixture(run: (options: any) => Promise<any>, prepareRuntime = async () => {}) {
  const instances: any[] = [];
  class Runtime {
    disposed = false;
    constructor(public options: any) { instances.push(this); }
    consolidateMemory = run;
    dispose() { this.disposed = true; }
  }
  const service = createMemoryDreamService({
    mossHome: '/tmp/moss-global-memory', transcriptDir: '/tmp/moss-global-memory/sessions',
    getSettings: () => settings, getRuntimeModule: async () => ({ ClaudeSession: Runtime }), prepareRuntime,
  });
  return { instances, service };
}

describe('global memory maintenance host', () => {
  test('creates one independent runtime, returns the result and cleans temporary history', async () => {
    const result = { summary: '整理完成', sessionsReviewed: 4, filesTouched: [] };
    const { instances, service } = fixture(async options => {
      expect(options.transcriptDir).toBe('/tmp/moss-global-memory/sessions');
      return result;
    });
    expect(service.start().phase).toBe('running');
    expect(service.start().phase).toBe('running');
    await service.waitForIdle();
    expect(instances).toHaveLength(1);
    expect(instances[0].options).toMatchObject({ cwd: '/tmp/moss-global-memory', model: 'gpt-5.5', mcpServers: {} });
    expect(instances[0].disposed).toBe(true);
    await expect(access(instances[0].options.projectDir)).rejects.toThrow();
    expect(service.getStatus()).toMatchObject({ phase: 'completed', result });
    const snapshot = service.getStatus();
    snapshot.result.summary = 'changed';
    expect(service.getStatus().result.summary).toBe('整理完成');
  });

  test('stops during preparation without creating a runtime', async () => {
    let release!: () => void;
    const { instances, service } = fixture(async () => { throw new Error('must not run'); },
      () => new Promise<void>(resolve => { release = resolve; }));
    service.start();
    expect(service.stop().phase).toBe('stopping');
    release();
    await service.waitForIdle();
    expect(service.getStatus().phase).toBe('canceled');
    expect(instances).toHaveLength(0);
  });

  test('surfaces failure, releases the runtime and allows another run', async () => {
    const { instances, service } = fixture(async () => { throw new Error('model unavailable'); });
    service.start();
    await service.waitForIdle();
    expect(service.getStatus()).toMatchObject({ phase: 'failed', message: 'model unavailable' });
    service.start();
    await service.waitForIdle();
    expect(instances).toHaveLength(2);
    expect(instances.every(instance => instance.disposed)).toBe(true);
  });

  test('IPC handlers accept no conversation identifier', async () => {
    const handlers = new Map();
    const { service } = fixture(async () => ({ summary: 'done' }));
    registerMemoryDreamIpc({ handle: (name, handler) => handlers.set(name, handler) }, service);
    expect(handlers.get('memory:dream-start')()).toMatchObject({ phase: 'running' });
    await service.waitForIdle();
    expect(handlers.get('memory:dream-status')()).toMatchObject({ phase: 'completed' });
  });
});
