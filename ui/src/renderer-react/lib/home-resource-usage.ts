import * as React from 'react';
import type { SessionSummary } from '@/types';

export const HOME_RESOURCE_USAGE_KEY = 'ui.homeResourceUsage.v1';
const CHANGE_EVENT = 'moss:home-resource-usage';
const KINDS = ['projects', 'assistants', 'skills'] as const;
type ResourceKind = typeof KINDS[number];
type Usage = { count: number; latest: number };
export type HomeResourceUsage = Record<ResourceKind, Record<string, Usage>> & {
  initialized: boolean;
  receipts: string[];
};

const emptyUsage = (): HomeResourceUsage => ({ initialized: false, projects: {}, assistants: {}, skills: {}, receipts: [] });

export function readHomeResourceUsage(): HomeResourceUsage {
  try {
    const raw = window.localStorage.getItem(HOME_RESOURCE_USAGE_KEY);
    if (!raw) return emptyUsage();
    const parsed = JSON.parse(raw);
    const usage = emptyUsage();
    usage.initialized = parsed?.initialized === true;
    usage.receipts = Array.isArray(parsed?.receipts) ? parsed.receipts.filter(id => typeof id === 'string').slice(-256) : [];
    for (const kind of KINDS) {
      usage[kind] = Object.fromEntries(Object.entries(parsed?.[kind] || {}).filter(([id, value]) => {
        const entry = value as Usage;
        return id.trim() && Number.isSafeInteger(entry?.count) && entry.count > 0 && Number.isFinite(entry.latest) && entry.latest >= 0;
      })) as Record<string, Usage>;
    }
    return usage;
  } catch {
    return emptyUsage();
  }
}

function saveUsage(usage: HomeResourceUsage) {
  try { window.localStorage.setItem(HOME_RESOURCE_USAGE_KEY, JSON.stringify(usage)); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

function addUsage(usage: HomeResourceUsage, kind: ResourceKind, ids: Array<string | null | undefined>, time: number) {
  for (const id of new Set(ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))) {
    const previous = Object.hasOwn(usage[kind], id) ? usage[kind][id] : undefined;
    Object.defineProperty(usage[kind], id, { enumerable: true, configurable: true, writable: true,
      value: { count: (previous?.count || 0) + 1, latest: Math.max(previous?.latest || 0, time) } });
  }
}

function isMainLocalChat(session: SessionSummary) {
  return !session.isSubAgent && session.agentMode !== 'remote-direct' && (!session.sessionKind || session.sessionKind === 'chat');
}

function addSessionUsage(usage: HomeResourceUsage, session: SessionSummary, skills: string[], time: number) {
  addUsage(usage, 'projects', [session.projectId], time);
  addUsage(usage, 'assistants', [session.assistantName], time);
  addUsage(usage, 'skills', skills, time);
}

// Seed once from existing conversations, then keep usage independently of their lifecycle.
export function initializeHomeResourceUsage(sessions: SessionSummary[]) {
  const usage = readHomeResourceUsage();
  if (usage.initialized) return;
  for (const session of sessions) {
    if (!isMainLocalChat(session) || !session.messageCount) continue;
    addSessionUsage(usage, session, session.skillIds || [], session.updatedAt);
  }
  usage.initialized = true;
  saveUsage(usage);
}

export function recordHomeResourceUse(session: SessionSummary, skills: Array<{ name: string }> = [], requestId?: string) {
  if (!isMainLocalChat(session)) return;
  const usage = readHomeResourceUsage();
  const receipt = requestId ? `${session.id}:${requestId}` : undefined;
  if (receipt && usage.receipts.includes(receipt)) return;
  addSessionUsage(usage, session, [...(session.skillIds || []), ...skills.map(skill => skill.name)], Date.now());
  if (receipt) usage.receipts = [...usage.receipts, receipt].slice(-256);
  saveUsage(usage);
}

export function rankHomeResources<T>(items: T[], getId: (item: T) => string, usage: Record<string, Usage>, limit = 3): T[] {
  return Array.from(new Map(items.map(item => [getId(item), item])).values())
    .filter(item => Object.hasOwn(usage, getId(item)) && usage[getId(item)].count > 0)
    .sort((a, b) => usage[getId(b)].count - usage[getId(a)].count || usage[getId(b)].latest - usage[getId(a)].latest)
    .slice(0, limit);
}

export function useHomeResourceUsage() {
  const [usage, setUsage] = React.useState(readHomeResourceUsage);
  React.useEffect(() => {
    const refresh = () => setUsage(readHomeResourceUsage());
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key === HOME_RESOURCE_USAGE_KEY) refresh(); };
    refresh();
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return usage;
}
