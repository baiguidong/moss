import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as permissionPolicy from '../src/tool-permission-policy.mjs';
import { normalizePermissionMode } from '../src/permission-modes.mjs';
import { deriveProjectSessionTaskStatus } from '../src/shared/project-session-task.mjs';
import { normalizeProjectId } from '../src/shared/project-normalization.mjs';
import { normalizeStringList } from '../src/shared/string-list.mjs';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
function section(start: string, end: string) {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing Main section: ${start}`);
  return main.slice(from, to);
}

// Exercise the real Main handlers without starting Electron or an agent model.
function fixture(projectId: string | null = 'project') {
  const record = {
    id: 'session', projectId, permissionMode: 'default',
    projectTaskStatus: 'working', busy: true, title: 'Task',
  };
  const project = { id: 'project', archivedAt: null as number | null, decisionPolicy: { mode: 'auto_all' } };
  const pending = new Map<string, any>();
  const events: Array<{ channel: string; payload: any }> = [];
  let requestNumber = 0;
  const api = runInNewContext(`
    ${section('function isPlainObject(', 'async function emitAppsChanged(')}
    ${section('function projectTaskStatusForSession(', 'async function getProjectCoordinatorTask(')}
    ({ requestToolPermission, respondToPendingQuestionRequest,
       rejectPendingQuestionRequestsForSession, rejectPendingQuestionRequestsForProject,
       buildAskUserQuestionUpdatedInput, listProjectCoordinatorTasks, projectTaskStatusForSession });
  `, {
    ...permissionPolicy,
    normalizePermissionMode, normalizeProjectId, normalizeStringList, deriveProjectSessionTaskStatus,
    randomUUID: () => `request-${++requestNumber}`,
    pendingQuestionRequests: pending,
    sessions: new Map([[record.id, record]]),
    isWebHost: false,
    mainWindow: { isDestroyed: () => false },
    readProjectSync: () => project,
    desktopSettings: { permissionMode: 'default' },
    emitToRenderer: (channel: string, payload: any) => events.push({ channel, payload }),
    emitSessionHistory: () => {},
    emitSessionMeta: () => {},
    appDecisionBroker: null,
    isBrowserAutomationAction: (action: string) => action === 'browser_snapshot',
    browserViewManager: { getAgentPageInfo: () => ({ tabId: 'tab', title: 'Page', url: 'https://example.test/page' }) },
    getBrowserAutomationOrigin: () => 'https://example.test',
    isLocalDevelopmentBrowserUrl: () => false,
    isBrowserAutomationFileWithinRoot: () => false,
    getSessionWorkspaceRoot: () => '/workspace',
    browserAutomationSessionOrigins: new Map(),
    pendingBrowserAutomationGrants: new Map(),
    describeBrowserAutomationAction: () => '读取页面并截图',
    redactBrowserAutomationUrl: (url: string) => url,
    listProjectAssets: async () => [],
    getProjectRootSessionRecords: () => [record],
    getProjectSessionFinalizerResultSync: () => null,
    getProjectWorkerTasks: () => [],
    isActiveProjectWorker: () => false,
    subAgentSessions: new Map(),
  });
  const answer = async (request: any, answers: object, annotations?: object) => api.respondToPendingQuestionRequest(request, {
    permissionDecision: {
      behavior: 'allow',
      updatedInput: api.buildAskUserQuestionUpdatedInput(request.input, answers, annotations),
    },
  });
  return { api, record, project, pending, events, answer };
}

describe('project questions use session permissions', () => {
  for (const projectId of [null, 'project']) {
    test(`${projectId || 'ordinary'} session waits for tool approval and preserves session grants`, async () => {
      const { api, record, pending, events, answer } = fixture(projectId);
      const input = { command: 'npm test' };
      const suggestions = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];
      const result = api.requestToolPermission(record, 'Bash', input, { suggestions });
      const request = [...pending.values()][0];
      expect(request).toBeDefined();
      expect(request.input.metadata.source).toBe('session:tool-permission');
      expect(request.input.metadata.toolInput).toEqual(input);
      expect(events.find(event => event.channel === 'agent:question-request')?.payload.sessionId).toBe(record.id);
      const question = request.input.questions[0];
      expect(question.options.map((option: any) => option.label)).toContain('本次会话允许');
      await answer(request, { [question.question]: '本次会话允许' });
      expect(await result).toEqual({ behavior: 'allow', updatedInput: input, updatedPermissions: suggestions });
      expect(pending.size).toBe(0);
    });
  }

  test('bypass permissions allows tools but still asks business questions despite legacy project policy', async () => {
    const { api, record, pending, answer } = fixture();
    record.permissionMode = 'bypassPermissions';
    expect(await api.requestToolPermission(record, 'Bash', { command: 'pwd', skip_confirmation: true }))
      .toEqual({ behavior: 'allow' });
    expect(pending.size).toBe(0);

    const question = {
      question: '选择发送日期', header: '日期',
      options: [{ label: '今天（推荐）', preview: '今天发送' }, { label: '明天', preview: '明天发送' }],
    };
    const result = api.requestToolPermission(record, 'AskUserQuestion', {
      questions: [question], metadata: { source: 'project:external-side-effect' },
    });
    const request = [...pending.values()][0];
    expect(request).toBeDefined();
    const annotations = { [question.question]: { preview: '明天发送', notes: '已核对' } };
    await answer(request, { [question.question]: '明天' }, annotations);
    expect(await result).toMatchObject({ behavior: 'allow', updatedInput: {
      answers: { [question.question]: '明天' }, annotations,
    } });
  });

  test('browser permissions use the session card and retain the website grant', async () => {
    const { api, record, pending, answer } = fixture();
    const input = { action: 'browser_snapshot', tab_id: 'tab' };
    const result = api.requestToolPermission(record, 'moss', input);
    const request = [...pending.values()][0];
    expect(request.input.metadata.source).toBe('session:tool-permission');
    await answer(request, { [request.input.questions[0].question]: '本次会话允许此网站' });
    expect(await result).toEqual({ behavior: 'allow', updatedInput: input });
    expect(await api.requestToolPermission(record, 'moss', input)).toEqual({ behavior: 'allow', updatedInput: input });
    expect(pending.size).toBe(0);
  });

  test('task attention follows live requests and clears after the last response', async () => {
    const { api, record, pending, events, answer } = fixture();
    const first = api.requestToolPermission(record, 'Bash', { command: 'pwd' });
    const second = api.requestToolPermission(record, 'AskUserQuestion', { questions: [{ question: '名称', options: [] }] });
    expect(await api.listProjectCoordinatorTasks('project')).toMatchObject([{ status: 'waiting_for_user', attentionCount: 2 }]);
    expect(api.projectTaskStatusForSession(record)).toBe('waiting_for_user');
    const [tool, question] = [...pending.values()];
    await api.respondToPendingQuestionRequest(tool, { permissionDecision: { behavior: 'deny', message: '取消命令' } });
    expect(await first).toEqual({ behavior: 'deny', message: '取消命令' });
    expect(await api.listProjectCoordinatorTasks('project')).toMatchObject([{ status: 'waiting_for_user', attentionCount: 1 }]);
    await answer(question, { 名称: '自定义名称' });
    expect(await second).toMatchObject({ updatedInput: { answers: { 名称: '自定义名称' } } });
    expect(await api.listProjectCoordinatorTasks('project')).toMatchObject([{ status: 'working', attentionCount: 0 }]);
    expect(api.projectTaskStatusForSession(record)).toBe('working');
    expect(events.filter(event => event.channel === 'project:changed')).toHaveLength(4);
    expect(await answer(question, { 名称: '重复回答' })).toMatchObject({ behavior: 'deny' });
  });

  test('canceling one session leaves other sessions waiting and project cancellation clears the remainder', async () => {
    const { api, record, pending } = fixture();
    const first = api.requestToolPermission(record, 'Bash', { command: 'pwd' });
    const second = api.requestToolPermission({ ...record, id: 'other' }, 'Bash', { command: 'pwd' });
    await api.rejectPendingQuestionRequestsForSession(record.id, 'stopped');
    expect(await first).toEqual({ behavior: 'deny', message: 'stopped' });
    expect([...pending.values()].map(request => request.sessionId)).toEqual(['other']);
    await api.rejectPendingQuestionRequestsForProject('project', 'project deleted');
    expect(await second).toEqual({ behavior: 'deny', message: 'project deleted' });
    expect(pending.size).toBe(0);
  });

  test('deleting a project rejects an outstanding approval and prevents new questions', async () => {
    const { api, record, project, pending, answer } = fixture();
    const result = api.requestToolPermission(record, 'Bash', { command: 'pwd' });
    const request = [...pending.values()][0];
    project.archivedAt = Date.now();
    expect(await answer(request, { [request.input.questions[0].question]: '允许运行' })).toMatchObject({ behavior: 'deny' });
    expect(await result).toMatchObject({ behavior: 'deny' });
    expect(await api.requestToolPermission(record, 'AskUserQuestion', { questions: [] })).toMatchObject({ behavior: 'deny' });
    expect(pending.size).toBe(0);
  });

  test('the active conversation displays project questions and tool permission cards', () => {
    const renderer = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
    const start = renderer.indexOf('const activeSessionQuestionRequest =');
    const end = renderer.indexOf('const workspaceTree =', start);
    const source = new Bun.Transpiler({ loader: 'tsx' }).transformSync(renderer.slice(start, end));
    const tool = { requestId: 'tool', sessionId: 'active', projectId: 'project', input: { metadata: { source: 'session:tool-permission' } } };
    const question = { requestId: 'question', sessionId: 'active', projectId: 'project', input: { questions: [] } };
    const select = (requests: any[]) => runInNewContext(`${source}; ({ activeToolPermissionRequest, activeQuestionRequest });`, {
      React: { useMemo: (compute: Function) => compute() },
      questionRequests: [{ sessionId: 'other', input: {} }, ...requests],
      activeSessionId: 'active',
    });
    expect(select([tool, question])).toEqual({ activeToolPermissionRequest: tool, activeQuestionRequest: null });
    expect(select([question])).toEqual({ activeToolPermissionRequest: null, activeQuestionRequest: question });
  });
});
