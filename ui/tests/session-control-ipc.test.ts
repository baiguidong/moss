import { describe, expect, it } from 'bun:test';
import { registerSessionControlIpc } from '../src/session-control-ipc.mjs';
import { loadDesktopPreload } from './helpers/desktop-preload';

function fixture() {
  const handlers = new Map<string, Function>();
  const actions: string[] = [];
  const pending = { requestId: 'q1', sessionId: 's1', input: { questions: ['choose'] }, appDecisionId: null as string | null };
  const pendingQuestionRequests = new Map([['q1', pending]]);
  const decisions: unknown[] = [];
  const record = {
    id: 's1', title: 'Task', projectId: 'p1' as string | null, parentSessionId: null as string | null,
    runtime: {
      abort: async () => { actions.push('abort'); },
      getAppState: () => ({ tasks: {
        running: { id: 'workflow1', type: 'local_workflow', status: 'running' },
        finished: { id: 'workflow2', type: 'local_workflow', status: 'completed' },
        agent: { id: 'agent1', type: 'local_agent', status: 'running' },
      } }),
      stopTask: async (id: string) => { actions.push(`stop:${id}`); },
    },
  };
  const deps = {
    ipcMain: { handle: (channel: string, handler: Function) => handlers.set(channel, handler) },
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
    isPlainObject: (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value),
    buildAskUserQuestionUpdatedInput: (input: object, answers: object, annotations: object) => ({ ...input, answers, annotations }),
  };
  registerSessionControlIpc(deps);
  const { api } = loadDesktopPreload((channel, payload) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Unexpected channel: ${channel}`);
    return handler({}, payload);
  });
  return { api, deps, actions, decisions, pending, record };
}

describe('Desktop session controls through preload and IPC', () => {
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
      allowed: true, source: 'desktop', resolutionAnswers: request.answers,
      permissionDecision: { behavior: 'allow', updatedInput: { ...pending.input, answers: request.answers, annotations: request.annotations } },
    } }]);
    await expect(api.answerQuestion(request)).rejects.toThrow('no longer pending');
    expect(await api.rejectQuestion(request)).toEqual({ ok: true });
    expect(decisions).toHaveLength(1);
  });

  it('reports a rejected runtime decision and accepts durable app decisions', async () => {
    const { api, deps, pending } = fixture();
    deps.respondToPendingQuestionRequest = async () => ({ behavior: 'deny', message: 'expired' });
    // Re-register with the alternate domain implementation.
    registerSessionControlIpc(deps);
    await expect(api.answerQuestion({ requestId: 'q1', sessionId: 's1', answers: {} })).rejects.toThrow('expired');
    pending.appDecisionId = 'durable-decision';
    expect(await api.answerQuestion({ requestId: 'q1', sessionId: 's1', answers: {} })).toEqual({ ok: true });
  });

  it('forwards a denial with its trimmed reason', async () => {
    const { api, decisions } = fixture();
    expect(await api.rejectQuestion({ requestId: 'q1', sessionId: 's1', message: '  no thanks  ' })).toEqual({ ok: true });
    expect(decisions[0]).toMatchObject({ decision: { allowed: false, permissionDecision: { behavior: 'deny', message: 'no thanks' } } });
  });

  it('aborts the runtime before stopping active workflows and clearing approvals', async () => {
    const { api, actions, deps } = fixture();
    expect(await api.abort({ sessionId: 's1' })).toEqual({ ok: true });
    expect(actions).toEqual(['abort', 'stop:workflow1', 'project:stopped', 'project:event', 'reject:s1', 'persist:true']);
    expect(deps.projectTaskCancellationRequests.has('s1')).toBe(true);
    expect(deps.pendingQuestionRequests.size).toBe(0);
  });

  it('keeps child-session cancellation separate from the project root', async () => {
    const { api, actions, deps, record } = fixture();
    record.parentSessionId = 'parent';
    await api.abort({ sessionId: 's1' });
    expect(actions).toEqual(['abort', 'stop:workflow1', 'reject:s1', 'persist:true']);
    expect(deps.projectTaskCancellationRequests.size).toBe(0);
  });

  it('surfaces abort failures instead of claiming the task stopped', async () => {
    const { api, actions, record, deps } = fixture();
    record.runtime.abort = async () => { throw new Error('interrupt failed'); };
    await expect(api.abort({ sessionId: 's1' })).rejects.toThrow('interrupt failed');
    expect(actions).toEqual([]);
    expect(deps.pendingQuestionRequests.has('q1')).toBe(true);
  });
});
