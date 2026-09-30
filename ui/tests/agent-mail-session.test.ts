import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as mailContext from '../src/agent-mail-context.mjs';

const mainSource = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

function sourceBetween(startMarker: string, endMarker: string) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing mail session source: ${startMarker}`);
  return mainSource.slice(start, end);
}

// Exercise the actual mailbox routing and prompt lifecycle without starting Electron.
const sessionSource = sourceBetween('function getAgentMailSessionMode()', 'function createAgentMailApproval(');
const promptSource = sourceBetween('async function runSessionPromptNow(', 'async function runSessionPrompt(');

function createHarness(sessionMode = 'fixed') {
  const sessions = new Map<string, any>();
  const runtimes = new Map<string, any>();
  const assignments = new Map<string, string>();
  const resumedIds: string[] = [];
  const shutdownIds: string[] = [];
  const noop = () => {};
  const context: any = {
    ...mailContext,
    sessions,
    desktopSettings: { agentMail: { sessionMode, inboxSessionIds: {} } },
    saveDesktopSettings: (settings: unknown) => { context.desktopSettings = settings; },
    getDesktopAgentMode: () => 'local',
    createSessionRecord: (options: object) => {
      const record = {
        id: `session-${sessions.size + 1}`,
        history: [],
        underlyingSessionId: null,
        runtime: null,
        ...options,
      };
      sessions.set(record.id, record);
      return record;
    },
    desktopStateStore: { listPendingDecisions: () => [], listTerminalDecisions: () => [] },
    agentMailStore: {
      assignSession: (mailboxKey: string, messageId: string, sessionId: string) => {
        assignments.set(`${mailboxKey}/${messageId}`, sessionId);
      },
      getThreadContext: () => ({ summaryText: 'LEGACY_THREAD_SUMMARY' }),
    },
    persistAgentMailThreadSummary: noop,
    assertWorkspaceVersionIdle: noop,
    localTranscriptSync: { refresh: noop, acknowledge: noop },
    shutdownSessionAgentTeam: (record: any) => { shutdownIds.push(record.id); },
    agentTeamsService: { checkNow: noop },
    disposeRuntime: (record: any) => { record.runtime = null; },
    resumeSessionRecord: async (record: any) => {
      resumedIds.push(record.underlyingSessionId);
      record.runtime = runtimes.get(record.underlyingSessionId);
      if (!record.runtime) throw new Error('Missing saved runtime');
      return record.runtime;
    },
    ensureRuntime: async (record: any) => {
      if (record.runtime) return record.runtime;
      const runtime = {
        sessionId: `runtime-${runtimes.size + 1}`,
        prompts: [] as string[],
        async *send(prompt: string) {
          this.prompts.push(prompt);
          yield {
            type: 'assistant',
            session_id: this.sessionId,
            message: { content: `已处理 ${this.prompts.length} 封邮件` },
          };
        },
      };
      runtimes.set(runtime.sessionId, runtime);
      record.runtime = runtime;
      return runtime;
    },
    maybeUpdateUnderlyingSessionId: (record: any, id: string) => {
      if (id) record.underlyingSessionId = id;
    },
    schedulePersistSession: noop,
    buildVisibleUserEvent: (text: string) => ({ type: 'user', message: { content: text } }),
    appendVisibleUserEvent: (record: any, _sender: string, event: unknown) => record.history.push(event),
    appendRuntimeMessageToSession: (record: any, event: unknown) => record.history.push(event),
    beginSessionBusyTiming: noop,
    clearSessionBusyTiming: noop,
    emitSessionMeta: noop,
    emitSessionHistory: noop,
    emitToRenderer: noop,
    getSessionSummary: () => ({}),
    snapshotSessionTasks: () => [],
    normalizeReplayUserText: (text: string) => text,
    extractTextFromRuntimePrompt: (prompt: string) => prompt,
    extractTextFromUserReplayMessage: () => '',
    isTopLevelUserPromptEcho: () => false,
    isCompactBoundaryMessage: () => false,
    extractTextFromAssistantMessage: (message: any) => message.message.content,
    isPromptTooLongText: () => false,
    isPromptTooLongError: () => false,
    AUTOMATIC_COMPACT_PROMPT: '/compact',
    scheduleSubAgentSessionSync: noop,
    isSessionBusyForRenderer: (record: any) => record.busy,
    refreshSessionHistoryFromTranscriptAfterTurn: noop,
    syncSubAgentSessionsBestEffort: noop,
    applyPendingMcpRuntimeReload: () => false,
  };
  const run = runInNewContext([
    promptSource,
    'const runSessionPrompt = runSessionPromptNow;',
    sessionSource,
    'runAgentMailMessage;',
  ].join('\n'), context);

  const receive = (id: string, {
    mailboxKey = 'mailbox:account-1',
    fromUserId = 'sender',
    fromName = '',
    sessionId = '',
  } = {}) => run({
    messageId: id,
    threadId: `thread-${id}`,
    fromUserId,
    fromName,
    subject: id,
    content: `处理邮件 ${id}`,
  }, { mailboxKey, sessionId });

  return {
    receive, sessions, runtimes, resumedIds, shutdownIds, assignments,
    get settings() { return context.desktopSettings; },
  };
}

describe('Agent Mail session continuity', () => {
  test('continues one sender’s Agent across mail threads and resumes it after a restart', async () => {
    const harness = createHarness();
    expect(await harness.receive('first')).toBe('已处理 1 封邮件');
    const record = [...harness.sessions.values()][0];
    const originalRuntime = record.runtime;
    const originalId = record.underlyingSessionId;

    expect(await harness.receive('second')).toBe('已处理 2 封邮件');
    expect(record.runtime).toBe(originalRuntime);
    expect(record.underlyingSessionId).toBe(originalId);
    expect(originalRuntime.prompts[0]).toContain('处理邮件 first');
    expect(originalRuntime.prompts[1]).toContain('处理邮件 second');
    expect(originalRuntime.prompts.join('\n')).not.toContain('LEGACY_THREAD_SUMMARY');
    expect(harness.shutdownIds).toEqual([]);

    record.runtime = null;
    expect(await harness.receive('after-restart')).toBe('已处理 3 封邮件');
    expect(harness.resumedIds).toEqual([originalId]);
    expect(record.underlyingSessionId).toBe(originalId);
    expect(harness.runtimes.size).toBe(1);
    expect(harness.sessions.size).toBe(1);
    expect(record.history.filter((event: any) => event.type === 'user')).toHaveLength(3);
  });

  test('uses separate fixed sessions for different mailbox accounts', async () => {
    const harness = createHarness();
    expect(await harness.receive('first', { mailboxKey: 'mailbox:account-1' })).toBe('已处理 1 封邮件');
    expect(await harness.receive('second', { mailboxKey: 'mailbox:account-2' })).toBe('已处理 1 封邮件');
    expect(await harness.receive('third', { mailboxKey: 'mailbox:account-1' })).toBe('已处理 2 封邮件');
    expect(harness.sessions.size).toBe(2);
    expect(harness.runtimes.size).toBe(2);
  });

  test('keeps A and B in separate sessions and identifies senders by user ID after a rename', async () => {
    const harness = createHarness();
    expect(await harness.receive('a-first', { fromUserId: 'a', fromName: 'Alice' })).toBe('已处理 1 封邮件');
    const alice = [...harness.sessions.values()][0];
    expect(alice.title).toBe('协作邮箱 · Alice');

    expect(await harness.receive('b-first', {
      fromUserId: 'b', fromName: 'Bob', sessionId: alice.id,
    })).toBe('已处理 1 封邮件');
    const bob = [...harness.sessions.values()][1];
    expect(bob.title).toBe('协作邮箱 · Bob');
    expect(harness.assignments.get('mailbox:account-1/b-first')).toBe(bob.id);

    expect(await harness.receive('a-second', { fromUserId: 'a', fromName: 'Alice New' })).toBe('已处理 2 封邮件');
    expect(await harness.receive('b-second', { fromUserId: 'b' })).toBe('已处理 2 封邮件');
    expect(alice.runtime.prompts.join('\n')).not.toContain('处理邮件 b-');
    expect(bob.runtime.prompts.join('\n')).not.toContain('处理邮件 a-');
    expect(harness.sessions.size).toBe(2);
    expect(harness.runtimes.size).toBe(2);
  });

  test('preserves legacy mixed history and reroutes queued mail to its sender session', async () => {
    const harness = createHarness();
    const legacy = { id: 'legacy', sessionKind: 'agent-mail', history: ['A and B mixed history'] };
    harness.sessions.set(legacy.id, legacy);
    harness.settings.agentMail.inboxSessionIds['mailbox:account-1'] = legacy.id;

    expect(await harness.receive('queued', { sessionId: legacy.id })).toBe('已处理 1 封邮件');
    const assignedId = harness.assignments.get('mailbox:account-1/queued');
    expect(assignedId).not.toBe(legacy.id);
    expect(harness.sessions.get(legacy.id)).toEqual(legacy);
    expect(await harness.receive('next')).toBe('已处理 2 封邮件');
    expect(harness.assignments.get('mailbox:account-1/next')).toBe(assignedId);
    expect(harness.sessions.size).toBe(2);
  });

  test('rejects missing sender identity instead of creating a shared fallback session', async () => {
    const harness = createHarness();
    await expect(harness.receive('unknown', { fromUserId: '' })).rejects.toThrow('sender identity');
    expect(harness.sessions.size).toBe(0);
  });

  test('starts independent Agents when each mail requests a new session', async () => {
    const harness = createHarness('new');
    expect(await harness.receive('first')).toBe('已处理 1 封邮件');
    expect(await harness.receive('second')).toBe('已处理 1 封邮件');
    expect(harness.sessions.size).toBe(2);
    expect(harness.runtimes.size).toBe(2);
    expect(harness.resumedIds).toEqual([]);
  });
});
