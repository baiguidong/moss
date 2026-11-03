import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { composerIsEmpty, mergeRecoveredDraft, preserveQueuedMessages, reconcileQueuedMessages, recoverQueuedMessages, requeueMessagesAfterStop, stopQueuedMessages, withdrawMessage,
  type ComposerDraft, type QueuedMessage } from '../src/renderer-react/lib/composer-queue';
import { firstMessageTitle } from '../src/renderer-react/lib/pending-first-message';

const empty: ComposerDraft = { text: '', files: [] };
const queued: QueuedMessage = { id: 'one', prompt: 'review', intent: 'boss', workspace: '/work',
  files: [{ name: 'a.txt', path: '/work/a.txt', resource: { uri: 'app://document', selection: 'full-file' } as any }],
  skills: [{ name: 'review', source: 'user' }], agentType: 'researcher', agent: { agentType: 'researcher' } as any,
  appSelection: { title: 'Workflow', providerId: 'workflow' } as any };

test('withdraw restores the whole snapshot and removes only that queue entry', () => {
  const queue = [queued, { ...queued, id: 'two' }];
  const result = withdrawMessage(queue, 'one', empty, '/work');
  expect(result.restored).toBe(true);
  expect(result.draft).toMatchObject({ text: 'review', files: queued.files, intent: 'boss',
    choices: { skills: queued.skills, agent: queued.agent }, appSelection: queued.appSelection });
  expect(result.queue.map(item => item.id)).toEqual(['two']);
  expect(queue).toHaveLength(2);
});

test('existing text, attachments, App or selected choices are never overwritten', () => {
  for (const draft of [
    { ...empty, text: 'currently typing' }, { ...empty, files: queued.files! },
    { ...empty, appSelection: queued.appSelection },
    { ...empty, choices: { skills: queued.skills!, agent: null } },
    { ...empty, choices: { skills: [], agent: queued.agent! } },
  ]) {
    const result = withdrawMessage([queued], queued.id, draft, '/work');
    expect(composerIsEmpty(draft)).toBe(false);
    expect(result.restored).toBe(false);
    expect(result.draft).toBe(draft);
    expect(result.queue[0]).toMatchObject({ status: 'draft', files: queued.files, skills: queued.skills });
  }
});

test('wrong workspace, already-dispatching and stale clicks cannot withdraw into a new context', () => {
  expect(withdrawMessage([queued], 'one', empty, '/other').restored).toBe(false);
  expect(withdrawMessage([{ ...queued, status: 'dispatching' }], 'one', empty, '/work').restored).toBe(false);
  expect(withdrawMessage([], 'one', empty, '/work').restored).toBe(false);
});

test('Stop and reload keep separate complete drafts without automatic replay', () => {
  const items: QueuedMessage[] = [queued, { ...queued, id: 'two', prompt: '', status: 'queued' }, { ...queued, id: 'running', status: 'dispatching' }];
  const stopped = preserveQueuedMessages(items);
  expect(stopped.map(item => item.status)).toEqual(['draft', 'draft', 'dispatching']);
  const recovered = recoverQueuedMessages(JSON.parse(JSON.stringify(stopped)));
  expect(recovered.every(item => item.status === 'draft')).toBe(true);
  expect(recovered[1].files).toEqual(queued.files);
  expect(recovered[2].notice).toContain('未确认');
});

test('Stop releases a concurrent individual cancellation back to an editable draft', () => {
  const stopped = stopQueuedMessages([{ ...queued, status: 'canceling' }]);
  expect(stopped[0]).toMatchObject({ status: 'draft', notice: '取消请求未确认，内容已保留。' });
});

test('Stop requeues an in-flight item while keeping existing drafts untouched', () => {
  const items: QueuedMessage[] = [
    { ...queued, status: 'dispatching', notice: '正在发送' },
    { ...queued, id: 'two', status: 'queued' },
    { ...queued, id: 'draft', status: 'draft', notice: '请核对记录' },
  ];
  const stopped = requeueMessagesAfterStop(items);
  expect(stopped.map(item => item.status)).toEqual(['queued', 'queued', 'draft']);
  expect(stopped[0].notice).toBeUndefined();
  expect(stopped[2].notice).toBe('请核对记录');
});

test('recovering another window preserves its intent/resources independently of current input', () => {
  const current: ComposerDraft = { text: 'current', files: [], intent: 'chat' };
  const other = withdrawMessage([queued], 'one', empty, '/work').draft;
  const result = mergeRecoveredDraft(current, other, 'recovered');
  expect(result.text).toBe('current');
  expect(result.intent).toBe('chat');
  expect(result.queued?.[0]).toMatchObject({ intent: 'boss', files: queued.files, skills: queued.skills, agent: queued.agent });
});

// Execute the actual App queue-dispatch integration with controlled Host timing.
function dispatchHarness(items: QueuedMessage[], host: any, dispatch?: any) {
  const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const flushQueuedMessagesRef =');
  const receiptStart = source.indexOf('  const acknowledgeQueuedMessages =');
  const eventStart = source.indexOf('    const offEvent =');
  const dispatchStart = source.indexOf('  const dispatchToSession =');
  const code = new Bun.Transpiler({ loader: 'tsx' }).transformSync(
    source.slice(receiptStart, source.indexOf('  // Draft restoration', receiptStart)) +
    source.slice(eventStart, source.indexOf('    const offState =', eventStart)) +
    (dispatch ? '' : source.slice(dispatchStart, source.indexOf('  const handleCreateProjectConversation =', dispatchStart))) +
    source.slice(start, source.indexOf('  const submitPrompt =', start)) + '\nglobalThis.flush = flushQueuedMessagesRef.current;');
  const state = {
    React: { useRef: (current: any) => ({ current }), useEffect: (fn: any) => fn(), useCallback: (fn: any) => fn },
    reconcileQueuedMessages, stopQueuedMessages, activeSessionIdRef: { current: 'another-session' },
    selectedAssistant: null, resourceContext: (resource: any) => resource,
    setPendingSendRequests: (_update: any) => {}, receive: (_event: any) => {},
    queuedMessagesRef: { current: { session: items } }, queueEpochs: { current: new Map() },
    removedSessionIdsRef: { current: new Set() }, cleanIpcErrorMessage: (error: Error) => error.message,
    dispatchToSession: dispatch, window: { agentDesktop: { ...host, onEvent: (fn: any) => { state.receive = fn; } } }, flush: (_id: string) => {},
    updateQueue: (id: string, update: any) => { (state.queuedMessagesRef.current as any)[id] = update((state.queuedMessagesRef.current as any)[id] ?? []); },
  };
  runInNewContext(code, state);
  return state;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('a received queued message disappears while the Agent is still running, even in another session', async () => {
  let finish!: () => void;
  let busy = false;
  let sent: any;
  const state = dispatchHarness([queued, { ...queued, id: 'two' }], {
    getSession: async () => ({ workspace: '/work', busy }),
    send: (payload: any) => { sent = payload; busy = true; return new Promise<void>(resolve => { finish = resolve; }); },
  });
  state.flush('session'); await settle();
  expect(sent.clientMessageId).toBe(queued.id);
  expect(state.queuedMessagesRef.current.session[0].status).toBe('dispatching');
  // A reply or an unrelated user message is not a receipt for this request.
  state.receive({ sessionId: 'session', payload: { type: 'assistant', clientMessageId: queued.id } });
  state.receive({ sessionId: 'session', payload: { type: 'user', prompt: queued.prompt } });
  expect(state.queuedMessagesRef.current.session).toHaveLength(2);
  state.receive({ sessionId: 'session', payload: { type: 'user', clientMessageId: sent.clientMessageId } });
  expect(busy).toBe(true);
  expect(state.queuedMessagesRef.current.session.map(item => item.id)).toEqual(['two']);
  state.flush('session'); // Receipt must not start the next message mid-turn.
  expect(sent.clientMessageId).toBe(queued.id);
  // Stop must not put the already received message back into the queue.
  state.queueEpochs.current.set('session', 1);
  state.updateQueue('session', requeueMessagesAfterStop);
  finish(); await settle();
  expect(state.queuedMessagesRef.current.session.map(item => item.id)).toEqual(['two']);
});

test('a late receipt after Stop removes the requeued entry, and late failure does not restore it', async () => {
  let fail!: (error: Error) => void;
  const state = dispatchHarness([queued], {
    getSession: async () => ({ workspace: '/work', busy: false }),
    send: () => new Promise((_resolve, reject) => { fail = reject; }),
  });
  state.flush('session'); await settle();
  state.queueEpochs.current.set('session', 1);
  state.updateQueue('session', requeueMessagesAfterStop);
  state.receive({ sessionId: 'session', payload: { type: 'user', clientMessageId: queued.id } });
  fail(new Error('connection closed after acceptance')); await settle();
  expect(state.queuedMessagesRef.current.session).toEqual([]);
});

test('history receipts clear recovered drafts and prevent replay when a live receipt was missed', async () => {
  const history = [{ type: 'user', clientMessageId: queued.id }];
  expect(reconcileQueuedMessages(recoverQueuedMessages([{ ...queued, status: 'dispatching' }]), history)).toEqual([]);
  let sends = 0;
  const state = dispatchHarness([queued], { getSession: async () => ({ workspace: '/work', busy: false, history }) },
    async () => { sends++; });
  state.flush('session'); await settle();
  expect(sends).toBe(0);
  expect(state.queuedMessagesRef.current.session).toEqual([]);
});

test('duplicate turn-end events do not dispatch twice; Stop during preparation preserves a draft', async () => {
  let resolve!: (value: any) => void;
  let sends = 0;
  const host = { getSession: () => new Promise(value => { resolve = value; }) };
  const state = dispatchHarness([queued], host, async () => { sends++; });
  state.flush('session'); state.flush('session');
  expect(state.queuedMessagesRef.current.session[0].status).toBe('dispatching');
  state.queueEpochs.current.set('session', 1);
  resolve({ workspace: '/work', busy: false });
  await settle();
  expect(sends).toBe(0);
  expect(state.queuedMessagesRef.current.session[0]).toMatchObject({ status: 'draft', files: queued.files });
});

test('failed transport preserves a reviewable draft instead of retrying automatically', async () => {
  let sends = 0;
  const state = dispatchHarness([queued], { getSession: async () => ({ workspace: '/work', busy: false }) }, async () => {
    sends++; throw new Error('response lost');
  });
  state.flush('session'); await settle(); await settle();
  expect(sends).toBe(1);
  expect(state.queuedMessagesRef.current.session[0]).toMatchObject({ status: 'draft', agentType: 'researcher' });
  expect(state.queuedMessagesRef.current.session[0].notice).toContain('未确认');
});

test('queue drains in order even when the turn-end event preceded send resolution', async () => {
  const calls: string[] = [];
  const state = dispatchHarness([queued, { ...queued, id: 'two', prompt: 'second' }],
    { getSession: async () => ({ workspace: '/work', busy: false }) }, async (_id: string, prompt: string) => { calls.push(prompt); });
  state.flush('session'); state.flush('session'); await settle(); await settle();
  expect(calls).toEqual(['review', 'second']);
  expect(state.queuedMessagesRef.current.session).toEqual([]);
});

function submitHarness() {
  const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const submitPrompt =');
  const code = new Bun.Transpiler({ loader: 'tsx' }).transformSync(
    source.slice(start, source.indexOf('  const handleSend =', start)) + '\nglobalThis.submit = submitPrompt;');
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const state: any = {
    React: { useCallback: (fn: any) => fn }, crypto,
    firstMessageTitle, setPendingFirstMessage: () => {},
    queueEpochs: { current: new Map() }, creatingSessionRef: { current: null },
    cleanIpcErrorMessage: (error: Error) => error.message,
    setPreparingNewSession: () => {}, setDraftAppIds: () => {}, setDraftAppServiceIds: () => {},
    input: 'original', appSelection: null, appDraftWorkspace: undefined, draftProject: null, homeComposerMode: 'chat', planDecisionBusy: false,
    activeSessionId: 'session', activeDetail: { workspace: '/work', agentMode: 'local', busy: false },
    activeSessionIdRef: { current: 'session' }, activeDetailRef: { current: { workspace: '/work' } },
    inputDraftRef: { current: '' }, composerAttachmentsRef: { current: [] },
    composerChoicesRef: { current: { skills: [], agent: null } }, appSelectionDraftRef: { current: null },
    draftAppIds: [], draftAppServiceIds: [], newSessionAgentMode: 'local',
    newSessionPermissionMode: 'default', selectedAssistant: null, createAndOpenSession: () => {},
    composerIsEmpty, queue: [], dispatchToSession: () => pending,
    setInput: (value: string) => { state.inputDraftRef.current = value; },
    setAppSelection: (value: any) => { state.appSelectionDraftRef.current = typeof value === 'function' ? value(state.appSelectionDraftRef.current) : value; },
    setComposerAttachments: (value: any) => { state.composerAttachmentsRef.current = value; },
    setComposerChoices: (value: any) => { state.composerChoicesRef.current = value; },
    handleComposerIntentChange: (value: string) => { state.intent = value; },
    updateQueue: (id: string, update: any) => { state.queueKey = id; state.queue = update(state.queue); },
  };
  runInNewContext(code, state);
  return { state, fail: () => reject(new Error('response lost')) };
}

test('late send failure preserves new attachments/choices and keeps the original as a separate draft', async () => {
  const { state, fail } = submitHarness();
  const sent = state.submit('boss', queued.files, undefined, queued.skills, queued.agent).catch(() => {});
  const currentFile = { name: 'new.txt', path: '/work/new.txt' };
  state.composerAttachmentsRef.current = [currentFile];
  state.composerChoicesRef.current = { skills: [{ name: 'new-skill' }], agent: null };
  fail(); await sent;
  expect(state.composerAttachmentsRef.current).toEqual([currentFile]);
  expect(state.composerChoicesRef.current.skills).toEqual([{ name: 'new-skill' }]);
  expect(state.queue[0]).toMatchObject({ prompt: 'original', intent: 'boss', files: queued.files,
    skills: queued.skills, agent: queued.agent, workspace: '/work', status: 'draft' });
});

test('busy App messages enter the queue synchronously so Stop/turn-end cannot miss them', async () => {
  const { state } = submitHarness();
  state.activeDetail.busy = true;
  // The callback closes over these binding values, not a preflight Promise.
  state.appSelection = queued.appSelection;
  const sent = state.submit('boss', queued.files, undefined, queued.skills, queued.agent);
  expect(state.queue).toHaveLength(1);
  expect(state.queue[0]).toMatchObject({ appSelection: queued.appSelection, status: 'queued' });
  state.queue = preserveQueuedMessages(state.queue);
  await sent;
  expect(state.queue).toHaveLength(1);
  expect(state.queue[0].status).toBe('draft');
});

test('failed sends restore intent into an empty composer but cannot restore into a changed workspace', async () => {
  for (const changedWorkspace of [false, true]) {
    const { state, fail } = submitHarness();
    const sent = state.submit('boss', queued.files, undefined, queued.skills, queued.agent).catch(() => {});
    if (changedWorkspace) state.activeDetailRef.current.workspace = '/other';
    fail(); await sent;
    if (changedWorkspace) {
      expect(state.inputDraftRef.current).toBe('');
      expect(state.queue[0].workspace).toBe('/work');
    } else {
      expect(state.inputDraftRef.current).toBe('original');
      expect(state.intent).toBe('boss');
      expect(state.composerChoicesRef.current.agent).toEqual(queued.agent);
    }
  }
});

test('session creation and attachment copying failures preserve the complete original draft', async () => {
  for (const stage of ['create', 'copy']) {
    const { state } = submitHarness();
    state.activeSessionId = null; state.activeSessionIdRef.current = null;
    state.activeDetail = null;
    state.createAndOpenSession = async () => {
      state.inputDraftRef.current = 'new typing';
      if (stage === 'create') throw new Error('cannot create');
      return 'created';
    };
    let sends = 0;
    state.dispatchToSession = async () => { sends++; };
    state.window = { agentDesktop: { copyFileToWorkspace: async () => ({ error: 'disk full' }) } };
    const files = [{ name: 'a.txt', path: '/input/a.txt' }];
    await expect(state.submit('boss', files, undefined, queued.skills, queued.agent)).rejects.toThrow();
    expect(sends).toBe(0);
    expect(state.inputDraftRef.current).toBe('new typing');
    expect(state.queueKey).toBe(stage === 'create' ? 'home' : 'created');
    expect(state.queue[0]).toMatchObject({ files, intent: 'boss', skills: queued.skills, agent: queued.agent, status: 'draft' });
    expect(state.queue[0].notice).toContain('发送准备失败');
  }
});

test('Stop during App preparation prevents a late direct send and preserves the snapshot', async () => {
  const { state } = submitHarness();
  let prepared!: () => void, sends = 0;
  state.appSelection = queued.appSelection;
  state.resourceContext = (value: any) => value;
  state.window = { agentDesktop: { prepareAppResource: () => new Promise<void>(resolve => { prepared = resolve; }) } };
  state.dispatchToSession = async () => { sends++; };
  const sent = state.submit('boss', queued.files, undefined, queued.skills, queued.agent);
  state.queueEpochs.current.set('session', 1);
  state.inputDraftRef.current = 'new typing';
  prepared(); await expect(sent).rejects.toThrow('发送已停止');
  expect(sends).toBe(0);
  expect(state.inputDraftRef.current).toBe('new typing');
  expect(state.queue[0]).toMatchObject({ appSelection: queued.appSelection, files: queued.files });
});

test('Stop while a new session copies attachments prevents its first model request', async () => {
  const { state } = submitHarness(); let sends = 0
  state.activeSessionId = null; state.activeSessionIdRef.current = null; state.activeDetail = null;
  state.createAndOpenSession = async () => 'created';
  state.window = { agentDesktop: { copyFileToWorkspace: async () => {
    state.queueEpochs.current.set('created', 1);
    return { path: '/created/a.txt' };
  } } };
  state.dispatchToSession = async () => { sends++; };
  await expect(state.submit('chat', [{ name: 'a.txt', path: '/input/a.txt' }])).rejects.toThrow('发送已停止');
  expect(sends).toBe(0);
  expect(state.queueKey).toBe('created');
  expect(state.queue[0].files).toEqual([{ name: 'a.txt', path: '/created/a.txt' }]);
});

test('annotation queue waits while busy and dispatches its structured context once idle', async () => {
  const annotation = { id: 'mark-1', resourceUri: 'moss-visualize://works/one', comment: '放大标题', selection: {
    kind: 'text' as const, selector: '#heading', text: '标题', nearbyText: '', rect: { x: 0, y: 0, width: 100, height: 20 },
  }, state: { rate: 8 } };
  let busy = true;
  const calls: any[][] = [];
  const state = dispatchHarness([{ id: annotation.id, prompt: '1 处标注', intent: 'chat', visualizationAnnotation: annotation }],
    { getSession: async () => ({ workspace: '/work', busy }) }, async (...args: any[]) => { calls.push(args); });
  state.flush('session'); await settle();
  expect(calls).toHaveLength(0);
  expect(state.queuedMessagesRef.current.session[0]).toMatchObject({ status: 'queued', visualizationAnnotation: annotation });
  busy = false; state.flush('session'); state.flush('session'); await settle();
  expect(calls).toHaveLength(1); expect(calls[0][7]).toEqual(annotation);
  expect(state.queuedMessagesRef.current.session).toEqual([]);
});
