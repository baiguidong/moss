import type { BackgroundTaskInfo, StoredApp } from '../types';
import type { AppComposerResource } from './app-composer';
import { appPageUnavailableReason } from './app-navigation';

// An ordinary view opts in to the conversation workbench. Its page receives a
// canonical App resource route as `target`; Core does not interpret that resource.
export const CONVERSATION_VIEW_ID = 'moss-conversation';
export type ConversationAppView = { appId: string; title: string; route: string; timestamp?: number; uuid?: string };
export type ConversationWorkbenchEntry = ConversationAppView & {
  key: string; viewTitle: string; viewRoute: string; kind: 'preview' | 'task'; status?: string; taskId?: string;
};
export const isAppViewRoute = (route: unknown): route is string => typeof route === 'string' && route.length <= 4096 && /^#\/[a-zA-Z0-9/_?=&.%+-]*$/.test(route);
export function conversationView(app: StoredApp) {
  const view = app.contributes?.views?.find(view => view.id === CONVERSATION_VIEW_ID);
  return view && app.hasUi && isAppViewRoute(view.route) && !appPageUnavailableReason(app, view.permission) ? view : null;
}
export function conversationWorkbenchRoute(viewRoute: string, target: string) {
  if (!isAppViewRoute(viewRoute) || !isAppViewRoute(target)) throw new Error('App 工作台地址无效');
  const [base, query = ''] = viewRoute.split('?');
  const params = new URLSearchParams(query); params.set('target', target);
  return `${base}?${params.toString()}`;
}
export function conversationWorkbenchEntries(apps: StoredApp[], views: ConversationAppView[], tasks: BackgroundTaskInfo[], selection?: AppComposerResource | null): ConversationWorkbenchEntry[] {
  const owners = new Map(apps.flatMap(app => { const view = conversationView(app); return view ? [[app.id || app.name, view] as const] : [] }));
  const entries = new Map<string, ConversationWorkbenchEntry>();
  const add = (resource: ConversationAppView, extra: Partial<ConversationWorkbenchEntry> = {}) => {
    const view = owners.get(resource.appId);
    if (!view || !isAppViewRoute(resource.route)) return;
    const key = `${resource.appId}:${resource.route}`;
    entries.set(key, { ...resource, key, viewTitle: view.title, viewRoute: view.route!, kind: 'preview', ...extra });
  };
  for (const view of [...views].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))) add(view);
  if (selection?.route) add({ appId: selection.appId, title: selection.title, route: selection.route, timestamp: Date.now() });
  for (const task of tasks) if (task.kind === 'app' && task.appId && task.route) add({ appId: task.appId, title: task.description, route: task.route, timestamp: task.startTime || 0 }, { kind: 'task', status: task.status, taskId: task.id });
  return [...entries.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
