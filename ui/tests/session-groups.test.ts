import { describe, expect, it } from 'bun:test';
import {
  getSessionGroupPreview,
  groupSidebarSessions,
  SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT,
} from '../src/renderer-react/lib/session-groups';

describe('sidebar session groups', () => {
  it('separates normal, cron, and project sessions', () => {
    const groups = groupSidebarSessions([
      { id: 'normal' },
      { id: 'project', projectId: 'project-1' },
      { id: 'cron', sessionKind: 'cron' as const },
      { id: 'project-cron', sessionKind: 'cron' as const, projectId: 'project-1' },
    ]);

    expect(groups.map((group) => [group.id, group.sessions.map((session) => session.id)])).toEqual([
      ['chat', ['normal']],
      ['cron', ['cron', 'project-cron']],
      ['project', ['project']],
    ]);
  });

  it('keeps pinned sessions first within their own group', () => {
    const groups = groupSidebarSessions([
      { id: 'recent' },
      { id: 'pinned', isPinned: true },
      { id: 'cron-recent', sessionKind: 'cron' as const },
      { id: 'cron-pinned', sessionKind: 'cron' as const, isPinned: true },
    ]);

    expect(groups[0].sessions.map((session) => session.id)).toEqual(['pinned', 'recent']);
    expect(groups[1].sessions.map((session) => session.id)).toEqual(['cron-pinned', 'cron-recent']);
  });

  it('limits each group preview to four sessions', () => {
    const sessions = Array.from({ length: 6 }, (_, index) => ({ id: `session-${index + 1}` }));

    expect(getSessionGroupPreview(sessions).map((session) => session.id)).toEqual([
      'session-1',
      'session-2',
      'session-3',
      'session-4',
    ]);
    expect(SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT).toBe(4);
  });

  it('keeps an active older session visible in the limited preview', () => {
    const sessions = Array.from({ length: 6 }, (_, index) => ({ id: `session-${index + 1}` }));

    expect(getSessionGroupPreview(sessions, 'session-6').map((session) => session.id)).toEqual([
      'session-1',
      'session-2',
      'session-3',
      'session-6',
    ]);
  });
});
