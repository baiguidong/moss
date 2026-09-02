import { describe, expect, it } from 'bun:test';
import {
  filterSidebarSessionsByQuery,
  getSessionNodePreview,
  groupProjectSessionTrees,
  groupSessionNodes,
  groupSidebarSessions,
  SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT,
} from '../src/renderer-react/lib/session-groups';

describe('sidebar session groups', () => {
  it('separates Feishu, normal, cron, and project sessions', () => {
    const groups = groupSidebarSessions([
      { id: 'feishu', originChannel: 'feishu' as const },
      { id: 'normal' },
      { id: 'project', projectId: 'project-1' },
      { id: 'cron', sessionKind: 'cron' as const },
      { id: 'project-cron', sessionKind: 'cron' as const, projectId: 'project-1' },
      { id: 'room', sessionKind: 'group-room' as const },
      { id: 'room-worker', parentSessionId: 'room', isSubAgent: true },
    ]);

    expect(groups.map((group) => [group.id, group.sessions.map((session) => session.id)])).toEqual([
      ['feishu', ['feishu']],
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
    const nodes = groupSessionNodes(sessions);

    expect(getSessionNodePreview(nodes).map((node) => node.session.id)).toEqual([
      'session-1',
      'session-2',
      'session-3',
      'session-4',
    ]);
    expect(SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT).toBe(4);
  });

  it('keeps an active older session visible in the limited preview', () => {
    const sessions = Array.from({ length: 6 }, (_, index) => ({ id: `session-${index + 1}` }));
    const nodes = groupSessionNodes(sessions);

    expect(getSessionNodePreview(nodes, 'session-6').map((node) => node.session.id)).toEqual([
      'session-1',
      'session-2',
      'session-3',
      'session-6',
    ]);
  });

  it('nests subagent sessions under their project parent', () => {
    const trees = groupProjectSessionTrees([
      { id: 'main-a', projectId: 'project-a', projectName: '项目 A' },
      { id: 'child-a1', projectId: 'project-a', parentSessionId: 'main-a', isSubAgent: true },
      { id: 'main-b', projectId: 'project-b', projectName: '项目 B' },
    ]);

    expect(trees.map((tree) => tree.label)).toEqual(['项目 A', '项目 B']);
    expect(trees[0].sessions[0].session.id).toBe('main-a');
    expect(trees[0].sessions[0].children.map((child) => child.id)).toEqual(['child-a1']);
  });

  it('nests Boss subagents under their ordinary root session', () => {
    const nodes = groupSessionNodes([
      { id: 'child', parentSessionId: 'main', isSubAgent: true },
      { id: 'main' },
      { id: 'other' },
    ]);

    expect(nodes.map((node) => node.session.id)).toEqual(['main', 'other']);
    expect(nodes[0].children.map((child) => child.id)).toEqual(['child']);
  });

  it('classifies a child using its root session group', () => {
    const groups = groupSidebarSessions([
      { id: 'cron-root', sessionKind: 'cron' as const },
      { id: 'cron-child', parentSessionId: 'cron-root', isSubAgent: true },
      { id: 'feishu-root', originChannel: 'feishu' as const },
      { id: 'feishu-child', parentSessionId: 'feishu-root', isSubAgent: true },
    ]);

    expect(groups.map((group) => [group.id, group.sessions.map((session) => session.id)])).toEqual([
      ['feishu', ['feishu-root', 'feishu-child']],
      ['cron', ['cron-root', 'cron-child']],
    ]);
  });

  it('keeps a parent visible when search matches only its child', () => {
    const sessions = [
      { id: 'main', title: '主会话' },
      { id: 'child', title: '汇总最近提交', parentSessionId: 'main', isSubAgent: true },
      { id: 'other', title: '设置飞书连接器' },
    ];
    expect(filterSidebarSessionsByQuery(sessions, '汇总').map((session) => session.id)).toEqual([
      'main',
      'child',
    ]);
  });

  it('keeps an active child by retaining its root in the preview', () => {
    const nodes = groupSessionNodes([
      { id: 'main-1' },
      { id: 'main-2' },
      { id: 'main-3' },
      { id: 'main-4' },
      { id: 'main-5' },
      { id: 'child-5', parentSessionId: 'main-5', isSubAgent: true },
    ]);
    expect(getSessionNodePreview(nodes, 'child-5').map((node) => node.session.id)).toEqual([
      'main-1',
      'main-2',
      'main-3',
      'main-5',
    ]);
  });
});
