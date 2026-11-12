import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AgentTeamsStatus,
  AgentTeamsWorkbench,
} from '../src/renderer-react/components/agent-teams-workbench';
import { getTeamMembersAtFrame, memberMatchesQuery, messagesForMember, memberRelations } from '../src/renderer-react/lib/agent-team-members';
import type { AgentTeamsSessionState } from '../src/renderer-react/types';

const state: AgentTeamsSessionState = {
  sessionId: 'desktop-1',
  teams: [{
    schemaVersion: 1,
    sessionId: 'desktop-1',
    incarnationId: 'run-1',
    teamName: 'agent-team-demo',
    status: 'completed',
    createdAt: 1,
    updatedAt: '2026-09-16T10:00:01.000Z',
    deletedAt: '2026-09-16T10:00:01.000Z',
    snapshots: [0, 1].map((index) => ({
      capturedAt: `2026-09-16T10:00:0${index}.000Z`,
      phase: index === 0 ? 'executing' : 'completed',
      taskCounts: { total: 2, completed: index + 1, inProgress: index === 0 ? 1 : 0, pending: 0, blocked: 0 },
      team: {
        name: 'agent-team-demo',
        description: 'Ship Agent Teams',
        createdAt: 1,
        leadAgentId: 'lead',
        leadSessionId: 'engine-1',
        members: [
          { agentId: 'lead', name: 'team-lead', agentType: 'lead', model: 'sonnet', color: '', joinedAt: 1, cwd: '/tmp', status: 'idle' },
          { agentId: 'worker', name: 'worker', agentType: 'developer', model: 'sonnet', color: '', joinedAt: 1, cwd: '/tmp', status: 'idle' },
        ],
      },
      tasks: [
        { id: '1', subject: 'Implement', description: '', activeForm: '', owner: 'worker', status: 'completed', blocked: false, blocks: ['2'], blockedBy: [], metadata: {} },
        { id: '2', subject: 'Verify', description: '', activeForm: '', owner: null, status: index === 0 ? 'in_progress' : 'completed', blocked: false, blocks: [], blockedBy: ['1'], metadata: {} },
      ],
      messages: [],
    })),
  }],
};

test('Agent Teams header status and workbench expose archived DAG playback', () => {
  const status = renderToStaticMarkup(<AgentTeamsStatus state={state} onOpen={() => {}} />);
  const workbench = renderToStaticMarkup(<AgentTeamsWorkbench state={state} onClose={() => {}} />);

  expect(status).toContain('Agent Teams 已完成');
  expect(status).toContain('2/2');
  expect(status).not.toContain('跟随');
  expect(workbench).toContain('Agent Teams · 共享任务图');
  expect(workbench).not.toContain('Ship Agent Teams');
  expect(workbench).not.toContain('按依赖分层 · 左至右');
  expect(workbench).toContain('成员拓扑');
  expect(workbench).toContain('任务依赖');
  expect(workbench).toContain('任务分配');
  expect(workbench).toContain('worker');
  expect(workbench).toContain('aria-label="团队历史时间轴"');
  expect(workbench).toContain('aria-label="从头播放团队历史"');
  expect(workbench).toContain('lg:w-1/2');
});

test('shutdown retains departed teammates and clears stale running status without changing the archive', () => {
  const archive = structuredClone(state);
  const run = archive.teams[0];
  const shutdown = structuredClone(run.snapshots.at(-1)!);
  shutdown.team.members = [{ ...shutdown.team.members[0], status: 'running' }];
  shutdown.phase = 'interrupted';
  run.status = 'interrupted';
  run.snapshots.push(shutdown);
  const original = JSON.stringify(archive);
  const members = getTeamMembersAtFrame(run);
  expect(members.find(member => member.name === 'worker')).toMatchObject({ present: false, activity: 'completed' });
  expect(members.find(member => member.name === 'team-lead')?.activity).toBe('interrupted');
  const workbench = renderToStaticMarkup(<AgentTeamsWorkbench state={archive} onClose={() => {}} />);
  expect(workbench).toContain('查看成员 worker，任务完成');
  expect(workbench).toContain('已退出团队');
  expect(workbench).toContain('0 个正在工作');
  expect(renderToStaticMarkup(<AgentTeamsStatus state={archive} onOpen={() => {}} />)).toContain('Team 2');
  expect(JSON.stringify(archive)).toBe(original);
});

test('completed assignments do not remain marked working during wrapping-up', () => {
  const run = structuredClone(state.teams[0]);
  const latest = run.snapshots.at(-1)!;
  latest.team.members = latest.team.members.map(member => ({ ...member, status: 'running' as const }));
  latest.phase = 'wrapping_up';
  run.status = 'live';
  const members = getTeamMembersAtFrame(run);
  expect(members.find(member => member.name === 'worker')?.activity).toBe('completed');
  const status = renderToStaticMarkup(<AgentTeamsStatus state={{ ...state, teams: [run] }} onOpen={() => {}} />);
  expect(status).toContain('收尾中');
  expect(status).toContain('任务 2/2');
  expect(status).toContain('进行中 0');
});

test('replay shows only members known at the selected frame and restores rejoined members', () => {
  const run = structuredClone(state.teams[0]);
  run.snapshots[0].team.members = [run.snapshots[0].team.members[0]];
  run.snapshots[0].tasks = [];
  expect(getTeamMembersAtFrame(run, 0).map(member => member.name)).toEqual(['team-lead']);
  const departed = structuredClone(run.snapshots[1]);
  departed.team.members = [departed.team.members[0]];
  departed.phase = 'executing';
  departed.tasks[0].status = 'in_progress';
  run.snapshots.push(departed);
  expect(getTeamMembersAtFrame(run, 2).find(member => member.name === 'worker')?.activity).toBe('departed');
  const rejoined = structuredClone(run.snapshots[1]);
  rejoined.phase = 'executing';
  rejoined.team.members[1].status = 'running';
  rejoined.tasks[0].status = 'in_progress';
  run.snapshots.push(rejoined);
  expect(getTeamMembersAtFrame(run, 3).find(member => member.name === 'worker')).toMatchObject({ present: true, activity: 'working' });
});

test('bounded archives recover explicit team assignees without inventing members for arbitrary owners', () => {
  const run = structuredClone(state.teams[0]);
  run.snapshots = [run.snapshots[1]];
  run.snapshots[0].team.members = [run.snapshots[0].team.members[0]];
  run.snapshots[0].tasks[0].metadata = { agentTeamAssignment: true, agentTeamAgentId: 'worker', agentTeamAgentName: 'worker' };
  run.snapshots[0].tasks[1].owner = 'external-reviewer';
  expect(getTeamMembersAtFrame(run).map(member => member.name)).toEqual(['team-lead', 'worker']);
});

test('member search includes tasks and relationships use actual dependencies and human messages', () => {
  const snapshot = structuredClone(state.teams[0].snapshots[0]);
  const worker = snapshot.team.members[1];
  snapshot.tasks[1].owner = 'team-lead';
  snapshot.messages = [
    { id: 'control', from: 'worker', to: 'team-lead', text: '{"type":"idle_notification"}', timestamp: '2026-09-16T10:00:00Z', read: true, color: '', summary: '' },
    { id: 'reply', from: 'worker', to: 'team-lead', text: 'Implementation ready for verification', timestamp: '2026-09-16T10:00:01Z', read: true, color: '', summary: 'Ready for verification' },
  ];
  expect(memberMatchesQuery(worker, snapshot, 'IMPLEMENT')).toBe(true);
  expect(memberMatchesQuery(worker, snapshot, 'missing')).toBe(false);
  expect(messagesForMember(snapshot.messages, worker).map(message => message.id)).toEqual(['reply']);
  expect(memberRelations(worker, snapshot.team.members, snapshot)).toMatchObject([{ member: { name: 'team-lead' }, upstream: 0, downstream: 1, messages: 1 }]);
  const markup = renderToStaticMarkup(<AgentTeamsWorkbench state={state} onClose={() => {}} />);
  expect(markup).toContain('Implement');
  expect(markup).toContain('搜索 Agent 或任务');
  expect(markup).toContain('筛选 Agent 状态');
});
