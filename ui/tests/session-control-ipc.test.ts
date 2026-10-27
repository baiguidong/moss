import { describe, expect, it } from 'bun:test';
import { registerSessionControlIpc } from '../src/session-control-ipc.mjs';
import { loadDesktopPreload } from './helpers/desktop-preload';

function fixture(context = {}) {
  const handlers = new Map<string, Function>();
  const actions: string[] = [];
  const pending = { requestId: 'q1', sessionId: 's1', input: { questions: ['choose'] } };
  const pendingQuestionRequests = new Map([['q1', pending]]);
  const decisions: unknown[] = [];
  const record = {
    id: 's1', title: 'Task', projectId: 'p1' as string | null, parentSessionId: null as string | null,
    runtime: {
      abort: async () => { actions.push('abort'); },
    },
  };
  const deps = {
    ipcMain: { handle: (channel: string, handler: Function) => handlers.set(channel, handler) },
    stopAppTasks: async (id: string) => { actions.push(`apps:${id}`); },
    shutdownAgentTeam: async () => {},
    getSessionRecord: (id: string) => { if (id !== record.id) throw new Error('Unknown session'); return record; },
    projectTaskCancellationRequests: new Set<string>(),
    updateProjectRootTaskLifecycle: async () => { actions.push('project:stopped'); },
    appendProjectEvent: async () => { actions.push('project:event'); },
    rejectPendingQuestionRequestsForSession: async (id: string) => { actions.push(`reject:${id}`); pendingQuestionRequests.clear(); },
    schedulePersistSession: (_record: unknown, immediate: boolean) => { actions.push(`persist:${immediate}`); },
    pendingQuestionRequests,
    respondToPendingQuestionRequest: async (request: typeof pending, decision: any) => {
      decisions.push({ request, decision });
      pendingQuestionRequests.delete(request.requestId);
      return decision.permissionDecision;
    },
    buildAskUserQuestionUpdatedInput: (input: object, answers: object, annotations: object) => ({ ...input, answers, annotations }),
  };
  registerSessionControlIpc(deps);
  const { api } = loadDesktopPreload((channel, payload) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Unexpected channel: ${channel}`);
    return handler(context, payload);
  });
  return { api, deps, actions, decisions, pending, record };
}

describe('Desktop session controls through preload and IPC', () => {
  it('uses the same session answers and rejections over the Web transport', async () => {
    const allowed = fixture({ transport: 'web' });
    await allowed.api.answerQuestion({ requestId: 'q1', sessionId: 's1', answers: {} });
    expect(allowed.decisions[0]).toMatchObject({ decision: { permissionDecision: { behavior: 'allow' } } });
    const denied = fixture({ transport: 'web' });
    await denied.api.rejectQuestion({ requestId: 'q1', sessionId: 's1' });
    expect(denied.decisions[0]).toMatchObject({ decision: { permissionDecision: { behavior: 'deny' } } });
  });
  it('rejects cross-session approvals and rejections without resolving the request', async () => {
    const { api, deps, decisions } = fixture();
    await expect(api.answerQuestion({ requestId: 'q1', sessionId: 'other', answers: {} })).rejects.toThrow('does not belong');
    await expect(api.rejectQuestion({ requestId: 'q1', sessionId: 'other' })).rejects.toThrow('does not belong');
    expect(decisions).toHaveLength(0);
    expect(deps.pendingQuestionRequests.has('q1')).toBe(true);
  });

  it('forwards answers and annotations once, then rejects stale approvals', async () => {
    const { api, decisions, pending } = fixture();
    const request = { requestId: 'q1', sessionId: 's1', answers: { choose: 'yes' }, annotations: { choose: { notes: 'approved' } } };
    expect(await api.answerQuestion(request)).toEqual({ ok: true });
    expect(decisions).toEqual([{ request: pending, decision: {
      permissionDecision: { behavior: 'allow', updatedInput: { ...pending.input, answers: request.answers, annotations: request.annotations } },
    } }]);
    await expect(api.answerQuestion(request)).rejects.toThrow('no longer pending');
    expect(await api.rejectQuestion(request)).toEqual({ ok: true });
    expect(decisions).toHaveLength(1);
  });

  it('reports a rejected runtime decision', async () => {
    const { api, deps } = fixture();
    deps.respondToPendingQuestionRequest = async () => ({ behavior: 'deny', message: 'expired' });
    // Re-register with the alternate domain implementation.
    registerSessionControlIpc(deps);
    await expect(api.answerQuestion({ requestId: 'q1', sessionId: 's1', answers: {} })).rejects.toThrow('expired');
  });

  it('forwards a denial with its trimmed reason', async () => {
    const { api, decisions } = fixture();
    expect(await api.rejectQuestion({ requestId: 'q1', sessionId: 's1', message: '  no thanks  ' })).toEqual({ ok: true });
    expect(decisions[0]).toMatchObject({ decision: { permissionDecision: { behavior: 'deny', message: 'no thanks' } } });
  });

  it('stops App tasks and the runtime before clearing approvals', async () => {
    const { api, actions, deps } = fixture();
    expect(await api.abort({ sessionId: 's1' })).toEqual({ ok: true });
    expect(actions).toEqual(['abort', 'apps:s1', 'project:stopped', 'project:event', 'reject:s1', 'persist:true']);
    expect(deps.projectTaskCancellationRequests.has('s1')).toBe(true);
    expect(deps.pendingQuestionRequests.size).toBe(0);
  });

  it('keeps child-session cancellation separate from the project root', async () => {
    const { api, actions, deps, record } = fixture();
    record.parentSessionId = 'parent';
    await api.abort({ sessionId: 's1' });
    expect(actions).toEqual(['abort', 'apps:s1', 'reject:s1', 'persist:true']);
    expect(deps.projectTaskCancellationRequests.size).toBe(0);
  });

  it('keeps the project task alive when Stop is only moving on to queued messages', async () => {
    const { api, actions, deps } = fixture();
    registerSessionControlIpc({ ...deps, shutdownAgentTeam: async (id: string) => { actions.push(`team:${id}`); } });
    await api.abort({ sessionId: 's1', terminateSession: false });
    expect(actions).toEqual(['abort', 'apps:s1', 'team:s1', 'reject:s1', 'persist:true']);
    expect(deps.projectTaskCancellationRequests.has('s1')).toBe(false);
  });

  it('surfaces abort failures instead of claiming the task stopped', async () => {
    const { api, actions, record, deps } = fixture();
    record.runtime.abort = async () => { throw new Error('interrupt failed'); };
    await expect(api.abort({ sessionId: 's1' })).rejects.toThrow('interrupt failed');
    expect(actions).toEqual(['apps:s1']);
    expect(deps.pendingQuestionRequests.has('q1')).toBe(true);
  });

  it('cancels preparation before asynchronous cleanup even when no runtime exists', async () => {
    const { api, deps, record } = fixture();
    record.runtime = null as any;
    const controller = new AbortController();
    let release!: () => void;
    registerSessionControlIpc({ ...deps,
      abortPendingSends: () => controller.abort(),
      stopComputerUse: () => new Promise<void>(resolve => { release = resolve; }),
    });
    const stopping = api.abort({ sessionId: 's1' });
    expect(controller.signal.aborted).toBe(true);
    release();
    expect(await stopping).toEqual({ ok: true });
  });

  it('starts the runtime interrupt while host cleanup is still blocked', async () => {
    const { api, deps, record } = fixture();
    let release!: () => void;
    let cleanupStarted = false;
    let abortStarted = false;
    record.runtime.abort = async () => { abortStarted = true; };
    registerSessionControlIpc({ ...deps,
      stopComputerUse: async () => {
        cleanupStarted = true;
        await new Promise<void>(resolve => { release = resolve; });
      },
    });
    const stopping = api.abort({ sessionId: 's1' });
    await new Promise(resolve => queueMicrotask(resolve));
    expect(cleanupStarted).toBe(true);
    expect(abortStarted).toBe(true);
    let settled = false;
    void stopping.then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    await expect(stopping).resolves.toEqual({ ok: true });
  });
});
