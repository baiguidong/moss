export function excludeRemovedSessions<T extends { id: string }>(
  sessions: T[],
  removedSessionIds: ReadonlySet<string>,
): T[] {
  if (removedSessionIds.size === 0) return sessions;
  return sessions.filter((session) => !removedSessionIds.has(session.id));
}

export function isSessionAlreadyRemovedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unknown session:/i.test(message);
}
