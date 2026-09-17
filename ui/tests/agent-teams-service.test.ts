import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentTeamsService,
  deriveTeamPhase,
  getTeamIncarnationId,
  isAgentTeamContinuationPrompt,
  sanitizeTeamName,
} from '../src/agent-teams/agent-teams-service.mjs';

const temporaryRoots: string[] = [];

async function createRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-agent-teams-'));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(filePath: string, value: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value), 'utf8');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('Agent Teams archive service', () => {
  it('derives workflow phases from shared task state', () => {
    expect(deriveTeamPhase([])).toBe('forming');
    expect(deriveTeamPhase([{ status: 'pending', blocked: false }])).toBe('ready');
    expect(deriveTeamPhase([{ status: 'in_progress', blocked: false }])).toBe('executing');
    expect(deriveTeamPhase([{ status: 'pending', blocked: true }])).toBe('blocked');
    expect(deriveTeamPhase([{ status: 'completed', blocked: false }])).toBe('wrapping_up');
    expect(deriveTeamPhase([], 'completed')).toBe('completed');
    expect(isAgentTeamContinuationPrompt('继续')).toBe(true);
    expect(isAgentTeamContinuationPrompt('Continue from where you left off.')).toBe(true);
    expect(isAgentTeamContinuationPrompt('开始一个新的检查')).toBe(false);
    expect(sanitizeTeamName('QA_Team')).toBe('qa-team');
  });

  it('uses the runtime team directory sanitizer and persists idle members', async () => {
    const mossHome = await createRoot();
    const sessionDir = path.join(mossHome, 'sessions', 'desktop-canonical');
    const team = {
      name: 'QA_Team',
      createdAt: 100,
      leadAgentId: 'team-lead@QA_Team',
      leadSessionId: 'engine-canonical',
      members: [
        { agentId: 'team-lead@QA_Team', name: 'team-lead', isActive: true },
        { agentId: 'tester@QA_Team', name: 'tester', isActive: false },
      ],
    };
    const canonicalName = sanitizeTeamName(team.name);
    await writeJson(path.join(mossHome, 'teams', canonicalName, 'config.json'), team);
    await writeJson(path.join(mossHome, 'tasks', canonicalName, '1.json'), {
      id: '1',
      subject: 'Run tests',
      description: 'Run the assigned checks',
      status: 'in_progress',
      owner: 'tester',
      blocks: [],
      blockedBy: [],
    });
    const service = createAgentTeamsService({
      mossHome,
      getSessionRecords: () => [{ id: 'desktop-canonical', underlyingSessionId: 'engine-canonical' }],
      getSessionDir: () => sessionDir,
      pollIntervalMs: 60_000,
    });

    await service.checkNow();
    const snapshot = (await service.getSessionState('desktop-canonical'))
      .teams[0]?.snapshots.at(-1);
    expect(snapshot?.tasks).toHaveLength(1);
    expect(snapshot?.team.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tester', status: 'idle' }),
    ]));
  });

  it('removes terminal receipts instead of archiving them for a deleted session', async () => {
    const mossHome = await createRoot();
    const sessionDir = path.join(mossHome, 'sessions', 'desktop-deleted');
    const team = {
      name: 'deleted-team',
      createdAt: 100,
      leadAgentId: 'team-lead@deleted-team',
      leadSessionId: 'engine-deleted',
      members: [],
    };
    const incarnationId = getTeamIncarnationId(team);
    const receiptPath = path.join(
      mossHome,
      'tasks',
      '.agent-team-terminals',
      `${incarnationId}.json`,
    );
    await writeJson(receiptPath, {
      schemaVersion: 1,
      incarnationId,
      teamName: team.name,
      capturedAt: '2026-09-17T01:00:00.000Z',
      reason: 'interrupted',
      team,
      tasks: [],
      messages: [{
        from: 'worker',
        to: 'team-lead',
        text: 'sensitive result',
        timestamp: '2026-09-17T01:00:00.000Z',
      }],
    });
    const service = createAgentTeamsService({
      mossHome,
      getSessionRecords: () => [{
        id: 'desktop-deleted',
        underlyingSessionId: 'engine-deleted',
        deleted: true,
      }],
      getSessionDir: () => sessionDir,
      pollIntervalMs: 60_000,
    });

    await service.checkNow();
    await expect(fsp.stat(receiptPath)).rejects.toThrow();
    expect((await service.getSessionState('desktop-deleted')).teams).toHaveLength(0);

    await writeJson(receiptPath, {
      schemaVersion: 1,
      incarnationId,
      teamName: team.name,
      capturedAt: '2026-09-17T01:00:01.000Z',
      reason: 'interrupted',
      team,
      tasks: [],
      messages: [],
    });
    expect(await service.discardTerminalReceiptsForSession(
      'desktop-deleted',
      'engine-deleted',
    )).toBe(1);
    await expect(fsp.stat(receiptPath)).rejects.toThrow();
  });

  it('retires a missing live run and finishes its lead summary only after a successful recovery turn', async () => {
    const mossHome = await createRoot();
    const sessionDir = path.join(mossHome, 'sessions', 'desktop-recovery');
    const incarnationId = 'recovery-run-1234';
    const interruptedAt = '2026-09-17T01:20:52.035Z';
    const runPath = path.join(sessionDir, 'agent-teams', `${incarnationId}.json`);
    const memberTask = {
      id: '1',
      subject: 'Check CPU',
      description: 'Inspect CPU',
      activeForm: 'Checking CPU',
      owner: 'cpu-checker',
      status: 'completed',
      blocks: ['2'],
      blockedBy: [],
      metadata: { agentTeamAssignment: true },
      blocked: false,
    };
    const summaryTask = {
      id: '2',
      subject: 'Summarize findings',
      description: 'Report final result',
      activeForm: 'Summarizing findings',
      owner: null,
      status: 'in_progress',
      blocks: [],
      blockedBy: ['1'],
      metadata: {},
      blocked: false,
    };
    await writeJson(runPath, {
      schemaVersion: 1,
      sessionId: 'desktop-recovery',
      incarnationId,
      teamName: 'recovery-team',
      status: 'live',
      createdAt: Date.parse('2026-09-17T01:19:48.000Z'),
      updatedAt: interruptedAt,
      deletedAt: null,
      snapshots: [{
        capturedAt: interruptedAt,
        phase: 'executing',
        taskCounts: { total: 2, completed: 1, inProgress: 1, pending: 0, blocked: 0 },
        team: {
          name: 'recovery-team',
          description: 'Recover after restart',
          createdAt: Date.parse('2026-09-17T01:19:48.000Z'),
          leadAgentId: 'team-lead@recovery-team',
          leadSessionId: 'engine-recovery',
          members: [
            { agentId: 'team-lead@recovery-team', name: 'team-lead', status: 'running' },
            { agentId: 'cpu-checker@recovery-team', name: 'cpu-checker', status: 'running' },
          ],
        },
        tasks: [memberTask, summaryTask],
        messages: [],
      }],
    });
    const records = [{
      id: 'desktop-recovery',
      underlyingSessionId: 'engine-recovery',
      busy: false,
      history: [],
    }];
    const service = createAgentTeamsService({
      mossHome,
      getSessionRecords: () => records,
      getSessionDir: () => sessionDir,
      pollIntervalMs: 60_000,
    });

    expect(await service.getRecoveryPlan('desktop-recovery')).toBeNull();
    const plan = await service.prepareRecoveryForTurn('desktop-recovery');
    expect(plan).toMatchObject({
      incarnationId,
      mode: 'finish_summary',
      incompleteTasks: [{ id: '2', status: 'in_progress' }],
    });
    expect(typeof plan?.attemptId).toBe('string');
    expect(plan?.instruction).toContain('do not recreate member agents');
    const completionMarker = `<!-- moss-agent-team-recovery-complete:${plan?.attemptId} -->`;
    const recoveryStartedAt = (await service.getSessionState('desktop-recovery'))
      .teams[0].recoveryAttempt.startedAt;
    expect(await service.reconcileRecoveryTurn(
      'desktop-recovery',
      incarnationId,
      plan?.attemptId,
      {
        assistantText: '最终汇总已准备完成。',
        turnSucceeded: false,
      },
    )).toBe(false);
    expect(await service.reconcileRecoveryTurn(
      'desktop-recovery',
      incarnationId,
      plan?.attemptId,
      {
        assistantText: '最终汇总已经完成，但缺少本次恢复的确认标记。',
        turnSucceeded: true,
      },
    )).toBe(false);

    records[0].history = [
      { type: 'user', prompt: '继续吧', timestamp: recoveryStartedAt + 1 },
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: `最终汇总：CPU 检查已经完成，系统当前负载较高，建议检查正在运行的编译任务。${completionMarker}`,
          }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: `最终汇总：CPU 检查已经完成，系统当前负载较高。${completionMarker}`,
      },
    ];
    records[0].busy = true;
    await service.reconcilePersistedContinuations('desktop-recovery');
    expect((await service.getSessionState('desktop-recovery')).teams[0].status)
      .toBe('interrupted');

    records[0].busy = false;
    records[0].history[0].timestamp = null;
    await service.reconcilePersistedContinuations('desktop-recovery');
    expect((await service.getSessionState('desktop-recovery')).teams[0].status)
      .toBe('interrupted');

    records[0].history = [
      { type: 'user', prompt: '继续', timestamp: recoveryStartedAt + 1 },
      { type: 'result', subtype: 'error', is_error: true, result: 'API Error' },
      { type: 'user', prompt: '解释一下其他问题', timestamp: recoveryStartedAt + 2 },
      { type: 'result', subtype: 'success', is_error: false, result: `无关回答${completionMarker}` },
    ];
    await service.reconcilePersistedContinuations('desktop-recovery');
    expect((await service.getSessionState('desktop-recovery')).teams[0].status)
      .toBe('interrupted');

    records[0].history = [
      { type: 'user', prompt: '继续吧', timestamp: recoveryStartedAt + 1 },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: `最终汇总：CPU 检查已经完成，系统当前负载较高。${completionMarker}`,
      },
    ];
    await service.reconcilePersistedContinuations('desktop-recovery');
    const state = await service.getSessionState('desktop-recovery');
    const recovered = state.teams[0];
    expect(recovered.status).toBe('completed');
    expect(recovered.snapshots).toHaveLength(3);
    expect(recovered.snapshots.at(-1)?.phase).toBe('completed');
    expect(recovered.snapshots.at(-1)?.tasks[1]).toMatchObject({
      id: '2',
      owner: 'team-lead',
      status: 'completed',
      metadata: { agentTeamRecoveredAfterRestart: true },
    });
    expect(recovered.snapshots.at(-1)?.recovery).toMatchObject({
      type: 'desktop_restart_continuation',
    });
    expect(recovered.recoveryAttempt).toMatchObject({
      id: plan?.attemptId,
      status: 'completed',
    });
  });

  it('does not infer empty or unassigned pending work as a lead summary', async () => {
    const mossHome = await createRoot();
    const sessionDir = path.join(mossHome, 'sessions', 'desktop-ambiguous');
    const incarnationId = 'ambiguous-run-1234';
    const runPath = path.join(sessionDir, 'agent-teams', `${incarnationId}.json`);
    const baseRun = {
      schemaVersion: 1,
      sessionId: 'desktop-ambiguous',
      incarnationId,
      teamName: 'ambiguous-team',
      status: 'interrupted',
      createdAt: 100,
      updatedAt: '2026-09-17T01:20:52.035Z',
      deletedAt: '2026-09-17T01:20:52.035Z',
    };
    const team = {
      name: 'ambiguous-team',
      description: 'Ambiguous recovery',
      createdAt: 100,
      leadAgentId: 'team-lead@ambiguous-team',
      leadSessionId: 'engine-ambiguous',
      members: [],
    };
    await writeJson(runPath, {
      ...baseRun,
      snapshots: [{
        capturedAt: baseRun.updatedAt,
        phase: 'interrupted',
        taskCounts: { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0 },
        team,
        tasks: [],
        messages: [],
      }],
    });
    const service = createAgentTeamsService({
      mossHome,
      getSessionRecords: () => [],
      getSessionDir: () => sessionDir,
      pollIntervalMs: 60_000,
    });

    expect(await service.getRecoveryPlan('desktop-ambiguous')).toMatchObject({
      mode: 'rerun_missing_members',
      incompleteTasks: [],
    });

    const completedAssignment = {
      id: '1',
      subject: 'Prepare input',
      description: '',
      activeForm: '',
      owner: 'worker',
      status: 'completed',
      blocks: ['2'],
      blockedBy: [],
      metadata: { agentTeamAssignment: true },
      blocked: false,
    };
    const pendingUnassignedWork = {
      id: '2',
      subject: 'Run integration test',
      description: '',
      activeForm: '',
      owner: null,
      status: 'pending',
      blocks: [],
      blockedBy: ['1'],
      metadata: {},
      blocked: false,
    };
    await writeJson(runPath, {
      ...baseRun,
      snapshots: [{
        capturedAt: baseRun.updatedAt,
        phase: 'interrupted',
        taskCounts: { total: 2, completed: 1, inProgress: 0, pending: 1, blocked: 0 },
        team,
        tasks: [completedAssignment, pendingUnassignedWork],
        messages: [],
      }],
    });
    expect(await service.getRecoveryPlan('desktop-ambiguous')).toMatchObject({
      mode: 'rerun_missing_members',
      incompleteTasks: [{ id: '2', status: 'pending' }],
    });
  });

  it('keeps interrupted member work explicit so the UI can start a new team', async () => {
    const mossHome = await createRoot();
    const sessionDir = path.join(mossHome, 'sessions', 'desktop-rerun');
    const incarnationId = 'rerun-members-1234';
    await writeJson(path.join(sessionDir, 'agent-teams', `${incarnationId}.json`), {
      schemaVersion: 1,
      sessionId: 'desktop-rerun',
      incarnationId,
      teamName: 'rerun-team',
      status: 'interrupted',
      createdAt: 100,
      updatedAt: '2026-09-17T01:20:52.035Z',
      deletedAt: '2026-09-17T01:20:52.035Z',
      snapshots: [{
        capturedAt: '2026-09-17T01:20:52.035Z',
        phase: 'interrupted',
        taskCounts: { total: 1, completed: 0, inProgress: 1, pending: 0, blocked: 0 },
        team: {
          name: 'rerun-team',
          description: 'Missing member work',
          createdAt: 100,
          leadAgentId: 'team-lead@rerun-team',
          leadSessionId: 'engine-rerun',
          members: [],
        },
        tasks: [{
          id: '1',
          subject: 'Check disk',
          description: 'Inspect disk',
          activeForm: 'Checking disk',
          owner: 'disk-checker',
          status: 'in_progress',
          blocks: [],
          blockedBy: [],
          metadata: { agentTeamAssignment: true },
          blocked: false,
        }],
        messages: [],
      }],
    });
    const service = createAgentTeamsService({
      mossHome,
      getSessionRecords: () => [],
      getSessionDir: () => sessionDir,
      pollIntervalMs: 60_000,
    });

    const plan = await service.getRecoveryPlan('desktop-rerun');
    expect(plan).toMatchObject({
      mode: 'rerun_missing_members',
      incompleteTasks: [{ id: '1', subject: 'Check disk' }],
    });
    expect(plan?.instruction).toContain('create a new Agent Team incarnation');
    expect(await service.reconcileRecoveryTurn(
      'desktop-rerun',
      incarnationId,
      'not-a-recovery-attempt',
      {
        assistantText: 'This answer must not complete missing member work.',
        turnSucceeded: true,
      },
    )).toBe(false);
  });

  it('archives live updates, terminal deletion, and a later same-name incarnation', async () => {
    const mossHome = await createRoot();
    const sessionDir = path.join(mossHome, 'sessions', 'desktop-1');
    const team = {
      name: 'agent-team-demo',
      description: 'demo',
      createdAt: 100,
      leadAgentId: 'team-lead@agent-team-demo',
      leadSessionId: 'engine-1',
      members: [{ agentId: 'lead', name: 'team-lead', agentType: 'lead', joinedAt: 100 }],
    };
    const task = {
      id: '1',
      subject: 'Implement archive',
      description: 'Persist the run',
      status: 'in_progress',
      blocks: [],
      blockedBy: [],
    };
    await writeJson(path.join(mossHome, 'teams', team.name, 'config.json'), team);
    await writeJson(path.join(mossHome, 'tasks', team.name, '1.json'), task);

    const emitted: unknown[] = [];
    const service = createAgentTeamsService({
      mossHome,
      getSessionRecords: () => [{ id: 'desktop-1', underlyingSessionId: 'engine-1' }],
      getSessionDir: () => sessionDir,
      emit: (_channel: string, payload: unknown) => emitted.push(payload),
      pollIntervalMs: 60_000,
    });

    await service.checkNow();
    let state = await service.getSessionState('desktop-1');
    expect(state.teams).toHaveLength(1);
    expect(state.teams[0].status).toBe('live');
    expect(state.teams[0].snapshots.at(-1)?.phase).toBe('executing');

    await writeJson(path.join(mossHome, 'tasks', team.name, '1.json'), { ...task, status: 'completed' });
    await writeJson(path.join(mossHome, 'tasks', team.name, '2.json'), {
      ...task,
      id: '2',
      subject: 'Use archive',
      status: 'pending',
      blockedBy: ['1'],
    });
    await service.checkNow();
    state = await service.getSessionState('desktop-1');
    expect(state.teams[0].snapshots.at(-1)?.phase).toBe('ready');
    expect(state.teams[0].snapshots.at(-1)?.taskCounts.blocked).toBe(0);
    expect(state.teams[0].snapshots.at(-1)?.tasks[1]?.blockedBy).toEqual(['1']);

    const incarnationId = getTeamIncarnationId(team);
    await writeJson(path.join(mossHome, 'tasks', '.agent-team-terminals', `${incarnationId}.json`), {
      schemaVersion: 1,
      incarnationId,
      teamName: team.name,
      capturedAt: '2026-09-16T10:00:00.000Z',
      reason: 'completed',
      team,
      tasks: [
        { ...task, status: 'completed' },
        { ...task, id: '2', status: 'completed', blockedBy: ['1'] },
      ],
      messages: [],
    });
    await service.checkNow();

    state = await service.getSessionState('desktop-1');
    expect(state.teams[0].status).toBe('completed');
    expect(state.teams[0].snapshots.at(-1)?.phase).toBe('completed');
    expect(await fsp.stat(path.join(sessionDir, 'agent-teams', `${incarnationId}.json`))).toBeTruthy();

    await fsp.rm(path.join(mossHome, 'teams', team.name), { recursive: true, force: true });
    await fsp.rm(path.join(mossHome, 'tasks', team.name), { recursive: true, force: true });

    const nextTeam = { ...team, createdAt: 200 };
    await writeJson(path.join(mossHome, 'teams', team.name, 'config.json'), nextTeam);
    await writeJson(path.join(mossHome, 'tasks', team.name, '1.json'), { ...task, status: 'pending' });
    await service.checkNow();

    state = await service.getSessionState('desktop-1');
    expect(state.teams).toHaveLength(2);
    expect(new Set(state.teams.map((run) => run.incarnationId)).size).toBe(2);
    expect(state.teams.filter((run) => run.teamName === team.name)).toHaveLength(2);
    expect(emitted.length).toBeGreaterThan(1);

    await fsp.rm(path.join(mossHome, 'teams', team.name), { recursive: true, force: true });
    await fsp.rm(path.join(mossHome, 'tasks', team.name), { recursive: true, force: true });
    await service.checkNow();
    await service.checkNow();
    state = await service.getSessionState('desktop-1');
    expect(state.teams.find((run) => run.incarnationId === getTeamIncarnationId(nextTeam))?.status)
      .toBe('interrupted');
  });
});
