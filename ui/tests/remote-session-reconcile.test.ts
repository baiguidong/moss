import { describe, expect, it } from 'bun:test';
import {
  applyRemoteSessionTitle,
  createRemoteHistoryCheckpoint,
} from '../src/remote-session-reconcile.mjs';

describe('remote session reconciliation', () => {
  it('retries history until a successful fetch commits the checkpoint', () => {
    const session: any = { remoteLastActiveAt: 100 };
    const failed = createRemoteHistoryCheckpoint(session, 200);
    expect(failed.needsRefresh).toBe(true);
    expect(session.remoteLastActiveAt).toBe(100);

    const retry = createRemoteHistoryCheckpoint(session, 200);
    expect(retry.needsRefresh).toBe(true);
    retry.commit();
    expect(session.remoteLastActiveAt).toBe(200);
    expect(createRemoteHistoryCheckpoint(session, 200).needsRefresh).toBe(false);
  });

  it('does not overwrite a client title with the generic Server title', () => {
    const session: any = { title: '客户端自定义标题' };
    expect(applyRemoteSessionTitle(session, '飞书会话')).toBe(false);
    expect(session.title).toBe('客户端自定义标题');

    const imported: any = { title: 'Moss Server 会话' };
    expect(applyRemoteSessionTitle(imported, '飞书会话')).toBe(true);
    expect(imported.title).toBe('飞书会话');
  });
});
