import { describe, expect, test } from 'bun:test';
import { buildPendingWorkItems, countPendingWorkItems } from '../src/renderer-react/lib/pending-work-items';

const session = (patch: Record<string, unknown> = {}) => ({
  id: 'session-1',
  title: '周报会话',
  permissionMode: 'default',
  workspace: '/tmp/report',
  createdAt: 1_000,
  updatedAt: 10_000,
  busy: false,
  messageCount: 2,
  sessionId: 'session-1',
  preview: '周报已生成',
  ...patch,
} as any);

describe('pending work aggregation', () => {
  test('sorts actionable work before progress and completed sessions', () => {
    const items = buildPendingWorkItems({
      now: 20_000,
      sessions: [
        session({ projectSessionStatus: 'completed', completedAt: 18_000 }),
        session({ id: 'session-2', title: '客户分析', projectSessionStatus: 'working', updatedAt: 16_000 }),
      ],
      questions: [{
        requestId: 'question-1',
        sessionId: 'session-1',
        requestedAt: 19_000,
        input: { questions: [{ question: '选择发送时间', header: '发送时间', options: [] }] },
      }],
      notifications: [{
        id: 'notification-1', severity: 'info', source: '消息中心', title: '普通通知', message: '不应进入工作台',
        createdAt: 19_500, read: false, occurrences: 1,
      }],
    });

    expect(items.map(item => item.id)).toEqual([
      'question:question-1',
      'session:session-2:progress',
      'session:session-1:result',
    ]);
    expect(countPendingWorkItems(items)).toBe(1);
  });

  test('keeps approvals actionable even when notification is read', () => {
    const items = buildPendingWorkItems({
      notifications: [{
        id: 'notification-1', severity: 'warning', source: '待确认', title: '允许发送邮件', message: '请确认',
        createdAt: 10_000, read: true, occurrences: 1, decisionRequestId: 'decision-1',
      }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('attention');
    expect(items[0].source).toBe('approval');
  });

  test('does not show old completed results', () => {
    const items = buildPendingWorkItems({
      now: 10 * 24 * 60 * 60 * 1_000,
      sessions: [session({ projectSessionStatus: 'completed', completedAt: 1_000 })],
    });
    expect(items).toEqual([]);
  });
});
