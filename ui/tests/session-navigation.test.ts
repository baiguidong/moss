import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const appSource = readFileSync(
  new URL('../src/renderer-react/App.tsx', import.meta.url),
  'utf8',
);

describe('new session navigation', () => {
  test('starts background restore after the list loads and preserves navigation while other catalogs load', async () => {
    const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const app = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'App') as ts.FunctionDeclaration;
    const effect = app.body!.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes("'host:renderer-ready'"))!;
    const apps = Promise.withResolvers<unknown[]>(), restore = Promise.withResolvers<void>();
    const navigations: string[] = [], progress: boolean[] = [], failures: string[] = [];
    const requestId = { current: 0 };
    runInNewContext(ts.transpileModule(effect.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      React: { useEffect: (fn: () => void) => fn() }, requestAnimationFrame: (fn: () => void) => fn(),
      window: { agentDesktop: { getSettings: async () => ({ appearancePersisted: true }), getStatus: async () => ({ sdkReady: true }), ipcInvoke: () => restore.promise } },
      refreshApps: () => apps.promise, refreshSummaries: async () => [], refreshProjects: async () => { throw new Error('project catalog'); },
      refreshAssistants: async () => [], applyDesktopSettings() {}, cleanIpcErrorMessage: String,
      openSessionRequestIdRef: requestId, setActiveView: (view: string) => navigations.push(view),
      setRestoringApps: (value: boolean) => progress.push(value), setBootError: (error: string) => failures.push(error),
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(progress).toEqual([true]);
    expect(failures[0]).toContain('project catalog');
    requestId.current++;
    apps.resolve([]);
    restore.resolve();
    await new Promise(resolve => setImmediate(resolve));
    expect(navigations).toEqual([]);
    expect(progress).toEqual([true, false]);
  });

  test('keeps an embedded App mounted while navigating and ignores runtime-only refreshes', () => {
    expect(appSource).toContain("className={activeView === 'embedded-app' ? 'h-full min-h-0' : 'hidden'}");
    expect(appSource).toContain("activeView === 'embedded-app' ? null : activeView === 'pending'");
    expect(appSource).toContain("payload?.action !== 'runtime'");
    expect(appSource).not.toContain("activeView === 'embedded-app' && embeddedAppName ? (");
  });
});
