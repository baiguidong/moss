import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'App') as ts.FunctionDeclaration;
const statements = app.body!.statements;
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function sessionNavigation(getSession: (payload: { sessionId: string }) => Promise<unknown>,
  getAppAuthoringContext?: (sessionId: string) => Promise<unknown>) {
  const callbacks = statements.filter((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => ['openSession', 'setActiveView'].includes(declaration.name.getText(ast))));
  const active = { current: { id: 'same', workspace: '/workspace', history: [] } };
  const sessionId = { current: 'same' };
  const state = { clears: 0, pending: null as string | null, view: 'chat', errors: [] as string[] };
  const { openSession: open, setActiveView: navigate } = runInNewContext(compile(callbacks.map(node => node.getText(ast)).join('\n') + '\n({ openSession, setActiveView });'), {
    React: { useCallback: (callback: unknown) => callback },
    confirmAppViewLeave: () => true,
    openSessionRequestIdRef: { current: 0 },
    window: { agentDesktop: { getSession, getAppAuthoringContext } },
    activeDetailRef: active, activeSessionIdRef: sessionId,
    setActiveViewRaw(view: string) { state.view = view; },
    setOpeningSessionId(id: string | null) { state.pending = id; },
    setActiveSessionId() {}, setComposerIntent() {}, setActiveDetail() {},
    cleanIpcErrorMessage: String, showPermissionNotice(message: string) { state.errors.push(message); },
    composerDraftsRef: { current: {} },
    reconcileComposerIntent: () => 'chat', composerIntentStatesRef: { current: new Map() },
    clearSessionWorkspaceState: () => { state.clears++; },
  });
  return { open, navigate, sessionId, state };
}

test('reopening the active session does not clear its loaded root directory', async () => {
  const { open, state } = sessionNavigation(async ({ sessionId }) => ({ id: sessionId, workspace: '/workspace', history: [] }));
  expect(await open('same')).toBe(true);
  expect(state.clears).toBe(0);
  expect(await open('different')).toBe(true);
  expect(state.clears).toBe(1);
});

test('shows the latest pending session and ignores stale successes and errors after navigation', async () => {
  const a = Promise.withResolvers<unknown>(), b = Promise.withResolvers<unknown>();
  const { open, navigate, state, sessionId } = sessionNavigation(({ sessionId }) => sessionId === 'a' ? a.promise : b.promise);
  const first = open('a');
  expect(state.pending).toBe('a');
  const second = open('b');
  a.resolve({ id: 'a' });
  expect(await first).toBe(false);
  expect(state.pending).toBe('b');
  navigate('settings');
  expect(state.pending).toBeNull();
  b.reject(new Error('late error'));
  expect(await second).toBe(false);
  expect(state.view).toBe('settings');
  expect(sessionId.current).toBe('same');
  expect(state.errors).toEqual([]);
});

test('opens history when optional App context fails and reports history failures', async () => {
  const { open, state, sessionId } = sessionNavigation(async ({ sessionId }) => {
    if (sessionId === 'missing') throw new Error('missing');
    return { id: sessionId };
  }, async () => { throw new Error('context unavailable'); });
  expect(await open('b')).toBe(true);
  expect(sessionId.current).toBe('b');
  expect(state.errors).toEqual([]);
  expect(await open('missing')).toBe(false);
  expect(sessionId.current).toBe('b');
  expect(state.errors[0]).toContain('missing');
  expect(state.pending).toBeNull();
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
