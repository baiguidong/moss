import { describe, expect, it } from 'bun:test';
import {
  APP_NOTIFICATIONS_STORAGE_KEY,
  MAX_APP_NOTIFICATIONS,
  appendAppNotification,
  cleanIpcErrorMessage,
  loadAppNotifications,
  saveAppNotifications,
  type AppNotification,
} from '../src/renderer-react/lib/app-notifications';

function notification(id: string, createdAt: number): AppNotification {
  return {
    id,
    severity: 'error',
    source: '连接器',
    title: '授权失败',
    message: `错误 ${id}`,
    createdAt,
    read: false,
    occurrences: 1,
  };
}

describe('app notification history', () => {
  it('removes the Electron IPC wrapper from the useful error reason', () => {
    expect(cleanIpcErrorMessage(
      "Error invoking remote method 'agent:mcp-authenticate': Error: OAuth callback timed out",
    )).toBe('OAuth callback timed out');
  });

  it('folds a repeated error within the dedupe window', () => {
    const first = appendAppNotification([], {
      severity: 'error',
      source: '连接器',
      title: '授权失败',
      message: 'OAuth callback timed out',
    }, { now: 1_000, id: 'first' });
    const second = appendAppNotification(first, {
      severity: 'error',
      source: '连接器',
      title: '授权失败',
      message: 'OAuth callback timed out',
    }, { now: 2_000, id: 'second' });

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: 'first', occurrences: 2, createdAt: 2_000, read: false });
  });

  it('keeps only the newest 200 entries', () => {
    const history = Array.from({ length: MAX_APP_NOTIFICATIONS }, (_, index) =>
      notification(String(index), index));
    const next = appendAppNotification(history, {
      severity: 'info',
      source: '测试',
      title: '新消息',
      message: '最新',
    }, { now: 10_000, id: 'newest' });

    expect(next).toHaveLength(MAX_APP_NOTIFICATIONS);
    expect(next[0].id).toBe('newest');
  });

  it('redacts credentials before keeping diagnostic details', () => {
    const next = appendAppNotification([], {
      severity: 'error',
      source: '连接器',
      title: '授权失败',
      message: 'Request failed with Bearer secret-token',
      details: 'https://example.com/callback?code=oauth-secret&access_token=token-secret',
    }, { now: 1_000, id: 'redacted' });

    expect(next[0].message).toBe('Request failed with Bearer [REDACTED]');
    expect(next[0].details).toContain('code=[REDACTED]');
    expect(next[0].details).toContain('access_token=[REDACTED]');
    expect(next[0].details).not.toContain('oauth-secret');
    expect(next[0].details).not.toContain('token-secret');
  });

  it('persists valid history and ignores malformed entries', () => {
    let stored = '';
    const storage = {
      getItem: (key: string) => key === APP_NOTIFICATIONS_STORAGE_KEY ? stored : null,
      setItem: (_key: string, value: string) => { stored = value; },
    };
    saveAppNotifications([notification('valid', 20)], storage);
    stored = JSON.stringify([...JSON.parse(stored), { id: 'broken' }]);

    expect(loadAppNotifications(storage).map((item) => item.id)).toEqual(['valid']);
  });
});
