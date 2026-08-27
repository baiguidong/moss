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

export type SessionNode<T> = {
  session: T;
  children: T[];
};

export type ProjectSessionNode<T> = SessionNode<T>;

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

function getGroupingSession<T extends GroupableSession>(
  session: T,
  sessionsById: Map<string, T>,
) {
  let current = session;
  const visited = new Set([session.id]);
  while (current.parentSessionId) {
    const parent = sessionsById.get(current.parentSessionId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    current = parent;
  }
  return current;
}

export function groupSessionNodes<T extends GroupableSession>(sessions: T[]): SessionNode<T>[] {
  const entryIds = new Set(sessions.map((entry) => entry.id));
  const roots = prioritizePinned(sessions.filter(
    (entry) => !entry.parentSessionId || !entryIds.has(entry.parentSessionId),
  ));
  return roots.map((session) => ({
    session,
    children: sessions.filter((entry) => entry.parentSessionId === session.id),
  }));
}

export function groupSidebarSessions<T extends GroupableSession>(sessions: T[]): SessionGroup<T>[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const groupSession = (session: T) => getGroupingSession(session, sessionsById);
  return [
    {
      id: 'feishu' as const,
      label: '飞书会话',
      sessions: prioritizePinned(sessions.filter(
        (session) => {
          const root = groupSession(session);
          return root.sessionKind !== 'cron' && root.originChannel === 'feishu';
        },
      )),
    },
    {
      id: 'chat' as const,
      label: '普通会话',
      sessions: prioritizePinned(sessions.filter(
        (session) => {
          const root = groupSession(session);
          return root.sessionKind !== 'cron' && root.originChannel !== 'feishu' && !root.projectId;
        },
      )),
    },
    {
      id: 'cron' as const,
      label: '定时任务',
      sessions: prioritizePinned(sessions.filter((session) => groupSession(session).sessionKind === 'cron')),
    },
    {
      id: 'project' as const,
      label: '项目',
      sessions: prioritizePinned(sessions.filter(
        (session) => {
          const root = groupSession(session);
          return root.sessionKind !== 'cron' && root.originChannel !== 'feishu' && Boolean(root.projectId);
        },
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
    return {
      id: projectId,
      label: entries.find((entry) => entry.projectName)?.projectName || projectId,
      sessions: groupSessionNodes(entries),
    };
  });
}

export function filterSidebarSessionsByQuery<T extends GroupableSession & { title: string }>(
  sessions: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return sessions;
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const included = new Set(
    sessions
      .filter((session) => session.title.toLocaleLowerCase().includes(normalizedQuery))
      .map((session) => session.id),
  );
  for (const sessionId of Array.from(included)) {
    let current = sessionsById.get(sessionId);
    const visited = new Set<string>();
    while (current?.parentSessionId && !visited.has(current.parentSessionId)) {
      visited.add(current.parentSessionId);
      included.add(current.parentSessionId);
      current = sessionsById.get(current.parentSessionId);
    }
  }
  return sessions.filter((session) => included.has(session.id));
}

export function getSessionNodePreview<T extends GroupableSession>(
  nodes: SessionNode<T>[],
  activeSessionId?: string | null,
  limit = SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT,
): SessionNode<T>[] {
  if (limit <= 0 || nodes.length === 0) return [];
  if (nodes.length <= limit) return nodes;
  const activeNode = activeSessionId
    ? nodes.find((node) => (
        node.session.id === activeSessionId ||
        node.children.some((child) => child.id === activeSessionId)
      ))
    : null;
  const preview = nodes.slice(0, limit);
  if (!activeNode || preview.includes(activeNode)) return preview;
  return [...preview.slice(0, Math.max(0, limit - 1)), activeNode];
}
