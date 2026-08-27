import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

const decisionUrl = new URL('../src/decision-broker.mjs', import.meta.url).href;
const notificationUrl = new URL('../src/app-notification-broker.mjs', import.meta.url).href;
const storeUrl = new URL('../src/feishu-adapter-store.mjs', import.meta.url).href;

function runScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createFeishuAdapterStore } from ${JSON.stringify(storeUrl)};
    import { createAppNotificationBroker } from ${JSON.stringify(notificationUrl)};
    import { createDecisionBroker } from ${JSON.stringify(decisionUrl)};
    const db = new DatabaseSync(':memory:');
    const store = createFeishuAdapterStore(db);
    const notifications = createAppNotificationBroker(db);
    try { ${source} } finally { db.close(); }
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('decision broker', () => {
  it('resolves once with a valid token and rejects duplicate responses', () => {
    const result = runScenario(`
      const calls = [];
      const broker = createDecisionBroker({
        store, notificationBroker: notifications, getSigningSecret: () => 'secret',
      });
      const created = broker.create({
        sessionId: 'session-1', kind: 'tool_permission', title: '允许操作',
        summary: '是否允许？', handler: ({ allowed }) => { calls.push(allowed); return { allowed }; },
      });
      const resolved = await broker.respond({
        decisionId: created.decision.id, allowed: true, source: 'feishu', actionToken: created.actionToken,
      });
      let duplicateError = '';
      try {
        await broker.respond({
          decisionId: created.decision.id, allowed: false, source: 'feishu', actionToken: created.actionToken,
        });
      } catch (error) { duplicateError = error.message; }
      console.log(JSON.stringify({ calls, resolved, duplicateError, notifications: notifications.list() }));
    `);
    expect(result.calls).toEqual([true]);
    expect(result.resolved.status).toBe('resolved');
    expect(result.duplicateError).toContain('no longer pending');
    expect(result.notifications[0].decisionRequestId).toBeUndefined();
  });

  it('allows only one concurrent desktop or Feishu response to execute', () => {
    const result = runScenario(`
      const calls = [];
      const broker = createDecisionBroker({
        store, notificationBroker: notifications, getSigningSecret: () => 'secret',
      });
      const created = broker.create({
        sessionId: 'session-1', kind: 'tool_permission', title: '允许操作',
        summary: '是否允许？', handler: async ({ allowed, source, context }) => {
          calls.push({ allowed, source, context });
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { allowed };
        },
      });
      const responses = await Promise.allSettled([
        broker.respond({
          decisionId: created.decision.id,
          allowed: true,
          source: 'feishu',
          actionToken: created.actionToken,
          context: { channel: 'mobile' },
        }),
        broker.respond({
          decisionId: created.decision.id,
          allowed: false,
          source: 'desktop',
          context: { channel: 'desktop' },
        }),
      ]);
      console.log(JSON.stringify({
        calls,
        statuses: responses.map((entry) => entry.status),
        decision: store.getDecision(created.decision.id),
      }));
    `);
    expect(result.calls).toEqual([{
      allowed: true,
      source: 'feishu',
      context: { channel: 'mobile' },
    }]);
    expect(result.statuses.sort()).toEqual(['fulfilled', 'rejected']);
    expect(result.decision.status).toBe('resolved');
  });

  it('expires live tool permissions when their session is canceled', () => {
    const result = runScenario(`
      const calls = [];
      const broker = createDecisionBroker({
        store, notificationBroker: notifications, getSigningSecret: () => 'secret',
      });
      const tool = broker.create({
        sessionId: 'session-1', kind: 'tool_permission', title: 'Tool', summary: 'Allow tool?',
        desktopOptions: [{ id: 'remember', label: '本次会话允许' }],
        handler: (response) => { calls.push(response); return { allowed: false }; },
      });
      const plan = broker.create({
        sessionId: 'session-1', kind: 'plan_approval', title: 'Plan', summary: 'Allow plan?',
        expiresAt: null,
      });
      await broker.cancelSession('session-1', 'Session aborted.', { kinds: ['tool_permission'] });
      console.log(JSON.stringify({
        calls,
        tool: store.getDecision(tool.decision.id),
        plan: store.getDecision(plan.decision.id),
        notifications: notifications.list(),
      }));
    `);
    expect(result.calls).toMatchObject([{ allowed: false, expired: true, source: 'system' }]);
    expect(result.tool.status).toBe('expired');
    expect(result.plan.status).toBe('pending');
    expect(result.notifications.find((entry: any) => entry.id === result.tool.notificationId)?.decisionRequestId).toBeUndefined();
  });
});
