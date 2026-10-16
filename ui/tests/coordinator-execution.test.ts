import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../../src/tools/AgentTool/AgentTool';
import { runAsyncAgentLifecycle } from '../../src/tools/AgentTool/agentToolUtils';
import { AbortError } from '../../src/utils/errors';
import { createAssistantMessage } from '../../src/utils/messages';
import { clearCommandQueue, getCommandQueue } from '../../src/utils/messageQueueManager';
import { runWithSessionIdContext } from '../../src/utils/sessionIdContext';
import { asSessionId } from '../../src/types/ids';
import { flushSessionStorage } from '../../src/utils/sessionStorage';

let engineDir: string;
const scoped = <T>(run: () => T) => runWithSessionIdContext(asSessionId('coordinator-lifecycle-test'), engineDir, run);
beforeEach(async () => { engineDir = await mkdtemp(join(tmpdir(), 'moss-lifecycle-test-')); });
afterEach(async () => { clearCommandQueue(); await scoped(flushSessionStorage); await rm(engineDir, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const controller = new AbortController();
  let state: any = { speculation: { status: 'idle' }, tasks: { worker: {
    id: 'worker', agentId: 'worker', type: 'local_agent', status: 'running',
    executionId: 'old', abortController: controller, notified: false,
  } } };
  const rootSetAppState = (update: Function) => { state = update(state); };
  return {
    task: () => state.tasks.worker,
    replace: () => { state = { ...state, tasks: { worker: {
      ...state.tasks.worker, executionId: 'new', status: 'running',
      abortController: new AbortController(), notified: false,
    } } }; },
    start: (makeStream: any, getWorktreeResult: any = async () => ({})) => scoped(() => runAsyncAgentLifecycle({
      taskId: 'worker', abortController: controller, makeStream,
      metadata: { prompt: 'Check races', resolvedAgentModel: 'test', isBuiltInAgent: true, startTime: Date.now(), agentType: 'general-purpose', isAsync: true },
      description: 'Check races', rootSetAppState,
      toolUseContext: { getAppState: () => state, options: { tools: [] } } as any,
      agentIdForCleanup: 'worker', enableSummarization: false, getWorktreeResult,
    })),
  };
}

for (const terminal of ['abort', 'failure', 'completed']) {
  test(`late ${terminal} from an older execution cannot change a resumed worker`, async () => {
    const f = fixture();
    const gate = deferred();
    const done = f.start(async function* () {
      await gate.promise;
      if (terminal === 'abort') throw new AbortError();
      if (terminal === 'failure') throw new Error('old request failed');
      yield createAssistantMessage({ content: 'Old result' });
    });
    const settled = f.task().executionSettled;
    expect(settled).toBeInstanceOf(Promise);
    f.replace();
    gate.resolve();
    await done;
    await settled;
    expect(f.task().status).toBe('running');
    expect(f.task().executionId).toBe('new');
    expect(f.task().notified).toBe(false);
    expect(f.task().abortController.signal.aborted).toBe(false);
    expect(f.task().progress).toBeUndefined();
  });
}

test('resume can wait for query cleanup without waiting for optional worktree cleanup', async () => {
  const f = fixture();
  const cleanup = deferred();
  const enteredCleanup = deferred();
  const done = f.start(async function* () {
    yield createAssistantMessage({ content: 'Finished' });
  }, async () => {
    enteredCleanup.resolve();
    await cleanup.promise;
    return {};
  });
  try {
    await enteredCleanup.promise;
    await f.task().executionSettled;
    expect(f.task().status).toBe('completed');
    f.replace();
  } finally {
    cleanup.resolve();
    await done;
  }
  expect(f.task().status).toBe('running');
  expect(f.task().notified).toBe(false);
});

test('optional cleanup errors cannot turn a successful worker receipt into a failure', async () => {
  const f = fixture();
  clearCommandQueue();
  try {
    await f.start(async function* () {
      yield createAssistantMessage({ content: 'Correct result' });
    }, async () => { throw new Error('Git cleanup failed'); });
    expect(f.task().status).toBe('completed');
    expect(f.task().notified).toBe(true);
    const receipt = getCommandQueue().find(item => item.mode === 'task-notification');
    expect(receipt?.value).toContain('<status>completed</status>');
    expect(receipt?.value).toContain('Correct result');
  } finally { clearCommandQueue(); }
});
