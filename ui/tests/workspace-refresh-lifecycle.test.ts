import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'App') as ts.FunctionDeclaration;
const statements = app.body!.statements;
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('reopening the active session does not clear its loaded root directory', async () => {
  const statement = statements.find((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === 'openSession'))!;
  const active = { current: { id: 'same', workspace: '/workspace', history: [] } };
  const sessionId = { current: 'same' };
  let clears = 0;
  const open = runInNewContext(compile(`${statement.getText(ast)}\nopenSession;`), {
    React: { useCallback: (callback: unknown) => callback },
    openSessionRequestIdRef: { current: 0 },
    window: { agentDesktop: { getSession: async ({ sessionId }: { sessionId: string }) => ({ ...active.current, id: sessionId }) } },
    activeDetailRef: active, activeSessionIdRef: sessionId,
    setActiveView() {}, setActiveSessionId() {}, setComposerIntent() {}, setActiveDetail() {},
    restoreComposerIntent: () => 'chat',
    clearSessionWorkspaceState: () => { clears++; },
  });
  expect(await open('same')).toBe(true);
  expect(clears).toBe(0);
  expect(await open('different')).toBe(true);
  expect(clears).toBe(1);
});

test('continuous file events refresh promptly and queue one follow-up during a slow listing', async () => {
  const effect = statements.find((node) => ts.isExpressionStatement(node)
    && node.getText(ast).includes('const scheduleRefresh ='))!;
  let onChanged: (payload: { sessionId: string }) => void;
  let cleanup: () => void;
  let calls = 0;
  let complete: () => void;
  const timers = new Map<number, () => Promise<void>>();
  const listeners = new Map<string, () => void>();
  let nextTimer = 0;
  runInNewContext(compile(effect.getText(ast)), {
    React: { useEffect: (callback: () => () => void) => { cleanup = callback(); } },
    activeSessionIdRef: { current: 'active' },
    refreshWorkspaceSnapshot: () => { calls++; return new Promise<void>((resolve) => { complete = resolve; }); },
    window: {
      agentDesktop: { onWorkspaceChanged: (callback: typeof onChanged) => { onChanged = callback; return () => {}; } },
      setTimeout: (callback: () => Promise<void>) => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: (id: number) => timers.delete(id),
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
  });
  onChanged!({ sessionId: 'other' });
  expect(timers.size).toBe(0);
  for (let i = 0; i < 100; i++) onChanged!({ sessionId: 'active' });
  expect(nextTimer).toBe(1);
  const refresh = timers.get(1)!;
  timers.delete(1);
  const inFlight = refresh();
  for (let i = 0; i < 100; i++) onChanged!({ sessionId: 'active' });
  expect(calls).toBe(1);
  expect(timers.size).toBe(0);
  complete!();
  await inFlight;
  expect(timers.size).toBe(1);
  cleanup!();
  expect(timers.size).toBe(0);
  expect(listeners.size).toBe(0);
});
