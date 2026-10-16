import { expect, test } from 'bun:test';
import '../../src/tools/AgentTool/AgentTool';
import { closeAgentMessageQueue, drainPendingMessages, queuePendingMessage } from '../../src/tasks/LocalAgentTask/LocalAgentTask';
import { SendMessageTool } from '../../src/tools/SendMessageTool/SendMessageTool';

function fixture() {
  let state: any = { agentNameRegistry: new Map([['worker', 'worker']]), toolPermissionContext: { mode: 'default' },
    tasks: { worker: { type: 'local_agent', status: 'running', pendingMessages: [] } } };
  const set = (update: any) => { state = update(state); };
  return { set, task: () => state.tasks.worker, get: () => state };
}

test('a query cannot close its inbox while accepted messages remain', () => {
  const f = fixture();
  expect(queuePendingMessage('worker', 'A', f.set)).toBe(true);
  expect(drainPendingMessages('worker', f.set, true)).toEqual(['A']);
  expect(f.task().isMessageQueueClosed).not.toBe(true);
  expect(queuePendingMessage('worker', 'B', f.set)).toBe(true);
  expect(drainPendingMessages('worker', f.set, true)).toEqual(['B']);
  expect(drainPendingMessages('worker', f.set, true)).toEqual([]);
  expect(f.task().isMessageQueueClosed).toBe(true);
  expect(queuePendingMessage('worker', 'too late', f.set)).toBe(false);
  expect(f.task().pendingMessages).toEqual([]);
  // Status remains running until metadata and MCP cleanup have settled.
  expect(f.task().status).toBe('running');
});

test('all terminal paths close message admission before asynchronous cleanup', () => {
  const f = fixture();
  closeAgentMessageQueue('worker', f.set);
  expect(queuePendingMessage('worker', 'late', f.set)).toBe(false);
  expect(queuePendingMessage('missing', 'late', f.set)).toBe(false);
  expect(f.task().pendingMessages).toEqual([]);
});

test('killed workers reject new messages even before the query closes', () => {
  const f = fixture();
  f.task().status = 'killed';
  expect(queuePendingMessage('worker', 'late', f.set)).toBe(false);
  expect(f.task().pendingMessages).toEqual([]);
});

test('SendMessage waits for a closing execution instead of claiming queued delivery', async () => {
  const f = fixture();
  closeAgentMessageQueue('worker', f.set);
  let reject!: (error: Error) => void;
  f.task().executionSettled = new Promise((_, fail) => { reject = fail; });
  let settled = false;
  const result = SendMessageTool.call(
    { to: 'worker', message: 'late instruction', summary: 'Continue' },
    { getAppState: f.get, setAppState: f.set, abortController: new AbortController() } as any,
    (() => {}) as any, undefined as any,
  ).then(result => { settled = true; return result; });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(f.task().pendingMessages).toEqual([]);
  reject(new Error('previous execution could not settle'));
  const response = await result;
  expect(response.data.success).toBe(false);
  expect(response.data.message).toContain('previous execution could not settle');
});
