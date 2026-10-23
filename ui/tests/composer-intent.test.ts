import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { reconcileComposerIntent, restoreComposerIntent } from '../src/renderer-react/lib/composer-intent';

const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'tsx' });

function fixture(persistedIntent = 'chat') {
  let intent = persistedIntent;
  let detail: any = { id: 'session', composerIntent: persistedIntent };
  const activeDetailRef = { current: detail };
  const callbacks: Record<string, Function> = {};
  const context = {
    React: { useCallback: (fn: Function) => fn },
    window: { agentDesktop: {
      onSessionMeta: (callback: Function) => { callbacks.meta = callback; },
      onState: (callback: Function) => { callbacks.state = callback; },
      onSessionHistory: (callback: Function) => { callbacks.history = callback; },
    } },
    composerIntentStatesRef: { current: new Map() },
    activeSessionIdRef: { current: 'session' }, activeDetailRef,
    removedSessionIdsRef: { current: new Set() },
    setComposerIntent: (next: string) => { intent = next; },
    setActiveDetail: (update: Function) => { detail = update(detail); },
    setSummaries: () => {}, setPendingSendRequests: () => {},
    upsertSummary: () => {}, showPermissionNotice: () => {},
    mergeSessionHistorySnapshot: (current: unknown) => current,
    flushQueuedMessagesRef: { current: () => {} },
    reconcileComposerIntent, restoreComposerIntent,
  };
  const changeStart = source.indexOf('const handleComposerIntentChange = React.useCallback');
  const changeEnd = source.indexOf('const handleDeleteSession', changeStart);
  const change = runInNewContext(`${transpiler.transformSync(source.slice(changeStart, changeEnd))}; handleComposerIntentChange`, context);
  for (const [startText, endText] of [
    ['const offMeta =', 'const offSessionHistory ='],
    ['const offState =', 'const offBackgroundTasks ='],
    ['const offSessionHistory =', 'const offRemoved ='],
  ]) {
    const start = source.indexOf(startText);
    runInNewContext(transpiler.transformSync(source.slice(start, source.indexOf(endText, start))), context);
  }
  return { change, callbacks, intent: () => intent, context };
}

test('acknowledges a persisted selection and accepts later mode changes', () => {
  const f = fixture();
  f.change('boss');
  f.callbacks.meta({ id: 'session', composerIntent: 'boss' });
  expect(f.context.composerIntentStatesRef.current.get('session').selected).toBeUndefined();
  f.callbacks.state({ sessionId: 'session', summary: { id: 'session', composerIntent: 'chat' } });
  expect(f.intent()).toBe('chat');
});

test('out-of-order state does not undo an acknowledged Boss selection', () => {
  const f = fixture();
  f.change('boss');
  f.callbacks.meta({ id: 'session', composerIntent: 'boss', updatedAt: 200 });
  f.callbacks.state({ sessionId: 'session', summary: { id: 'session', composerIntent: 'chat', updatedAt: 100 } });
  expect(f.intent()).toBe('boss');
  f.callbacks.meta({ id: 'session', composerIntent: 'chat', updatedAt: 300 });
  expect(f.intent()).toBe('chat');
});

test('100 reordered metadata, state and history snapshots preserve the latest mode', () => {
  const f = fixture();
  f.change('boss');
  f.callbacks.meta({ id: 'session', composerIntent: 'boss', updatedAt: 200 });
  for (let i = 0; i < 100; i++) {
    const summary = { id: 'session', composerIntent: 'chat', updatedAt: 1 + ((i * 73) % 199) };
    if (i % 3 === 0) f.callbacks.meta(summary);
    else if (i % 3 === 1) f.callbacks.state({ sessionId: 'session', summary });
    else f.callbacks.history({ sessionId: 'session', summary, history: [] });
    expect(f.intent()).toBe('boss');
  }
  f.change('chat');
  f.callbacks.history({ sessionId: 'session', summary: { id: 'session', composerIntent: 'chat', updatedAt: 300 }, history: [] });
  f.callbacks.meta({ id: 'session', composerIntent: 'boss', updatedAt: 200 });
  expect(f.intent()).toBe('chat');
});

test('preserves other sessions and uses each project session’s selected mode', () => {
  const overrides = new Map([['session', { selected: 'chat' as const }], ['other', { selected: 'boss' as const }]]);
  expect(reconcileComposerIntent({ id: 'session', projectId: 'project', composerIntent: 'chat' }, overrides)).toBe('chat');
  expect(overrides.get('session')?.selected).toBeUndefined();
  expect(overrides.get('other')?.selected).toBe('boss');
  expect(restoreComposerIntent({ composerIntent: 'coordinator' as any })).toBe('boss');
});

for (const [before, after] of [['chat', 'boss'], ['boss', 'chat']]) {
  test(`keeps the user's ${after} selection through ${before} metadata and state refreshes`, () => {
    const f = fixture(before);
    f.change(after);
    f.callbacks.meta({ id: 'session', composerIntent: before, title: 'Renamed' });
    expect(f.intent()).toBe(after);
    f.callbacks.state({ sessionId: 'session', summary: { id: 'session', composerIntent: before } });
    expect(f.intent()).toBe(after);
  });
}
