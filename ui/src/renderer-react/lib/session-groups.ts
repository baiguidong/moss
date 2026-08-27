export type SessionGroupId = 'feishu' | 'chat' | 'cron' | 'project';

export type GroupableSession = {
  id: string;
  isPinned?: boolean;
  projectId?: string | null;
  projectName?: string | null;
  parentSessionId?: string | null;
  isSubAgent?: boolean;
  sessionKind?: 'chat' | 'cron';
  originChannel?: 'desktop' | 'feishu' | 'cron';
};

export type ProjectSessionNode<T> = {
  session: T;
  children: T[];
};

export type ProjectSessionTree<T> = {
  id: string;
  label: string;
  sessions: ProjectSessionNode<T>[];
};

export type SessionGroup<T> = {
  id: SessionGroupId;
  label: string;
  sessions: T[];
};

export const SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT = 4;

function prioritizePinned<T extends GroupableSession>(sessions: T[]) {
  return [
    ...sessions.filter((session) => session.isPinned),
    ...sessions.filter((session) => !session.isPinned),
  ];
}

export function groupSidebarSessions<T extends GroupableSession>(sessions: T[]): SessionGroup<T>[] {
  return [
    {
      id: 'feishu' as const,
      label: '飞书会话',
      sessions: prioritizePinned(sessions.filter(
        (session) => session.sessionKind !== 'cron' && session.originChannel === 'feishu',
      )),
    },
    {
      id: 'chat' as const,
      label: '普通会话',
      sessions: prioritizePinned(sessions.filter(
        (session) => session.sessionKind !== 'cron' && session.originChannel !== 'feishu' && !session.projectId,
      )),
    },
    {
      id: 'cron' as const,
      label: '定时任务',
      sessions: prioritizePinned(sessions.filter((session) => session.sessionKind === 'cron')),
    },
    {
      id: 'project' as const,
      label: '项目',
      sessions: prioritizePinned(sessions.filter(
        (session) => session.sessionKind !== 'cron' && session.originChannel !== 'feishu' && Boolean(session.projectId),
      )),
    },
  ].filter((group) => group.sessions.length > 0);
}

export function groupProjectSessionTrees<T extends GroupableSession>(sessions: T[]): ProjectSessionTree<T>[] {
  const grouped = new Map<string, T[]>();
  for (const session of sessions) {
    if (session.sessionKind === 'cron' || session.originChannel === 'feishu' || !session.projectId) continue;
    grouped.set(session.projectId, [...(grouped.get(session.projectId) || []), session]);
  }
  return Array.from(grouped.entries()).map(([projectId, entries]) => {
    const entryIds = new Set(entries.map((entry) => entry.id));
    const mainSessions = prioritizePinned(entries.filter(
      (entry) => !entry.parentSessionId || !entryIds.has(entry.parentSessionId),
    ));
    return {
      id: projectId,
      label: entries.find((entry) => entry.projectName)?.projectName || projectId,
      sessions: mainSessions.map((session) => ({
        session,
        children: entries.filter((entry) => entry.parentSessionId === session.id),
      })),
    };
  });
}

export function getSessionGroupPreview<T extends { id: string }>(
  sessions: T[],
  activeSessionId?: string | null,
  limit = SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT,
): T[] {
  if (limit <= 0 || sessions.length === 0) return [];
  if (sessions.length <= limit) return sessions;

  const preview = sessions.slice(0, limit);
  if (!activeSessionId || preview.some((session) => session.id === activeSessionId)) {
    return preview;
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  if (!activeSession) return preview;

  return [...preview.slice(0, Math.max(0, limit - 1)), activeSession];
}
