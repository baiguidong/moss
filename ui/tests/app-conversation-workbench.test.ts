import { describe, expect, test } from 'bun:test';
import { conversationWorkbenchEntries, conversationWorkbenchRoute } from '../src/renderer-react/lib/app-conversation-workbench';

const app = { id: 'example.flow', name: 'example.flow', enabled: true, hasUi: true, contributes: { views: [{ id: 'moss-conversation', title: '工作流', route: '#/conversation' }] } } as any;
const definition = { appId: app.id, title: '旧修订', route: '#/flows/one?revision=1', timestamp: 1 };
describe('conversation App workbench', () => {
  test('only an enabled, authorized, explicitly contributed view can be embedded', () => {
    expect(conversationWorkbenchEntries([app], [definition], [])).toHaveLength(1);
    for (const candidate of [{ ...app, enabled: false }, { ...app, hasUi: false }, { ...app, packageStatus: 'incompatible' }, { ...app, contributes: { views: [] } }, { ...app, contributes: { views: [{ ...app.contributes.views[0], permission: 'files:read' }] } }]) {
      expect(conversationWorkbenchEntries([candidate], [definition], [])).toHaveLength(0);
    }
    expect(conversationWorkbenchEntries([app], [{ ...definition, appId: 'another.app' }], [])).toHaveLength(0);
  });
  test('keeps pinned revisions, deduplicates reads, and prefers actual task state over a presentation', () => {
    const run = { appId: app.id, title: '测试运行', route: '#/runs/one', timestamp: 3 };
    const task = { kind: 'app', id: 'task-1', appId: app.id, description: run.title, route: run.route, status: 'completed', startTime: 3 } as any;
    const entries = conversationWorkbenchEntries([app], [definition, definition, { ...definition, route: '#/flows/one?revision=2', timestamp: 2 }, run], [task]);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: 'task', taskId: 'task-1', status: 'completed' });
    expect(new Set(entries.map(entry => entry.key)).size).toBe(3);
  });
  test('passes a bounded local target route without replacing the App view or allowing external navigation', () => {
    const route = conversationWorkbenchRoute('#/conversation?theme=system', '#/flows/one?revision=2');
    const query = new URLSearchParams(route.split('?')[1]);
    expect(route.split('?')[0]).toBe('#/conversation');
    expect(query.get('theme')).toBe('system');
    expect(query.get('target')).toBe('#/flows/one?revision=2');
    expect(() => conversationWorkbenchRoute('#/conversation', 'https://example.com')).toThrow();
    expect(conversationWorkbenchEntries([app], [{ ...definition, route: '#/' + 'a'.repeat(4096) }], [])).toHaveLength(0);
  });
});
