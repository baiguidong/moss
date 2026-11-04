import { afterEach, beforeEach, expect, test } from 'bun:test';
import { HOME_RESOURCE_USAGE_KEY, initializeHomeResourceUsage, rankHomeResources, readHomeResourceUsage, recordHomeResourceUse } from '../src/renderer-react/lib/home-resource-usage';
import type { SessionSummary } from '../src/renderer-react/types';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(target, {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  }) });
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
const session = (extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'session', title: '工作', permissionMode: 'default', workspace: '/work', createdAt: 1, updatedAt: 10,
  busy: false, messageCount: 2, sessionId: 'engine-session', preview: '', projectId: 'project',
  assistantName: 'expert', skillIds: ['skill'], ...extra,
});

test('migrates actual conversation usage once and retains it after sessions are deleted or archived', () => {
  initializeHomeResourceUsage([
    session(), session({ id: 'archived', archivedAt: 20 }),
    session({ id: 'empty', messageCount: 0 }), session({ id: 'worker', isSubAgent: true }),
    session({ id: 'remote', agentMode: 'remote-direct' }), session({ id: 'cron', sessionKind: 'cron' }),
  ]);
  expect(readHomeResourceUsage().projects.project).toEqual({ count: 2, latest: 10 });
  initializeHomeResourceUsage([]);
  initializeHomeResourceUsage([session()]);
  expect(JSON.parse(storage.get(HOME_RESOURCE_USAGE_KEY)!).assistants.expert.count).toBe(2);
});

test('records explicit skills once per accepted request, persists counts, and deduplicates session skills', () => {
  initializeHomeResourceUsage([]);
  recordHomeResourceUse(session(), [{ name: 'skill' }, { name: 'chosen-in-chat' }], 'message');
  recordHomeResourceUse(session(), [{ name: 'skill' }, { name: 'chosen-in-chat' }], 'message');
  recordHomeResourceUse(session(), [{ name: 'chosen-in-chat' }], 'next-message');
  const saved = readHomeResourceUsage();
  expect(saved.projects.project.count).toBe(2);
  expect(saved.assistants.expert.count).toBe(2);
  expect(saved.skills.skill.count).toBe(2);
  expect(saved.skills['chosen-in-chat'].count).toBe(2);
  expect(saved.skills.skill.latest).toBeGreaterThan(10);
  recordHomeResourceUse(session({ isSubAgent: true }), [], 'worker');
  recordHomeResourceUse(session({ agentMode: 'remote-direct' }), [], 'remote');
  expect(readHomeResourceUsage()).toEqual(saved);
});

test('only ranks used, currently available resources, by frequency then recency', () => {
  const items = ['unused', 'old', 'recent', 'frequent', 'fourth', 'recent'];
  const usage = { old: { count: 1, latest: 1 }, recent: { count: 1, latest: 5 },
    frequent: { count: 3, latest: 2 }, fourth: { count: 1, latest: 0 }, removed: { count: 20, latest: 10 } };
  expect(rankHomeResources(items, id => id, usage)).toEqual(['frequent', 'recent', 'old']);
  expect(rankHomeResources(items, id => id, {})).toEqual([]);
  expect(rankHomeResources([], id => id, usage)).toEqual([]);
});

test('ignores malformed stored usage and prototype names are safe resource IDs', () => {
  storage.set(HOME_RESOURCE_USAGE_KEY, '{bad json');
  expect(readHomeResourceUsage().projects).toEqual({});
  storage.set(HOME_RESOURCE_USAGE_KEY, JSON.stringify({ skills: {
    valid: { count: 2, latest: 1 }, negative: { count: -1, latest: 2 }, text: { count: '3', latest: 2 }, null: null,
  } }));
  expect(Object.keys(readHomeResourceUsage().skills)).toEqual(['valid']);
  recordHomeResourceUse(session({ projectId: '__proto__' }), [{ name: 'constructor' }], 'message');
  expect(readHomeResourceUsage().projects.__proto__).toEqual({ count: 1, latest: expect.any(Number) });
  expect(rankHomeResources(['constructor', 'toString'], id => id, readHomeResourceUsage().skills)).toEqual(['constructor']);
});
