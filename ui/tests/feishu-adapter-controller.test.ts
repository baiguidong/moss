import { describe, expect, it } from 'bun:test';
import { createFeishuAdapterController } from '../src/feishu-adapter-controller.mjs';

function createMemoryStore() {
  const conversations = new Map<string, any>();
  const events = new Map<string, any>();
  const turns: any[] = [];
  return {
    getOrCreateConversation({ adapterInstanceId, tenantKey, chatId, pairedOpenId }: any) {
      const key = `${adapterInstanceId}:${tenantKey}:${chatId}`;
      if (!conversations.has(key)) {
        conversations.set(key, {
          id: `conversation-${conversations.size + 1}`,
          adapterInstanceId,
          tenantKey,
          chatId,
          pairedOpenId,
          activeSessionId: null,
        });
      }
      return { ...conversations.get(key) };
    },
    getConversation(id: string) {
      const value = [...conversations.values()].find((entry) => entry.id === id);
      return value ? { ...value } : null;
    },
    listConversations() {
      return [...conversations.values()].map((entry) => ({ ...entry }));
    },
    setActiveSession(id: string, sessionId: string) {
      const value = [...conversations.values()].find((entry) => entry.id === id);
      value.activeSessionId = sessionId;
      return { ...value };
    },
    claimEvent({ adapterInstanceId, eventId, conversationId, eventType }: any) {
      const key = `${adapterInstanceId}:${eventId}`;
      if (events.has(key)) return { claimed: false, event: { ...events.get(key) } };
      const event = { adapterInstanceId, eventId, conversationId, eventType, status: 'received' };
      events.set(key, event);
      return { claimed: true, event: { ...event } };
    },
    updateEvent(adapterInstanceId: string, eventId: string, updates: any) {
      const key = `${adapterInstanceId}:${eventId}`;
      Object.assign(events.get(key), updates);
      return { ...events.get(key) };
    },
    enqueueTurn(input: any) {
      const turn = { id: `turn-${turns.length + 1}`, status: 'queued', deliveredAt: null, ...input };
      turns.push(turn);
      return { ...turn };
    },
    listQueuedTurns() {
      return turns.filter((turn) => turn.status === 'queued').map((turn) => ({ ...turn }));
    },
    updateTurn(id: string, updates: any) {
      const turn = turns.find((entry) => entry.id === id);
      Object.assign(turn, updates);
      return { ...turn };
    },
    listPendingTurnDeliveries() {
      return turns.filter((turn) => ['completed', 'failed'].includes(turn.status) && !turn.deliveredAt)
        .map((turn) => ({ ...turn }));
    },
    markTurnDelivered(id: string) {
      const turn = turns.find((entry) => entry.id === id);
      turn.deliveredAt = Date.now();
      return { ...turn };
    },
    cancelQueuedTurns(sessionId: string) {
      let count = 0;
      for (const turn of turns) {
        if (turn.sessionId === sessionId && turn.status === 'queued') {
          turn.status = 'cancelled';
          count += 1;
        }
      }
      return count;
    },
  };
}

async function waitUntil(predicate: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}

describe('Feishu adapter controller', () => {
  it('creates one session for the first message and deduplicates retries', async () => {
    const store = createMemoryStore();
    const sessions = new Map<string, any>();
    const prompts: string[] = [];
    const deliveries: any[] = [];
    const controller = createFeishuAdapterController({
      store,
      resolveIdentity: () => ({ adapterInstanceId: 'feishu:app', tenantKey: 'app' }),
      getWritableSession: (id: string) => sessions.get(id) || null,
      createSession: async () => {
        const session = { id: `session-${sessions.size + 1}`, title: '飞书会话', busy: false };
        sessions.set(session.id, session);
        return session;
      },
      sendPrompt: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt);
        return { assistantText: `reply:${prompt}` };
      },
      sendAdapterEvent: (type: string, payload: any) => {
        deliveries.push({ type, payload });
        return true;
      },
    });
    const request = {
      type: 'chat.message.received',
      payload: { chatId: 'chat', openId: 'user', eventId: 'message-1', text: 'hello' },
    };
    const accepted = await controller.handleRequest(request);
    const duplicate = await controller.handleRequest(request);
    await waitUntil(() => deliveries.length === 1);

    expect(accepted).toMatchObject({ accepted: true, session: { id: 'session-1' } });
    expect(duplicate).toMatchObject({ duplicate: true, sessionId: 'session-1' });
    expect(prompts).toEqual(['hello']);
    expect(deliveries[0]).toMatchObject({ type: 'turn.completed', payload: { text: 'reply:hello' } });
    controller.onReady();
    await waitUntil(() => deliveries.length === 2);
    expect(deliveries[1].payload.turnId).toBe(deliveries[0].payload.turnId);
    store.markTurnDelivered(deliveries[0].payload.turnId);
    controller.onReady();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(deliveries).toHaveLength(2);
  });

  it('reuses one fixed session and treats slash-like controls as ordinary messages', async () => {
    const store = createMemoryStore();
    const sessions = new Map<string, any>();
    const prompts: Array<{ sessionId: string; prompt: string }> = [];
    const releases: Array<() => void> = [];
    let created = 0;
    const controller = createFeishuAdapterController({
      store,
      resolveIdentity: () => ({ adapterInstanceId: 'feishu:app', tenantKey: 'app' }),
      getWritableSession: (id: string) => sessions.get(id) || null,
      createSession: async () => {
        created += 1;
        const session = { id: `session-${created}`, title: '飞书会话', busy: false };
        sessions.set(session.id, session);
        return session;
      },
      sendPrompt: async (sessionId: string, prompt: string) => {
        prompts.push({ sessionId, prompt });
        await new Promise<void>((resolve) => releases.push(resolve));
        return { assistantText: `reply:${prompt}` };
      },
      sendAdapterEvent: () => true,
    });
    await controller.handleRequest({
      type: 'chat.message.received',
      payload: { chatId: 'chat', openId: 'user', eventId: 'message-1', text: '/new' },
    });
    await controller.handleRequest({
      type: 'chat.message.received',
      payload: { chatId: 'chat', openId: 'user', eventId: 'message-2', text: '/stop' },
    });
    await waitUntil(() => prompts.length === 1);
    expect(created).toBe(1);
    expect(prompts).toEqual([{ sessionId: 'session-1', prompt: '/new' }]);
    releases.shift()?.();
    await waitUntil(() => prompts.length === 2);
    expect(created).toBe(1);
    expect(prompts).toEqual([
      { sessionId: 'session-1', prompt: '/new' },
      { sessionId: 'session-1', prompt: '/stop' },
    ]);
    releases.shift()?.();
  });

  it('rejects all legacy session-management requests', async () => {
    const store = createMemoryStore();
    const controller = createFeishuAdapterController({
      store,
      resolveIdentity: () => ({ adapterInstanceId: 'feishu:app', tenantKey: 'app' }),
      getWritableSession: () => null,
      createSession: async () => { throw new Error('should not create'); },
      sendPrompt: async () => ({ assistantText: '' }),
      sendAdapterEvent: () => true,
    });

    for (const type of [
      'conversation.list',
      'conversation.current',
      'conversation.select',
      'conversation.new',
      'session.abort',
      'decision.respond',
    ]) {
      await expect(controller.handleRequest({
        type,
        payload: { chatId: 'chat', openId: 'user' },
      })).rejects.toThrow('Unsupported Feishu Adapter request');
    }
  });

  it('passes the authenticated Channel context into identity resolution', async () => {
    const store = createMemoryStore();
    const contexts: any[] = [];
    const controller = createFeishuAdapterController({
      store,
      resolveIdentity: (_openId: string, context: any) => {
        contexts.push(context);
        return { adapterInstanceId: 'feishu:app-config', tenantKey: 'app-config' };
      },
      getWritableSession: () => null,
      createSession: async () => ({ id: 'session-1', title: '飞书会话', busy: false }),
      sendPrompt: async () => ({ assistantText: '' }),
      sendAdapterEvent: () => true,
    });
    const context = { appId: 'moss.feishu', instanceId: 'moss.feishu--default' };

    await controller.handleRequest({
      type: 'chat.message.received',
      payload: { chatId: 'chat', openId: 'user', eventId: 'message-1', text: 'hello' },
    }, context);

    expect(contexts).toEqual([context]);
  });

});
