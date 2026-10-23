import { expect, test } from 'bun:test';
import { createSessionInteractions } from '../src/session-interactions.mjs';
import { preserveAppTaskHistory } from '../src/apps/app-task-session.mjs';
import { latestSessionInteractions, composerDelivery } from '../src/renderer-react/lib/session-interactions';
import { buildMainChatRenderMessagesFromHistory } from '../src/renderer-react/lib/agent-transcript';
import { indexHistoryTurns } from '../src/shared/turn-identity.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(runtime: any, timeoutMs = 120000) {
  const record: any = { id: 'a', runtime, history: [], busy: true, activeInputTurnId: 'main' };
  const other: any = { id: 'b', runtime, history: [], busy: true };
  const service = createSessionInteractions({ getSessionRecord: (id: string) => id === 'a' ? record : other,
    publish: (record: any, event: any) => record.history.push(event), timeoutMs });
  return { service, record, other };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('steering has a stable receipt, is not replayed, and reports cancellation without losing text', () => {
  let calls = 0, consumed: (status: string) => void = () => {};
  const { service, record, other } = fixture({ steer: (_: string, __: string, cb: any) => { calls++; consumed = cb; return true; } });
  const input = { sessionId: 'a', action: 'steer', id: 'input-1', prompt: '保留要求' };
  expect(service.handle(input).status).toBe('accepted');
  expect(service.handle(input).status).toBe('accepted');
  expect(calls).toBe(1); expect(other.history).toEqual([]);
  expect(() => service.handle({ ...input, prompt: 'changed' })).toThrow();
  consumed('cancelled');
  expect(latestSessionInteractions(record.history)[0]).toMatchObject({ status: 'cancelled', prompt: input.prompt, turnId: 'main' });
});

test('late steering explicitly declines acceptance so automatic continuation is safe', () => {
  const { service, record } = fixture({ steer: () => false });
  expect(service.handle({ sessionId: 'a', action: 'steer', id: 'late', prompt: 'late' }).status).toBe('not_running');
  expect(record.history).toEqual([]);
});

test('side cancellation does not stop the main task and a late answer cannot overwrite it', async () => {
  let resolve: (value: any) => void = () => {};
  let signal: AbortSignal;
  const { service, record } = fixture({ askSideQuestion: (_: string, s: AbortSignal) => { signal = s; return new Promise(r => { resolve = r; }); } });
  service.handle({ sessionId: 'a', action: 'side_question', id: 'side', prompt: 'why?' });
  await tick();
  expect(() => service.handle({ sessionId: 'a', action: 'side_question', id: 'second', prompt: 'another' })).toThrow();
  service.handle({ sessionId: 'a', action: 'cancel_side', id: 'side' });
  expect(signal!.aborted).toBe(true); expect(record.busy).toBe(true);
  resolve({ response: 'too late', status: 'completed' }); await tick();
  expect(latestSessionInteractions(record.history)[0].status).toBe('cancelled');
});

test('side timeout and failure are explicit; deleted sessions receive no late answer', async () => {
  const timeout = fixture({ askSideQuestion: () => new Promise(() => {}) }, 5);
  timeout.service.handle({ sessionId: 'a', action: 'side_question', id: 'timeout', prompt: 'why?' });
  await new Promise(r => setTimeout(r, 15));
  expect(latestSessionInteractions(timeout.record.history)[0].status).toBe('timeout');
  const failed = fixture({ askSideQuestion: async () => { throw new Error('fixture failure'); } });
  failed.service.handle({ sessionId: 'a', action: 'side_question', id: 'failed', prompt: 'why?' }); await tick();
  expect(latestSessionInteractions(failed.record.history)[0]).toMatchObject({ status: 'failed', error: 'fixture failure' });
  const removed = fixture({ askSideQuestion: async () => ({ response: 'answer' }) });
  removed.service.handle({ sessionId: 'a', action: 'side_question', id: 'removed', prompt: 'why?' }); removed.record.deleted = true; await tick();
  expect(removed.record.history).toHaveLength(1);
});

test('Host interaction history survives transcript refresh and does not enter main assistant output', () => {
  const start = { type: 'user', uuid: 'main', prompt: 'write', timestamp: 1 };
  const steering = { type: 'session_interaction', kind: 'steer', id: 'extra', turnId: 'main', uuid: 'receipt', status: 'consumed', prompt: 'extra', timestamp: 2 };
  const extra = { type: 'user', uuid: 'extra', prompt: 'extra', timestamp: 3 };
  const answer = { type: 'assistant', uuid: 'answer', message: { content: [{ type: 'text', text: 'done' }, { type: 'tool_use', id: 'tool', name: 'Write', input: {} }] }, timestamp: 4 };
  const side = { type: 'session_interaction', kind: 'side_question', id: 'side', uuid: 'side-receipt', prompt: 'why', response: 'side only', status: 'completed', timestamp: 5 };
  const history = preserveAppTaskHistory([start, steering, extra, answer, side], [start, extra, answer]);
  expect(latestSessionInteractions(history)).toHaveLength(2);
  const rendered = buildMainChatRenderMessagesFromHistory(history);
  expect(JSON.stringify(rendered)).not.toContain('side only');
  expect(rendered.filter(item => item.type !== 'system').every(item => !item.turnId || item.turnId === 'main')).toBe(true);
  const index = indexHistoryTurns(history);
  expect([...index.turns.keys()]).toEqual(['main']);
  expect([...index.toolOwners.get('tool')]).toEqual(['main']);
});

test('composer sends everything to the current task and reserves only /btw for side questions', () => {
  expect(composerDelivery({ loading: true, value: '补充' })).toBe('steer');
  expect(composerDelivery({ loading: true, value: '' })).toBe('steer');
  expect(composerDelivery({ loading: false, value: '问题' })).toBe('send');
  expect(composerDelivery({ loading: true, value: '/btw 解释一下' })).toBe('side_question');
});

test('restored in-flight interactions become unknown without starting a replacement request', () => {
  const { service, record } = fixture({});
  record.busy = false;
  record.history = [{ type: 'session_interaction', kind: 'side_question', id: 'old', prompt: 'question', status: 'running' }];
  expect(service.handle({ sessionId: 'a', action: 'inspect', id: 'old' }).status).toBe('unknown');
  expect(service.handle({ sessionId: 'a', action: 'side_question', id: 'old', prompt: 'question' }).status).toBe('unknown');
});

test('actual composer handler reuses uncertain request identity; side send never clears the main draft', async () => {
  const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
  const segment = source.slice(source.indexOf('  const interactionRequests ='), source.indexOf('  const handleApprovePlan ='));
  const ids: string[] = [], cleared: string[] = [];
  let rejectFirst = true, resolve: (value: any) => void = () => {};
  const context: any = { React: { useRef: (current: any) => ({ current }), useCallback: (fn: any) => fn }, crypto,
    activeSessionId: 'a', composerIntent: 'chat', activeDetail: { composerIntent: 'chat' },
    queueEpochs: { current: new Map() }, updateQueue: () => {},
    activeSessionIdRef: { current: 'a' }, inputDraftRef: { current: 'same prompt' }, setInput: (value: string) => cleared.push(value),
    window: { agentDesktop: { sessionInteraction: async ({ id }: any) => {
      ids.push(id); if (rejectFirst) { rejectFirst = false; throw new Error('response lost'); }
      return new Promise(r => { resolve = r; });
    } } },
  };
  vm.runInNewContext(new Bun.Transpiler({ loader: 'tsx' }).transformSync(segment) + '\nglobalThis.submitInteraction = handleSessionInteraction;', context);
  await expect(context.submitInteraction('steer', 'same prompt')).rejects.toThrow('response lost');
  const retry = context.submitInteraction('steer', 'same prompt'); context.inputDraftRef.current = 'newer typing';
  resolve({ status: 'accepted', id: ids.at(-1) }); await retry;
  expect(ids[0]).toBe(ids[1]); expect(cleared).toEqual([]);
  const next = context.submitInteraction('side_question', 'new question');
  resolve({ status: 'running', id: ids.at(-1) }); await next;
  expect(cleared).toEqual([]);
});

test('preparing attachments is deduplicated and cannot insert into a replacement turn', async () => {
  let ready!: (text: string) => void, calls = 0;
  const record: any = { id: 'a', busy: true, activeInputTurnId: 'main', history: [], runtime: { steer: () => { calls++; return true; } } };
  const service = createSessionInteractions({ getSessionRecord: () => record, publish: (record: any, event: any) => record.history.push(event),
    prepareSteer: () => new Promise<string>(resolve => { ready = resolve; }) });
  const input = { sessionId: 'a', action: 'steer', id: 'attachment', prompt: 'read', details: { intent: 'chat', files: [{ name: 'x.txt', path: '/x.txt' }] } };
  const first = service.handle(input), duplicate = service.handle(input);
  expect(first).toBe(duplicate);
  await tick(); record.activeInputTurnId = 'another-turn'; ready('prepared attachment');
  expect((await first).status).toBe('not_running'); expect(calls).toBe(0); expect(record.history).toEqual([]);
});

test('prepared supplement keeps the original rich payload for cancellation and renders only user-facing text', async () => {
  let seen = '', state!: (status: string) => void;
  const record: any = { id: 'a', busy: true, activeInputTurnId: 'main', history: [], runtime: { steer: (text: string, _id: string, cb: any) => { seen = text; state = cb; return true; } } };
  const service = createSessionInteractions({ getSessionRecord: () => record, publish: (record: any, event: any) => record.history.push(event), prepareSteer: async () => 'HIDDEN_SKILL_INSTRUCTION\nread /x.txt' });
  const details = { intent: 'chat', files: [{ name: 'x.txt', path: '/x.txt' }], skills: [{ name: 'review' }] };
  expect((await service.handle({ sessionId: 'a', action: 'steer', id: 'rich', prompt: '参考附件继续', details })).status).toBe('accepted');
  expect(seen).toContain('HIDDEN_SKILL_INSTRUCTION'); state('consumed');
  record.history.push({ type: 'user', uuid: 'rich', message: { role: 'user', content: seen }, timestamp: Date.now() });
  const before = JSON.stringify(record.history);
  const rendered = buildMainChatRenderMessagesFromHistory(record.history);
  expect(JSON.stringify(rendered)).not.toContain('HIDDEN_SKILL_INSTRUCTION');
  expect(JSON.stringify(rendered)).toContain('/x.txt'); expect(JSON.stringify(rendered)).toContain('参考附件继续');
  expect(JSON.stringify(record.history)).toBe(before);
  state('cancelled'); expect(latestSessionInteractions(record.history)[0].details).toEqual(details);
});

test('actual composer automatically schedules a declined supplement with all resources, but never replays unknown receipt', async () => {
  const source = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
  const segment = source.slice(source.indexOf('  const interactionRequests ='), source.indexOf('  const handleApprovePlan ='));
  let status = 'deferred', queue: any[] = [], flushed = 0;
  const context: any = { React: { useRef: (current: any) => ({ current }), useCallback: (fn: any) => fn }, crypto,
    activeSessionId: 'a', composerIntent: 'boss', activeDetail: { workspace: '/work' }, queueEpochs: { current: new Map() },
    activeSessionIdRef: { current: 'a' }, inputDraftRef: { current: 'keep' }, setInput: () => {},
    updateQueue: (_id: string, fn: any) => { queue = fn(queue); }, flushQueuedMessagesRef: { current: () => { flushed++; } },
    window: { agentDesktop: { sessionInteraction: async () => ({ status }), getSession: async () => ({ busy: false }) } } };
  vm.runInNewContext(new Bun.Transpiler({ loader: 'tsx' }).transformSync(segment) + '\nglobalThis.submitInteraction = handleSessionInteraction;', context);
  const details = { intent: 'boss', files: [{ name: 'a.txt', path: '/work/a.txt' }], skills: [{ name: 'review' }], appSelection: { providerId: 'app/flow' } };
  await context.submitInteraction('steer', 'continue', details); await tick();
  expect(queue).toHaveLength(1); expect(queue[0]).toMatchObject({ ...details, prompt: 'continue', status: 'queued' }); expect(flushed).toBe(1);
  status = 'unknown'; await expect(context.submitInteraction('steer', 'uncertain', details)).rejects.toThrow('未确认');
  expect(queue).toHaveLength(1); expect(flushed).toBe(1);
});

test('startup steering declines explicitly without side effects so the same message can be scheduled automatically', () => {
  const { service, record } = fixture(null);
  expect(service.handle({ sessionId: 'a', action: 'steer', id: 'startup', prompt: 'continue' })).toEqual({ status: 'not_running', id: 'startup' });
  expect(record.history).toEqual([]);
  expect(() => service.handle({ sessionId: 'a', action: 'side_question', id: 'cold-side', prompt: 'why' })).toThrow('尚未建立模型上下文');
});

test('side question restores an idle runtime and reports restore failures as a receipt', async () => {
  const { record } = fixture(null);
  let restores = 0;
  record.underlyingSessionId = 'saved-session';
  const service = createSessionInteractions({
    getSessionRecord: () => record,
    publish: (target: any, event: any) => target.history.push(event),
    ensureRuntime: async () => {
      restores += 1;
      record.runtime = { askSideQuestion: async () => ({ status: 'completed', response: '恢复后的回答' }) };
      return record.runtime;
    },
  });
  expect(await service.handle({ sessionId: 'a', action: 'side_question', id: 'restored', prompt: 'why' })).toEqual({ status: 'running', id: 'restored' });
  await tick();
  expect(restores).toBe(1);
  expect(latestSessionInteractions(record.history)[0]).toMatchObject({ status: 'completed', response: '恢复后的回答' });

  const failed = fixture(null);
  const failedService = createSessionInteractions({
    getSessionRecord: () => failed.record,
    publish: (target: any, event: any) => target.history.push(event),
    ensureRuntime: async () => { throw new Error('resume failed'); },
  });
  expect(await failedService.handle({ sessionId: 'a', action: 'side_question', id: 'restore-failed', prompt: 'why' })).toEqual({ status: 'running', id: 'restore-failed' });
  await tick();
  expect(latestSessionInteractions(failed.record.history)[0]).toMatchObject({ status: 'failed', error: 'resume failed' });
});

test('side questions acknowledge runtime restoration immediately and can cancel it without a late model call', async () => {
  const { record } = fixture(null);
  let restore!: (runtime: any) => void, signal!: AbortSignal, restores = 0, questions = 0;
  const service = createSessionInteractions({
    getSessionRecord: () => record,
    publish: (target: any, event: any) => target.history.push(event),
    ensureRuntime: (_record: any, value: AbortSignal) => {
      signal = value; restores++;
      return new Promise(resolve => { restore = resolve; });
    },
  });
  const request = { sessionId: 'a', action: 'side_question', id: 'restoring', prompt: '进展呢' };
  expect(service.handle(request)).toEqual({ status: 'running', id: request.id });
  expect(latestSessionInteractions(record.history)[0].status).toBe('running');
  expect(service.handle(request).status).toBe('running');
  expect(service.handle({ sessionId: 'a', action: 'inspect', id: request.id }).status).toBe('running');
  expect(() => service.handle({ ...request, prompt: 'different' })).toThrow('同一消息标识');
  expect(() => service.handle({ ...request, id: 'another' })).toThrow('本会话已有侧问');
  await tick();
  expect(restores).toBe(1);
  expect(service.handle({ sessionId: 'a', action: 'cancel_side', id: request.id }).status).toBe('cancelled');
  expect(signal.aborted).toBe(true);
  restore({ askSideQuestion: () => { questions++; return { response: 'late' }; } });
  await tick();
  expect(questions).toBe(0);
  expect(latestSessionInteractions(record.history)[0].status).toBe('cancelled');
  expect(record.busy).toBe(true);
});

test('side question timeout includes restoration and a late restore cannot submit a model request', async () => {
  const { record } = fixture(null);
  let restore!: (runtime: any) => void, questions = 0;
  const service = createSessionInteractions({
    getSessionRecord: () => record,
    publish: (target: any, event: any) => target.history.push(event),
    timeoutMs: 5,
    ensureRuntime: () => new Promise(resolve => { restore = resolve; }),
  });
  service.handle({ sessionId: 'a', action: 'side_question', id: 'timeout', prompt: '进展呢' });
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(latestSessionInteractions(record.history)[0].status).toBe('timeout');
  restore({ askSideQuestion: () => { questions++; return { response: 'late' }; } });
  await tick();
  expect(questions).toBe(0);
  expect(latestSessionInteractions(record.history)[0].status).toBe('timeout');
});
