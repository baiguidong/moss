import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

const brokerUrl = new URL('../src/app-notification-broker.mjs', import.meta.url).href;
const storeUrl = new URL('../src/feishu-adapter-store.mjs', import.meta.url).href;

function runScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createFeishuAdapterStore } from ${JSON.stringify(storeUrl)};
    import { createAppNotificationBroker } from ${JSON.stringify(brokerUrl)};
    const db = new DatabaseSync(':memory:');
    createFeishuAdapterStore(db);
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
});
