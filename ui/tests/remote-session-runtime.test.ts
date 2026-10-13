import { describe, expect, it } from 'bun:test';
import { createRemoteRuntimeFactory } from '../src/remote-session-runtime.mjs';

function fixture({ beforeCreate = async () => {} } = {}) {
  let settings = { permissionMode: 'default', advanced: {}, workflows: {} };
  const sent: string[] = [];
  const modes: string[] = [];
  let connected = false;
  let callbacks: any;
  let created = 0;
  let attached = 0;
  let onSend = () => {};
  class Manager {
    constructor(_config: unknown, nextCallbacks: unknown) { callbacks = nextCallbacks; }
    connect() { connected = true; queueMicrotask(() => callbacks.onConnected()); }
    isConnected() { return connected; }
    disconnect() { connected = false; }
    setPermissionMode(mode: string) { modes.push(mode); return Promise.resolve(); }
    sendMessage(prompt: string) { sent.push(prompt); onSend(); return connected; }
    respondToPermissionRequest() {}
    sendInterrupt() { return Promise.resolve({ interrupted: true }); }
  }
  const mod = {
    DirectConnectSessionManager: Manager,
    createDirectConnectSession: async () => { await beforeCreate(); created++; return { config: { sessionId: 'server-session' } }; },
    attachDirectConnectSession: async () => { attached++; return { config: { sessionId: 'server-session' } }; },
  };
  const { createRemoteDirectRuntime } = createRemoteRuntimeFactory({
    getSettings: () => settings,
    getClaudeRuntimeModule: async () => mod,
    buildClaudeSessionConfig: async () => ({ environment: {}, webSearch: {} }),
    resolveRemoteDirectConnection: async () => ({ serverUrl: 'https://example.com', authToken: 'test' }),
    syncRemoteSkillsForConnection: async () => {},
    prepareAssistantContextForSessionStart: async () => {},
    normalizePermissionDecision: (value: unknown) => value,
    isRemoteDirectSessionNotFoundError: () => false,
    fetchRemoteDirectSessionInfo: async () => ({ session: { desiredState: 'active' } }),
    resumeRemoteDirectSession: async () => { throw new Error('Unexpected resume'); },
    schedulePersistSession() {}, emitSessionMeta() {}, startWorkspaceWatcher() {}, mossLog() {},
  });
  const record = { id: 'desktop-session', workspace: '/workspace', history: [] };
  const runtime = createRemoteDirectRuntime({ sessionRecord: record });
  return {
    runtime, record, sent, modes,
    recreate: () => createRemoteDirectRuntime({ sessionRecord: record }),
    changeSettings: () => { settings = { ...settings, permissionMode: 'dontAsk' }; },
    complete: () => callbacks.onMessage({ type: 'result', subtype: 'success' }),
    interruptConnection: () => { connected = false; callbacks.onReconnecting(); },
    reconnect: () => { connected = true; callbacks.onConnected(); },
    whenSent: () => new Promise<void>(resolve => { onSend = resolve; }),
    get created() { return created; },
    get attached() { return attached; },
  };
}

describe('extracted remote session runtime', () => {
  it('protects attachment session creation from retirement and releases protection on success or failure', async () => {
    let finish!: () => void;
    const h = fixture({ beforeCreate: () => new Promise<void>(resolve => { finish = resolve; }) });
    const pending = h.runtime.ensureSession();
    expect(h.runtime.getIdleRetirementBlocker()).toBe('remote-request');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    expect(h.runtime.getIdleRetirementBlocker()).toBe('remote-request');
    finish(); await pending;
    expect(h.runtime.getIdleRetirementBlocker()).toBeNull();
    h.runtime.dispose();
    await expect(h.runtime.ensureSession()).rejects.toThrow('disposed');
    const failing = fixture({ beforeCreate: async () => { throw new Error('creation failed'); } });
    await expect(failing.runtime.ensureSession()).rejects.toThrow('creation failed');
    expect(failing.runtime.getIdleRetirementBlocker()).toBeNull();
    failing.runtime.dispose();
  });

  it('recreates the local runtime and attaches the existing server session after idle disposal', async () => {
    const h = fixture();
    let runtime = h.runtime;
    try {
      for (const prompt of ['before retirement', 'after retirement']) {
        const sent = h.whenSent(), stream = runtime.send(prompt), first = stream.next();
        await sent; h.complete(); await first; await stream.next();
        expect(runtime.getIdleRetirementBlocker()).toBeNull();
        runtime.dispose();
        if (prompt === 'before retirement') runtime = h.recreate();
      }
      expect(h.created).toBe(1); expect(h.attached).toBe(1);
      expect(h.record).toMatchObject({ underlyingSessionId: 'server-session' });
      expect(h.sent).toEqual(['before retirement', 'after retirement']);
    } finally { runtime.dispose(); }
  });

  it('keeps desktop/server IDs separate, reuses the session and reads current settings', async () => {
    const h = fixture();
    try {
      for (const prompt of ['first', 'second']) {
        const sent = h.whenSent();
        const stream = h.runtime.send(prompt);
        const first = stream.next();
        await sent;
        expect(h.runtime.getIdleRetirementBlocker()).toBe('remote-request');
        h.complete();
        expect((await first).value.type).toBe('result');
        expect((await stream.next()).done).toBe(true);
        expect(h.runtime.getIdleRetirementBlocker()).toBeNull();
        h.changeSettings();
      }
      expect(h.record).toMatchObject({ id: 'desktop-session', underlyingSessionId: 'server-session' });
      expect(h.created).toBe(1);
      expect(h.modes).toEqual(['default', 'dontAsk']);
      expect(h.sent).toEqual(['first', 'second']);
    } finally { h.runtime.dispose(); }
  });

  it('interrupts the current turn on disconnect and does not replay it after reattach', async () => {
    const h = fixture();
    try {
      const sent = h.whenSent();
      const stream = h.runtime.send('first');
      const pending = stream.next().catch(error => error);
      await sent;
      h.interruptConnection();
      expect((await pending).message).toContain('connection was interrupted');
      h.reconnect();
      expect(h.sent).toEqual(['first']);
      const nextSent = h.whenSent();
      const nextStream = h.runtime.send('second');
      const next = nextStream.next();
      await nextSent;
      h.complete();
      expect((await next).value.type).toBe('result');
      await nextStream.next();
      expect(h.sent).toEqual(['first', 'second']);
      expect(h.created).toBe(1);
    } finally { h.runtime.dispose(); }
  });

  it('rejects deleted or disposed sessions before sending anything', async () => {
    const h = fixture();
    Object.assign(h.record, { deleting: true });
    await expect(h.runtime.send('deleted').next()).rejects.toThrow('会话正在删除');
    Object.assign(h.record, { deleting: false });
    h.runtime.dispose();
    await expect(h.runtime.send('disposed').next()).rejects.toThrow('disposed');
    expect(h.sent).toEqual([]);
    expect(h.created).toBe(0);
  });
});
