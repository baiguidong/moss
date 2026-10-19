import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

const brokerUrl = new URL('../src/app-notification-broker.mjs', import.meta.url).href;
const storeUrl = new URL('../src/desktop-state-store.mjs', import.meta.url).href;

function runScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createDesktopStateStore } from ${JSON.stringify(storeUrl)};
    import { createAppNotificationBroker } from ${JSON.stringify(brokerUrl)};
    const db = new DatabaseSync(':memory:');
    createDesktopStateStore(db);
    try { ${source} } finally { db.close(); }
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('Main app notification broker', () => {
  it('deduplicates, redacts secrets, and keeps mobile content separate', () => {
    const result = runScenario(`
      const deliveries = [];
      const broker = createAppNotificationBroker(db, { onDeliver: (item) => deliveries.push(item) });
      broker.create({
        severity: 'warning', source: '测试', title: '需要确认',
        message: 'token=secret', details: 'password=hunter2 /Users/private/file',
        mobileTitle: '需要确认',
        mobileSummary: '路径 /Users/private/file，网址 https://example.com/docs，Windows C:\\\\Users\\\\private\\\\file',
        mobilePolicy: 'summary',
      }, { now: 100 });
      broker.create({ severity: 'warning', source: '测试', title: '需要确认', message: 'token=secret' }, { now: 101 });
      console.log(JSON.stringify({ notifications: broker.list(), deliveries }));
    `);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].occurrences).toBe(2);
    expect(result.notifications[0].message).toContain('[REDACTED]');
    expect(result.deliveries[0].summary).not.toContain('/Users/private');
    expect(result.deliveries[0].summary).not.toContain('C:\\Users');
    expect(result.deliveries[0].summary).toContain('https://example.com/docs');
  });

  it('does not remove an actionable notification until its decision is resolved', () => {
    const result = runScenario(`
      const broker = createAppNotificationBroker(db);
      const actionable = broker.create({
        severity: 'warning', source: '待确认', title: '需要确认', message: '是否继续？',
        mobileTitle: '需要确认', mobileSummary: '是否继续？', mobilePolicy: 'summary',
        decisionRequestId: 'decision-1',
        decisionOptions: [{ id: 'remember', label: '本次会话允许' }],
      }, { id: 'actionable' });
      broker.create({ severity: 'info', source: 'Moss', title: '普通消息', message: '完成' }, { id: 'normal' });
      broker.remove(actionable.id);
      broker.clear();
      const beforeResolution = broker.list();
      broker.resolveDecision('decision-1');
      broker.clear();
      console.log(JSON.stringify({ beforeResolution, afterResolution: broker.list() }));
    `);
    expect(result.beforeResolution.map((entry: any) => entry.id)).toEqual(['actionable']);
    expect(result.beforeResolution[0].decisionRequestId).toBe('decision-1');
    expect(result.beforeResolution[0].decisionOptions).toEqual([{
      id: 'remember', label: '本次会话允许',
    }]);
    expect(result.afterResolution).toEqual([]);
  });

  it('imports legacy history without reviving stale decision actions', () => {
    const result = runScenario(`
      const broker = createAppNotificationBroker(db);
      broker.importLegacy([{
        id: 'legacy', severity: 'warning', source: '旧消息', title: '旧确认',
        message: '历史内容', createdAt: 100, read: false, occurrences: 1,
        decisionRequestId: 'stale-decision',
        decisionOptions: [{ id: 'remember', label: '以后允许' }],
      }]);
      console.log(JSON.stringify({ notifications: broker.list(), mobile: broker.listMobilePayloads() }));
    `);
    expect(result.notifications[0].decisionRequestId).toBeUndefined();
    expect(result.notifications[0].decisionOptions).toBeUndefined();
    expect(result.mobile).toEqual([]);
  });

  it('retains every pending approval when ordinary history exceeds its limit', () => {
    const result = runScenario(`
      const broker = createAppNotificationBroker(db);
      for (let i = 0; i < 205; i++) broker.create({
        title: 'Approval', message: 'Allow?', decisionRequestId: 'decision-' + i,
      }, { id: 'approval-' + i, now: 100 + i });
      for (let i = 0; i < 220; i++) broker.create({
        title: 'Ordinary ' + i, message: 'Done',
      }, { id: 'ordinary-' + i, now: 1000 + i });
      const items = broker.list();
      const remaining = broker.clear();
      broker.resolveDecision('decision-0');
      broker.clear();
      console.log(JSON.stringify({
        pending: items.filter(item => item.decisionRequestId).length,
        history: items.filter(item => !item.decisionRequestId).length,
        afterClear: remaining.length, afterResolution: broker.list().length,
      }));
    `);
    expect(result).toEqual({ pending: 205, history: 200, afterClear: 205, afterResolution: 204 });
  });

  it('keeps independent approvals and ordinary messages separate even with identical text', () => {
    const result = runScenario(`
      const broker = createAppNotificationBroker(db);
      const input = { source: 'App', title: 'Confirm', message: 'Continue?' };
      broker.create(input, { now: 100 });
      broker.create({ ...input, decisionRequestId: 'first' }, { now: 101 });
      broker.create({ ...input, decisionRequestId: 'second' }, { now: 102 });
      broker.create(input, { now: 103 });
      console.log(JSON.stringify(broker.list()));
    `);
    expect(result).toHaveLength(3);
    expect(result.filter((item: any) => item.decisionRequestId).map((item: any) => item.decisionRequestId).sort()).toEqual(['first', 'second']);
    expect(result.find((item: any) => !item.decisionRequestId).occurrences).toBe(2);
  });
});
