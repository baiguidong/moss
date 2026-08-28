import { describe, expect, it } from 'bun:test';
import {
  authorizeFeishuDecisionResponse,
  createFeishuAdapterController,
} from '../src/feishu-adapter-controller.mjs';

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
      listWritableSessions: () => [...sessions.values()],
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
      abortSession: async () => {},
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

  it('selects an old session and preserves message order while draining', async () => {
    const store = createMemoryStore();
    const sessions = new Map<string, any>([
      ['old-session', { id: 'old-session', title: '老会话', busy: false }],
    ]);
    const prompts: string[] = [];
    const releases: Array<() => void> = [];
    const controller = createFeishuAdapterController({
      store,
      resolveIdentity: () => ({ adapterInstanceId: 'feishu:app', tenantKey: 'app' }),
      listWritableSessions: () => [...sessions.values()],
      getWritableSession: (id: string) => sessions.get(id) || null,
      createSession: async () => { throw new Error('should not create'); },
      sendPrompt: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt);
        await new Promise<void>((resolve) => releases.push(resolve));
        return { assistantText: `reply:${prompt}` };
      },
      abortSession: async () => {},
      sendAdapterEvent: () => true,
    });
    await controller.handleRequest({
      type: 'conversation.select',
      payload: { chatId: 'chat', openId: 'user', sessionId: 'old-session' },
    });
    await controller.handleRequest({
      type: 'chat.message.received',
      payload: { chatId: 'chat', openId: 'user', eventId: 'message-1', text: 'first' },
    });
    await controller.handleRequest({
      type: 'chat.message.received',
      payload: { chatId: 'chat', openId: 'user', eventId: 'message-2', text: 'second' },
    });
    await waitUntil(() => prompts.length === 1);
    expect(prompts).toEqual(['first']);
    releases.shift()?.();
    await waitUntil(() => prompts.length === 2);
    expect(prompts).toEqual(['first', 'second']);
    releases.shift()?.();
  });

  it('lists customer-facing session pages and resolves bot menu requests by user', async () => {
    const store = createMemoryStore();
    store.getOrCreateConversation({
      adapterInstanceId: 'feishu:app',
      tenantKey: 'app',
      chatId: 'chat',
      pairedOpenId: 'user',
    });
    const sessions = new Map<string, any>([
      ['s1', { id: 's1', title: '飞书一', updatedAt: 6, busy: false, originChannel: 'feishu' }],
      ['s2', { id: 's2', title: '飞书二', updatedAt: 5, busy: false, originChannel: 'feishu' }],
      ['s3', { id: 's3', title: '项目一', updatedAt: 4, busy: false, originChannel: 'desktop', projectName: 'Moss' }],
      ['s4', { id: 's4', title: '桌面一', updatedAt: 3, busy: false, originChannel: 'desktop' }],
    ]);
    const controller = createFeishuAdapterController({
      store,
      resolveIdentity: () => ({ adapterInstanceId: 'feishu:app', tenantKey: 'app' }),
      listWritableSessions: () => [...sessions.values()],
      getWritableSession: (id: string) => sessions.get(id) || null,
      createSession: async () => { throw new Error('should not create'); },
      sendPrompt: async () => ({ assistantText: '' }),
      abortSession: async () => {},
      sendAdapterEvent: () => true,
    });

    const firstPage = await controller.handleRequest({
      type: 'conversation.list',
      payload: { openId: 'user', category: 'recent', page: 0, pageSize: 2 },
    });
    expect(firstPage).toMatchObject({
      chatId: 'chat', page: 0, pageSize: 2, total: 4, hasPrevious: false, hasNext: true,
    });
    expect(firstPage.sessions.map((session: any) => session.id)).toEqual(['s1', 's2']);

    const projectPage = await controller.handleRequest({
      type: 'conversation.list',
      payload: { openId: 'user', category: 'project' },
    });
    expect(projectPage.sessions.map((session: any) => session.id)).toEqual(['s3']);
  });

  it('authorizes decision callbacks only for the delivered Feishu conversation', () => {
    const identity = { adapterInstanceId: 'feishu:app', tenantKey: 'app' };
    const decision = { notificationId: 'notification-1' };
    const store = {
      findConversation({ chatId }: any) {
        return chatId === 'chat-1'
          ? { id: 'conversation-1', chatId, pairedOpenId: 'user-1' }
          : null;
      },
      listNotificationDeliveries() {
        return [{
          conversationId: 'conversation-1',
          status: 'delivered',
          externalMessageId: 'message-1',
        }];
      },
    };

    expect(authorizeFeishuDecisionResponse({
      store, identity, decision, chatId: 'chat-1', openId: 'user-1',
    })).toMatchObject({ conversation: { id: 'conversation-1' } });
    expect(() => authorizeFeishuDecisionResponse({
      store, identity, decision, chatId: 'chat-2', openId: 'user-1',
    })).toThrow('not authorized');
    expect(() => authorizeFeishuDecisionResponse({
      store, identity, decision, chatId: 'chat-1', openId: 'user-2',
    })).toThrow('not authorized');
    expect(() => authorizeFeishuDecisionResponse({
      store: {
        ...store,
        listNotificationDeliveries: () => [{
          conversationId: 'conversation-1', status: 'pending', externalMessageId: null,
        }],
      },
      identity,
      decision,
      chatId: 'chat-1',
      openId: 'user-1',
    })).toThrow('not delivered');
  });
});
