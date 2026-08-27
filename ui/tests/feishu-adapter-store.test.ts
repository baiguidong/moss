import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

const storeUrl = new URL('../src/feishu-adapter-store.mjs', import.meta.url).href;

function runNodeStoreScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createFeishuAdapterStore } from ${JSON.stringify(storeUrl)};
    const db = new DatabaseSync(':memory:');
    try {
      ${source}
    } finally {
      db.close();
    }
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('Feishu adapter store', () => {
  it('persists conversation bindings and event idempotency', () => {
    const result = runNodeStoreScenario(`
      let timestamp = 100;
      const store = createFeishuAdapterStore(db, { now: () => timestamp++ });
      const conversation = store.getOrCreateConversation({
        adapterInstanceId: 'feishu:cli_test',
        tenantKey: 'cli_test',
        chatId: 'oc_chat',
        pairedOpenId: 'ou_user',
      });
      const selected = store.setActiveSession(conversation.id, 'session-1');
      const first = store.claimEvent({
        adapterInstanceId: 'feishu:cli_test',
        eventId: 'om_message',
        conversationId: conversation.id,
        eventType: 'message',
      });
      const duplicate = store.claimEvent({
        adapterInstanceId: 'feishu:cli_test',
        eventId: 'om_message',
        conversationId: conversation.id,
        eventType: 'message',
      });
      console.log(JSON.stringify({ conversation, selected, first, duplicate }));
    `);
    expect(result.conversation.activeSessionId).toBeNull();
    expect(result.selected.activeSessionId).toBe('session-1');
    expect(result.first.claimed).toBe(true);
    expect(result.duplicate.claimed).toBe(false);
  });

  it('stores queued turns and terminal results', () => {
    const result = runNodeStoreScenario(`
      const store = createFeishuAdapterStore(db);
      const turn = store.enqueueTurn({
        sessionId: 'session-1',
        conversationId: 'conversation-1',
        sourceChannel: 'feishu',
        sourceEventId: 'om_message',
        prompt: 'hello',
      });
      const queued = store.listQueuedTurns();
      const prematureDelivery = store.markTurnDelivered(turn.id);
      const completed = store.updateTurn(turn.id, { status: 'completed', resultText: 'world' });
      const delivered = store.markTurnDelivered(turn.id);
      console.log(JSON.stringify({ turn, queued, prematureDelivery, completed, delivered, remaining: store.listQueuedTurns() }));
    `);
    expect(result.queued.map((entry: any) => entry.id)).toEqual([result.turn.id]);
    expect(result.completed).toMatchObject({ status: 'completed', resultText: 'world' });
    expect(result.prematureDelivery.deliveredAt).toBeNull();
    expect(result.delivered.deliveredAt).toBeNumber();
    expect(result.remaining).toEqual([]);
  });

  it('expires runtime decisions, recovers durable plan claims, and disables stale actions on restart', () => {
    const result = runNodeStoreScenario(`
      let timestamp = 100;
      const store = createFeishuAdapterStore(db, { now: () => timestamp++ });
      const runtime = store.createDecision({
        id: 'runtime', sessionId: 'session-1', kind: 'tool_permission',
        mobileTitle: 'Runtime', mobileSummary: 'Runtime summary', actionTokenHash: 'hash',
        notificationId: 'notification-runtime', expiresAt: 10000,
      });
      const plan = store.createDecision({
        id: 'plan', sessionId: 'session-1', kind: 'plan_approval',
        mobileTitle: 'Plan', mobileSummary: 'Plan summary', actionTokenHash: 'hash',
        notificationId: 'notification-plan', expiresAt: null,
      });
      store.claimDecision(plan.id, 'feishu');
      db.prepare(\`
        INSERT INTO app_notifications (
          id, severity, source, title, message, mobile_title, mobile_summary,
          mobile_policy, decision_request_id, read, occurrences, created_at, updated_at
        ) VALUES (?, 'warning', 'test', 'title', 'message', 'mobile', 'summary', 'summary', ?, 0, 1, ?, ?)
      \`).run('notification-runtime', runtime.id, timestamp, timestamp);

      const restarted = createFeishuAdapterStore(db, { now: () => 500 });
      const notification = db.prepare('SELECT * FROM app_notifications WHERE id = ?').get('notification-runtime');
      console.log(JSON.stringify({
        runtime: restarted.getDecision(runtime.id),
        plan: restarted.getDecision(plan.id),
        pending: restarted.listPendingDecisionsForSession('session-1'),
        terminal: restarted.listTerminalDecisions(),
        notification,
      }));
    `);
    expect(result.runtime.status).toBe('expired');
    expect(result.plan.status).toBe('pending');
    expect(result.pending.map((entry: any) => entry.id)).toEqual(['plan']);
    expect(result.terminal.map((entry: any) => entry.id)).toContain('runtime');
    expect(result.notification.decision_request_id).toBeNull();
    expect(result.notification.mobile_policy).toBe('disabled');
    expect(result.notification.read).toBe(1);
  });
});
