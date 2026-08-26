import * as React from 'react';

export const QUICK_SELECTION_LIMIT = 5;

export function promoteRecentIds(
  currentIds: string[],
  promotedIds: string[],
  limit = 24,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();

  for (const id of [...promotedIds, ...currentIds]) {
    const normalized = String(id || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
    if (next.length >= limit) break;
  }

  return next;
}

export function rankRecentItems<T>(
  items: T[],
  getId: (item: T) => string,
  selectedIds: string[],
  recentIds: string[],
  limit = QUICK_SELECTION_LIMIT,
): T[] {
  const byId = new Map(items.map((item) => [getId(item), item]));
  const orderedIds = promoteRecentIds(selectedIds, [], Number.POSITIVE_INFINITY);
  const seen = new Set(orderedIds);

  for (const id of [...recentIds, ...items.map(getId)]) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  return orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item))
    .slice(0, limit);
}

function readRecentIds(storageKey: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function useRecentIds(storageKey: string) {
  const [recentIds, setRecentIds] = React.useState<string[]>(() => readRecentIds(storageKey));

  const remember = React.useCallback((id: string) => {
    setRecentIds((current) => {
      const next = promoteRecentIds(current, [id]);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [storageKey]);

  return { recentIds, remember };
}
